"use client";

import { useFormatter } from "next-intl";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { Id } from "./types";
import { cx } from "./ui";

/**
 * Each person keeps one colour wherever they appear (reveal, recap, taste map) — an identity, not a
 * verdict: nobody's rating is painted "wrong" for being far from the group.
 */
const PERSON_TONES = ["var(--tag-blue)", "var(--tag-violet)", "var(--tag-amber)", "var(--tag-green)", "var(--tag-rose)", "var(--tag-coral)"];

export function personTone(ids: readonly Id[], id: Id): string {
  const index = ids.indexOf(id);
  return PERSON_TONES[(index < 0 ? 0 : index) % PERSON_TONES.length];
}

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
export const firstName = (name: string) => name.split(/\s+/).filter(Boolean)[0] ?? name;

export interface ScalePerson {
  id: Id;
  name: string;
  value: number;
  tone: string;
  self?: boolean;
}

/** How long a scale takes to land everyone: ~0.5 s each, never more than ~3.2 s however big the group. */
export function dropStep(count: number): number {
  return Math.min(520, Math.round(3200 / Math.max(1, count)));
}

/** When the last person has landed, in ms — the moment the verdict can follow. */
export function landedAfter(count: number, startDelay = 0): number {
  return startDelay + Math.max(0, count - 1) * dropStep(count) + 600;
}

const SLOT = 64;

/**
 * A rating scale people drop onto one by one, closest to the group first and the most different last,
 * each landing with their name and number so a recording reads without a legend. Two people closer than
 * an avatar's width stack instead of overlapping (measured, so a phone stacks more).
 */
export function RatingScale({
  people,
  min,
  max,
  startDelay = 0,
  average,
  averageLabel,
  labelFor,
}: {
  people: ScalePerson[];
  min: number;
  max: number;
  startDelay?: number;
  /** Draws a dashed marker once everyone has landed. */
  average?: number | null;
  averageLabel?: string;
  /** The name under each avatar ("You" for the viewer). */
  labelFor?: (person: ScalePerson) => string;
}) {
  const nf = useFormatter();
  const range = Math.max(1e-9, max - min);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const sorted = people.map((person) => person.value).sort((a, b) => a - b);
  const center = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0;
  const order = [...people].sort((a, b) => Math.abs(a.value - center) - Math.abs(b.value - center));
  const step = dropStep(people.length);
  const minGap = width ? (58 / width) * 100 : 12;
  const placed: Array<{ person: ScalePerson; index: number; level: number; left: number }> = [];
  for (const [index, person] of order.entries()) {
    const left = ((person.value - min) / range) * 100;
    let level = 0;
    while (placed.some((other) => other.level === level && Math.abs(other.left - left) < minGap)) level += 1;
    placed.push({ person, index, level, left });
  }
  const tallest = Math.max(1, ...placed.map((spot) => spot.level + 1));
  const ticks = Array.from({ length: Math.floor(range) + 1 }, (_, index) => min + index).filter((tick) => range <= 10 || tick % Math.ceil(range / 5) === 0);
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
  const done = landedAfter(people.length, startDelay);

  return (
    <div ref={ref} className="relative mx-5 sm:mx-7" style={{ height: `${tallest * SLOT + 34}px` }}>
      {average !== null && average !== undefined ? (
        <div className="reveal-fade absolute bottom-6 top-0 w-px -translate-x-1/2 border-l border-dashed border-white/35" style={{ left: `${((average - min) / range) * 100}%`, ...delay(done) }}>
          <span className="absolute -top-1 left-1.5 whitespace-nowrap text-[10px] uppercase tracking-wider text-white/55">{averageLabel} {fmt(average)}</span>
        </div>
      ) : null}
      {placed.map(({ person, index, level, left }) => (
        <div key={person.id} className="absolute bottom-6 -translate-x-1/2" style={{ left: `${left}%`, marginBottom: `${level * SLOT}px` }}>
          <div className="reveal-drop flex flex-col items-center" style={delay(startDelay + index * step)}>
            <span
              className={cx("grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white shadow-lg", person.self && "ring-2 ring-white ring-offset-2 ring-offset-[var(--spotlight)]")}
              style={{ background: person.tone }}
            >
              {initialsOf(person.name)}
            </span>
            <span className="mt-1 whitespace-nowrap rounded-full bg-black/40 px-1.5 py-px text-[10px] leading-4 text-white">
              {labelFor ? labelFor(person) : firstName(person.name)} <strong className="font-semibold tabular-nums">{fmt(person.value)}</strong>
            </span>
            {level === 0 ? <span className="h-1.5 w-0.5" style={{ background: person.tone }} aria-hidden="true" /> : null}
          </div>
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-6 h-0.5 rounded-full bg-white/20" />
      {ticks.map((tick) => (
        <span key={tick} className="absolute bottom-0 -translate-x-1/2 text-[11px] tabular-nums text-white/45" style={{ left: `${((tick - min) / range) * 100}%` }}>{tick}</span>
      ))}
    </div>
  );
}
