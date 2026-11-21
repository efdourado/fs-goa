"use client";

import { StateButton } from "./state-button";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { Id } from "./types";
import { AvatarMark, cx } from "./ui";

interface TasteMoment { title: string; you: number; them: number }
interface TastePerson { userId: Id; name: string; shared: number; agreement: number | null; twin: TasteMoment | null; clash: TasteMoment | null; twinTies: number; identical: boolean }
interface TastePair { a: { userId: Id; name: string }; b: { userId: Id; name: string }; agreement: number; shared: number }
interface GroupTaste { viewerId: Id; minShared: number; people: TastePerson[]; twins: TastePair | null; opposites: TastePair | null }

/** Agreement as a colour: close in taste is green, far is coral — same language as the reveal. */
function toneFor(agreement: number): string {
  if (agreement >= 78) return "var(--tag-green)";
  if (agreement >= 65) return "var(--tag-amber)";
  return "var(--main-2)";
}

const INNER_RADIUS = 13;
const OUTER_RADIUS = 40;
const MAX_MAP_PEOPLE = 6;
/** Radial weight of a collapsed run of empty bands, against 1 for a band someone sits in. */
const COLLAPSED_GAP = 0.6;
/** Markers sit on an arc that leaves the top axis clear for the ring labels. */
const ARC_START = -54;
const ARC_SPAN = 288;
/** Minimum centre-to-centre distance (viewBox units): a 10-unit marker plus its % tag. */
const MARKER_GAP = 13;

/**
 * "Who shares your taste": you in the middle, everyone else sitting as close to you as
 * your ratings of the same titles are — across every challenge the group ran. Tap someone for the title
 * you agreed on most and the one you didn't. Every distance says what it is built on ("4 in common").
 */
