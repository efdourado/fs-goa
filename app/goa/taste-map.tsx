"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { Id } from "./types";
import { cx } from "./ui";

interface TasteMoment { title: string; you: number; them: number }
interface TastePerson { userId: Id; name: string; shared: number; agreement: number | null; twin: TasteMoment | null; clash: TasteMoment | null }
interface TastePair { a: { userId: Id; name: string }; b: { userId: Id; name: string }; agreement: number; shared: number }
interface GroupTaste { viewerId: Id; minShared: number; ratedCount: number; people: TastePerson[]; twins: TastePair | null; opposites: TastePair | null }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

/** Agreement as a colour: close in taste is green, far is coral — same language as the reveal. */
function toneFor(agreement: number): string {
  if (agreement >= 78) return "var(--tag-green)";
  if (agreement >= 65) return "var(--tag-amber)";
  return "var(--main-2)";
}

/**
 * How far out someone sits (as % of the map's width) for an agreement score. Real scores live between
 * about 40% and 100% — mapping that band onto the whole map keeps "close" and "far" visibly different.
 */
const radiusFor = (agreement: number) => 11 + Math.min(1, Math.max(0, (100 - agreement) / 60)) * 33;
const RINGS = [90, 75, 60];

/**
 * "Who shares your taste": you in the middle, everyone else drifting in until they sit as close to you as
 * your ratings of the same titles are — across every challenge the group ran. Tap someone for the title
 * you agreed on most and the one you didn't. Every distance says what it is built on ("4 in common").
 */
export function TasteMap({ groupId, youLabel }: { groupId: Id; youLabel: string }) {
  const t = useTranslations("taste");
  const nf = useFormatter();
  const [taste, setTaste] = useState<GroupTaste | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let active = true;
    apiRequest<GroupTaste>(API_PATHS.groupTaste(groupId))
      .then((data) => { if (active) setTaste(data); })
      .catch(() => { if (active) setTaste(null); });
    return () => { active = false; };
  }, [groupId]);

  if (!taste || !taste.people.length) return null;
  const scored = taste.people.filter((person): person is TastePerson & { agreement: number } => person.agreement !== null);
  const waiting = taste.people.filter((person) => person.agreement === null);
  const selected = scored.find((person) => person.userId === selectedId) ?? scored[0] ?? null;
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  // A pair that includes the viewer names them "You", first.
  const pairNames = (pair: TastePair) => pair.b.userId === taste.viewerId
    ? { a: youLabel, b: pair.a.name }
    : { a: pair.a.userId === taste.viewerId ? youLabel : pair.a.name, b: pair.b.name };

  // Ring labels go in the gap between the first two people, where no avatar can sit.
  const labelAngle = (-90 + 180 / Math.max(1, scored.length) + (scored.length === 2 ? 30 : 0)) * (Math.PI / 180);
  // Spread people round the circle, closest first from the top, so the layout is stable between visits.
  const placed = scored.map((person, index) => {
    const angle = (-90 + (index * 360) / scored.length + (scored.length === 2 ? 30 : 0)) * (Math.PI / 180);
    const radius = radiusFor(person.agreement);
    return { person, index, x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, dx: Math.cos(angle), dy: Math.sin(angle) };
  });

  return (
    <section>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("title")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("basis", { count: taste.ratedCount })}</span>
        </div>
        {scored.length ? (
          <button type="button" className="mt-1 flex-none cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => setRun((value) => value + 1)}>↺ {t("replay")}</button>
        ) : null}
      </div>

      <div key={run} className="overflow-hidden rounded-[24px] bg-[var(--spotlight)] text-[var(--spotlight-ink)] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {scored.length ? (
          <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
              <circle cx="50" cy="50" r={radiusFor(40)} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={0.25} />
              {RINGS.map((ring) => (
                <circle key={ring} cx="50" cy="50" r={radiusFor(ring)} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={0.25} strokeDasharray="0.8 1.2" />
              ))}
              {placed.map(({ person, index, x, y }) => (
                <line
                  key={person.userId}
                  x1="50" y1="50" x2={x} y2={y}
                  pathLength={1}
                  className="taste-line"
                  stroke={toneFor(person.agreement)}
                  strokeOpacity={selected?.userId === person.userId ? 0.9 : 0.4}
                  strokeWidth={selected?.userId === person.userId ? 0.6 : 0.35}
                  style={{ animationDelay: `${700 + index * 220}ms` }}
                />
              ))}
            </svg>
            {RINGS.map((ring) => (
              <span key={ring} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--spotlight)] px-0.5 text-[9px] tabular-nums text-white/40" style={{ left: `${50 + Math.cos(labelAngle) * radiusFor(ring)}%`, top: `${50 + Math.sin(labelAngle) * radiusFor(ring)}%` }}>{ring}%</span>
            ))}
            <span className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--spotlight-ink)] text-[11px] font-bold text-[var(--spotlight)] shadow-lg">{youLabel}</span>
            {placed.map(({ person, index, x, y, dx, dy }) => (
              <button
                key={person.userId}
                type="button"
                onClick={() => setSelectedId(person.userId)}
                className="taste-drift absolute flex cursor-pointer flex-col items-center gap-1 focus-visible:outline-none"
                style={{ left: `${x}%`, top: `${y}%`, "--dx": `${dx * 160}px`, "--dy": `${dy * 160}px`, animationDelay: `${index * 220}ms` } as CSSProperties}
                aria-label={t("personAria", { name: person.name, agreement: person.agreement, count: person.shared })}
                aria-pressed={selected?.userId === person.userId}
              >
                <span
                  className={cx("grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white shadow-lg transition", selected?.userId === person.userId && "ring-2 ring-white ring-offset-2 ring-offset-[var(--spotlight)]")}
                  style={{ background: toneFor(person.agreement) }}
                >
                  {initials(person.name)}
                </span>
                <span className="whitespace-nowrap rounded-full bg-black/35 px-1.5 text-[10px] tabular-nums text-white/85">{person.agreement}%</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6 sm:p-8">
            <p className="text-2xl font-light leading-tight tracking-[-0.03em]">{t("emptyTitle")}</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/65">{t("emptyBody", { count: taste.minShared })}</p>
          </div>
        )}

        <div className="space-y-5 border-t border-white/10 p-5 sm:p-7 lg:border-l lg:border-t-0">
          {selected ? (
            <div className="taste-rise" style={{ animationDelay: selectedId ? "0ms" : `${scored.length * 220 + 500}ms` }} key={selected.userId}>
              <p className="text-xs text-white/55">{t("withName", { name: selected.name })}</p>
              <p className="mt-1 text-4xl font-light tracking-[-0.05em]" style={{ color: toneFor(selected.agreement!) }}>{selected.agreement}%</p>
              <p className="mt-1 text-sm text-white/75">{t(`verdict.${selected.agreement! >= 90 ? "twins" : selected.agreement! >= 78 ? "close" : selected.agreement! >= 65 ? "mixed" : "apart"}`)}</p>
              <p className="mt-1 text-xs text-white/45">{t("inCommon", { count: selected.shared })}</p>
              <dl className="mt-4 space-y-2.5 text-sm">
                {selected.twin ? (
                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <dt className="text-xs text-white/50">{t("closestOn")}</dt>
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
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-white/50">{t("notYet", { count: taste.minShared })}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {waiting.map((person) => (
                  <li key={person.userId} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] py-0.5 pl-0.5 pr-2.5 text-xs text-white/60">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-white/30 text-[9px] font-bold">{initials(person.name)}</span>
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
