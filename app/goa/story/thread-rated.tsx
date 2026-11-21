"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

import { firstName } from "../rating-scale";
import type { Id } from "../types";
import type { RatedNote, RatedStory, StoryInput } from "./model";
import { threadPersonStyle } from "./thread-people";

const PLOT = 250;
const BOTTOM = 34;
const MIN_STEP = 96;
/** A story image draws this many titles; the lines run on into a fade and a "…" for the rest. */
const STORY_STATIONS = 6;
/** Of those, every other title is named (three: the 2nd, 4th and 6th, which have room on both sides), one line each. */
const STORY_LABEL_EVERY = 2;
/** Room after the last drawn title for the lines to run on and fade (in steps). */
const TAIL_STEPS = 0.75;

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
export function RatedThread({ story: whole, input, focus, visible, fit = false }: { story: RatedStory; input: StoryInput; focus: Id | null; visible?: ReadonlySet<Id>; fit?: boolean }) {
  const t = useTranslations("story");
  const fadeId = useId();
  // A story image is a glance: the first titles, then each line heads for the next one and fades out.
  const tail = fit && whole.stations.length > STORY_STATIONS + 1;
  const story: RatedStory = tail ? {
    ...whole,
    stations: whole.stations.slice(0, STORY_STATIONS + 1),
    threads: whole.threads.map((thread) => ({ ...thread, values: thread.values.slice(0, STORY_STATIONS + 1) })),
    notes: whole.notes.filter((note) => whole.stations.findIndex((station) => station.item.id === note.itemId) < STORY_STATIONS),
  } : whole;
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

  const tn = useTranslations("story.note");
  const personName = (id: Id) => firstName(input.people.find((person) => person.id === id)?.name ?? "");
  const count = story.stations.length;
  const contentWidth = fit ? width : Math.max(width, count * MIN_STEP);
  const step = contentWidth / Math.max(1, tail ? STORY_STATIONS + TAIL_STEPS : count);
  const range = Math.max(1e-9, input.scale.max - input.scale.min);
  const x = (index: number) => step * index + step / 2;
  const ids = input.people.map((person) => person.id);
  const threads = story.threads.filter(({ person, values }) => (!visible || visible.has(person.id)) && values.some((value) => value !== null));
  const stationIndex = new Map(story.stations.map((station, index) => [station.item.id, index]));
  const ticks = Array.from({ length: Math.floor(range) + 1 }, (_, index) => input.scale.min + index).filter((tick) => range <= 10 || tick % Math.ceil(range / 5) === 0);
  const drawMs = 1800;
  const stagger = Math.min(140, 700 / Math.max(1, threads.length - 1));
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

  // Notes: each takes the first row where it doesn't run into another one (quotes stay in the almanac).
  const rows: Array<Array<[number, number]>> = [];
  const bubbles = story.notes.filter((note) => note.kind !== "quote").flatMap((note) => {
    const index = stationIndex.get(note.itemId);
    if (index === undefined) return [];
    const text = noteText(note, tn, personName, fmt);
    // A note stays on one line (a wrapped one would run into the row under it), centred on its title and kept
    // inside the drawing.
    const bubbleWidth = text.length * 6.4 + 30;
    const left = Math.max(0, Math.min(Math.max(0, contentWidth - bubbleWidth), x(index) - bubbleWidth / 2));
    let row = 0;
    while (rows[row]?.some(([from, to]) => left < to + 8 && left + bubbleWidth > from - 8)) row += 1;
    (rows[row] ??= []).push([left, left + bubbleWidth]);
    return [{ note, index, row, text, left }];
  });
  // Titles too close to read: only every few get their name and number (spread evenly, first and last always);
  // every point stays on the line.
  const LABEL = 88;
  const labelled = (() => {
    if (tail) return new Set(story.stations.slice(0, STORY_STATIONS).flatMap((_, index) => (index % STORY_LABEL_EVERY === STORY_LABEL_EVERY - 1 ? [index] : [])));
    if (step >= LABEL || count <= 2) return new Set(story.stations.map((_, index) => index));
    const slots = Math.max(2, Math.floor(contentWidth / LABEL));
    return new Set(Array.from({ length: slots }, (_, slot) => Math.round((slot * (count - 1)) / (slots - 1))));
  })();
  const labelWidth = Math.max(step, Math.min(LABEL + 24, contentWidth / Math.max(1, labelled.size)));
  // A story's labels stay centred on their title and never reach the next one (or past the drawing's edges).
  const labelBox = (index: number) => {
    if (!tail) return { left: Math.max(0, Math.min(contentWidth - labelWidth, x(index) - labelWidth / 2)), width: labelWidth };
    // The right edge is the "…" after the last title, so it always shows.
    const half = Math.max(0, Math.min(x(index), x(STORY_STATIONS) - 14 - x(index), (step * STORY_LABEL_EVERY - 8) / 2));
    return { left: x(index) - half, width: half * 2 };
  };
  const top = 20 + Math.max(1, rows.length) * 30;
  const height = top + PLOT;
  const y = (value: number) => top + (1 - (value - input.scale.min) / range) * (PLOT - BOTTOM);
  const HEIGHT = height;
  const TOP = top;

  return (
    <div ref={ref} className="relative w-full overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
      <div className="relative" style={{ width: contentWidth || "100%", height: HEIGHT + 64 }}>
        <svg width={contentWidth} height={HEIGHT} className="absolute left-0 top-0 block" role="img" aria-label={t("threadAria", { count: threads.length, items: count })}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={contentWidth} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === input.scale.min || tick === input.scale.max ? 0.14 : 0.06} />
              <text x={6} y={y(tick) - 4} fontSize="10" fill="currentColor" fillOpacity={0.35}>{tick}</text>
            </g>
          ))}
          {tail ? (
            <defs>
              <linearGradient id={`${fadeId}-fade`} gradientUnits="userSpaceOnUse" x1={x(STORY_STATIONS - 1) + step * 0.15} x2={x(STORY_STATIONS)} y1={0} y2={0}>
                <stop offset="0%" stopColor="white" />
                <stop offset="100%" stopColor="white" stopOpacity={0} />
              </linearGradient>
              <mask id={`${fadeId}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={contentWidth} height={HEIGHT}>
                <rect x={0} y={0} width={contentWidth} height={HEIGHT} fill={`url(#${fadeId}-fade)`} />
              </mask>
            </defs>
          ) : null}
          <g mask={tail ? `url(#${fadeId}-mask)` : undefined}>
          {story.stations.map((station, index) => (
            <line key={station.item.id} x1={x(index)} x2={x(index)} y1={TOP - 18} y2={HEIGHT - BOTTOM} stroke="currentColor" strokeOpacity={0.07} />
          ))}
          {/* Two people: the space between their lines as a ribbon — thin where they met, wide where each brought
              something. One person: the shape of their season, filled beneath the line. */}
          {story.threads.length === 2 ? (() => {
            const both = story.threads[0].values.flatMap((value, index) => {
              const other = story.threads[1].values[index];
              return value !== null && other !== null ? [{ x: x(index), a: y(value), b: y(other) }] : [];
            });
            if (both.length < 2) return null;
            const low = y(input.scale.max);
            const high = y(input.scale.min);
            const upper = smoothPaths(both.map((point) => ({ x: point.x, y: point.a })), low, high)[0];
            const lower = smoothPaths([...both].reverse().map((point) => ({ x: point.x, y: point.b })), low, high)[0];
            return <path d={`${upper} ${lower.replace(/^M/, "L")} Z`} fill="currentColor" fillOpacity={0.09} className="reveal-fade" style={delay(drawMs)} />;
          })() : null}
          {story.threads.length === 1 ? (() => {
            const points = story.threads[0].values.flatMap((value, index) => (value === null ? [] : [{ x: x(index), y: y(value) }]));
            if (points.length < 2) return null;
            const line = smoothPaths(points, y(input.scale.max), y(input.scale.min))[0];
            const base = y(input.scale.min);
            const { tone } = threadPersonStyle(ids, story.threads[0].person.id);
            return (
              <>
                <defs>
                  <linearGradient id="solo-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={tone} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={tone} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={`${line} L${points.at(-1)!.x},${base} L${points[0].x},${base} Z`} fill="url(#solo-fill)" className="reveal-fade" style={delay(drawMs * 0.6)} />
              </>
            );
          })() : null}
          {/* The group, as one faint line (a group only — two lines already say it, one line is it). */}
          {!visible && story.threads.length > 2 && smoothPaths(story.stations.map((station, index) => ({ x: x(index), y: y(station.average) })), y(input.scale.max), y(input.scale.min)).map((d, index) => (
            <path key={`avg-${index}`} d={d} fill="none" stroke="currentColor" strokeOpacity={0.28} strokeWidth={7} strokeLinecap="round" pathLength={1} className="taste-line" style={{ ...delay(0), animationDuration: `${drawMs}ms` }} />
          ))}
          {threads.map((thread, order) => {
            const { tone, dash } = threadPersonStyle(ids, thread.person.id);
            const dim = focus !== null && focus !== thread.person.id;
            return (
              <g key={thread.person.id} data-thread-person={thread.person.id} style={{ opacity: dim ? 0.1 : 1, transition: "opacity 250ms" }}>
                {smoothPaths(thread.values.map((value, index) => (value === null ? null : { x: x(index), y: y(value) })), y(input.scale.max), y(input.scale.min)).map((d, index) => (
                  <path key={index} d={d} fill="none" stroke={tone} strokeWidth={focus === thread.person.id ? 3.5 : 2.4} strokeLinecap="round" strokeDasharray={dash} pathLength={dash ? undefined : 1} className={dash ? "reveal-fade" : "taste-line"} style={{ ...delay(150 + order * stagger), animationDuration: `${drawMs}ms` }} />
                ))}
                {thread.values.map((value, index) => value === null ? null : (
                  <circle key={index} cx={x(index)} cy={y(value)} r={focus === thread.person.id ? 5 : 3.6} fill={tone} stroke="var(--spotlight)" strokeWidth={1.5} className="reveal-fade" style={delay(300 + order * stagger + (index / Math.max(1, count - 1)) * drawMs)} />
                ))}
              </g>
            );
          })}
          </g>
        </svg>

        {bubbles.map(({ note, index, row, text, left }) => (
          <Bubble key={`${note.kind}-${index}`} note={note} text={text} left={left} top={8 + row * 30} at={drawMs * ((index + 1) / count) + 500 + row * 200} />
        ))}

        {/* More titles past the edge: the lines fade out over them and a quiet "…" says so. */}
        {tail ? <p className="absolute text-[15px] leading-none text-[var(--thread-ink)]/45" aria-hidden="true" style={{ left: x(STORY_STATIONS) - 8, top: HEIGHT - BOTTOM + 10 }}>…</p> : null}
        {/* The titles along the bottom, with the group's number. */}
        {story.stations.map((station, index) => labelled.has(index) ? (
          <div key={station.item.id} className="absolute text-center" style={{ ...labelBox(index), top: HEIGHT - BOTTOM + 8 }}>
            <p className="mx-auto max-w-[92%] truncate text-[11px] leading-tight text-[var(--thread-ink)]/80" title={station.item.title}>{station.item.title}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[var(--thread-ink)]/45">{fmt(station.average)}</p>
          </div>
        ) : null)}
      </div>
    </div>
  );
}

function noteText(note: RatedNote, t: ReturnType<typeof useTranslations>, name: (id: Id) => string, fmt: (value: number) => string): string {
  switch (note.kind) {
    case "favourite": return t("favourite", { value: fmt(note.value) });
    case "split": return t("split", { low: fmt(note.low), high: fmt(note.high) });
    case "surprise": return t("surprise", { expected: fmt(note.expected), actual: fmt(note.actual) });
    case "flop": return t("flop", { value: fmt(note.value) });
    case "loner": return t("loner", { name: name(note.personId), value: fmt(note.value) });
    case "quote": return `“${note.text}” (${name(note.personId)})`;
  }
}

function Bubble({ note, text, left, top, at }: {
  note: RatedNote; text: string; left: number; top: number; at: number;
}) {
  const accent = note.kind === "favourite" ? "var(--tag-green)" : note.kind === "flop" ? "var(--tag-coral)" : "var(--main-2)";
  // The position lives on the outer box and the fade-in on the inner one (an animation's transform would move it).
  return (
    <div className="absolute z-10" style={{ left, top }}>
      <div
        className="reveal-rise w-max whitespace-nowrap rounded-lg bg-[var(--spotlight-ink)] px-2 py-1 text-[11px] leading-snug text-[var(--spotlight)] shadow-[var(--elevate-card)]"
        style={{ borderLeft: `3px solid ${accent}`, animationDelay: `${at}ms` }}
      >
        {text}
      </div>
    </div>
  );
}
