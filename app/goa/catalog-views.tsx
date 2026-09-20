"use client";

import type { ReactNode } from "react";

import { AddCardTile } from "./add-tile";
import { CoverSwatch, ItemCover, ScoreRing } from "./catalog-cover";
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

/** One cover in the grid — a button that opens the item, or a checkbox while items are being picked. */
export function CatalogTile({ title, year, avg, ratingLabel, caption, note, noteTone = "muted", size = "md", className, selecting, picked, onPick, onOpen }: {
  title: string;
  year?: number | null;
  avg?: number | null;
  ratingLabel: string;
  caption: string;
  note?: string;
  noteTone?: "muted" | "warn";
  size?: "sm" | "md";
  /** Sizes the tile inside a rail; a grid leaves it out. */
  className?: string;
  selecting?: boolean;
  picked?: boolean;
  onPick?: (on: boolean) => void;
  onOpen: () => void;
}) {
  const body = (
    <>
      <ItemCover title={title} year={year} avg={avg} ratingLabel={ratingLabel} size={size} className={cx("transition duration-200", picked ? "ring-[3px] ring-[var(--main)] ring-offset-2 ring-offset-[var(--canvas)]" : "group-hover:-translate-y-0.5 group-hover:shadow-[var(--elevate-2)]")}>
        {selecting ? (
          <span aria-hidden="true" className={cx("absolute bottom-3 left-3 grid h-6 w-6 place-items-center rounded-full border-2 text-xs", picked ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--cover-ink)] bg-[var(--paper)]/70")}>{picked ? "✓" : ""}</span>
        ) : null}
      </ItemCover>
      <span className="flex flex-col gap-0.5 text-xs text-[var(--muted)] sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <span className="min-w-0 truncate">{caption}</span>
        {note ? <span className={cx("flex-none", noteTone === "warn" && "text-[var(--warn)]")}>{note}</span> : null}
      </span>
    </>
  );
  const shared = cx("group flex min-w-0 flex-col gap-2.5 text-left focus-visible:outline-none", className);
  return selecting ? (
    <label className={cx(shared, "cursor-pointer")}>
      <input type="checkbox" className="peer sr-only" checked={Boolean(picked)} aria-label={title} onChange={(event) => onPick?.(event.target.checked)} />
      <span className="flex flex-col gap-2.5 rounded-[22px] peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--main)]/25">{body}</span>
    </label>
  ) : (
    <button type="button" onClick={onOpen} className={cx(shared, "cursor-pointer rounded-[22px] focus-visible:ring-4 focus-visible:ring-[var(--main)]/25")}>{body}</button>
  );
}

/** The dashed "+ Add item" cell that opens the add dialog — the same tile the group page's shelf starts with, sized like a cover. */
export function AddItemTile({ label, onClick }: { label: string; onClick: () => void }) {
  return <AddCardTile label={label} onClick={onClick} className="aspect-[3/4] w-full self-start" />;
}

/** One row of the list layout: a small cover swatch, the title and its details, the rating ring. */
export function CatalogRow({ title, year, avg, ratingLabel, meta, selecting, picked, onPick, onOpen }: {
  title: string;
  year?: number | null;
  avg?: number | null;
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
      <ScoreRing value={avg} size={38} label={ratingLabel} strokeWidth={3} textClassName="text-[11px] font-medium" />
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
