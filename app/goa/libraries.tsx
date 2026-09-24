"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { CACHE_KEYS, readCache, writeCache } from "./cache";
import { useGoaFormat } from "./format";
import { RecipeIcon, type RecipeIconName } from "./recipe-icons";
import type { CatalogItem, CatalogLibrary, CatalogRecommender, Id } from "./types";
import { cx } from "./ui";

/** Where a catalogue lives: the caller's own space, or one group's. */
export type CatalogScope = "personal" | { groupId: Id };

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
const BUILT_IN_LIBRARIES: ReadonlyArray<{ kind: "film" | "book"; source: "screens" | "pages" }> = [
  { kind: "film", source: "screens" },
  { kind: "book", source: "pages" },
];

/** Libraries as a picker sees them: real ones plus the built-ins not created yet (made the first time they get an item). */
interface LibraryChoice {
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

/** The icon for each library source — the same artwork as the recipe it starts from (Screens = Cinema, Pages = Estante…). */
const GLYPH_ICON: Record<CatalogLibrary["source"], RecipeIconName> = {
  screens: "cinema",
  pages: "bookshelf",
  tables: "tables",
  custom: "custom",
};

export function LibraryGlyph({ source, className }: { source: CatalogLibrary["source"]; className?: string }) {
  return <RecipeIcon name={GLYPH_ICON[source]} className={cx("h-[18px] w-[18px]", className)} />;
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

/** What a page's catalogue shelf draws from: the libraries, how many items each holds, and the newest few of each. */
export interface CatalogShelfData {
  libraries: CatalogLibrary[];
  /** Items per library, by its `kind` — the whole count, not just the ones in `items`. */
  counts: Record<string, number>;
  items: CatalogItem[];
}

const shelfInflight = new Map<string, Promise<CatalogShelfData>>();
/** When a warm-up last brought a shelf in, so the page that opens right after does not ask for it again. */
const shelfWarmedAt = new Map<string, number>();
const WARM_ANSWER_MS = 5_000;

/** Asks for a shelf once at a time: a prefetch already on its way is the request the page then waits on. */
function fetchShelf(path: string): Promise<CatalogShelfData> {
  let pending = shelfInflight.get(path);
  if (!pending) {
    pending = apiRequest<CatalogShelfData>(path)
      .then((data) => {
        writeCache(CACHE_KEYS.shelf(path), data);
        return data;
      })
      .finally(() => shelfInflight.delete(path));
    shelfInflight.set(path, pending);
  }
  return pending;
}

/** Starts loading a shelf before its page is open — on hovering the link, or beside the app's own first load. */
export function prefetchCatalogShelf(scope: CatalogScope): void {
  const path = API_PATHS.catalogWorkspace(scope).shelf;
  if (readCache(CACHE_KEYS.shelf(path))) return;
  fetchShelf(path).then(() => shelfWarmedAt.set(path, Date.now())).catch(() => undefined);
}

/**
 * One request for the whole shelf, painted from the tab's last answer (the app's stale-while-revalidate cache)
 * while a fresh one loads. `null` only when there is nothing recent to show.
 */
export function useCatalogShelf(scope: CatalogScope): CatalogShelfData | null {
  const path = API_PATHS.catalogWorkspace(scope).shelf;
  const [state, setState] = useState<{ path: string; data: CatalogShelfData | null }>(() => ({ path, data: readCache<CatalogShelfData>(CACHE_KEYS.shelf(path)) }));
  useEffect(() => {
    let active = true;
    // An answer a warm-up fetched seconds ago is as good as a new one — use it once, then revalidate as usual.
    const warmedAt = shelfWarmedAt.get(path);
    shelfWarmedAt.delete(path);
    if (warmedAt !== undefined && Date.now() - warmedAt < WARM_ANSWER_MS && readCache<CatalogShelfData>(CACHE_KEYS.shelf(path))) return;
    fetchShelf(path)
      .then((data) => {
        shelfWarmedAt.delete(path); // the page has taken this answer; the next visit revalidates
        if (active) setState({ path, data });
      })
      .catch(() => {
        // A failed refresh keeps whatever is already showing; with nothing to show, the shelf just stays out of the way.
        if (active) setState((current) => (current.path === path && current.data ? current : { path, data: { libraries: [], counts: {}, items: [] } }));
      });
    return () => { active = false; };
  }, [path]);
  return state.path === path ? state.data : readCache<CatalogShelfData>(CACHE_KEYS.shelf(path));
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
