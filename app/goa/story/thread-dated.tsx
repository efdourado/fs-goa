"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id } from "../types";
import { addDaysKey, type DatedStory, daysBetween, type StoryInput } from "./model";

const LANE = 46;
const TOP = 30;
const LABEL = 92;
const MIN_DAY = 9;

/**
 * Everyone's days as a thread across the calendar: solid where they kept going, broken where they
 * stopped. A day with a number is a bead sized by it. Each lane's longest run is outlined and named.
 * It draws itself left to right, like the days did.
 */
export function DatedThread({ story, input, focus, run, fit = false }: { story: DatedStory; input: StoryInput; focus: Id | null; run: number; fit?: boolean }) {
  const t = useTranslations("story");
  const f = useFormatter();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (story.lanes.length === 1) return <CalendarHeat story={story} input={input} run={run} />;
  const total = daysBetween(story.from, story.to) + 1;
  const plotWidth = fit ? Math.max(1, width - LABEL - 12) : Math.max(width - LABEL - 12, total * MIN_DAY);
  const dayWidth = plotWidth / total;
  const contentWidth = plotWidth + LABEL + 12;
  const x = (day: string) => LABEL + daysBetween(story.from, day) * dayWidth + dayWidth / 2;
  const height = TOP + story.lanes.length * LANE + 8;
  const ids = input.people.map((person) => person.id);
  const maxValue = Math.max(1, ...story.lanes.flatMap((lane) => lane.days.map((row) => row.value ?? 0)));
  // Month starts (or every ~2 weeks on short spans) as the time ruler.
  const ruler: string[] = [];
  for (let offset = 0; offset < total; offset += 1) {
    const day = addDaysKey(story.from, offset);
    const due = offset === 0 || day.endsWith("-01") || (total <= 45 && offset % 7 === 0);
    // Two labels closer than ~5 days would overlap — keep the first.
    if (due && (!ruler.length || daysBetween(ruler.at(-1)!, day) >= 5)) ruler.push(day);
  }

  return (
    <div ref={ref} className="relative w-full overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
      <div key={run} className="story-sweep relative" style={{ width: contentWidth || "100%", height }}>
        <svg width={contentWidth} height={height} className="block" role="img" aria-label={t("lanesAria", { count: story.lanes.length, days: total })}>
          {ruler.map((day) => (
            <g key={day}>
              <line x1={x(day) - dayWidth / 2} x2={x(day) - dayWidth / 2} y1={TOP - 8} y2={height} stroke="currentColor" strokeOpacity={0.08} />
              <text x={x(day) - dayWidth / 2 + 3} y={TOP - 14} fontSize="10" fill="currentColor" fillOpacity={0.45}>{f.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" })}</text>
            </g>
          ))}
          {story.lanes.map((lane, laneIndex) => {
            const tone = personTone(ids, lane.person.id);
            const mid = TOP + laneIndex * LANE + LANE / 2;
            const dim = focus !== null && focus !== lane.person.id;
            // Runs of consecutive days become one solid stroke.
            const runs: Array<{ from: string; to: string }> = [];
            for (const row of lane.days) {
              const last = runs.at(-1);
              if (last && daysBetween(last.to, row.day) === 1) last.to = row.day;
              else runs.push({ from: row.day, to: row.day });
            }
            return (
              <g key={lane.person.id} style={{ opacity: dim ? 0.12 : 1, transition: "opacity 250ms" }}>
                <line x1={LABEL} x2={contentWidth - 12} y1={mid} y2={mid} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2 4" />
                {runs.map((segment) => (
                  <line key={segment.from} x1={x(segment.from)} x2={x(segment.to)} y1={mid} y2={mid} stroke={tone} strokeWidth={4} strokeLinecap="round" />
                ))}
                {lane.longest ? (
                  <g>
                    <rect x={x(lane.longest.from) - dayWidth / 2 - 2} y={mid - 13} width={(daysBetween(lane.longest.from, lane.longest.to) + 1) * dayWidth + 4} height={26} rx={13} fill="none" stroke={tone} strokeOpacity={0.55} strokeWidth={1.2} />
                    <text x={(x(lane.longest.from) + x(lane.longest.to)) / 2} y={mid - 17} fontSize="10" textAnchor="middle" fill={tone}>{t("streakDays", { count: lane.longest.length })}</text>
                  </g>
                ) : null}
                {lane.days.map((row) => (
                  <circle key={row.day} cx={x(row.day)} cy={mid} r={row.value === null ? 3.2 : 2.5 + (row.value / maxValue) * 6} fill={tone} stroke="var(--spotlight)" strokeWidth={1} />
                ))}
                {lane.best ? <text x={x(lane.best.day)} y={mid + 21} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity={0.7}>★ {lane.best.value}</text> : null}
              </g>
            );
          })}
        </svg>
        {/* Names stay pinned on the left while the calendar scrolls. */}
        {story.lanes.map((lane, laneIndex) => (
          <div key={lane.person.id} className="absolute left-0 flex items-center gap-1.5 pl-1" style={{ top: TOP + laneIndex * LANE + LANE / 2 - 12, opacity: focus !== null && focus !== lane.person.id ? 0.3 : 1 }}>
            <span className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: personTone(ids, lane.person.id) }}>{initialsOf(lane.person.name)}</span>
            <span className="max-w-[3.6rem] truncate text-[11px] text-white/75">{firstName(lane.person.name)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One person's days as a calendar: a square per day in week columns, filled where they showed up — stronger
 * where the day's number was bigger. Their longest run is outlined, their best day ringed.
 */
function CalendarHeat({ story, input, run }: { story: DatedStory; input: StoryInput; run: number }) {
  const t = useTranslations("story");
  const f = useFormatter();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const lane = story.lanes[0];
  const tone = personTone(input.people.map((person) => person.id), lane.person.id);
  const byDay = new Map(lane.days.map((row) => [row.day, row.value]));
  const maxValue = Math.max(1, ...lane.days.map((row) => row.value ?? 0));
  // Weeks start on Sunday; the first column is padded back to it.
  const startOffset = new Date(`${story.from}T12:00:00Z`).getUTCDay();
  const first = addDaysKey(story.from, -startOffset);
  const weeks = Math.ceil((daysBetween(first, story.to) + 1) / 7);
  const left = 22;
  // Squares grow to fill the card (up to a comfortable size), so a short challenge isn't a postage stamp.
  const gap = 4;
  const cell = Math.max(12, Math.min(44, width ? (width - left) / weeks - gap : 15));
  const top = 18;
  const svgWidth = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  const inRun = (day: string) => Boolean(lane.longest && day >= lane.longest.from && day <= lane.longest.to);
  const weekdayLetters = Array.from({ length: 7 }, (_, index) => f.dateTime(new Date(Date.UTC(2026, 0, 4 + index, 12)), { weekday: "narrow", timeZone: "UTC" }));
  return (
    <div ref={ref} className="w-full overflow-x-auto [scrollbar-width:thin]">
      <svg key={run} width={svgWidth} height={height} className="story-sweep block" role="img" aria-label={t("calendarAria", { days: lane.days.length })}>
        {weekdayLetters.map((letter, index) => index % 2 === 1 ? (
          <text key={index} x={0} y={top + index * (cell + gap) + cell - 3} fontSize="10" fill="currentColor" fillOpacity={0.4}>{letter}</text>
        ) : null)}
        {Array.from({ length: weeks }, (_, week) => {
          const monday = addDaysKey(first, week * 7);
          const label = week === 0 || monday.slice(8, 10) <= "07" ? f.dateTime(new Date(`${addDaysKey(monday, 0)}T12:00:00Z`), { month: "short", timeZone: "UTC" }) : null;
          return (
            <g key={week}>
              {label && (week === 0 || monday.slice(5, 7) !== addDaysKey(monday, -7).slice(5, 7)) ? <text x={left + week * (cell + gap)} y={10} fontSize="10" fill="currentColor" fillOpacity={0.45}>{label}</text> : null}
              {Array.from({ length: 7 }, (_, weekday) => {
                const day = addDaysKey(first, week * 7 + weekday);
                if (day < story.from || day > story.to) return null;
                const logged = byDay.has(day);
                const value = byDay.get(day) ?? null;
                const strength = !logged ? 0 : value === null ? 0.85 : 0.35 + 0.65 * (value / maxValue);
                const best = lane.best?.day === day;
                return (
                  <rect
                    key={day}
                    x={left + week * (cell + gap)}
                    y={top + weekday * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx={4}
                    fill={logged ? tone : "currentColor"}
                    fillOpacity={logged ? strength : 0.07}
                    stroke={best ? "var(--spotlight-ink)" : inRun(day) ? tone : "none"}
                    strokeWidth={best ? 2 : 1}
                  >
                    <title>{`${f.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" })}${value !== null ? ` · ${f.number(value)}` : ""}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      {lane.longest ? <p className="mt-3 text-xs text-white/60">{t("calendarRun", { count: lane.longest.length })}</p> : null}
    </div>
  );
}
