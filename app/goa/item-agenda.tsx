"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useGoaFormat } from "./format";
import { eventPhase, instantToDateKey } from "./schedule";
import type { ChallengeItem, Id } from "./types";
import { cardClass, cx, sectionLabelClass } from "./ui";

/**
 * Items with their own date (a match's kickoff) sort by *when they happen*; items
 * with only an answer window sort by that window. The two never mix on one item —
 * the event's own date wins, the window is just a second line under it.
 */
type Bucket = "now" | "upcoming" | "open" | "scheduled" | "happened" | "past_due";

const ORDER: Bucket[] = ["now", "upcoming", "open", "scheduled", "happened", "past_due"];

/** The end of an item's window that says "when" for its bucket: what it's due by, or when it opens. */
function keyInstant(item: ChallengeItem, bucket: Bucket): string | null {
  const event = item.catalogItem?.scheduledAt;
  if (event && (bucket === "now" || bucket === "upcoming" || bucket === "happened")) return event.startsAt;
  if (bucket === "scheduled") return item.opensAt ?? item.dueAt ?? null;
  return item.dueAt ?? item.opensAt ?? null;
}

function bucketOf(item: ChallengeItem, nowMs: number): Bucket | null {
  const event = item.catalogItem?.scheduledAt;
  if (event) return eventPhase(event, nowMs);
  if (!item.opensAt && !item.dueAt) return null;
  if (item.status === "scheduled") return "scheduled";
  if (item.status === "past_due") return "past_due";
  return "open";
}

/**
 * Everything with a date, ordered by when it matters: what's under way or coming up, what's
 * open for answers (soonest due first), what has already happened. A date here is a
 * reminder, never a lock — a past-due item can still be answered.
 */
export function ItemAgenda({
  items,
  timeZone,
  selectedId,
  doneIds,
  onSelect,
}: {
  items: ChallengeItem[];
  timeZone: string;
  selectedId: Id | null;
  doneIds: Set<Id>;
  onSelect: (id: Id) => void;
}) {
  const t = useTranslations("agenda");
  const f = useGoaFormat();
  // A snapshot taken when the agenda mounts — "happened" vs "coming up" needn't tick by the second.
  const [nowMs] = useState(() => Date.now());
  const groups = useMemo(() => {
    const result: Record<Bucket, ChallengeItem[]> = { now: [], upcoming: [], open: [], scheduled: [], happened: [], past_due: [] };
    for (const item of items) {
      const bucket = bucketOf(item, nowMs);
      if (bucket) result[bucket].push(item);
    }
    const time = (item: ChallengeItem, bucket: Bucket) => new Date(keyInstant(item, bucket) ?? 0).getTime();
    result.now.sort((a, b) => time(a, "now") - time(b, "now"));
    result.upcoming.sort((a, b) => time(a, "upcoming") - time(b, "upcoming"));
    result.open.sort((a, b) => (a.dueAt ? time(a, "open") : Infinity) - (b.dueAt ? time(b, "open") : Infinity));
    result.scheduled.sort((a, b) => time(a, "scheduled") - time(b, "scheduled"));
    result.happened.sort((a, b) => time(b, "happened") - time(a, "happened"));
    result.past_due.sort((a, b) => time(b, "past_due") - time(a, "past_due"));
    return result;
  }, [items, nowMs]);

  const total = ORDER.reduce((sum, bucket) => sum + groups[bucket].length, 0);
  if (!total) return null;

  const tone: Record<Bucket, string> = {
    now: "bg-[var(--main-soft)] text-[var(--main-strong)]",
    upcoming: "bg-[var(--wash)] text-[var(--ink)]",
    open: "bg-[var(--main-soft)] text-[var(--main-strong)]",
    scheduled: "bg-[var(--wash)] text-[var(--muted)]",
    happened: "bg-[var(--wash)] text-[var(--muted)]",
    past_due: "bg-[var(--warn-soft)] text-[var(--warn)]",
  };

  return (
    <details open className="group" aria-label={t("title")}>
      <summary className="mb-2 flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h2 className={cx(sectionLabelClass, "inline-flex items-center gap-2")}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none text-[var(--muted)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("title")}
        </h2>
        <span className="text-xs text-[var(--muted)]">{t("tally", { count: total })}</span>
      </summary>
      <div className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
        {ORDER.filter((bucket) => groups[bucket].length).map((bucket) => (
          <div key={bucket} className="p-2">
            <h3 className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">{t(`bucket.${bucket}`)}</h3>
            <ul>
              {groups[bucket].map((item) => {
                const event = item.catalogItem?.scheduledAt ?? null;
                const instant = keyInstant(item, bucket);
                const dayKey = instant ? instantToDateKey(instant, event?.timeZone ?? timeZone) : null;
                const day = dayKey ? new Date(`${dayKey}T12:00:00Z`) : null;
                const active = item.id === selectedId;
                const done = doneIds.has(item.id);
                const detail = [event ? f.eventWhen(event) : null, f.itemWindow(item, timeZone)].filter(Boolean).join(" · ");
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[var(--hover)]",
                        active && "bg-[var(--main-soft)]/50",
                      )}
                    >
                      <span className={cx("grid h-11 w-11 flex-none place-content-center rounded-xl text-center leading-none", tone[bucket])} aria-hidden="true">
                        <span className="text-base font-medium tabular-nums">{day ? day.getUTCDate() : "·"}</span>
                        <span className="mt-0.5 text-[9px] uppercase tracking-wide">
                          {day ? new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(day).replace(".", "") : ""}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-sm", active ? "font-medium text-[var(--main-strong)]" : "font-light")}>
                          {item.title}{item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--muted)]">{detail}</span>
                      </span>
                      {done ? (
                        <span className="flex-none rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--ok)]">{t("done")}</span>
                      ) : bucket === "past_due" ? (
                        <span className="flex-none rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--warn)]">{t("pastDue")}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
