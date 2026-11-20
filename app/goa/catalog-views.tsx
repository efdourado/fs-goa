"use client";

import { useTranslations } from "next-intl";
import { type PointerEvent, useId } from "react";

import { coverColors, coverToneOf, ScoreRing } from "./catalog-cover";
import { useGoaFormat } from "./format";
import { StateButton } from "./state-button";
import type { CatalogItem } from "./types";
import { cx } from "./ui";
import { formatRuntime } from "./utils";

export const decadeOf = (year: number): string => `${Math.floor(year / 10) * 10}s`;

export interface CatalogGroup<T> {
  key: string;
  /** Empty for the ungrouped view or items missing the chosen value. */
  label: string;
  items: T[];
}

/**
 * Groups an already-sorted list by property value. Items keep their relative order within each group,
 * and items missing the value go last.
 */
export function groupCatalogItems<T>(items: readonly T[], valueOf?: (item: T) => string, compare = (left: string, right: string) => left.localeCompare(right)): CatalogGroup<T>[] {
  if (!valueOf) return [{ key: "all", label: "", items: [...items] }];
  const groups = new Map<string, CatalogGroup<T>>();
  for (const item of items) {
    const label = valueOf(item).trim();
    const key = label.toLocaleLowerCase();
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const named = [...groups.values()].filter((group) => group.label);
  named.sort((left, right) => compare(left.label, right.label));
  return [...named, ...[...groups.values()].filter((group) => !group.label)];
}

export function useCatalogPropertyText() {
  const tc = useTranslations("common");
  const f = useGoaFormat();

  return (item: CatalogItem, hidden: readonly string[] = []): string[] => {
    const native: Array<[string, string | number | null | undefined]> = [
      ["author", item.author], ["year", item.year], ["main_genre", item.mainGenre],
      ["page_count", item.pageCount], ["runtime_minutes", formatRuntime(item.runtimeMinutes)],
      ["scheduled_at", item.scheduledAt ? f.eventWhen(item.scheduledAt) : null],
    ];
    const parts = native.flatMap(([key, value]) => hidden.includes(key) || value == null || value === "" ? [] : [String(value)]);
    for (const attribute of item.attributes ?? []) {
      const value = attribute.type === "boolean" ? tc(attribute.value ? "yes" : "no")
        : attribute.type === "date" ? f.date(String(attribute.value)) : String(attribute.value);
      parts.push(value);
    }
    return parts;
  };
}

function startPropertyScroll(container: HTMLElement) {
  const line = container.querySelector<HTMLElement>(".catalog-property-text");
  if (!line || line.hasAttribute("data-scrolling")) return;
  const distance = line.scrollWidth - line.clientWidth;
  if (distance <= 1) return;
  line.style.setProperty("--property-distance", `-${distance}px`);
  line.style.setProperty("--property-duration", `${Math.max(2, distance / 45)}s`);
  line.setAttribute("data-scrolling", "");
}

function stopPropertyScroll(container: HTMLElement) {
  container.querySelector(".catalog-property-text")?.removeAttribute("data-scrolling");
}

function PropertyLine({ values, note, warn, className, id, focusable = true }: {
  values: readonly string[];
  note?: string;
  warn?: boolean;
  className?: string;
  id?: string;
  focusable?: boolean;
}) {
  if (!values.length && !note) return null;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus the scrollable line.
    <small id={id} className={cx("catalog-property-line block min-w-0 text-xs text-[var(--muted)]", className)} tabIndex={focusable ? 0 : undefined} onFocus={(event) => startPropertyScroll(event.currentTarget)} onBlur={(event) => stopPropertyScroll(event.currentTarget)}>
      <span className="catalog-property-text block truncate">
        {values.join(" · ")}
        {note ? <span className={warn ? "text-[var(--warn)]" : undefined}>{values.length ? " · " : ""}{note}</span> : null}
      </span>
    </small>
  );
}

/** The fixed height of a catalogue card (and a library card). */
export const catalogCardHeight = "h-16 sm:h-[4.75rem]";

