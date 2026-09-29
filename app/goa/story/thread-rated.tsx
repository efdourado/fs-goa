"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { firstName, personTone } from "../rating-scale";
import type { Id } from "../types";
import { cx } from "../ui";
import type { RatedNote, RatedStory, StoryInput } from "./model";

const HEIGHT = 340;
const TOP = 70;
const BOTTOM = 34;
const MIN_STEP = 96;

/** A smooth line through points (Catmull-Rom as cubic Béziers), broken wherever someone skipped a title. */
function smoothPaths(points: Array<{ x: number; y: number } | null>, low = -Infinity, high = Infinity): string[] {
  const clamp = (value: number) => Math.max(low, Math.min(high, value));
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let run: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (point) run.push(point);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.map((line) => {
    if (line.length === 1) return `M${line[0].x - 0.01},${line[0].y} L${line[0].x},${line[0].y}`;
    let d = `M${line[0].x},${line[0].y}`;
    for (let index = 0; index < line.length - 1; index += 1) {
      const p0 = line[index - 1] ?? line[index];
      const p1 = line[index];
      const p2 = line[index + 1];
      const p3 = line[index + 2] ?? p2;
      // Control points stay inside the plot, so a steep drop never swings past the scale.
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) };
      d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    }
    return d;
  });
}

/**
 * Everyone's line through the titles, in the order they were watched: up where they loved it, down where
 * they didn't. Lines that braid are people who agree; where they fan out, the group split. Notes pinned
 * on top say what happened there. Tap a name in the legend to follow one line.
 */
