"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { coverColors, coverToneOf } from "../catalog-cover";
import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id, Metric } from "../types";
import { CommentText, cx } from "../ui";
import type { DatedStory, GroupStat, RatedStory, Story, StoryInput } from "./model";

/** A small typographic cover — the title is the artwork, tinted like the catalogue's. `bare` drops the title when it is printed beside it. */
export function TitleChip({ title, year, className, bare = false }: { title: string; year?: number | null; className?: string; bare?: boolean }) {
  return (
    <span className={cx("relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-lg bg-[var(--cover-bg)] p-1.5 text-[var(--cover-ink)]", className)} style={coverColors(coverToneOf(title))}>
      <span aria-hidden="true" className="absolute -bottom-5 -right-5 h-12 w-12 rounded-full border-[8px] border-[var(--cover-deco)]" />
      <span className="relative text-[7px] tracking-[0.08em]" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year ?? " "}</span>
      {/* Bare: the title is already written right next to the cover — don't say it twice. */}
      {bare ? null : <span className="relative line-clamp-3 break-words text-[10px] font-light leading-[1.05]">{title}</span>}
    </span>
  );
}

/** One page of the almanac: its name, its one-line headline, what's on it (for the download list), and the page itself. */
export interface AlmanacPage {
  id: string;
  title: string;
  headline: string;
  contents: string;
  body: ReactNode;
}

/** The one card every fact sits in: paper on the canvas, a hairline, the same padding and corners everywhere. */
const cardClass = "flex min-w-0 flex-col rounded-[20px] border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6";

/** A titled card inside a page — a heading, the facts, nothing else. Cards in a row share one height. */
function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx(cardClass, wide && "[grid-column:1/-1]")}>
      <h4 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h4>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

/**
 * One exercise as a single row: its name, a tiny line of every session's number (the best dot filled),
 * the range it covered and the gain — compact, no arrows, the line already goes up.
 */
function Progression({ title, row, unit, person, fmt, tone }: {
  title: string;
  row: { first: number; best: number; sessions: number; series: number[] };
  unit: string;
  person: string | null;
  fmt: (value: number) => string;
  tone: string;
}) {
  const t = useTranslations("story");
  const width = 88;
  const height = 22;
  const low = Math.min(...row.series);
  const high = Math.max(...row.series);
  const span = Math.max(1e-9, high - low);
  const x = (index: number) => (row.series.length === 1 ? width / 2 : 3 + (index * (width - 6)) / (row.series.length - 1));
  const y = (value: number) => height - 3 - ((value - low) / span) * (height - 6);
  const points = row.series.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const gain = Math.round(((row.best - row.first) / Math.max(1e-9, row.first)) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_88px_6.5rem_3rem] items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block truncate">{title}</span>
        <span className="block text-xs text-[var(--muted)]">{[person, t("records.sessions", { count: row.sessions })].filter(Boolean).join(" · ")}</span>
      </span>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        <polyline points={points} fill="none" stroke={tone} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(row.series.indexOf(high))} cy={y(high)} r={2.6} fill={tone} />
      </svg>
      <span className="whitespace-nowrap text-right text-xs tabular-nums text-[var(--muted)]">{t("records.range", { first: fmt(row.first), best: fmt(row.best), unit })}</span>
      <strong className="text-right font-medium tabular-nums" style={{ color: tone }}>+{gain}%</strong>
    </li>
  );
}

/**
 * Expectation against reality for one title, as a track: the hollow dot is the guess, the filled one where
 * it landed, the bar between them the distance — and the difference written plainly at the end.
 */
function Shift({ title, expected, actual, min, max, fmt }: { title: string; expected: number; actual: number; min: number; max: number; fmt: (value: number) => string }) {
  const at = (value: number) => ((value - min) / Math.max(1e-9, max - min)) * 100;
  const up = actual >= expected;
  const tone = up ? "var(--main)" : "var(--main-2)";
  const low = Math.min(expected, actual);
  const high = Math.max(expected, actual);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{title}</span>
        <span className="flex-none text-xs font-medium tabular-nums" style={{ color: tone }}>{up ? "+" : "−"}{fmt(Math.abs(actual - expected))}</span>
      </div>
      <div className="relative mt-2 h-4">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line)]" />
        <span className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ left: `${at(low)}%`, width: `${at(high) - at(low)}%`, background: tone, opacity: 0.55 }} />
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--paper)]" style={{ left: `${at(expected)}%`, borderColor: "var(--muted)" }} title={fmt(expected)} />
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${at(actual)}%`, background: tone }} title={fmt(actual)} />
      </div>
      <div className="relative mt-1 h-4 text-[10px] tabular-nums text-[var(--muted)]">
        {/* Two numbers too close to read apart: the rating speaks, the guess is in the dot. */}
        {Math.abs(at(actual) - at(expected)) >= 9 ? <span className="absolute -translate-x-1/2" style={{ left: `${at(expected)}%` }}>{fmt(expected)}</span> : null}
        <span className="absolute -translate-x-1/2 font-medium text-[var(--ink)]" style={{ left: `${at(actual)}%` }}>{fmt(actual)}</span>
      </div>
    </li>
  );
}

function Bar({ value, max, tone, label, figure, strong }: { value: number; max: number; tone?: string; label: ReactNode; figure: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
      <span className={cx("truncate", strong ? "font-medium" : "font-light")}>{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--wash-strong)]">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (value / Math.max(1e-9, max)) * 100)}%`, background: tone ?? "var(--main)" }} />
      </span>
      <span className="w-10 text-right tabular-nums text-[var(--muted)]">{figure}</span>
    </div>
  );
}