/** A coloured item tile. Challenge results can add a year and rating. */
export function CatalogTile({ title, year, avg, ratingLabel, caption, properties, className }: {
  title: string;
  year?: string | number | null;
  avg?: number | null;
  ratingLabel?: string;
  caption?: string;
  properties?: readonly string[];
  className?: string;
}) {
  const rated = avg !== null && avg !== undefined;
  return (
    <div title={title} onPointerEnter={(event) => startPropertyScroll(event.currentTarget)} onPointerLeave={(event) => stopPropertyScroll(event.currentTarget)} className={cx("flex min-w-0 flex-col gap-2 text-left", className)}>
      <span
        className={cx("relative flex items-center gap-3 overflow-hidden rounded-[20px] bg-[var(--cover-bg)] px-4 text-[var(--cover-ink)] shadow-[var(--elevate-1)]", catalogCardHeight)}
        style={coverColors(coverToneOf(title))}
      >
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-9 -right-7 h-20 w-20 rounded-full border-[12px] border-[var(--cover-deco)]" />
        <span className="relative min-w-0 flex-1 truncate text-[15px] font-light tracking-[-0.02em] sm:text-lg">{title}</span>
        {year !== null && year !== undefined && year !== "" ? <span className="relative hidden flex-none text-[11px] tracking-[0.08em] sm:block" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year}</span> : null}
        {rated ? (
          <ScoreRing value={avg} size={34} label={ratingLabel ?? ""} strokeWidth={3} className="relative hidden bg-[var(--paper)] shadow-[var(--elevate-card)] sm:inline-grid" textClassName="text-[11px] font-medium" />
        ) : null}
      </span>
      {properties ? <PropertyLine values={properties} className="mx-1" /> : caption ? (
        <span className="hidden truncate px-1 text-xs text-[var(--muted)] sm:block">{caption}</span>
      ) : null}
    </div>
  );
}

export function CatalogRow({ title, meta, note, noteTone = "muted", selecting, picked, onPick, edit }: {
  title: string;
  meta: readonly string[];
  note?: string;
  noteTone?: "muted" | "warn";
  selecting?: boolean;
  picked?: boolean;
  onPick?: (on: boolean) => void;
  edit?: { label: string; onOpen: () => void };
}) {
  const detailsId = useId();
  const editable = !selecting && Boolean(edit);
  const rowClass = "flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left sm:gap-4 sm:px-4 sm:py-3.5";
  const hoverClass = "cursor-pointer transition-colors hover:bg-[var(--wash)]/40";
  const pointerEvents = {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => startPropertyScroll(event.currentTarget),
    onPointerLeave: (event: PointerEvent<HTMLElement>) => stopPropertyScroll(event.currentTarget),
  };
  const content = (
    <>
      <span aria-hidden="true" className="h-7 w-7 flex-none rounded-full bg-[var(--cover-bg)] shadow-[inset_0_0_0_6px_var(--cover-deco)] sm:h-8 sm:w-8" style={coverColors(coverToneOf(title))} />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[15px] font-normal sm:text-base">{title}</strong>
        <PropertyLine id={editable ? detailsId : undefined} focusable={!editable} values={meta} note={note} warn={noteTone === "warn"} className="mt-0.5 sm:mt-1 sm:text-[13px] sm:leading-5" />
      </span>
    </>
  );
  if (selecting) {
    return (
      <label className={cx(rowClass, hoverClass)} {...pointerEvents}>
        <input type="checkbox" className="h-4 w-4 flex-none" checked={Boolean(picked)} aria-label={title} onChange={(event) => onPick?.(event.target.checked)} />
        {content}
      </label>
    );
  }
  if (edit) {
    return (
      <StateButton type="button" aria-label={edit.label} aria-describedby={meta.length || note ? detailsId : undefined} aria-haspopup="dialog"
        className={cx(rowClass, hoverClass, "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]")}
        onClick={edit.onOpen} onFocus={(event) => startPropertyScroll(event.currentTarget)} onBlur={(event) => stopPropertyScroll(event.currentTarget)} {...pointerEvents}
      >
        {content}
      </StateButton>
    );
  }
  return <div className={rowClass} {...pointerEvents}>{content}</div>;
}
