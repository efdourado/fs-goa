"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { coverColors, coverToneOf } from "../catalog-cover";
import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id } from "../types";
import { cx } from "../ui";
import { downloadNode } from "./download";
import type { DatedStory, GroupStat, RatedStory, StoryInput } from "./model";

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

/**
 * One fact of the almanac: a label, a figure, what backs it — and its own download, so any single card
 * can be sent on its own. `wide` spans two columns on large screens.
 */
export function Card({ eyebrow, title, children, wide, filename, tone }: {
  eyebrow: string;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  filename: string;
  tone?: string;
}) {
  const t = useTranslations("story");
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <article ref={ref} className={cx("relative flex flex-col rounded-[22px] border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6", wide && "md:[column-span:none]")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tone ?? "var(--main)" }}>{eyebrow}</p>
        <button
          type="button"
          data-story-skip=""
          disabled={busy}
          onClick={async () => { if (!ref.current) return; setBusy(true); try { await downloadNode(ref.current, filename); } finally { setBusy(false); } }}
          className="-mr-2 -mt-2 grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
          aria-label={t("downloadCard")}
          title={t("downloadCard")}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {title ? <h3 className="mt-2 text-2xl font-light leading-tight tracking-[-0.03em]">{title}</h3> : null}
      <div className="mt-4 flex-1">{children}</div>
      <p className="mt-4 text-[10px] text-[var(--muted)]">goa · {filename.split(" — ")[0]}</p>
    </article>
  );
}

