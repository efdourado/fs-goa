"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useGoaFormat } from "./format";
import type { CatalogLibrary, CatalogRecommender, Id } from "./types";
import { cx } from "./ui";

/** Where a catalogue lives: the caller's own space, or one group's. */
export type CatalogScope = "personal" | { groupId: Id };

export function scopeKey(scope: CatalogScope): string {
  return scope === "personal" ? "personal" : scope.groupId;
}

/**
 * A library's display name: whatever someone typed, or the product name for its
 * source (Screens, Pages, Tables) until they rename it. `label` is never
 * interpreted — the opaque `kind` is what everything else keys off.
 */
export function useLibraryName(): (library: Pick<CatalogLibrary, "label" | "source">) => string {
  const t = useTranslations("libraries");
  return (library) => library.label?.trim() || t(`source.${library.source}`);
}

/** The two built-in libraries every workspace can use before it has created anything. */
export const BUILT_IN_LIBRARIES: ReadonlyArray<{ kind: "film" | "book"; source: "screens" | "pages" }> = [
  { kind: "film", source: "screens" },
  { kind: "book", source: "pages" },
];

/** Libraries as a picker sees them: real ones plus the built-ins not created yet (made the first time they get an item). */
export interface LibraryChoice {
  /** `null` for a built-in that doesn't exist yet. */
  id: Id | null;
  kind: string;
  source: CatalogLibrary["source"];
  label: string | null;
}

export function libraryChoices(libraries: CatalogLibrary[]): LibraryChoice[] {
  const real = libraries.map<LibraryChoice>((library) => ({ id: library.id, kind: library.kind, source: library.source, label: library.label }));
  const missing = BUILT_IN_LIBRARIES
    .filter((builtIn) => !libraries.some((library) => library.kind === builtIn.kind))
    .map<LibraryChoice>((builtIn) => ({ id: null, kind: builtIn.kind, source: builtIn.source, label: null }));
  return [...real, ...missing];
}

/** A small line icon per source, so a row of libraries reads at a glance without leaning on their names. */
const GLYPH_PATHS: Record<CatalogLibrary["source"], ReactNode> = {
  screens: (
    <>
      <rect x="2" y="3" width="12" height="8.4" rx="1.7" />
      <path d="M6 14h4M8 11.4V14" strokeLinecap="round" />
    </>
  ),
  pages: (
    <>
      <path d="M8 4.3C6.7 3.2 4.6 3 2.5 3.5v8.3c2.1-.4 4.2-.2 5.5.8 1.3-1 3.4-1.2 5.5-.8V3.5C11.4 3 9.3 3.2 8 4.3Z" strokeLinejoin="round" />
      <path d="M8 4.3v8.3" />
    </>
  ),
  tables: (
    <>
      <rect x="2.4" y="3" width="11.2" height="10" rx="1.7" />
      <path d="M2.4 6.6h11.2M2.4 9.9h11.2M6.3 6.6V13" />
    </>
  ),
  custom: <path d="M8 2.4l1.3 3.7 3.7 1.3-3.7 1.3L8 12.4 6.7 8.7 3 7.4l3.7-1.3L8 2.4Z" strokeLinejoin="round" />,
};

export function LibraryGlyph({ source, className }: { source: CatalogLibrary["source"]; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx("h-4 w-4 flex-none", className)} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {GLYPH_PATHS[source]}
    </svg>
  );
}

interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

function useScopedList<T>(path: string, pick: (raw: never) => T): Loaded<T> {
  const f = useGoaFormat();
  const [state, setState] = useState<{ path: string; data: T | null; error: string | null }>({ path, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    apiRequest<never>(path, { signal: controller.signal })
      .then((raw) => setState({ path, data: pick(raw), error: null }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({ path, data: null, error: f.error(cause) });
      });
    return () => controller.abort();
    // `pick` and `f` are stable per caller; only the path and reload nonce should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce]);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  // A stale answer for a previous path must never show under the new one.
  return { data: state.path === path ? state.data : null, error: state.path === path ? state.error : null, reload };
}

const pickLibraries = (raw: { libraries: CatalogLibrary[] }) => raw.libraries;
const pickRecommenders = (raw: { recommenders: CatalogRecommender[] }) => raw.recommenders;

export function useCatalogLibraries(scope: CatalogScope): Loaded<CatalogLibrary[]> {
  return useScopedList(API_PATHS.catalogWorkspace(scope).libraries, pickLibraries);
}

export function useCatalogRecommenders(scope: CatalogScope, enabled = true): Loaded<CatalogRecommender[]> {
  // A disabled feature must not even ask — the path is empty and the hook stays idle.
  return useScopedList(enabled ? API_PATHS.catalogWorkspace(scope).recommenders : "", pickRecommenders);
}

/** A row of pill buttons for choosing which library something belongs to, with an optional "new library" tail. */
export function LibraryPills({
  choices,
  kind,
  selectedKinds,
  onPick,
  onNew,
  label,
}: {
  choices: LibraryChoice[];
  /** The one chosen library, for a single-choice picker… */
  kind?: string | null;
  /** …or every chosen one, for a picker that combines several. */
  selectedKinds?: readonly string[];
  onPick: (choice: LibraryChoice) => void;
  onNew?: () => void;
  label: string;
}) {
  const t = useTranslations("libraries");
  const libraryName = useLibraryName();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {choices.map((choice) => {
        const active = selectedKinds ? selectedKinds.includes(choice.kind) : choice.kind === kind;
        return (
          <button
            key={choice.kind}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(choice)}
            className={cx(
              "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition",
              active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] hover:border-[var(--main-line)]",
            )}
          >
            <LibraryGlyph source={choice.source} />
            {libraryName(choice)}
          </button>
        );
      })}
      {onNew ? (
        <button
          type="button"
          onClick={onNew}
          className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-4 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
        >
          ＋ {t("newLibrary")}
        </button>
      ) : null}
    </div>
  );
}