function Avatar({ id, name, ids, size = 7 }: { id: Id; name: string; ids: Id[]; size?: number }) {
  return <span className="grid flex-none place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: personTone(ids, id), width: size * 4, height: size * 4 }}>{initialsOf(name)}</span>;
}

// Two columns at most, decided by the page's own width (a screen, or a downloaded page) — and a lone last card
// takes the whole row instead of sitting next to a hole.
const grid = "grid gap-4 @2xl:grid-cols-2 @2xl:[&>*:last-child:nth-child(odd)]:[grid-column:1/-1]";

/**
 * Every page the almanac has for this story — only the ones its data can fill. `full` lists everything
 * (the downloadable pages have no "show all" to press).
 */
export function useAlmanacPages(story: Story, input: StoryInput, metrics: Metric[], full = false): AlmanacPage[] {
  const t = useTranslations("story");
  const nf = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const showAll = full || expanded;
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const day = (key: string) => nf.dateTime(new Date(`${key}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const ids = input.people.map((person) => person.id);
  const noun = (count: number) => t(`noun.${input.noun}`, { count });
  const pages: AlmanacPage[] = [];
  const metricsPage: AlmanacPage[] = [];

  if (story.kind === "rated") {
    const s: RatedStory = story;
    const scaleSpan = input.scale.max - input.scale.min;
    const statBars = (stats: GroupStat[]) => (
      <div className="space-y-2.5">
        {stats.map((stat, index) => (
          <Bar key={stat.key} label={<>{stat.key} <span className="text-xs text-[var(--muted)]">· {stat.count}</span></>} value={stat.average - input.scale.min} max={scaleSpan} strong={index === 0 && stat.count >= 2} figure={fmt(stat.average)} tone={index === 0 && stat.count >= 2 ? "var(--main)" : "var(--main-line)"} />
        ))}
      </div>
    );
    const podium = s.ranking.slice(0, 3);
    const rest = s.ranking.slice(3);
    const propertyLabel = (label: string) => (t.has(`property.labels.${label}`) ? t(`property.labels.${label}`) : label);

    pages.push({
      id: "rankings",
      title: t("pages.rankings.title"),
      headline: t("pages.rankings.headline", { title: s.ranking[0].item.title, value: fmt(s.ranking[0].average) }),
      contents: [t("podium.eyebrow"), rest.length ? t("ranking.rest") : null, s.genres.length ? t("genres.eyebrow") : null, s.years.length ? t("years.eyebrow") : null].filter(Boolean).join(" · "),
      body: (
        <div className={grid}>
          <Block title={t("podium.eyebrow")}>
            <div className="grid max-w-md grid-cols-3 items-end gap-3">
              {[podium[1], podium[0], podium[2]].map((score, index) => score ? (
                <div key={score.item.id} className="flex flex-col items-center text-center">
                  <span className={cx("relative w-full", index === 1 ? "max-w-[6.5rem]" : "max-w-[5.25rem]")}>
                    <TitleChip bare title={score.item.title} year={score.item.year} className="w-full" />
                    {/* The place, as a badge on the cover — the pedestal is for the number. */}
                    <span className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--ink)] text-[11px] font-medium text-[var(--canvas)]">{index === 1 ? 1 : index === 0 ? 2 : 3}</span>
                  </span>
                  <p className="mt-2 line-clamp-1 text-xs">{score.item.title}</p>
                  <div className={cx("mt-2 flex w-full flex-col items-center justify-start rounded-lg bg-[var(--wash)] pt-2.5", index === 1 ? "h-24" : index === 0 ? "h-[4.5rem]" : "h-14")}>
                    <span className="text-2xl font-light tabular-nums leading-none tracking-[-0.03em]">{fmt(score.average)}</span>
                    <span className="mt-1 text-[10px] text-[var(--muted)]">{t("podium.average")}</span>
                  </div>
                </div>
              ) : <span key={index} />)}
            </div>
          </Block>
          {rest.length ? (
            <Block title={t("ranking.rest")}>
              <ol className="space-y-2">
                {(showAll ? rest : rest.slice(0, 5)).map((score, index) => (
                  <li key={score.item.id}><Bar label={<><span className="mr-1.5 tabular-nums text-[var(--muted)]">{index + 4}</span>{score.item.title}</>} value={score.average - input.scale.min} max={scaleSpan} figure={fmt(score.average)} tone="var(--main-line)" /></li>
                ))}
              </ol>
              {!full && rest.length > 5 ? (
                <button type="button" className="mt-3 cursor-pointer text-xs text-[var(--main-strong)]" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? t("showLess") : t("showAll", { count: s.ranking.length })}
                </button>
              ) : null}
            </Block>
          ) : null}
          {s.genres.length ? <Block title={t("genres.title", { genre: s.genres[0].key, value: fmt(s.genres[0].average) })}>{statBars(s.genres)}</Block> : null}
          {s.years.length ? (
            <Block title={t("years.title", { first: s.years[0].key, last: s.years.at(-1)!.key })}>
              <div className="flex h-28 items-end gap-1.5">
                {s.years.map((year) => {
                  const tallest = Math.max(...s.years.map((row) => row.count));
                  // Only a year with two or more titles can be "the best" — one title is an anecdote.
                  const contenders = s.years.filter((row) => row.count >= 2);
                  const best = year.count >= 2 && year.average === Math.max(...contenders.map((row) => row.average));
                  return (
                    <div key={year.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={year.items.join(" · ")}>
                      <span className="text-[10px] tabular-nums text-[var(--muted)]">{fmt(year.average)}</span>
                      <span className="w-full rounded-t" style={{ height: `${(year.count / tallest) * 70}px`, background: best ? "var(--main)" : "var(--main-line)" }} />
                      <span className="text-[10px] tabular-nums">{year.key}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">{t("years.note")}</p>
            </Block>
          ) : null}
        </div>
      ),
    });

    if (s.duo) {
      const d = s.duo;
      const toneA = personTone(ids, d.a.id);
      const toneB = personTone(ids, d.b.id);
      const nameA = firstName(d.a.name);
      const nameB = firstName(d.b.name);
      const titleRows = (rows: typeof d.met, lead: "a" | "b" | null) => (
        <ul className="space-y-2 text-sm">
          {rows.slice(0, 5).map((row) => (
            <li key={row.item.id} className="flex items-center gap-3">
              <TitleChip bare title={row.item.title} year={row.item.year} className="w-8 flex-none" />
              <span className="min-w-0 flex-1 truncate">{row.item.title}</span>
              <span className="flex-none tabular-nums text-xs">
                <span className={lead === "b" ? "text-[var(--muted)]" : "font-medium"} style={lead === "a" ? { color: toneA } : undefined}>{fmt(row.a)}</span>
                <span className="text-[var(--muted)]"> · </span>
                <span className={lead === "a" ? "text-[var(--muted)]" : "font-medium"} style={lead === "b" ? { color: toneB } : undefined}>{fmt(row.b)}</span>
              </span>
            </li>
          ))}
          {rows.length > 5 ? <li className="text-xs text-[var(--muted)]">{t("metricsMore", { count: rows.length - 5 })}</li> : null}
        </ul>
      );
      const argumentQuotes = d.argument ? s.quotes.filter((quote) => quote.item.id === d.argument!.item.id) : [];
      const span = Math.max(1e-9, input.scale.max - input.scale.min);
      pages.push({
        id: "duo",
        title: t("duo.title"),
        headline: t("duo.mix.line", { total: d.met.length + d.aBrought.length + d.bBrought.length + d.between, things: noun(d.met.length + d.aBrought.length + d.bBrought.length + d.between), met: d.met.length, a: nameA, aCount: d.aBrought.length, b: nameB, bCount: d.bBrought.length }),
        contents: [t("duo.mix.title"), t("duo.loved"), d.argument ? t("duo.argument") : null, t("duo.scale")].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            <Block title={t("duo.mix.title")} wide>
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                {[
                  { count: d.aBrought.length, color: toneA },
                  { count: d.met.length, color: "var(--ink)" },
                  { count: d.between, color: "var(--wash-strong)" },
                  { count: d.bBrought.length, color: toneB },
                ].filter((part) => part.count > 0).map((part, index) => (
                  <span key={index} style={{ flexGrow: part.count, background: part.color }} className="h-full border-r-2 border-[var(--paper)] last:border-r-0" />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: toneA }} />{t("duo.mix.brought", { name: nameA, count: d.aBrought.length })}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" />{t("duo.mix.met", { count: d.met.length })}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: toneB }} />{t("duo.mix.brought", { name: nameB, count: d.bBrought.length })}</span>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">{t("duo.mix.note", { between: d.between })}</p>
            </Block>
            {d.sharedFavourite ? (
              <Block title={t("duo.loved")}>
                <div className="flex items-center gap-4">
                  <TitleChip bare title={d.sharedFavourite.item.title} year={d.sharedFavourite.item.year} className="w-20 flex-none" />
                  <div>
                    <p className="text-2xl font-light tracking-[-0.03em]">{d.sharedFavourite.item.title}</p>
                    <p className="mt-1 text-sm"><span style={{ color: toneA }}>{nameA} {fmt(d.sharedFavourite.a)}</span> <span className="text-[var(--muted)]">·</span> <span style={{ color: toneB }}>{nameB} {fmt(d.sharedFavourite.b)}</span></p>
                  </div>
                </div>
              </Block>
            ) : null}
            {d.argument ? (
              <Block title={t("duo.argument")}>
                <div className="flex items-center gap-4">
                  <TitleChip bare title={d.argument.item.title} year={d.argument.item.year} className="w-20 flex-none" />
                  <div>
                    <p className="text-2xl font-light tracking-[-0.03em]">{d.argument.item.title}</p>
                    <p className="mt-1 text-sm"><span style={{ color: toneA }}>{nameA} {fmt(d.argument.a)}</span> <span className="text-[var(--muted)]">·</span> <span style={{ color: toneB }}>{nameB} {fmt(d.argument.b)}</span></p>
                  </div>
                </div>
                {argumentQuotes.length ? (
                  <div className="mt-4 space-y-2">
                    {argumentQuotes.map((quote) => (
                      <figure key={quote.person.id} className="border-l-2 pl-3" style={{ borderColor: personTone(ids, quote.person.id) }}>
                        <CommentText text={quote.text} className="text-sm font-light" />
                        <figcaption className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Avatar id={quote.person.id} name={quote.person.name} ids={ids} size={4} />{firstName(quote.person.name)}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </Block>
            ) : null}
            <Block title={t("duo.scale")}>
              <div className="flex items-end gap-8">
                <div><p className="text-4xl font-light tabular-nums tracking-[-0.04em]" style={{ color: toneA }}>{fmt(d.aAverage)}</p><p className="text-xs text-[var(--muted)]">{nameA}</p></div>
                <div><p className="text-4xl font-light tabular-nums tracking-[-0.04em]" style={{ color: toneB }}>{fmt(d.bAverage)}</p><p className="text-xs text-[var(--muted)]">{nameB}</p></div>
              </div>
              <p className="mt-3 text-sm">{Math.abs(d.aAverage - d.bAverage) < 0.2 ? t("duo.sameScale") : t("duo.higher", { name: d.aAverage > d.bAverage ? nameA : nameB, gap: fmt(Math.abs(d.aAverage - d.bAverage)) })}</p>
            </Block>
          </div>
        ),
      });
      pages.push({
        id: "brought",
        title: t("duo.broughtTitle"),
        headline: t("duo.broughtHeadline", { a: nameA, b: nameB }),
        contents: [t("duo.met"), t("duo.brought", { name: nameA }), t("duo.brought", { name: nameB }), d.leanings.length ? t("duo.leanings") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            {d.met.length ? <Block title={t("duo.met")}>{titleRows(d.met, null)}</Block> : null}
            {d.aBrought.length ? <Block title={t("duo.brought", { name: nameA })}>{titleRows(d.aBrought, "a")}</Block> : null}
            {d.bBrought.length ? <Block title={t("duo.brought", { name: nameB })}>{titleRows(d.bBrought, "b")}</Block> : null}
            {d.leanings.length ? (
              <Block title={t("duo.leanings")}>
                <div className="mb-2 flex justify-between text-xs"><span style={{ color: toneA }}>{nameA}</span><span style={{ color: toneB }}>{nameB}</span></div>
                <ul className="space-y-2">
                  {d.leanings.map((row) => (
                    <li key={row.genre} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                      <span className="flex h-2 justify-end overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="h-full rounded-full" style={{ width: `${((row.a - input.scale.min) / span) * 100}%`, background: toneA }} /></span>
                      <span className="w-24 truncate text-center text-xs">{row.genre} <span className="text-[var(--muted)]">· {row.count}</span></span>
                      <span className="flex h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="h-full rounded-full" style={{ width: `${((row.b - input.scale.min) / span) * 100}%`, background: toneB }} /></span>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
          </div>
        ),
      });
    } else if (s.solo) {
      const o = s.solo;
      const tallest = Math.max(1, ...o.distribution.map((row) => row.count));
      const tone = personTone(ids, o.person.id);
      pages.push({
        id: "solo",
        title: t("solo.title"),
        headline: t("solo.headline", { value: fmt(o.average), count: o.perfect.length }),
        contents: [t("solo.scale"), o.perfect.length ? t("solo.perfect") : null, o.lowest ? t("solo.lowest") : null, o.instincts ? t("solo.instincts") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            <Block title={t("solo.scale")} wide>
              <div className="flex h-32 items-end gap-1.5">
                {o.distribution.map((row) => (
                  <div key={row.value} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-[var(--muted)]">{row.count || ""}</span>
                    <span className="w-full rounded-t" style={{ height: `${Math.max(2, (row.count / tallest) * 88)}px`, background: row.count ? tone : "var(--wash-strong)", opacity: row.count ? 0.4 + 0.6 * (row.count / tallest) : 1 }} />
                    <span className="text-[10px] tabular-nums">{fmt(row.value)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm">{t("solo.average", { value: fmt(o.average) })}</p>
            </Block>
            {o.perfect.length ? (
              <Block title={t("solo.perfect")}>
                <ul className="flex flex-wrap gap-3">
                  {o.perfect.map((score) => <li key={score.item.id} className="w-16"><TitleChip bare title={score.item.title} year={score.item.year} className="w-full" /><p className="mt-1 truncate text-xs">{score.item.title}</p></li>)}
                </ul>
              </Block>
            ) : null}
            {o.lowest ? (
              <Block title={t("solo.lowest")}>
                <div className="flex items-center gap-4">
                  <TitleChip bare title={o.lowest.item.title} year={o.lowest.item.year} className="w-16 flex-none grayscale" />
                  <div><p className="text-xl font-light">{o.lowest.item.title}</p><p className="text-3xl font-light tabular-nums">{fmt(o.lowest.average)}</p></div>
                </div>
              </Block>
            ) : null}
            {o.instincts ? (
              <Block title={t("solo.instincts")}>
                <p className="text-4xl font-light tabular-nums tracking-[-0.04em]">±{fmt(o.instincts.miss)}</p>
                <p className="mt-2 text-sm">{t("solo.instinctsLine", { close: o.instincts.close, total: o.instincts.total })}</p>
              </Block>
            ) : null}
          </div>
        ),
      });
    } else if (s.critics.length || s.pairs.length) {
      pages.push({
        id: "people",
        title: t("pages.people.title"),
        headline: s.commonGround[0]
          ? t("common.title", { a: firstName(s.commonGround[0].a.name), b: firstName(s.commonGround[0].b.name), genre: s.commonGround[0].genre })
          : s.pairs[0]
            ? t("pairs.title", { a: firstName(s.pairs[0].a.name), b: firstName(s.pairs[0].b.name), agreement: s.pairs[0].agreement })
            : t("critics.title", { name: firstName(s.critics[0].person.name), value: fmt(s.critics[0].average) }),
        contents: [t("critics.eyebrow"), t("favourites.eyebrow"), s.pairs.length ? t("pairs.eyebrow") : null, s.commonGround.length ? t("common.eyebrow") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            {s.critics.length ? (
              <Block title={t("critics.title", { name: firstName(s.critics[0].person.name), value: fmt(s.critics[0].average) })}>
                <ul className="space-y-2.5">
                  {[...s.critics].reverse().map((critic, index, list) => (
                    <li key={critic.person.id} className="flex items-center gap-3 text-sm">
                      <Avatar id={critic.person.id} name={critic.person.name} ids={ids} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{firstName(critic.person.name)}{index === 0 ? <span className="text-[var(--muted)]"> · {t("critics.generous")}</span> : index === list.length - 1 ? <span className="text-[var(--muted)]"> · {t("critics.tough")}</span> : null}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{t("critics.detail", { top: critic.top, favourite: critic.favourite?.item.title ?? "—" })}</span>
                      </span>
                      <strong className="font-medium tabular-nums">{fmt(critic.average)}</strong>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
            {s.critics.length ? (
              <Block title={t("favourites.eyebrow")}>
                <ul className="flex flex-wrap gap-3">
                  {s.critics.filter((critic) => critic.favourite).map((critic) => (
                    <li key={critic.person.id} className="flex w-[4.5rem] flex-col gap-1.5">
                      <TitleChip title={critic.favourite!.item.title} year={critic.favourite!.item.year} className="w-full" />
                      <span className="flex items-center gap-1 text-xs"><Avatar id={critic.person.id} name={critic.person.name} ids={ids} size={4} /><span className="truncate">{firstName(critic.person.name)}</span></span>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
            {s.pairs.length ? (
              <Block title={t("pairs.eyebrow")}>
                <ul className="space-y-2">
                  {s.pairs.slice(0, 6).map((pair, index) => (
                    <li key={`${pair.a.id}-${pair.b.id}`}>
                      <Bar label={<span className="flex items-center gap-1.5"><span className="flex -space-x-1.5"><Avatar id={pair.a.id} name={pair.a.name} ids={ids} size={6} /><Avatar id={pair.b.id} name={pair.b.name} ids={ids} size={6} /></span><span className="truncate">{firstName(pair.a.name)} & {firstName(pair.b.name)}</span></span>} value={pair.agreement} max={100} figure={`${pair.agreement}%`} strong={index === 0} tone={index === 0 ? "var(--tag-blue)" : "var(--main-line)"} />
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--muted)]">{t("pairs.note", { count: s.pairs.length })}</p>
              </Block>
            ) : null}
            {s.commonGround.length ? (
              <Block title={t("common.eyebrow")}>
                <ul className="space-y-3 text-sm">
                  {s.commonGround.map((row) => (
                    <li key={`${row.a.id}-${row.b.id}`} className="flex items-start gap-3">
                      <span className="flex -space-x-2"><Avatar id={row.a.id} name={row.a.name} ids={ids} /><Avatar id={row.b.id} name={row.b.name} ids={ids} /></span>
                      <span className="leading-snug">{t("common.line", { a: firstName(row.a.name), b: firstName(row.b.name), agreement: row.agreement, genre: row.genre, aValue: fmt(row.aAverage), bValue: fmt(row.bAverage) })}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--muted)]">{t("common.hint")}</p>
              </Block>
            ) : null}
          </div>
        ),
      });
    }

    if (s.totals.minutes || s.properties.length || s.surprises.length) {
      pages.push({
        id: "details",
        title: t("pages.details.title"),
        headline: s.surprises[0]
          ? t("surprises.title", { title: s.surprises[0].item.title })
          : s.properties[0]
            ? t("pages.details.headlineProperty", { label: propertyLabel(s.properties[0].label), name: s.properties[0].best.key })
            : t(input.people.length === 1 ? "time.titleSolo" : "time.title", { hours: Math.floor((s.totals.minutes ?? 0) / 60), minutes: Math.round((s.totals.minutes ?? 0) % 60) }),
        contents: [s.totals.minutes ? t("time.eyebrow") : null, ...s.properties.map((property) => t("property.eyebrow", { label: propertyLabel(property.label) })), s.surprises.length ? t("surprises.eyebrow") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            {s.totals.minutes ? (
              <Block title={t("time.eyebrow")}>
                <p className="text-3xl font-light tracking-[-0.03em]">{t(input.people.length === 1 ? "time.titleSolo" : "time.title", { hours: Math.floor(s.totals.minutes / 60), minutes: Math.round(s.totals.minutes % 60) })}</p>
                {s.length ? (
                  <div className="mt-3 space-y-1.5 text-sm">
                    <p><span className="text-[var(--muted)]">{t("time.longest")}</span> · {s.length.longest.item.title} · {s.length.longest.item.runtime} min · <strong className="font-medium tabular-nums">{fmt(s.length.longest.average)}</strong></p>
                    <p><span className="text-[var(--muted)]">{t("time.shortest")}</span> · {s.length.shortest.item.title} · {s.length.shortest.item.runtime} min · <strong className="font-medium tabular-nums">{fmt(s.length.shortest.average)}</strong></p>
                    {s.length.longAverage !== null && s.length.shortAverage !== null ? <p className="pt-1 text-[var(--muted)]">{t(s.length.longAverage >= s.length.shortAverage ? "time.worthIt" : "time.notWorth", { long: fmt(s.length.longAverage), short: fmt(s.length.shortAverage) })}</p> : null}
                  </div>
                ) : null}
              </Block>
            ) : null}
            {s.properties.map((property) => (
              <Block key={property.label} title={t("property.eyebrow", { label: propertyLabel(property.label) })}>
                <p className="text-3xl font-light tracking-[-0.03em]">{property.best.key}</p>
                <p className="mt-2 text-sm">{t("property.line", { count: property.best.count, things: noun(property.best.count), value: fmt(property.best.average) })}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{property.best.items.join(" · ")}</p>
                {property.runnerUp ? <p className="mt-2 text-xs text-[var(--muted)]">{t("property.runnerUp", { name: property.runnerUp.key, value: fmt(property.runnerUp.average) })}</p> : null}
              </Block>
            ))}
            {s.surprises.length ? (
              <Block title={t("surprises.eyebrow")}>
                <ul className="space-y-4">
                  {s.surprises.map((row) => <Shift key={row.item.id} title={row.item.title} expected={row.expected} actual={row.actual} min={input.scale.min} max={input.scale.max} fmt={fmt} />)}
                </ul>
                <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--muted)]" />{t("surprises.expected")}</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--main)]" />{t("surprises.actual")}</span>
                </p>
              </Block>
            ) : null}
          </div>
        ),
      });
    }

    if (s.quotes.length) {
      pages.push({
        id: "words",
        title: t(input.people.length === 1 ? "pages.words.titleSolo" : "pages.words.title"),
        headline: t("pages.words.headline", { count: s.quotes.length }),
        contents: s.quotes.map((quote) => firstName(quote.person.name)).join(" · "),
        body: (
          <div className={grid}>
            {s.quotes.map((quote) => (
              <figure key={`${quote.person.id}-${quote.item.id}`} className={cx(cardClass, "border-l-[3px]")} style={{ borderLeftColor: personTone(ids, quote.person.id) }}>
                <CommentText text={quote.text} className="text-lg font-light" />
                <figcaption className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]"><Avatar id={quote.person.id} name={quote.person.name} ids={ids} size={5} />{t("quotes.by", { name: firstName(quote.person.name), title: quote.item.title, value: fmt(quote.value) })}</figcaption>
              </figure>
            ))}
          </div>
        ),
      });
    }
    return [...pages, ...metricsPage];
  }

  if (story.kind === "dated") {
    const s: DatedStory = story;
    const unit = input.counter?.unit || (input.counter?.label ?? "");
    const byStreak = [...s.lanes].sort((a, b) => (b.longest?.length ?? 1) - (a.longest?.length ?? 1));
    const byTotal = s.lanes.filter((lane) => lane.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const byConsistency = [...s.lanes].sort((a, b) => (b.consistency ?? 0) - (a.consistency ?? 0));
    const weekdayNames = Array.from({ length: 7 }, (_, index) => nf.dateTime(new Date(Date.UTC(2026, 0, 4 + index, 12)), { weekday: "short", timeZone: "UTC" }));
    const comebacks = s.lanes.filter((lane) => lane.comeback).sort((a, b) => b.comeback!.gap - a.comeback!.gap);
    const bests = s.lanes.filter((lane) => lane.best).sort((a, b) => b.best!.value - a.best!.value);

    if (s.lanes.length === 1) {
      const lane = s.lanes[0];
      pages.push({
        id: "streaks",
        title: t("pages.streaks.title"),
        headline: lane.longest ? t("soloDays.headline", { count: lane.longest.length }) : t("streaks.none"),
        contents: [t("soloDays.numbers"), t("consistency.eyebrow"), comebacks.length ? t("comeback.eyebrow") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            <Block title={t("soloDays.numbers")}>
              <dl className="grid grid-cols-3 gap-4">
                {[
                  { value: lane.longest?.length ?? 1, label: t("soloDays.longest") },
                  { value: lane.current, label: t("soloDays.current") },
                  { value: lane.days.length, label: t("soloDays.days") },
                ].map((row) => (
                  <div key={row.label} className="flex flex-col-reverse"><dt className="text-xs text-[var(--muted)]">{row.label}</dt><dd className="text-4xl font-light tabular-nums tracking-[-0.04em]">{row.value}</dd></div>
                ))}
              </dl>
            </Block>
            <Block title={t("consistency.eyebrow")}>
              <div className="flex items-center gap-5">
                <span className="relative grid h-24 w-24 flex-none place-items-center">
                  <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--wash-strong)" strokeWidth="2.6" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={personTone(ids, lane.person.id)} strokeWidth="2.6" strokeDasharray={`${lane.consistency ?? 0} 100`} strokeLinecap="round" />
                  </svg>
                  <span className="text-xl font-light tabular-nums">{lane.consistency ?? 0}%</span>
                </span>
                <p className="text-sm">{t("soloDays.consistency", { days: lane.days.length, total: s.totals.days })}</p>
              </div>
            </Block>
            {comebacks.length ? (
              <Block title={t("comeback.eyebrow")}>
                <p className="text-2xl font-light tracking-[-0.03em]">{t("soloDays.comeback", { gap: comebacks[0].comeback!.gap })}</p>
                <p className="mt-1 text-sm">{t("comeback.line", { day: day(comebacks[0].comeback!.back) })}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">{t("comeback.note")}</p>
              </Block>
            ) : null}
          </div>
        ),
      });
    } else pages.push({
      id: "streaks",
      title: t("pages.streaks.title"),
      headline: byStreak[0].longest ? t("streaks.title", { name: firstName(byStreak[0].person.name), count: byStreak[0].longest.length }) : t("streaks.none"),
      contents: [t("streaks.eyebrow"), t("consistency.eyebrow"), comebacks.length ? t("comeback.eyebrow") : null].filter(Boolean).join(" · "),
      body: (
        <div className={grid}>
          <Block title={t("streaks.eyebrow")}>
            <ul className="space-y-2.5">
              {byStreak.map((lane) => (
                <li key={lane.person.id} className="flex items-center gap-3 text-sm">
                  <Avatar id={lane.person.id} name={lane.person.name} ids={ids} />
                  <span className="w-16 truncate">{firstName(lane.person.name)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, ((lane.longest?.length ?? 1) / Math.max(1, byStreak[0].longest?.length ?? 1)) * 100)}%`, background: personTone(ids, lane.person.id) }} /></span>
                  <span className="w-32 flex-none whitespace-nowrap text-right text-xs text-[var(--muted)]">{t("streaks.best", { count: lane.longest?.length ?? 1 })}{lane.current > 1 ? ` · ${t("streaks.now", { count: lane.current })}` : ""}</span>
                </li>
              ))}
            </ul>
          </Block>
          <Block title={t("consistency.title", { name: firstName(byConsistency[0].person.name), value: byConsistency[0].consistency ?? 0 })}>
            <div className="flex flex-wrap gap-4">
              {byConsistency.map((lane) => (
                <div key={lane.person.id} className="flex flex-col items-center gap-1">
                  <span className="relative grid h-14 w-14 place-items-center">
                    <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--wash-strong)" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke={personTone(ids, lane.person.id)} strokeWidth="3" strokeDasharray={`${lane.consistency ?? 0} 100`} strokeLinecap="round" />
                    </svg>
                    <span className="text-xs font-medium tabular-nums">{lane.consistency ?? 0}%</span>
                  </span>
                  <span className="text-xs">{firstName(lane.person.name)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{t("consistency.note", { days: s.totals.days })}</p>
          </Block>
          {s.together !== null ? (
            <Block title={t("together.title")}>
              <p className="text-4xl font-light tabular-nums tracking-[-0.04em]">{s.together}</p>
              <p className="mt-2 text-sm">{t("together.line", { a: firstName(s.lanes[0].person.name), b: firstName(s.lanes[1].person.name), count: s.together, days: s.totals.days })}</p>
            </Block>
          ) : null}
          {comebacks.length ? (
            <Block title={t("comeback.eyebrow")}>
              <p className="text-2xl font-light tracking-[-0.03em]">{t("comeback.title", { name: firstName(comebacks[0].person.name), gap: comebacks[0].comeback!.gap })}</p>
              <p className="mt-1 text-sm">{t("comeback.line", { day: day(comebacks[0].comeback!.back) })}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">{t("comeback.note")}</p>
            </Block>
          ) : null}
        </div>
      ),
    });

    if (s.lanes.length === 1) {
      const lane = s.lanes[0];
      pages.push({
        id: "volume",
        title: t("pages.volume.title"),
        headline: s.totals.total !== null ? t("totals.title", { total: nf.number(s.totals.total), unit }) : t("pages.volume.headlineCount", { count: s.totals.checkins }),
        contents: [s.totals.total !== null ? input.counter?.label ?? null : null, lane.best ? t("bestDay.eyebrow") : null, t("weekdays.eyebrow")].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            {s.totals.total !== null ? (
              <Block title={input.counter?.label ?? ""}>
                <p className="text-5xl font-light tabular-nums tracking-[-0.04em]">{nf.number(s.totals.total)} <span className="text-xl text-[var(--muted)]">{unit}</span></p>
                <p className="mt-2 text-sm">{t("soloDays.perDay", { value: nf.number(Math.round((s.totals.total / Math.max(1, lane.days.length)) * 10) / 10), unit })}</p>
              </Block>
            ) : null}
            {lane.best ? (
              <Block title={t("bestDay.eyebrow")}>
                <p className="text-5xl font-light tabular-nums tracking-[-0.04em]">{nf.number(lane.best.value)} <span className="text-xl text-[var(--muted)]">{unit}</span></p>
                <p className="mt-2 text-sm">{day(lane.best.day)}</p>
              </Block>
            ) : null}
            <Block title={s.bestWeekdays.length ? t("weekdays.title", { day: s.bestWeekdays.map((index) => weekdayNames[index]).join(" & ") }) : t("weekdays.even")}>
              <div className="flex h-24 items-end gap-2">
                {s.weekdays.map((count, index) => (
                  <div key={index} className="flex flex-1 flex-col items-center gap-1">
                    <span className="w-full rounded-t" style={{ height: `${Math.max(4, (count / Math.max(1, ...s.weekdays)) * 72)}px`, background: s.bestWeekdays.includes(index) ? "var(--main)" : "var(--main-line)" }} />
                    <span className="text-[10px] text-[var(--muted)]">{weekdayNames[index]}</span>
                  </div>
                ))}
              </div>
            </Block>
          </div>
        ),
      });
    } else pages.push({
      id: "volume",
      title: t("pages.volume.title"),
      headline: s.totals.total !== null ? t("totals.title", { total: nf.number(s.totals.total), unit }) : t("pages.volume.headlineCount", { count: s.totals.checkins }),
      contents: [byTotal.length ? input.counter?.label ?? null : null, t("weekdays.eyebrow"), bests.length ? t("bestDay.eyebrow") : null].filter(Boolean).join(" · "),
      body: (
        <div className={grid}>
          {byTotal.length ? (
            <Block title={input.counter?.label ?? ""}>
              <div className="space-y-2.5">
                {byTotal.map((lane, index) => <Bar key={lane.person.id} label={firstName(lane.person.name)} value={lane.total ?? 0} max={byTotal[0].total ?? 1} figure={nf.number(lane.total ?? 0)} strong={index === 0} tone={personTone(ids, lane.person.id)} />)}
              </div>
            </Block>
          ) : null}
          <Block title={s.bestWeekdays.length ? t("weekdays.title", { day: s.bestWeekdays.map((index) => weekdayNames[index]).join(" & ") }) : t("weekdays.even")}>
            <div className="flex h-24 items-end gap-2">
              {s.weekdays.map((count, index) => (
                <div key={index} className="flex flex-1 flex-col items-center gap-1">
                  <span className="w-full rounded-t" style={{ height: `${Math.max(4, (count / Math.max(1, ...s.weekdays)) * 72)}px`, background: s.bestWeekdays.includes(index) ? "var(--main)" : "var(--main-line)" }} />
                  <span className="text-[10px] text-[var(--muted)]">{weekdayNames[index]}</span>
                </div>
              ))}
            </div>
          </Block>
          {bests.length ? (
            <Block title={t("bestDay.title", { name: firstName(bests[0].person.name), value: nf.number(bests[0].best!.value), unit, day: day(bests[0].best!.day) })}>
              <ul className="space-y-1.5 text-sm">
                {bests.map((lane) => <li key={lane.person.id} className="flex items-center gap-2"><Avatar id={lane.person.id} name={lane.person.name} ids={ids} size={5} />{firstName(lane.person.name)} <span className="text-[var(--muted)]">· {day(lane.best!.day)}</span><strong className="ml-auto font-medium tabular-nums">{nf.number(lane.best!.value)}</strong></li>)}
              </ul>
            </Block>
          ) : null}
        </div>
      ),
    });

    if (s.records.length) {
      pages.push({
        id: "records",
        title: t("records.eyebrow"),
        headline: t("records.headline", { title: s.records[0].item.title, gain: Math.round(((s.records[0].best - s.records[0].first) / Math.max(1e-9, s.records[0].first)) * 100) }),
        contents: s.records.slice(0, 4).map((row) => row.item.title).join(" · "),
        body: (
          <div className={grid}>
            <Block title={t("records.list", { label: input.recordLabel ?? "" })} wide>
              <ul className="divide-y divide-[var(--line)]">
                {s.records.map((row) => (
                  <Progression key={`${row.person.id}-${row.item.id}`} title={row.item.title} row={row} unit={input.recordUnit ?? ""} person={s.lanes.length > 1 ? firstName(row.person.name) : null} fmt={(value) => nf.number(value)} tone={personTone(ids, row.person.id)} />
                ))}
              </ul>
            </Block>
          </div>
        ),
      });
    }

    if (s.notes.length) {
      pages.push({
        id: "words",
        title: t(input.people.length === 1 ? "pages.words.titleSolo" : "pages.words.title"),
        headline: t("pages.words.headline", { count: s.notes.length }),
        contents: s.notes.map((note) => firstName(note.person.name)).join(" · "),
        body: (
          <div className={grid}>
            {s.notes.map((note) => (
              <figure key={`${note.person.id}-${note.day}`} className={cx(cardClass, "border-l-[3px]")} style={{ borderLeftColor: personTone(ids, note.person.id) }}>
                <CommentText text={note.text} className="text-lg font-light" />
                <figcaption className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]"><Avatar id={note.person.id} name={note.person.name} ids={ids} size={5} />{firstName(note.person.name)} · {day(note.day)}</figcaption>
              </figure>
            ))}
          </div>
        ),
      });
    }
    return [...pages, ...metricsPage];
  }
  return metricsPage;
}
