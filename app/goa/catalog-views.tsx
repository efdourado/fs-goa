"use client";

import { coverColors, coverToneOf, ScoreRing } from "./catalog-cover";
import type { GoaFormat } from "./format";
import type { CatalogAttributeValue, CatalogLibrary, EventSchedule } from "./types";
import { CheckCircle, cx } from "./ui";

export type CatalogGroupBy = "none" | "genre" | "decade" | "year";

export const decadeOf = (year: number): string => `${Math.floor(year / 10) * 10}s`;

export interface CatalogGroup<T> {
  key: string;
  /** Empty for the single unlabelled group, and for "no genre" / "undated" (the caller names those). */
  label: string;
  items: T[];
}

interface Groupable {
  mainGenre?: string | null;
  year?: number | null;
}

/**
 * Splits already-sorted items into sections, keeping each item's place inside its section. Genres run A→Z,
 * decades and years newest first; the items that lack the field come last as one unlabelled section.
 */
export function groupCatalogItems<T extends Groupable>(items: readonly T[], by: CatalogGroupBy): CatalogGroup<T>[] {
  if (by === "none") return [{ key: "all", label: "", items: [...items] }];
  const groups = new Map<string, CatalogGroup<T>>();
  for (const item of items) {
    const label = by === "genre" ? item.mainGenre?.trim() ?? "" : item.year ? (by === "decade" ? decadeOf(item.year) : String(item.year)) : "";
    const key = by === "genre" ? label.toLowerCase() : label;
    const group = groups.get(key) ?? { key: key || "__none__", label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const named = [...groups.values()].filter((group) => group.label);
  named.sort((left, right) => (by === "genre" ? left.label.localeCompare(right.label) : right.label.localeCompare(left.label)));
  return [...named, ...[...groups.values()].filter((group) => !group.label)];
}

/**
 * What a library's `coverTopProperty` choice resolves to for one item — a native
 * field, a custom attribute (matched by its semantic key, the same string
 * `item.attributes[].key` already uses), `"none"` for blank, or `null` (the
 * server resolves an unconfigured library to its first numeric property).
 */
export function resolveCoverTop(
  item: {
    year?: number | null; author?: string | null; mainGenre?: string | null;
    runtimeMinutes?: number | null; pageCount?: number | null; scheduledAt?: EventSchedule | null;
    attributes?: CatalogAttributeValue[];
  },
  coverTopProperty: CatalogLibrary["coverTopProperty"] | undefined,
  f: GoaFormat,
): string | number | null {
  if (coverTopProperty === undefined || coverTopProperty === null) return null;
  if (coverTopProperty === "none") return null;
  const attribute = item.attributes?.find((entry) => entry.key === coverTopProperty);
  if (attribute) {
    if (attribute.type === "boolean") return attribute.value ? "✓" : null;
    if (attribute.type === "date") return f.date(String(attribute.value));
    return attribute.value as string | number;
  }
  switch (coverTopProperty) {
    case "year": return item.year ?? null;
    case "author": return item.author ?? null;
    case "main_genre": return item.mainGenre ?? null;
    case "runtime_minutes": return item.runtimeMinutes ?? null;
    case "page_count": return item.pageCount ?? null;
    case "scheduled_at": return item.scheduledAt ? f.eventWhen(item.scheduledAt) : null;
    default: return null;
  }
}

/** The fixed height of a catalogue card (and a library card): one line of title, never taller. */
export const catalogCardHeight = "h-16 sm:h-[4.75rem]";

/**
 * One catalogue item as a card the width of a challenge card and one line tall: the title's own tint, the title
 * cut with "…" when it runs long, and — from `sm:` up — the library's top value (a year) and the rating ring on
 * the same line. A button that opens the item, or a checkbox while items are being picked. A caption (author,
 * genre, runtime) shows under it from `sm:` up; a note always does.
 */
export function CatalogTile({ title, year, avg, ratingLabel, badgeHidden, caption, note, noteTone = "muted", className, selecting, picked, onPick, onOpen }: {
  title: string;
  year?: string | number | null;
  avg?: number | null;
  /** Turns off the rating ring regardless of `avg` — the library's own choice, not "no rating yet". */
  badgeHidden?: boolean;
  ratingLabel: string;
  caption: string;
  note?: string;
  noteTone?: "muted" | "warn";
  /** Sizes the card inside a rail; a grid leaves it out. */
  className?: string;
  selecting?: boolean;
  picked?: boolean;
  onPick?: (on: boolean) => void;
  /** Leave it out for a tile that only shows the item (a result page): no button, no hover. */
  onOpen?: () => void;
}) {
  const rated = !badgeHidden && avg !== null && avg !== undefined;
  const body = (
    <>
      <span
        className={cx(
          "relative flex items-center gap-3 overflow-hidden rounded-[20px] bg-[var(--cover-bg)] px-4 text-[var(--cover-ink)] shadow-[var(--elevate-1)] transition duration-200",
          catalogCardHeight,
          picked ? "ring-[3px] ring-[var(--main)] ring-offset-2 ring-offset-[var(--canvas)]" : "group-hover:-translate-y-0.5 group-hover:shadow-[var(--elevate-2)]",
        )}
        style={coverColors(coverToneOf(title))}
      >
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-9 -right-7 h-20 w-20 rounded-full border-[12px] border-[var(--cover-deco)]" />
        {selecting ? (
          <CheckCircle on={Boolean(picked)} className="relative !h-6 !w-6" />
        ) : null}
        <span className="relative min-w-0 flex-1 truncate text-[15px] font-light tracking-[-0.02em] sm:text-lg">{title}</span>
        {year !== null && year !== undefined && year !== "" ? <span className="relative hidden flex-none text-[11px] tracking-[0.08em] sm:block" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year}</span> : null}
        {rated ? (
          <ScoreRing value={avg} size={34} label={ratingLabel} strokeWidth={3} className="relative hidden bg-[var(--paper)] shadow-[0_2px_8px_rgba(32,36,31,0.14)] sm:inline-grid" textClassName="text-[11px] font-medium" />
        ) : null}
      </span>
      {caption || note ? (
        <span className={cx("flex-col gap-0.5 px-1 text-xs text-[var(--muted)] sm:flex sm:flex-row sm:items-baseline sm:justify-between sm:gap-2", note ? "flex" : "hidden")}>
          <span className="hidden min-w-0 truncate sm:block">{caption}</span>
          {note ? <span className={cx("flex-none", noteTone === "warn" && "text-[var(--warn)]")}>{note}</span> : null}
        </span>
      ) : null}
    </>
  );
  const shared = cx("group flex min-w-0 flex-col gap-2 text-left focus-visible:outline-none", className);
  return selecting ? (
    <label className={cx(shared, "cursor-pointer")}>
      <input type="checkbox" className="peer sr-only" checked={Boolean(picked)} aria-label={title} onChange={(event) => onPick?.(event.target.checked)} />
      <span className="flex flex-col gap-2 rounded-[22px] peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--main)]/25">{body}</span>
    </label>
  ) : onOpen ? (
    <button type="button" onClick={onOpen} title={title} className={cx(shared, "cursor-pointer rounded-[22px] focus-visible:ring-4 focus-visible:ring-[var(--main)]/25")}>{body}</button>
  ) : (
    // Not a "group": the hover lift belongs to tiles that open something.
    <div title={title} className={cx("flex min-w-0 flex-col gap-2 text-left", className)}>{body}</div>
  );
}

/**
 * One item as a list row: a small round cover in the title's tint, the title (with the library's top value), the rating ring, and
 * under the title its details. A phone keeps the first two on one line; from `sm:` up every detail shows, wrapping.
 */
export function CatalogRow({ title, year, avg, ratingLabel, badgeHidden, meta, note, noteTone = "muted", selecting, picked, onPick, onOpen }: {
  title: string;
  year?: string | number | null;
  avg?: number | null;
  /** Turns off the rating ring badge regardless of `avg` — the library's own choice, not "no rating yet". */
  badgeHidden?: boolean;
  ratingLabel: string;
  /** The details, most telling first. */
  meta: readonly string[];
  /** Always shown last (how many challenges hold the item). */
  note?: string;
  noteTone?: "muted" | "warn";
  selecting?: boolean;
  picked?: boolean;
  onPick?: (on: boolean) => void;
  onOpen: () => void;
}) {
  const rating = badgeHidden || avg === null || avg === undefined ? null : <ScoreRing value={avg} size={36} label={ratingLabel} strokeWidth={3} textClassName="text-[11px] font-medium" />;
  const body = (
    <>
      {selecting ? <input type="checkbox" className="h-4 w-4 flex-none" checked={Boolean(picked)} aria-label={title} onChange={(event) => onPick?.(event.target.checked)} /> : null}
      <span aria-hidden="true" className="h-7 w-7 flex-none rounded-full bg-[var(--cover-bg)] shadow-[inset_0_0_0_6px_var(--cover-deco)] sm:h-8 sm:w-8" style={coverColors(coverToneOf(title))} />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[15px] font-normal sm:text-base">{title}{year !== null && year !== undefined && year !== "" ? <span className="ml-1.5 font-light text-[var(--muted)]">{year}</span> : null}</strong>
        {meta.length || note ? (
          <small className="mt-0.5 block truncate text-xs text-[var(--muted)] sm:mt-1 sm:whitespace-normal sm:text-[13px] sm:leading-5">
            {meta.map((part, index) => <span key={index} className={index >= 2 ? "hidden sm:inline" : undefined}>{index ? " · " : ""}{part}</span>)}
            {note ? <span className={noteTone === "warn" ? "text-[var(--warn)]" : undefined}>{meta.length ? " · " : ""}{note}</span> : null}
          </small>
        ) : null}
      </span>
    </>
  );
  const shared = "flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition hover:bg-[var(--wash)] sm:gap-4 sm:px-4 sm:py-3.5";
  return selecting
    ? <label className={cx(shared, "cursor-pointer")}>{body}{rating}</label>
    : <button type="button" onClick={onOpen} className={cx(shared, "cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--main)]/25")}>{body}{rating}</button>;
}