export function RatedThread({ story, input, focus, run }: { story: RatedStory; input: StoryInput; focus: Id | null; run: number }) {
  const t = useTranslations("story");
  const nf = useFormatter();
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const count = story.stations.length;
  const contentWidth = Math.max(width, count * MIN_STEP);
  const step = contentWidth / Math.max(1, count);
  const range = Math.max(1e-9, input.scale.max - input.scale.min);
  const x = (index: number) => step * index + step / 2;
  const y = (value: number) => TOP + (1 - (value - input.scale.min) / range) * (HEIGHT - TOP - BOTTOM);
  const ids = input.people.map((person) => person.id);
  const stationIndex = new Map(story.stations.map((station, index) => [station.item.id, index]));
  const ticks = Array.from({ length: Math.floor(range) + 1 }, (_, index) => input.scale.min + index).filter((tick) => range <= 10 || tick % Math.ceil(range / 5) === 0);
  const drawMs = 1800;
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

  // Notes: one bubble per note, stacked when two land on the same title.
  const perStation = new Map<number, number>();
  // Quotes read better in the almanac's wall than squeezed over the lines.
  const bubbles = story.notes.filter((note) => note.kind !== "quote").flatMap((note) => {
    const index = stationIndex.get(note.itemId);
    if (index === undefined) return [];
    const slot = perStation.get(index) ?? 0;
    perStation.set(index, slot + 1);
    return [{ note, index, slot }];
  });

  return (
    <div ref={ref} className="relative w-full overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
      <div key={run} className="relative" style={{ width: contentWidth || "100%", height: HEIGHT + 64 }}>
        <svg width={contentWidth} height={HEIGHT} className="absolute left-0 top-0 block" role="img" aria-label={t("threadAria", { count: input.people.length, items: count })}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={contentWidth} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === input.scale.min || tick === input.scale.max ? 0.14 : 0.06} />
              <text x={6} y={y(tick) - 4} fontSize="10" fill="currentColor" fillOpacity={0.35}>{tick}</text>
            </g>
          ))}
          {story.stations.map((station, index) => (
            <line key={station.item.id} x1={x(index)} x2={x(index)} y1={TOP - 18} y2={HEIGHT - BOTTOM} stroke="currentColor" strokeOpacity={0.07} />
          ))}
          {/* The group, as one faint line. */}
          {smoothPaths(story.stations.map((station, index) => ({ x: x(index), y: y(station.average) })), y(input.scale.max), y(input.scale.min)).map((d, index) => (
            <path key={`avg-${index}`} d={d} fill="none" stroke="currentColor" strokeOpacity={0.28} strokeWidth={7} strokeLinecap="round" pathLength={1} className="taste-line" style={{ ...delay(0), animationDuration: `${drawMs}ms` }} />
          ))}
          {story.threads.map((thread, order) => {
            const tone = personTone(ids, thread.person.id);
            const dim = focus !== null && focus !== thread.person.id;
            return (
              <g key={thread.person.id} style={{ opacity: dim ? 0.1 : 1, transition: "opacity 250ms" }}>
                {smoothPaths(thread.values.map((value, index) => (value === null ? null : { x: x(index), y: y(value) })), y(input.scale.max), y(input.scale.min)).map((d, index) => (
                  <path key={index} d={d} fill="none" stroke={tone} strokeWidth={focus === thread.person.id ? 3.5 : 2.4} strokeLinecap="round" pathLength={1} className="taste-line" style={{ ...delay(150 + order * 140), animationDuration: `${drawMs}ms` }} />
                ))}
                {thread.values.map((value, index) => value === null ? null : (
                  <circle key={index} cx={x(index)} cy={y(value)} r={focus === thread.person.id ? 5 : 3.6} fill={tone} stroke="var(--spotlight)" strokeWidth={1.5} className="reveal-fade" style={delay(300 + order * 140 + (index / Math.max(1, count - 1)) * drawMs)} />
                ))}
              </g>
            );
          })}
        </svg>

        {bubbles.map(({ note, index, slot }) => (
          <Bubble key={`${note.kind}-${index}`} note={note} input={input} left={x(index)} top={8 + slot * 30} at={drawMs * ((index + 1) / count) + 500 + slot * 200} fmt={fmt} edge={index === 0 ? "start" : index === count - 1 ? "end" : "middle"} />
        ))}

        {/* The titles along the bottom, with the group's number. */}
        {story.stations.map((station, index) => (
          <div key={station.item.id} className="absolute text-center" style={{ left: x(index) - step / 2, width: step, top: HEIGHT - BOTTOM + 8 }}>
            <p className="mx-auto line-clamp-2 max-w-[92%] text-[11px] leading-tight text-white/80">{station.item.title}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-white/45">{fmt(station.average)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ note, input, left, top, at, fmt, edge }: {
  note: RatedNote; input: StoryInput; left: number; top: number; at: number; fmt: (value: number) => string; edge: "start" | "middle" | "end";
}) {
  const t = useTranslations("story.note");
  const name = (id: Id) => firstName(input.people.find((person) => person.id === id)?.name ?? "");
  const text = (() => {
    switch (note.kind) {
      case "favourite": return t("favourite", { value: fmt(note.value) });
      case "split": return t("split", { low: fmt(note.low), high: fmt(note.high) });
      case "surprise": return t("surprise", { expected: fmt(note.expected), actual: fmt(note.actual) });
      case "flop": return t("flop", { value: fmt(note.value) });
      case "loner": return t("loner", { name: name(note.personId), value: fmt(note.value) });
      case "quote": return `“${note.text}” — ${name(note.personId)}`;
    }
  })();
  const accent = note.kind === "favourite" ? "var(--tag-green)" : note.kind === "flop" ? "var(--tag-coral)" : note.kind === "quote" ? "var(--spotlight-ink)" : "var(--main-2)";
  return (
    <div
      className={cx("reveal-rise absolute z-10 w-max max-w-[13rem] rounded-lg bg-[var(--spotlight-ink)] px-2 py-1 text-[11px] leading-snug text-[var(--spotlight)] shadow-lg", note.kind === "quote" && "italic")}
      style={{ left, top, transform: edge === "start" ? "translateX(-12px)" : edge === "end" ? "translateX(calc(-100% + 12px))" : "translateX(-50%)", borderLeft: `3px solid ${accent}`, animationDelay: `${at}ms` }}
    >
      {text}
    </div>
  );
}
