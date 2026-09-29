"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { coverColors, coverToneOf } from "../catalog-cover";
import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id, Metric } from "../types";
import { cx } from "../ui";
import type { DatedStory, GroupStat, RatedStory, Story, StoryInput } from "./model";

/** A small typographic cover — the title is the artwork, tinted like the catalogue's. */
export function TitleChip({ title, year, className }: { title: string; year?: number | null; className?: string }) {
  return (
    <span className={cx("relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-lg bg-[var(--cover-bg)] p-1.5 text-[var(--cover-ink)]", className)} style={coverColors(coverToneOf(title))}>
      <span aria-hidden="true" className="absolute -bottom-5 -right-5 h-12 w-12 rounded-full border-[8px] border-[var(--cover-deco)]" />
      <span className="relative text-[7px] tracking-[0.08em]" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year ?? " "}</span>
      <span className="relative line-clamp-3 break-words text-[10px] font-light leading-[1.05]">{title}</span>
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

/** A titled block inside a page — no box, just a heading, the facts, and room around them. */
function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("min-w-0", wide && "[grid-column:1/-1]")}>
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="mt-3">{children}</div>
    </div>
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

/** The challenge's own metrics (the recipe's, Goa's automatic ones, whatever the owner made) — plain rows, top five each. */
function MetricsPage({ metrics }: { metrics: Metric[] }) {
  const t = useTranslations("story");
  return (
    <div className="grid gap-x-12 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
      {metrics.map((metric) => (
        <div key={metric.id} className="min-w-0 border-t border-[var(--line)] pt-3">
          <p className="text-sm text-[var(--muted)]">{metric.label}</p>
          {metric.series?.length ? (
            <ol className="mt-2 space-y-1 text-sm">
              {metric.series.slice(0, 5).map((row, index) => (
                <li key={row.key} className="flex gap-2"><span className="w-4 tabular-nums text-[var(--muted)]">{index + 1}</span><span className="min-w-0 flex-1 truncate">{row.label}</span><strong className="font-medium tabular-nums">{row.formattedValue ?? row.value ?? "—"}</strong></li>
              ))}
              {metric.series.length > 5 ? <li className="text-xs text-[var(--muted)]">{t("metricsMore", { count: metric.series.length - 5 })}</li> : null}
            </ol>
          ) : (
            <p className="mt-1 text-3xl font-light tabular-nums tracking-[-0.03em]">{metric.formattedValue ?? "—"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Columns follow the width of the page they're on (the screen, or a downloaded page), not the viewport.
const grid = "grid gap-x-14 gap-y-10 [grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr))]";

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
  // A metric with nothing to show yet (no value, no rows) stays out rather than printing a dash.
  const shownMetrics = metrics.filter((metric) => metric.visibleInResults !== false && metric.operation !== "completion_rate"
    && ((metric.series?.length ?? 0) > 0 || (metric.formattedValue && metric.formattedValue !== "—")));
  const metricsPage: AlmanacPage[] = shownMetrics.length
    ? [{ id: "metrics", title: t("pages.metrics.title"), headline: t("pages.metrics.headline", { count: shownMetrics.length }), contents: shownMetrics.slice(0, 4).map((metric) => metric.label).join(" · "), body: <MetricsPage metrics={shownMetrics} /> }]
    : [];

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
                  <TitleChip title={score.item.title} year={score.item.year} className={cx("w-full", index === 1 ? "max-w-[6.5rem]" : "max-w-[5.25rem]")} />
                  <p className="mt-2 line-clamp-1 text-xs">{score.item.title}</p>
                  <div className={cx("mt-2 flex w-full flex-col items-center rounded-t-lg bg-[var(--wash)] pt-2", index === 1 ? "h-24" : index === 0 ? "h-16" : "h-12")}>
                    <span className="text-lg font-medium tabular-nums">{fmt(score.average)}</span>
                    <span className="text-[10px] text-[var(--muted)]">#{index === 1 ? 1 : index === 0 ? 2 : 3}</span>
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
                  const best = year.average === Math.max(...s.years.map((row) => row.average));
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

    if (s.critics.length || s.pairs.length) {
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
                      <Bar label={<span className="flex items-center gap-1.5"><span className="flex -space-x-1.5"><Avatar id={pair.a.id} name={pair.a.name} ids={ids} size={5} /><Avatar id={pair.b.id} name={pair.b.name} ids={ids} size={5} /></span><span className="truncate">{firstName(pair.a.name)} & {firstName(pair.b.name)}</span></span>} value={pair.agreement} max={100} figure={`${pair.agreement}%`} strong={index === 0} tone={index === 0 ? "var(--tag-blue)" : "var(--main-line)"} />
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
            : t("time.title", { hours: Math.floor((s.totals.minutes ?? 0) / 60), minutes: Math.round((s.totals.minutes ?? 0) % 60) }),
        contents: [s.totals.minutes ? t("time.eyebrow") : null, ...s.properties.map((property) => t("property.eyebrow", { label: propertyLabel(property.label) })), s.surprises.length ? t("surprises.eyebrow") : null].filter(Boolean).join(" · "),
        body: (
          <div className={grid}>
            {s.totals.minutes ? (
              <Block title={t("time.eyebrow")}>
                <p className="text-3xl font-light tracking-[-0.03em]">{t("time.title", { hours: Math.floor(s.totals.minutes / 60), minutes: Math.round(s.totals.minutes % 60) })}</p>
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
                <ul className="space-y-2.5">
                  {s.surprises.map((row) => (
                    <li key={row.item.id} className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate">{row.item.title}</span>
                      <span className="tabular-nums text-[var(--muted)] line-through">{fmt(row.expected)}</span>
                      <span className={row.actual >= row.expected ? "text-[var(--ok)]" : "text-[var(--danger)]"}>{row.actual >= row.expected ? "↗" : "↘"}</span>
                      <strong className="w-8 text-right font-medium tabular-nums">{fmt(row.actual)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--muted)]">{t("surprises.note")}</p>
              </Block>
            ) : null}
          </div>
        ),
      });
    }

    if (s.quotes.length) {
      pages.push({
        id: "words",
        title: t("pages.words.title"),
        headline: t("pages.words.headline", { count: s.quotes.length }),
        contents: s.quotes.map((quote) => firstName(quote.person.name)).join(" · "),
        body: (
          <div className={grid}>
            {s.quotes.map((quote) => (
              <figure key={`${quote.person.id}-${quote.item.id}`} className="border-l-2 pl-4" style={{ borderColor: personTone(ids, quote.person.id) }}>
                <blockquote className="text-xl font-light leading-snug tracking-[-0.01em]">“{quote.text}”</blockquote>
                <figcaption className="mt-2 text-xs text-[var(--muted)]">{t("quotes.by", { name: firstName(quote.person.name), title: quote.item.title, value: fmt(quote.value) })}</figcaption>
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

    pages.push({
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

    pages.push({
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
        headline: t("records.title", { title: s.records[0].item.title, first: nf.number(s.records[0].first), best: nf.number(s.records[0].best) }),
        contents: s.records.slice(0, 4).map((row) => row.item.title).join(" · "),
        body: (
          <div className={grid}>
            <Block title={t("records.note", { label: input.recordLabel ?? "" })} wide>
              <ul className="space-y-2">
                {s.records.map((row) => (
                  <li key={`${row.person.id}-${row.item.id}`} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{row.item.title}</span>
                    <span className="tabular-nums text-[var(--muted)]">{nf.number(row.first)}</span><span aria-hidden="true">→</span><strong className="font-medium tabular-nums">{nf.number(row.best)}</strong>
                    <span className="w-14 text-right text-xs text-[var(--ok)]">+{Math.round(((row.best - row.first) / Math.max(1e-9, row.first)) * 100)}%</span>
                  </li>
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
        title: t("pages.words.title"),
        headline: t("pages.words.headline", { count: s.notes.length }),
        contents: s.notes.map((note) => firstName(note.person.name)).join(" · "),
        body: (
          <div className={grid}>
            {s.notes.map((note) => (
              <figure key={`${note.person.id}-${note.day}`} className="border-l-2 pl-4" style={{ borderColor: personTone(ids, note.person.id) }}>
                <blockquote className="text-xl font-light leading-snug">“{note.text}”</blockquote>
                <figcaption className="mt-2 text-xs text-[var(--muted)]">{firstName(note.person.name)} · {day(note.day)}</figcaption>
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
