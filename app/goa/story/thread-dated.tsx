"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id } from "../types";
import { addDaysKey, type DatedStory, daysBetween, type StoryInput, weekIndex } from "./model";

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

  if (story.lanes.length === 1) return <SoloRhythm story={story} input={input} run={run} />;
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
            // Each run (days in a row, or for a workout weeks in a row) is one solid stroke.
            const runs = lane.runs;
            return (
              <g key={lane.person.id} style={{ opacity: dim ? 0.12 : 1, transition: "opacity 250ms" }}>
                <line x1={LABEL} x2={contentWidth - 12} y1={mid} y2={mid} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2 4" />
                {runs.map((segment) => (
                  <line key={segment.from} x1={x(segment.from)} x2={x(segment.to)} y1={mid} y2={mid} stroke={tone} strokeWidth={4} strokeLinecap="round" />
                ))}
                {lane.longest ? (
                  <g>
                    <rect x={x(lane.longest.from) - dayWidth / 2 - 2} y={mid - 13} width={(daysBetween(lane.longest.from, lane.longest.to) + 1) * dayWidth + 4} height={26} rx={13} fill="none" stroke={tone} strokeOpacity={0.55} strokeWidth={1.2} />
                    <text x={(x(lane.longest.from) + x(lane.longest.to)) / 2} y={mid - 17} fontSize="10" textAnchor="middle" fill={tone}>{t(story.rhythm === "week" ? "streakWeeks" : "streakDays", { count: lane.longest.length })}</text>
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
 * One person's challenge across the whole width of the card, however long it ran (a month or half a year):
 * one column per week, as tall as the days they showed up, the number on top, the months underneath. The
 * weeks of their longest run are brighter.
 */
function SoloRhythm({ story, input, run }: { story: DatedStory; input: StoryInput; run: number }) {
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
  // Whole weeks, Monday to Sunday, from the first week to the last.
  const firstWeek = weekIndex(story.from);
  const weeks = weekIndex(story.to) - firstWeek + 1;
  const axisStart = addDaysKey("1970-01-05", firstWeek * 7);
  const W = Math.max(280, width || 640);
  const pad = 6;
  const plot = W - pad * 2;
  const weekWidth = plot / weeks;
  const counts = Array.from({ length: weeks }, () => 0);
  for (const row of lane.days) counts[weekIndex(row.day) - firstWeek] += 1;
  const maxCount = Math.max(1, ...counts);
  const runWeeks = lane.longest ? [weekIndex(lane.longest.from) - firstWeek, weekIndex(lane.longest.to) - firstWeek] : null;

  const height = 200;
  const base = height - 20;
  const stripTop = 22;
  const barHeight = (count: number) => (count / maxCount) * (base - stripTop);
  const monthOf = (week: number) => addDaysKey(axisStart, week * 7).slice(0, 7);

  return (
    <div ref={ref} className="w-full">
      <svg key={run} width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="story-sweep block h-auto w-full" role="img" aria-label={t("soloAria", { days: lane.days.length, weeks })}>
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="currentColor" strokeOpacity={0.18} />
        {counts.map((count, week) => {
          // A bar never gets wider than a thumb, however few the weeks: it sits centred in its week.
          const barWidth = Math.max(2, Math.min(56, weekWidth - Math.min(5, weekWidth * 0.18) * 2));
          const inset = (weekWidth - barWidth) / 2;
          const tall = barHeight(count);
          const inRun = Boolean(runWeeks && week >= runWeeks[0] && week <= runWeeks[1]);
          const newMonth = week === 0 || monthOf(week) !== monthOf(week - 1);
          return (
            <g key={week}>
              {newMonth ? (
                <>
                  {week > 0 ? <line x1={pad + week * weekWidth} x2={pad + week * weekWidth} y1={stripTop - 6} y2={base} stroke="currentColor" strokeOpacity={0.1} /> : null}
                  <text x={pad + week * weekWidth + 3} y={height - 5} fontSize="10" fill="currentColor" fillOpacity={0.45}>{f.dateTime(new Date(`${addDaysKey(axisStart, week * 7)}T12:00:00Z`), { month: "short", timeZone: "UTC" })}</text>
                </>
              ) : null}
              {count ? (
                <rect x={pad + week * weekWidth + inset} y={base - tall} width={barWidth} height={tall} rx={Math.min(6, barWidth / 2)} fill={tone} fillOpacity={inRun ? 0.95 : 0.5}>
                  <title>{t("soloWeek", { count, date: f.dateTime(new Date(`${addDaysKey(axisStart, week * 7)}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) })}</title>
                </rect>
              ) : (
                <rect x={pad + week * weekWidth + inset} y={base - 3} width={barWidth} height={3} rx={1.5} fill="currentColor" fillOpacity={0.12} />
              )}
              {count && weekWidth >= 18 ? <text x={pad + (week + 0.5) * weekWidth} y={base - tall - 5} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity={0.7}>{count}</text> : null}
            </g>
          );
        })}
      </svg>
      {lane.longest ? <p className="mt-3 px-3 text-xs text-white/60">{t(story.rhythm === "week" ? "calendarRunWeek" : "calendarRun", { count: lane.longest.length })}</p> : null}
    </div>
  );
}