export function TasteMap({ groupId, youLabel }: { groupId: Id; youLabel: string }) {
  const t = useTranslations("taste");
  const nf = useFormatter();
  const [taste, setTaste] = useState<GroupTaste | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<GroupTaste>(API_PATHS.groupTaste(groupId))
      .then((data) => { if (active) setTaste(data); })
      .catch(() => { if (active) setTaste(null); });
    return () => { active = false; };
  }, [groupId]);

  if (!taste || !taste.people.length) return null;
  const scored = taste.people.filter((person): person is TastePerson & { agreement: number } => person.agreement !== null);
  // The API lists the closest scores first. For larger groups, keep both ends of that list.
  const matchesPerEnd = MAX_MAP_PEOPLE / 2;
  const plotted = scored.length > MAX_MAP_PEOPLE
    ? [...scored.slice(0, matchesPerEnd), ...scored.slice(-matchesPerEnd)]
    : scored;
  const waiting = taste.people.filter((person) => person.agreement === null);
  const selected = plotted.find((person) => person.userId === selectedId) ?? plotted[0] ?? null;
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  // A pair that includes the viewer names them "You", first.
  const pairNames = (pair: TastePair) => pair.b.userId === taste.viewerId
    ? { a: youLabel, b: pair.a.name }
    : { a: pair.a.userId === taste.viewerId ? youLabel : pair.a.name, b: pair.b.name };

  // Rings mark bands of `ringStep`. A band someone sits in keeps its full width; a run of two or more
  // empty bands collapses into one thin gap, so 85–100 and 0–10 don't leave 40–60 rings standing in between.
  // Built from the people on the map only: someone left off it must not hold a ring open.
  const lowest = plotted.reduce((min, person) => Math.min(min, person.agreement), 100);
  const ringStep = lowest >= 70 ? 10 : 20;
  const floor = Math.min(70, Math.floor(lowest / ringStep) * ringStep);
  const bandOf = (agreement: number) => Math.min(Math.floor(agreement / ringStep), 100 / ringStep - 1);
  const occupied = new Set(plotted.map((person) => bandOf(person.agreement)));
  const stops: Array<{ value: number; depth: number }> = [{ value: 100, depth: 0 }];
  for (let band = 100 / ringStep - 1, depth = 0; band * ringStep >= floor;) {
    let next = band;
    if (occupied.has(band)) next = band - 1;
    else while (next * ringStep >= floor && !occupied.has(next)) next -= 1;
    const run = band - next;
    depth += occupied.has(band) || run === 1 ? 1 : COLLAPSED_GAP;
    stops.push({ value: (next + 1) * ringStep, depth });
    band = next;
  }
  const rings = stops.map((stop) => stop.value);
  const totalDepth = stops.at(-1)!.depth || 1;
  const radiusFor = (agreement: number) => {
    const index = Math.max(1, stops.findIndex((stop) => stop.value <= agreement));
    const upper = stops[index - 1];
    const lower = stops[index] ?? upper;
    const share = upper.value === lower.value ? 0 : (upper.value - agreement) / (upper.value - lower.value);
    const depth = upper.depth + share * (lower.depth - upper.depth);
    return INNER_RADIUS + depth * (OUTER_RADIUS - INNER_RADIUS) / totalDepth;
  };
  // Seat people alternately from the closest and the furthest end, so near scores (100% and 98%) never sit
  // side by side; then nudge any two markers that still touch apart along their own ring. The radius stays exact.
  const seating = plotted.map((_, index) => (index % 2 === 0 ? index / 2 : plotted.length - 1 - (index - 1) / 2));
  const seated = seating.map((index) => plotted[index]);
  const radii = seated.map((person) => radiusFor(person.agreement));
  const degrees = seated.map((_, index) => (seated.length === 1 ? 0 : ARC_START + ARC_SPAN * (index + 0.5) / seated.length));
  const pointAt = (index: number) => {
    const angle = degrees[index] * Math.PI / 180;
    return { x: 50 + Math.cos(angle) * radii[index], y: 50 + Math.sin(angle) * radii[index] };
  };
  for (let pass = 0; pass < 120; pass += 1) {
    let moved = false;
    for (let i = 0; i < seated.length; i += 1) {
      for (let j = i + 1; j < seated.length; j += 1) {
        const a = pointAt(i);
        const b = pointAt(j);
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (gap >= MARKER_GAP) continue;
        const nudge = ((MARKER_GAP - gap) / 2 / Math.min(radii[i], radii[j])) * 180 / Math.PI;
        const direction = degrees[i] <= degrees[j] ? 1 : -1;
        degrees[i] = Math.max(ARC_START, Math.min(ARC_START + ARC_SPAN, degrees[i] - direction * nudge));
        degrees[j] = Math.max(ARC_START, Math.min(ARC_START + ARC_SPAN, degrees[j] + direction * nudge));
        moved = true;
      }
    }
    if (!moved) break;
  }
  const placed = seated.map((person, index) => ({ person, ...pointAt(index) }));

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em]">{t("title")}</h2>

      <div className="overflow-hidden rounded-[24px] bg-[var(--spotlight)] text-[var(--spotlight-ink)] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {scored.length ? (
          <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
              {rings.map((ring) => (
                <circle key={ring} cx="50" cy="50" r={radiusFor(ring)} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={0.25} strokeDasharray={ring === floor ? undefined : "0.8 1.2"} />
              ))}
              {placed.map(({ person, x, y }) => (
                <line
                  key={person.userId}
                  x1="50" y1="50" x2={x} y2={y}
                  stroke={toneFor(person.agreement)}
                  strokeOpacity={selected?.userId === person.userId ? 0.9 : 0.4}
                  strokeWidth={selected?.userId === person.userId ? 0.6 : 0.35}
                />
              ))}
            </svg>
            {rings.map((ring) => (
              <span key={ring} className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--spotlight)] px-1 text-[10px] tabular-nums text-white/70" style={{ top: `${50 - radiusFor(ring)}%` }}>{ring}%</span>
            ))}
            <span className="absolute left-1/2 top-1/2 grid aspect-square w-[12%] max-w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--spotlight-ink)] text-[11px] font-bold text-[var(--spotlight)] shadow-[var(--elevate-card)]">{youLabel}</span>
            {placed.map(({ person, x, y }) => {
              const active = selected?.userId === person.userId;
              return (
                <div
                  key={person.userId}
                  className={cx("absolute aspect-square w-[10%] -translate-x-1/2 -translate-y-1/2 focus-within:z-20", active && "z-10")}
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <StateButton
                    type="button"
                    onClick={() => setSelectedId(person.userId)}
                    aria-label={t("personAria", { name: person.name, agreement: person.agreement, count: person.shared })}
                    aria-pressed={active}
                    className={cx("grid size-full cursor-pointer place-items-center rounded-full p-0.5 shadow-[var(--elevate-card)]", active && "ring-2 ring-white ring-offset-2 ring-offset-[var(--spotlight)]")}
                    style={{ background: toneFor(person.agreement) }}
                  >
                    <AvatarMark />
                  </StateButton>
                  <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-1.5 text-[10px] tabular-nums text-white/90" aria-hidden="true">{person.agreement}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6 sm:p-8">
            <p className="text-2xl font-light leading-tight tracking-[-0.03em]">{t("emptyTitle")}</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/65">{t("emptyBody", { count: taste.minShared })}</p>
          </div>
        )}

        <div className={cx("space-y-5 border-white/10 p-5 sm:p-7 lg:border-l", selected && "border-t lg:border-t-0")}>
          {selected ? (
            <div>
              <p className="text-xs text-white/55">{t("withName", { name: selected.name })}</p>
              <p className="mt-1 text-4xl font-light tracking-[-0.05em]" style={{ color: toneFor(selected.agreement) }}>{selected.agreement}%</p>
              <p className="mt-1 text-sm text-white/75">{t(`verdict.${selected.identical ? "same" : selected.agreement >= 90 ? "twins" : selected.agreement >= 78 ? "close" : selected.agreement >= 65 ? "mixed" : "apart"}`)}</p>
              <p className="mt-1 text-xs text-white/45">{t("inCommon", { count: selected.shared })}</p>
              <dl className="mt-4 space-y-2.5 text-sm">
                {selected.twin && !selected.identical ? (
                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <dt className="text-xs text-white/50">{selected.twinTies > 1 ? t("closestAmong", { count: selected.twinTies }) : t("closestOn")}</dt>
                    <dd className="mt-0.5 text-white/90">{selected.twin.title} <span className="text-white/55">· {t("scores", { you: fmt(selected.twin.you), name: selected.name.split(/\s+/)[0], them: fmt(selected.twin.them) })}</span></dd>
                  </div>
                ) : null}
                {selected.clash ? (
                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <dt className="text-xs text-white/50">{t("furthestOn")}</dt>
                    <dd className="mt-0.5 text-white/90">{selected.clash.title} <span className="text-white/55">· {t("scores", { you: fmt(selected.clash.you), name: selected.name.split(/\s+/)[0], them: fmt(selected.clash.them) })}</span></dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {taste.twins || taste.opposites ? (
            <div className="space-y-1.5 border-t border-white/10 pt-4 text-sm text-white/70">
              {taste.twins ? <p>{t("groupTwins", { ...pairNames(taste.twins), agreement: taste.twins.agreement })}</p> : null}
              {taste.opposites ? <p>{t("groupOpposites", { ...pairNames(taste.opposites), agreement: taste.opposites.agreement })}</p> : null}
            </div>
          ) : null}

          {waiting.length ? (
            <div>
              <p className="text-xs text-white/50">{t("notYet", { count: taste.minShared })}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {waiting.map((person) => (
                  <li key={person.userId} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] py-0.5 pl-0.5 pr-2.5 text-xs text-white/60">
                    <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full border border-dashed border-white/30 opacity-60"><AvatarMark /></span>
                    {t("sharedSoFar", { name: person.name.split(/\s+/)[0], count: person.shared })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