function Bar({ value, max, tone, label, figure, strong }: { value: number; max: number; tone?: string; label: ReactNode; figure: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm">
      <span className={cx("truncate", strong ? "font-medium" : "font-light")}>{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (value / Math.max(1e-9, max)) * 100)}%`, background: tone ?? "var(--main)" }} />
      </span>
      <span className="w-9 text-right tabular-nums text-[var(--muted)]">{figure}</span>
    </div>
  );
}

function Avatar({ id, name, ids, size = 7 }: { id: Id; name: string; ids: Id[]; size?: number }) {
  return (
    <span className="grid flex-none place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: personTone(ids, id), width: size * 4, height: size * 4 }}>{initialsOf(name)}</span>
  );
}

// ── Rated ─────────────────────────────────────────────────────────────────

export function RatedAlmanac({ story, input }: { story: RatedStory; input: StoryInput }) {
  const t = useTranslations("story");
  const nf = useFormatter();
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const ids = input.people.map((person) => person.id);
  const [showAll, setShowAll] = useState(false);
  const file = (key: string) => `${input.title} — ${t(key)}`;
  const noun = (count: number) => t(`noun.${input.noun}`, { count });
  const podium = story.ranking.slice(0, 3);
  const rest = story.ranking.slice(3);
  const statBars = (stats: GroupStat[], best?: string) => (
    <div className="space-y-2.5">
      {stats.map((stat) => (
        <Bar key={stat.key} label={<>{stat.key} <span className="text-xs text-[var(--muted)]">· {stat.count}</span></>} value={stat.average - input.scale.min} max={input.scale.max - input.scale.min} strong={stat.key === best} figure={fmt(stat.average)} tone={stat.key === best ? "var(--main)" : "var(--main-line)"} />
      ))}
    </div>
  );
  const personName = (id: Id) => input.people.find((person) => person.id === id)?.name ?? "";

  return (
    <div className="gap-4 space-y-4 md:columns-2 xl:columns-3 [&>*]:break-inside-avoid">
      {/* The podium, then everything else in order. */}
      {podium.length ? (
        <Card eyebrow={t("podium.eyebrow")} title={podium[0].item.title} filename={file("podium.eyebrow")} wide>
          <div className="grid grid-cols-3 items-end gap-3">
            {[podium[1], podium[0], podium[2]].map((score, index) => score ? (
              <div key={score.item.id} className="flex flex-col items-center text-center">
                <TitleChip title={score.item.title} year={score.item.year} className={cx("w-full shadow-md", index === 1 ? "max-w-[7.5rem]" : "max-w-[6rem]")} />
                <p className="mt-2 line-clamp-1 text-xs">{score.item.title}</p>
                <div className={cx("mt-2 flex w-full flex-col items-center justify-start rounded-t-xl bg-[var(--wash)] pt-2", index === 1 ? "h-28" : index === 0 ? "h-20" : "h-16")}>
                  <span className="text-lg font-medium tabular-nums">{fmt(score.average)}</span>
                  <span className="text-[10px] text-[var(--muted)]">#{index === 1 ? 1 : index === 0 ? 2 : 3}</span>
                </div>
              </div>
            ) : <span key={index} />)}
          </div>
          {rest.length ? (
            <ol className="mt-5 space-y-2 border-t border-[var(--line)] pt-4" start={4}>
              {(showAll ? rest : rest.slice(0, 2)).map((score, index) => (
                <li key={score.item.id}>
                  <Bar label={<><span className="mr-1.5 tabular-nums text-[var(--muted)]">{index + 4}</span>{score.item.title}</>} value={score.average - input.scale.min} max={input.scale.max - input.scale.min} figure={fmt(score.average)} tone="var(--main-line)" />
                </li>
              ))}
            </ol>
          ) : null}
          {rest.length > 2 ? (
            <button type="button" data-story-skip="" className="mt-3 cursor-pointer text-xs text-[var(--main-strong)]" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t("showLess") : t("showAll", { count: story.ranking.length })}
            </button>
          ) : null}
        </Card>
      ) : null}

      {story.commonGround[0] ? (
        <Card eyebrow={t("common.eyebrow")} title={t("common.title", { a: firstName(story.commonGround[0].a.name), b: firstName(story.commonGround[0].b.name), genre: story.commonGround[0].genre })} filename={file("common.eyebrow")} tone="var(--tag-violet)">
          <div className="space-y-3">
            {story.commonGround.map((row) => (
              <div key={`${row.a.id}-${row.b.id}`} className="flex items-center gap-3 rounded-2xl bg-[var(--wash)] p-3">
                <span className="flex -space-x-2"><Avatar id={row.a.id} name={row.a.name} ids={ids} /><Avatar id={row.b.id} name={row.b.name} ids={ids} /></span>
                <p className="min-w-0 text-sm leading-snug">
                  {t("common.line", { a: firstName(row.a.name), b: firstName(row.b.name), agreement: row.agreement, genre: row.genre, aValue: fmt(row.aAverage), bValue: fmt(row.bAverage) })}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">{t("common.hint")}</p>
        </Card>
      ) : null}

      {story.genres.length ? (
        <Card eyebrow={t("genres.eyebrow")} title={t("genres.title", { genre: story.genres[0].key, value: fmt(story.genres[0].average) })} filename={file("genres.eyebrow")}>
          {statBars(story.genres, story.genres[0].key)}
          <p className="mt-3 text-xs text-[var(--muted)]">{t("genres.note", { count: story.genres.length })}</p>
        </Card>
      ) : null}

      {story.totals.minutes ? (
        <Card eyebrow={t("time.eyebrow")} title={t("time.title", { hours: Math.floor(story.totals.minutes / 60), minutes: Math.round(story.totals.minutes % 60) })} filename={file("time.eyebrow")} tone="var(--tag-amber)">
          {story.length ? (
            <div className="space-y-3 text-sm">
              <p><span className="text-[var(--muted)]">{t("time.longest")}</span> {story.length.longest.item.title} · {story.length.longest.item.runtime} min · <strong className="tabular-nums">{fmt(story.length.longest.average)}</strong></p>
              <p><span className="text-[var(--muted)]">{t("time.shortest")}</span> {story.length.shortest.item.title} · {story.length.shortest.item.runtime} min · <strong className="tabular-nums">{fmt(story.length.shortest.average)}</strong></p>
              {story.length.longAverage !== null && story.length.shortAverage !== null ? (
                <p className="rounded-xl bg-[var(--wash)] p-3 text-sm">{t(story.length.longAverage >= story.length.shortAverage ? "time.worthIt" : "time.notWorth", { long: fmt(story.length.longAverage), short: fmt(story.length.shortAverage) })}</p>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {story.critics.length ? (
        <Card eyebrow={t("critics.eyebrow")} title={t("critics.title", { name: firstName(story.critics[0].person.name), value: fmt(story.critics[0].average) })} filename={file("critics.eyebrow")} tone="var(--tag-coral)">
          <ul className="space-y-2.5">
            {[...story.critics].reverse().map((critic, index, list) => (
              <li key={critic.person.id} className="flex items-center gap-3 text-sm">
                <Avatar id={critic.person.id} name={critic.person.name} ids={ids} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{firstName(critic.person.name)} {index === 0 ? <em className="not-italic text-[var(--muted)]">· {t("critics.generous")}</em> : index === list.length - 1 ? <em className="not-italic text-[var(--muted)]">· {t("critics.tough")}</em> : null}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{t("critics.detail", { top: critic.top, favourite: critic.favourite?.item.title ?? "—" })}</span>
                </span>
                <strong className="tabular-nums">{fmt(critic.average)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {story.pairs.length ? (
        <Card eyebrow={t("pairs.eyebrow")} title={t("pairs.title", { a: firstName(story.pairs[0].a.name), b: firstName(story.pairs[0].b.name), agreement: story.pairs[0].agreement })} filename={file("pairs.eyebrow")} tone="var(--tag-blue)">
          <ul className="space-y-2">
            {story.pairs.slice(0, 6).map((pair, index, list) => (
              <li key={`${pair.a.id}-${pair.b.id}`}>
                <Bar
                  label={<span className="flex items-center gap-1"><span className="flex -space-x-1.5"><Avatar id={pair.a.id} name={pair.a.name} ids={ids} size={5} /><Avatar id={pair.b.id} name={pair.b.name} ids={ids} size={5} /></span><span className="truncate">{firstName(pair.a.name)} & {firstName(pair.b.name)}</span></span>}
                  value={pair.agreement}
                  max={100}
                  figure={`${pair.agreement}%`}
                  strong={index === 0 || index === list.length - 1}
                  tone={index === 0 ? "var(--tag-blue)" : "var(--main-line)"}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">{t("pairs.note", { count: story.pairs.length })}</p>
        </Card>
      ) : null}

      {story.surprises.length ? (
        <Card eyebrow={t("surprises.eyebrow")} title={t("surprises.title", { title: story.surprises[0].item.title })} filename={file("surprises.eyebrow")} tone="var(--main-2)">
          <ul className="space-y-3">
            {story.surprises.map((row) => (
              <li key={row.item.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.item.title}</span>
                <span className="tabular-nums text-[var(--muted)] line-through">{fmt(row.expected)}</span>
                <span className={row.actual >= row.expected ? "text-[var(--ok)]" : "text-[var(--danger)]"}>{row.actual >= row.expected ? "↗" : "↘"}</span>
                <strong className="w-8 text-right tabular-nums">{fmt(row.actual)}</strong>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">{t("surprises.note")}</p>
        </Card>
      ) : null}

      {story.properties.map((property) => (
        <Card key={property.label} eyebrow={t("property.eyebrow", { label: t.has(`property.labels.${property.label}`) ? t(`property.labels.${property.label}`) : property.label })} title={property.best.key} filename={file("property.file")}>
          <p className="text-sm">{t("property.line", { count: property.best.count, things: noun(property.best.count), value: fmt(property.best.average) })}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">{property.best.items.join(" · ")}</p>
          {property.runnerUp ? <p className="mt-3 text-xs text-[var(--muted)]">{t("property.runnerUp", { name: property.runnerUp.key, value: fmt(property.runnerUp.average) })}</p> : null}
        </Card>
      ))}

      {story.years.length ? (
        <Card eyebrow={t("years.eyebrow")} title={t("years.title", { first: story.years[0].key, last: story.years.at(-1)!.key })} filename={file("years.eyebrow")}>
          <div className="flex h-32 items-end gap-1.5">
            {story.years.map((year) => {
              const tallest = Math.max(...story.years.map((row) => row.count));
              const best = year.average === Math.max(...story.years.map((row) => row.average));
              return (
                <div key={year.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={year.items.join(" · ")}>
                  <span className="text-[10px] tabular-nums text-[var(--muted)]">{fmt(year.average)}</span>
                  <span className="w-full rounded-t-md" style={{ height: `${(year.count / tallest) * 80}px`, background: best ? "var(--main)" : "var(--main-line)" }} />
                  <span className="text-[10px] tabular-nums">{year.key}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">{t("years.note")}</p>
        </Card>
      ) : null}

      {story.critics.length ? (
        <Card eyebrow={t("favourites.eyebrow")} filename={file("favourites.eyebrow")} tone="var(--tag-green)">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {story.critics.filter((critic) => critic.favourite).map((critic) => (
              <li key={critic.person.id} className="flex flex-col gap-1.5">
                <TitleChip title={critic.favourite!.item.title} year={critic.favourite!.item.year} className="w-full max-w-[6rem]" />
                <span className="flex items-center gap-1.5 text-xs"><Avatar id={critic.person.id} name={critic.person.name} ids={ids} size={5} />{firstName(critic.person.name)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {story.quotes.length ? (
        <Card eyebrow={t("quotes.eyebrow")} filename={file("quotes.eyebrow")} wide tone="var(--ink)">
          <div className="grid gap-4 sm:grid-cols-2">
            {story.quotes.map((quote) => (
              <figure key={`${quote.person.id}-${quote.item.id}`} className="border-l-2 pl-3" style={{ borderColor: personTone(ids, quote.person.id) }}>
                <blockquote className="text-base font-light leading-snug">“{quote.text}”</blockquote>
                <figcaption className="mt-1.5 text-xs text-[var(--muted)]">{t("quotes.by", { name: firstName(personName(quote.person.id)), title: quote.item.title, value: fmt(quote.value) })}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ── Dated ─────────────────────────────────────────────────────────────────

export function DatedAlmanac({ story, input }: { story: DatedStory; input: StoryInput }) {
  const t = useTranslations("story");
  const f = useFormatter();
  const ids = input.people.map((person) => person.id);
  const file = (key: string) => `${input.title} — ${t(key)}`;
  const day = (key: string) => f.dateTime(new Date(`${key}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const unit = input.counter?.unit || (input.counter?.label ?? "");
  const byStreak = [...story.lanes].sort((a, b) => (b.longest?.length ?? 1) - (a.longest?.length ?? 1));
  const byTotal = [...story.lanes].filter((lane) => lane.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const byConsistency = [...story.lanes].sort((a, b) => (b.consistency ?? 0) - (a.consistency ?? 0));
  const weekdayNames = Array.from({ length: 7 }, (_, index) => f.dateTime(new Date(Date.UTC(2026, 0, 4 + index, 12)), { weekday: "short", timeZone: "UTC" }));
  const comebacks = story.lanes.filter((lane) => lane.comeback).sort((a, b) => b.comeback!.gap - a.comeback!.gap);
  const bests = story.lanes.filter((lane) => lane.best).sort((a, b) => b.best!.value - a.best!.value);

  return (
    <div className="gap-4 space-y-4 md:columns-2 xl:columns-3 [&>*]:break-inside-avoid">
      <Card eyebrow={t("streaks.eyebrow")} title={byStreak[0].longest ? t("streaks.title", { name: firstName(byStreak[0].person.name), count: byStreak[0].longest.length }) : t("streaks.none")} filename={file("streaks.eyebrow")} wide tone="var(--main-2)">
        <ul className="space-y-2.5">
          {byStreak.map((lane) => (
            <li key={lane.person.id} className="flex items-center gap-3 text-sm">
              <Avatar id={lane.person.id} name={lane.person.name} ids={ids} />
              <span className="w-16 truncate">{firstName(lane.person.name)}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--wash-strong)]">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(4, ((lane.longest?.length ?? 1) / Math.max(1, byStreak[0].longest?.length ?? 1)) * 100)}%`, background: personTone(ids, lane.person.id) }} />
              </span>
              <span className="w-32 flex-none whitespace-nowrap text-right text-xs text-[var(--muted)]">{t("streaks.best", { count: lane.longest?.length ?? 1 })}{lane.current > 1 ? ` · ${t("streaks.now", { count: lane.current })}` : ""}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card eyebrow={t("consistency.eyebrow")} title={t("consistency.title", { name: firstName(byConsistency[0].person.name), value: byConsistency[0].consistency ?? 0 })} filename={file("consistency.eyebrow")} tone="var(--tag-green)">
        <div className="flex flex-wrap gap-4">
          {byConsistency.map((lane) => {
            const value = lane.consistency ?? 0;
            return (
              <div key={lane.person.id} className="flex flex-col items-center gap-1">
                <span className="relative grid h-16 w-16 place-items-center">
                  <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--wash-strong)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={personTone(ids, lane.person.id)} strokeWidth="3" strokeDasharray={`${value} 100`} strokeLinecap="round" />
                  </svg>
                  <span className="text-sm font-medium tabular-nums">{value}%</span>
                </span>
                <span className="text-xs">{firstName(lane.person.name)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">{t("consistency.note", { days: story.totals.days })}</p>
      </Card>

      {story.totals.total !== null && byTotal.length ? (
        <Card eyebrow={t("totals.eyebrow", { label: input.counter?.label ?? "" })} title={t("totals.title", { total: f.number(story.totals.total), unit })} filename={file("totals.file")} tone="var(--tag-blue)">
          <div className="space-y-2.5">
            {byTotal.map((lane, index) => (
              <Bar key={lane.person.id} label={firstName(lane.person.name)} value={lane.total ?? 0} max={byTotal[0].total ?? 1} figure={f.number(lane.total ?? 0)} strong={index === 0} tone={personTone(ids, lane.person.id)} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card eyebrow={t("weekdays.eyebrow")} title={story.bestWeekdays.length ? t("weekdays.title", { day: story.bestWeekdays.map((index) => weekdayNames[index]).join(" & "), count: story.bestWeekdays.length }) : t("weekdays.even")} filename={file("weekdays.eyebrow")}>
        <div className="flex h-28 items-end gap-2">
          {story.weekdays.map((count, index) => (
            <div key={index} className="flex flex-1 flex-col items-center gap-1">
              <span className="w-full rounded-t-md" style={{ height: `${Math.max(4, (count / Math.max(1, ...story.weekdays)) * 88)}px`, background: story.bestWeekdays.includes(index) ? "var(--main)" : "var(--main-line)" }} />
              <span className="text-[10px] text-[var(--muted)]">{weekdayNames[index]}</span>
            </div>
          ))}
        </div>
      </Card>

      {bests.length ? (
        <Card eyebrow={t("bestDay.eyebrow")} title={t("bestDay.title", { name: firstName(bests[0].person.name), value: f.number(bests[0].best!.value), unit, day: day(bests[0].best!.day) })} filename={file("bestDay.eyebrow")} tone="var(--tag-amber)">
          <ul className="space-y-1.5 text-sm">
            {bests.map((lane) => (
              <li key={lane.person.id} className="flex items-center gap-2"><Avatar id={lane.person.id} name={lane.person.name} ids={ids} size={5} />{firstName(lane.person.name)} <span className="text-[var(--muted)]">· {day(lane.best!.day)}</span><strong className="ml-auto tabular-nums">{f.number(lane.best!.value)}</strong></li>
            ))}
          </ul>
        </Card>
      ) : null}

      {comebacks.length ? (
        <Card eyebrow={t("comeback.eyebrow")} title={t("comeback.title", { name: firstName(comebacks[0].person.name), gap: comebacks[0].comeback!.gap })} filename={file("comeback.eyebrow")} tone="var(--tag-violet)">
          <p className="text-sm">{t("comeback.line", { day: day(comebacks[0].comeback!.back) })}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("comeback.note")}</p>
        </Card>
      ) : null}

      {story.records.length ? (
        <Card eyebrow={t("records.eyebrow")} title={t("records.title", { title: story.records[0].item.title, first: f.number(story.records[0].first), best: f.number(story.records[0].best) })} filename={file("records.eyebrow")} wide tone="var(--tag-coral)">
          <ul className="space-y-2">
            {story.records.map((row) => (
              <li key={`${row.person.id}-${row.item.id}`} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.item.title}</span>
                <span className="tabular-nums text-[var(--muted)]">{f.number(row.first)}</span>
                <span aria-hidden="true">→</span>
                <strong className="tabular-nums">{f.number(row.best)}</strong>
                <span className="w-14 text-right text-xs text-[var(--ok)]">+{Math.round(((row.best - row.first) / Math.max(1e-9, row.first)) * 100)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">{t("records.note", { label: input.recordLabel ?? "" })}</p>
        </Card>
      ) : null}

      {story.notes.length ? (
        <Card eyebrow={t("notes.eyebrow")} filename={file("notes.eyebrow")} tone="var(--ink)">
          <div className="space-y-4">
            {story.notes.map((note) => (
              <figure key={`${note.person.id}-${note.day}`} className="border-l-2 pl-3" style={{ borderColor: personTone(ids, note.person.id) }}>
                <blockquote className="text-base font-light leading-snug">“{note.text}”</blockquote>
                <figcaption className="mt-1 text-xs text-[var(--muted)]">{firstName(note.person.name)} · {day(note.day)}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

