"use client";

import type { ReactNode } from "react";

import { CoverSwatch, coverColors, coverToneOf, ScoreRing } from "./catalog-cover";
import type { GoaFormat } from "./format";
import type { CatalogAttributeValue, CatalogLibrary, EventSchedule } from "./types";
import { cx } from "./ui";

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
 * historical default: native `year`, which is already blank for any kind that
 * never had one).
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
  if (coverTopProperty === undefined || coverTopProperty === null) return item.year ?? null;
  if (coverTopProperty === "none") return null;
  switch (coverTopProperty) {
    case "year": return item.year ?? null;
    case "author": return item.author ?? null;
    case "main_genre": return item.mainGenre ?? null;
    case "runtime_minutes": return item.runtimeMinutes ?? null;
    case "page_count": return item.pageCount ?? null;
    case "scheduled_at": return item.scheduledAt ? f.eventWhen(item.scheduledAt) : null;
    default: {
      const attribute = item.attributes?.find((entry) => entry.key === coverTopProperty);
      if (!attribute) return null;
      if (attribute.type === "boolean") return attribute.value ? "✓" : null;
      if (attribute.type === "date") return f.date(String(attribute.value));
      return attribute.value as string | number;
    }
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
  onOpen: () => void;
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
          <span aria-hidden="true" className={cx("relative grid h-6 w-6 flex-none place-items-center rounded-full border-2 text-xs", picked ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--cover-ink)] bg-[var(--paper)]/70")}>{picked ? "✓" : ""}</span>
        ) : null}
        <span className="relative min-w-0 flex-1 truncate text-[15px] font-light tracking-[-0.02em] sm:text-lg">{title}</span>
        {year ? <span className="relative hidden flex-none text-[11px] tracking-[0.08em] sm:block" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year}</span> : null}
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
  ) : (
    <button type="button" onClick={onOpen} title={title} className={cx(shared, "cursor-pointer rounded-[22px] focus-visible:ring-4 focus-visible:ring-[var(--main)]/25")}>{body}</button>
  );
}

/** The dashed "＋ Add item" card that opens the add dialog — one line tall, like the item cards beside it. */
export function AddItemTile({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex cursor-pointer items-center justify-center gap-2.5 self-start rounded-[20px] border border-dashed border-[var(--main-line)] px-4 text-[13px] text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
        catalogCardHeight,
        className ?? "w-full",
      )}
    >
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-[var(--main-soft)]">＋</span>
      {label}
    </button>
  );
}

/** One row of the list layout: a small cover swatch, the title and its details, the rating ring. */
export function CatalogRow({ title, year, avg, ratingLabel, badgeHidden, meta, selecting, picked, onPick, onOpen }: {
  title: string;
  year?: string | number | null;
  avg?: number | null;
  /** Turns off the rating ring badge regardless of `avg` — the library's own choice, not "no rating yet". */
  badgeHidden?: boolean;
  ratingLabel: string;
  meta: string;
  selecting?: boolean;
  picked?: boolean;
  onPick?: (on: boolean) => void;
  onOpen: () => void;
}) {
  const body = (
    <>
      {selecting ? <input type="checkbox" className="h-4 w-4 flex-none" checked={Boolean(picked)} aria-label={title} onChange={(event) => onPick?.(event.target.checked)} /> : null}
      <span className="w-9 flex-none sm:w-11"><CoverSwatch title={title} /></span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate font-light">{title}{year ? <span className="ml-1.5 text-[var(--muted)]">{year}</span> : null}</strong>
        <small className="mt-1 block truncate text-[var(--muted)]">{meta}</small>
      </span>
      {badgeHidden || avg === null || avg === undefined ? null : <ScoreRing value={avg} size={38} label={ratingLabel} strokeWidth={3} textClassName="text-[11px] font-medium" />}
    </>
  );
  const shared = "flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-[var(--wash)] sm:px-5";
  return selecting
    ? <label className={cx(shared, "cursor-pointer")}>{body}</label>
    : <button type="button" onClick={onOpen} className={cx(shared, "cursor-pointer")}>{body}</button>;
}

/** Covers / list as icon buttons on one track. */
export function LayoutToggle<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon: ReactNode }>;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-full bg-[var(--wash-strong)]/70 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={cx("grid h-8 w-10 cursor-pointer place-items-center rounded-full transition", value === option.value ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
