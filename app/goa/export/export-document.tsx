"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";

import { monthCells } from "../checkin-days";
import type { ChallengeDetail, Entry, Id } from "../types";
import { dateKeyInSaoPaulo, parseCommentBlocks } from "../utils";
import {
  buildExportModel, coverLines, type DocChapter, type DocColor, type DocEntry, type DocItem,
  type DocPerson, type DocStat, type ExportModel,
} from "./model";

type Section = "cover" | "rules" | "items" | "diary" | "scoreboard";
const SECTIONS: Section[] = ["cover", "rules", "items", "diary", "scoreboard"];

function tone(color: DocColor | undefined): string {
  return color ? `xd-c-${color}` : "";
}

/** Ink unless the challenge has real stages: then each stage keeps its colour. Nothing else is coloured. */
function stageTone(chapter: DocChapter | undefined): string {
  return chapter?.staged ? tone(chapter.color) : "";
}

/** The day as a date at noon in São Paulo, so the calendar day never shifts. */
function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00-03:00`);
}

function useDoc() {
  const t = useTranslations("exportDoc");
  const format = useFormatter();
  const locale = useLocale();
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  return {
    t,
    n: (value: number) => number.format(value),
    day: (day: string | null, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
      day ? format.dateTime(dayDate(day), options as never) : "—",
  };
}

type Doc = ReturnType<typeof useDoc>;

/** A 0–5 row of dots, halves included, for a rating out of `max`. */
function Dots({ value, max }: { value: number; max: number }) {
  const scaled = Math.round((value / max) * 5 * 2) / 2;
  return (
    <span className="xd-dots" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <i key={index} className={scaled >= index + 1 ? "on" : scaled >= index + 0.5 ? "half" : undefined} />
      ))}
    </span>
  );
}

function CommentBlocks({ text }: { text: string }) {
  return (
    <>
      {parseCommentBlocks(text).map((block, index) =>
        block.kind === "divider" ? <hr key={index} />
          : block.kind === "quote" ? <blockquote key={index}>{block.text}</blockquote>
            : <p key={index}>{block.text}</p>,
      )}
    </>
  );
}

/** A short answer in the reader's terms: a number with their decimal mark, a date spelled out. */
function answerText(value: DocEntry["values"][number], doc: Doc): string {
  if (value.number !== null) return value.unit ? `${doc.n(value.number)} ${value.unit}` : doc.n(value.number);
  if (value.type === "date" && /^\d{4}-\d{2}-\d{2}/.test(value.text)) return doc.day(value.text.slice(0, 10));
  return value.text;
}

/** Dates are opt-in ("Dates" in the toolbar): an optional date field is left out unless they're asked for. */
function printed(value: DocEntry["values"][number], showDates: boolean): boolean {
  return showDates || value.type !== "date" || value.required;
}

/** One answer: the short values on a line, the comments as paragraphs underneath. */
function EntryBody({ entry, doc, showDates }: { entry: DocEntry; doc: Doc; showDates: boolean }) {
  const short = entry.values.filter((value) => !value.long && printed(value, showDates));
  const long = entry.values.filter((value) => value.long);
  const shown = (value: DocEntry["values"][number]) => answerText(value, doc);
  return (
    <>
      {short.length ? (
        <div className="xd-line">
          {short.map((value, index) => (
            <span className="xd-kv" key={index}>
              <span>{value.label} </span>
              <b>{shown(value)}</b>
            </span>
          ))}
        </div>
      ) : null}
      {long.map((value, index) => (
        <div className="xd-text" key={index}>
          {long.length > 1 ? <span className="xd-text-label">{value.label}</span> : null}
          <CommentBlocks text={value.text} />
        </div>
      ))}
      {!entry.values.length && !entry.children.length ? <span className="xd-empty">{doc.t("checked")}</span> : null}
    </>
  );
}

function Cover({ challenge, model, doc, footer }: { challenge: ChallengeDetail; model: ExportModel; doc: Doc; footer?: ReactNode }) {
  // A zero says nothing on a cover (a challenge that hasn't started yet): only the numbers there are.
  const stats = model.stats.filter((stat) => !("value" in stat) || stat.value > 0);
  const lines = coverLines(challenge.title);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const size = Math.max(34, Math.min(92, Math.floor(610 / (longest * 0.68))));
  const names = model.people.filter((person) => person.key !== "shared").map((person) => person.name);
  const eyebrow = names.length === 0 ? doc.t("eyebrowSolo")
    : names.length === 1 ? doc.t("presentsOne", { name: names[0] })
      : names.length <= 4 ? doc.t("presents", { names: `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` })
        : doc.t("presentsGroup", { count: names.length });
  const scoreCount = model.chapters.reduce((sum, chapter) => sum + chapter.items.reduce((total, item) => total + item.ratings.length, 0), 0);
  const outOf = (value: number) => `${doc.n(value)}/${model.ratingMax}`;
  const verdict = !model.hasRatings ? [] : [
    model.champion?.ratingAvg != null ? { label: doc.t("champion"), value: model.champion.title, note: outOf(model.champion.ratingAvg) } : null,
    model.disappointment?.ratingAvg != null ? { label: doc.t("disappointment"), value: model.disappointment.title, note: outOf(model.disappointment.ratingAvg) } : null,
    model.overallAvg !== null ? { label: doc.t("overall"), value: doc.n(model.overallAvg), note: doc.t("ratingsCount", { count: scoreCount }) } : null,
  ].filter((row): row is { label: string; value: string; note: string } => row !== null);
  const range = model.firstDay
    ? model.firstDay === model.lastDay ? doc.day(model.firstDay) : doc.t("range", { from: doc.day(model.firstDay), to: doc.day(model.lastDay) })
    : null;
  return (
    <section className="xd-cover">
      <p className="xd-eyebrow">{eyebrow}</p>
      <h1 className="xd-cover-title" style={{ fontSize: `min(${size}px, calc((100vw - 40px) / ${(longest * 0.7).toFixed(2)}))` }}>
        {lines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </h1>
      <p className="xd-cover-lede">{challenge.description?.trim() || doc.t("coverLede", { title: challenge.title })}</p>
      {range ? <p className="xd-eyebrow" style={{ marginTop: "6mm" }}>{range}</p> : null}
      {verdict.length ? (
        // The verdict, read off the scoreboard: a few plain lines, not boxes.
        <dl className="xd-verdict">
          {verdict.map((row) => (
            <div key={row.label}><dt>{row.label}</dt><dd><b>{row.value}</b>{row.note ? <span>{row.note}</span> : null}</dd></div>
          ))}
        </dl>
      ) : null}
      {stats.length ? (
        <div className="xd-stats">
          {stats.map((stat) => <StatBlock key={stat.kind} stat={stat} doc={doc} />)}
        </div>
      ) : <div className="xd-stats-none" />}
      {footer}
    </section>
  );
}

function StatBlock({ stat, doc }: { stat: DocStat; doc: Doc }) {
  const value = stat.kind === "years" ? `${stat.from}–${stat.to}`
    : stat.kind === "runtime" ? `~${doc.n(stat.hours)}h`
      : stat.kind === "streak" ? doc.t("streakValue", { count: stat.value })
      : doc.n(stat.value);
  return (
    <div className="xd-stat">
      <b>{value}</b>
      <span>{doc.t(`stats.${stat.kind}`)}</span>
    </div>
  );
}

function HowItWorks({ challenge, doc }: { challenge: ChallengeDetail; doc: Doc }) {
  const rules = challenge.ruleSections ?? [];
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("rulesTitle")}</h2>
      <p className="xd-lede">{doc.t("rulesLede")}</p>
      <ol className="xd-rules">
        {rules.map((rule, index) => (
          <li key={index}>
            <b>{rule.title}</b>{rule.description ? <> {rule.description}</> : null}
            {rule.topics?.length ? (
              <ol>
                {rule.topics.map((topic, topicIndex) => (
                  <li key={topicIndex}><span>{index + 1}.{topicIndex + 1}</span><b>{topic.title}</b>{topic.description ? <> {topic.description}</> : null}</li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One row per person on an item card: their scores on one line (the expectation first, it came first) and
 * their comments under it. The entry types and days are left out: the field label already says "Nota",
 * and when it happened lives in the "When" tile and the diary.
 */
function byPerson(entries: DocEntry[]): DocEntry[] {
  const rows = new Map<string, DocEntry[]>();
  for (const entry of entries) rows.set(entry.personKey, [...(rows.get(entry.personKey) ?? []), entry]);
  return [...rows.values()].map((own) => {
    const ordered = [...own].sort((a, b) => Number(b.purpose === "expectation") - Number(a.purpose === "expectation"));
    const values = ordered.flatMap((entry) => entry.values);
    return {
      ...ordered[0],
      values: [...values.filter((value) => !value.long), ...values.filter((value) => value.long)],
      children: ordered.flatMap((entry) => entry.children),
    };
  });
}

function ItemCard({ item, chapter, model, doc, people, showWhen }: {
  item: DocItem; chapter: DocChapter; model: ExportModel; doc: Doc; people: Map<string, DocPerson>; showWhen: boolean;
}) {
  const multiPeople = model.people.length > 1;
  const recommender = item.recommender;
  const by = recommender ? (
    <div className={`xd-by ${stageTone(chapter)}`}>
      <span>{doc.t("recommendedBy")}</span>
      <strong>{recommender.name.split(" ")[0]}</strong>
    </div>
  ) : null;
  const number = <span className="xd-num">{String(item.number).padStart(2, "0")}</span>;
  const meta = item.subtitle || item.meta.length ? <p>{[item.subtitle, ...item.meta].filter(Boolean).join(" · ")}</p> : null;
  // Nothing logged yet: the title and a line saying so — no empty tiles.
  if (!item.entries.length && !item.progress.length) {
    return (
      <article className={`xd-card is-empty ${stageTone(chapter)}`}>
        <header className="xd-card-head">
          {number}
          <div className="xd-card-title"><h3>{item.title}</h3>{meta}<p className="xd-card-empty">{doc.t("noEntries")}</p></div>
          {by}
        </header>
      </article>
    );
  }
  // Each person's own score lives in their row and on the scoreboard — a tile only ever holds one number:
  // the score itself when it's one person's, the average when it's several.
  const tiles: Array<{ label: string; body: ReactNode }> = [];
  if (model.hasRatings) {
    tiles.push({
      label: doc.t(multiPeople ? "tiles.average" : "tiles.rating"),
      body: item.ratingAvg !== null
        ? <><Dots value={item.ratingAvg} max={model.ratingMax} /><small>{doc.n(item.ratingAvg)}/{model.ratingMax}</small></>
        : <small>{doc.t("noRating")}</small>,
    });
  }
  const count = item.entries.length + item.progress.reduce((sum, row) => sum + row.points.length, 0);
  tiles.push({ label: doc.t("tiles.entries"), body: <>{doc.n(count)}</> });
  if (showWhen && item.lastDay) tiles.push({ label: doc.t("tiles.when"), body: <>{doc.day(item.lastDay)}</> });
  const long = item.entries.length > 5 || item.entries.some((entry) => entry.values.some((value) => value.long && value.text.length > 600));
  return (
    <article className={`xd-card ${stageTone(chapter)}${long ? " is-long" : ""}`}>
      <header className="xd-card-head">
        {number}
        <div className="xd-card-title"><h3>{item.title}</h3>{meta}</div>
        {by}
      </header>
      <div className="xd-tiles">
        {tiles.map((tile) => <div className="xd-tile" key={tile.label}><span>{tile.label}</span><b>{tile.body}</b></div>)}
      </div>
      {item.note ? <p className="xd-lead"><b>{doc.t("about")} </b>{item.note}</p> : null}
      <dl className="xd-rows">
        {byPerson(item.entries).map((entry) => {
          const person = people.get(entry.personKey);
          return (
            <div className="xd-row" key={entry.id}>
              <dt>{person?.name ?? "—"}</dt>
              <dd><EntryBody entry={entry} doc={doc} showDates={showWhen} /></dd>
            </div>
          );
        })}
        {item.progress.map((row) => {
          const person = people.get(row.personKey);
          return (
            <div className="xd-row" key={`progress-${row.personKey}`}>
              <dt>{person?.name ?? "—"}{row.label ? <small>{row.label}</small> : null}</dt>
              <dd>
                {/* Not every day (a book club logs dozens): how much, over how many days, from when to when. */}
                <ProgressSummary row={row} doc={doc} />
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}

function Items({ model, doc, people, showWhen }: { model: ExportModel; doc: Doc; people: Map<string, DocPerson>; showWhen: boolean }) {
  const itemCount = model.chapters.reduce((sum, chapter) => sum + chapter.items.length, 0);
  // Only real stages get a heading; a long list's colour runs are just colour.
  const labelled = model.chapters.some((chapter) => chapter.staged);
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("itemsTitle")}</h2>
      <p className="xd-lede">{doc.t("itemsLede", { items: itemCount, chapters: labelled ? model.chapters.length : 0 })}</p>
      {model.chapters.map((chapter, index) => (
        <div key={chapter.index}>
          {labelled ? (
            <div className={`xd-chapter ${stageTone(chapter)}${index === 0 ? " xd-first-chapter" : ""}`}>
              <h3>{doc.t("chapter", { n: index + 1 })}{chapter.title ? ` · ${chapter.title}` : ""}</h3>
              {chapter.subtitle ? <p>{chapter.subtitle}</p> : null}
            </div>
          ) : index === 0 ? <div style={{ height: "4mm" }} /> : null}
          {chapter.items.map((item) => <ItemCard key={item.id} item={item} chapter={chapter} model={model} doc={doc} people={people} showWhen={showWhen} />)}
        </div>
      ))}
    </section>
  );
}

/** A person's progress on one item in a line: "129 pages in 22 days · 29 Mar – 3 May". */
function ProgressSummary({ row, doc }: { row: DocItem["progress"][number]; doc: Doc }) {
  const days = [...new Set(row.points.map((point) => point.day).filter((day): day is string => Boolean(day)))].sort();
  const short = (day: string) => doc.day(day, { day: "numeric", month: "short" });
  const range = days.length > 1 ? `${short(days[0])} – ${short(days.at(-1)!)}` : days.length ? short(days[0]) : null;
  const amount = row.total !== null
    ? (row.unit ? `${doc.n(row.total)} ${row.unit}` : doc.n(row.total))
    : row.points.length === 1 ? row.points[0].text : doc.t("progressEntries", { count: row.points.length });
  return (
    <p className="xd-line">
      <b>{amount}</b>
      {days.length > 1 ? <span className="xd-soft">{doc.t("progressDays", { count: days.length })}</span> : null}
      {range ? <span className="xd-soft">{range}</span> : null}
    </p>
  );
}

const WEEK = [0, 1, 2, 3, 4, 5, 6];

function Diary({ model, doc, people }: { model: ExportModel; doc: Doc; people: Map<string, DocPerson> }) {
  const entryCount = model.diary.reduce((sum, month) => sum + month.entries.length, 0);
  const dayCount = model.diary.reduce((sum, month) => sum + month.days.length, 0);
  const multiPeople = model.people.length > 1;
  // A Sunday-first week, named in the reader's language (4 Jan 2026 was a Sunday).
  const weekdays = WEEK.map((offset) => doc.day(`2026-01-${String(4 + offset).padStart(2, "0")}`, { weekday: "narrow" }));
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t(model.sessionMode ? "diaryTitleSessions" : "diaryTitle")}</h2>
      <p className="xd-lede">{doc.t("diaryLede", { entries: entryCount, days: dayCount })}</p>
      {model.diary.map((month) => {
        const logged = new Map(month.days.map((row) => [row.day, row.personKeys]));
        return (
          <div className="xd-month" key={month.month || "undated"}>
            <div className="xd-month-head">
              {month.month ? (
                <h3>{doc.day(`${month.month}-15`, { month: "long" })} <span>{month.month.slice(0, 4)}</span></h3>
              ) : <h3>{doc.t("undated")}</h3>}
              <p>{doc.t("monthDays", { count: month.days.length })}</p>
            </div>
            <div className="xd-month-body">
              {month.month ? (
                <div className="xd-cal" aria-hidden="true">
                  {weekdays.map((name, index) => <span key={index}>{name}</span>)}
                  {monthCells(month.month).map((day, index) => {
                    if (!day) return <i key={index} />;
                    // A marked day; ringed when more than one person logged it.
                    const keys = logged.get(day);
                    return <i key={index} className={keys ? `on${keys.length > 1 ? " many" : ""}` : undefined}>{Number(day.slice(8))}</i>;
                  })}
                </div>
              ) : <div />}
              {/* The days are on the calendar; beside it, the month in a few lines rather than every one of them. */}
              {month.summary.length ? (
                <table className="xd-sets xd-summary">
                  <tbody>
                    {month.summary.map((line) => {
                      const person = people.get(line.personKey);
                      return (
                        <tr key={`${line.name}-${line.personKey}`}>
                          <td>
                            {line.name}
                            {multiPeople ? <span className="xd-who">{person?.name}</span> : null}
                          </td>
                          <td className="xd-times">{doc.n(line.times)}×</td>
                          <td>{line.bests.map((best) => `${best.label} ${doc.n(best.value)}${best.unit ? ` ${best.unit}` : ""}`).join(" · ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <div />}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Scoreboard({ model, doc, showDates }: { model: ExportModel; doc: Doc; showDates: boolean }) {
  const items = model.chapters.flatMap((chapter) => chapter.items.map((item) => ({ item, chapter })));
  const raters = model.people.filter((person) => person.ratingAvg !== null).slice(0, 4);
  const perPerson = raters.length > 1;
  const showYear = items.some(({ item }) => item.year);
  const showBy = model.hasRecommenders;
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("scoreboardTitle")}</h2>
      <p className="xd-lede">{doc.t(model.hasRatings ? "scoreboardLede" : "scoreboardLedePlain")}</p>
      <div className="xd-table-wrap">
        <table className="xd-table">
          <thead>
            <tr>
              <th aria-hidden="true" />
              <th>{doc.t("col.item")}</th>
              {showYear ? <th>{doc.t("col.year")}</th> : null}
              {showBy ? <th>{doc.t("recommendedBy")}</th> : null}
              {model.hasRatings && perPerson ? raters.map((person) => <th className="score xd-col" key={person.key} title={person.name}><span>{person.name.split(" ")[0]}</span></th>) : null}
              {model.hasRatings ? <th className="score xd-col"><span>{doc.t(perPerson ? "col.avg" : "col.rating")}</span></th> : <th className="score xd-col"><span>{doc.t("col.entries")}</span></th>}
              {showDates ? <th>{doc.t("col.date")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map(({ item, chapter }) => (
              <tr key={item.id} className={stageTone(chapter)}>
                <td className="num">{String(item.number).padStart(2, "0")}</td>
                <td className="title">{item.title}</td>
                {showYear ? <td className="small">{item.year ?? ""}</td> : null}
                {showBy ? <td className="small">{item.recommender?.name.split(" ")[0] ?? ""}</td> : null}
                {model.hasRatings && perPerson ? raters.map((person) => {
                  const rating = item.ratings.find((row) => row.personKey === person.key);
                  return <td className="score" key={person.key}>{rating ? doc.n(rating.value) : <span className="muted">—</span>}</td>;
                }) : null}
                {model.hasRatings
                  ? <td className="score avg">{item.ratingAvg !== null ? doc.n(item.ratingAvg) : <span className="muted">—</span>}</td>
                  : <td className="score">{doc.n(item.entries.length + item.progress.reduce((sum, row) => sum + row.points.length, 0))}</td>}
                {showDates ? <td className="small muted">{item.lastDay ? doc.day(item.lastDay, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Records({ model, doc, showDates }: { model: ExportModel; doc: Doc; showDates: boolean }) {
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("recordsTitle")}</h2>
      <p className="xd-lede">{doc.t("recordsLede")}</p>
      <div className="xd-table-wrap">
        <table className="xd-table">
          <thead>
            <tr>
              <th aria-hidden="true" />
              <th>{doc.t("col.item")}</th>
              <th className="score">{doc.t("col.sessions")}</th>
              <th>{doc.t("col.best")}</th>
              {showDates ? <th>{doc.t("col.date")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {model.records.map((record, index) => (
              <tr key={record.itemId}>
                <td className="num">{String(index + 1).padStart(2, "0")}</td>
                <td className="title">{record.title}</td>
                <td className="score">{doc.n(record.sessions)}</td>
                <td className="small">{record.bests.map((best) => `${best.label} ${doc.n(best.value)}${best.unit ? ` ${best.unit}` : ""}`).join(" · ") || "—"}</td>
                {showDates ? <td className="small muted">{record.lastDay ? doc.day(record.lastDay, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckIcon() {
  return <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m2.5 6.2 2.2 2.2 4.8-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The export dashboard: pick what goes in, see the document as it will print, and save it as a PDF.
 * Everything shown is what the viewer can already see in the challenge — `listEntries` applied the rules.
 */
export function ExportDocument({ challenge, entries, userId, fontClassName }: {
  challenge: ChallengeDetail; entries: Entry[]; userId: Id; fontClassName: string;
}) {
  const doc = useDoc();
  const tc = useTranslations("common");
  const [onlyMine, setOnlyMine] = useState(false);
  const [showWhen, setShowWhen] = useState(false);
  const words = { yes: tc("yes"), no: tc("no"), group: doc.t("group") };
  const everyone = useMemo(() => buildExportModel({ challenge, entries, userId, words }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [challenge, entries, userId]);
  const model = useMemo(() => (onlyMine ? buildExportModel({ challenge, entries, userId, onlyMine: true, words }) : everyone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [challenge, entries, userId, onlyMine, everyone]);
  const people = useMemo(() => new Map(model.people.map((person) => [person.key, person])), [model]);

  const available: Record<Section, boolean> = {
    cover: true,
    rules: Boolean(challenge.ruleSections?.length),
    items: !model.sessionMode && model.chapters.length > 0,
    diary: model.diary.length > 0,
    // A scoreboard needs something to score: a list nobody has logged yet has none.
    scoreboard: model.sessionMode ? model.records.length > 0 : model.chapters.some((chapter) => chapter.items.some((item) => item.entries.length || item.progress.length)),
  };
  const [hidden, setHidden] = useState<Set<Section>>(new Set());
  const shown = (section: Section) => available[section] && !hidden.has(section);
  const toggle = (section: Section) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

  const colophon = <p className="xd-colophon">{doc.t("colophon", { date: doc.day(dateKeyInSaoPaulo(new Date())) })}</p>;
  // With only the cover to print, the closing line sits on it rather than alone on a second, empty page.
  const onlyCover = shown("cover") && !SECTIONS.some((section) => section !== "cover" && shown(section));
  return (
    <div className={`xd-screen ${fontClassName}`}>
      <div className="xd-toolbar">
        <div className="xd-toolbar-inner">
          <div className="xd-toolbar-row">
            <a className="inline-flex min-h-9 min-w-0 items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]" href={`/challenges/${challenge.id}`}>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="truncate">{challenge.title}</span>
            </a>
            <div className="flex flex-none items-center gap-3">
              <span className="hidden text-xs text-[var(--muted)] lg:inline">{doc.t("printHint")}</span>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent bg-[var(--main)] px-4 py-2 text-sm font-medium text-white shadow-[var(--elevate-1)] transition hover:opacity-90"
              >
                <DownloadIcon />
                {doc.t("download")}
              </button>
            </div>
          </div>
          <div className="xd-chips" role="group" aria-label={doc.t("sectionsLabel")}>
            {SECTIONS.filter((section) => available[section]).map((section) => (
              <button key={section} type="button" className="xd-chip" aria-pressed={!hidden.has(section)} onClick={() => toggle(section)}>
                {!hidden.has(section) ? <CheckIcon /> : null}
                {doc.t(section === "scoreboard" && model.sessionMode ? "sections.records" : `sections.${section}`)}
              </button>
            ))}
            {shown("items") ? (
              <>
                <span className="xd-chip-gap" aria-hidden="true" />
                <button type="button" className="xd-chip" aria-pressed={showWhen} onClick={() => setShowWhen((value) => !value)}>
                  {showWhen ? <CheckIcon /> : null}
                  {doc.t("showWhen")}
                </button>
              </>
            ) : null}
            {everyone.people.length > 1 ? (
              <>
                <span className="xd-chip-gap" aria-hidden="true" />
                <button type="button" className="xd-chip" aria-pressed={onlyMine} onClick={() => setOnlyMine((value) => !value)}>
                  {onlyMine ? <CheckIcon /> : null}
                  {doc.t("onlyMine")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="xd-stage">
        <article className="xd">
          {shown("cover") ? <Cover challenge={challenge} model={model} doc={doc} footer={onlyCover ? colophon : undefined} /> : null}
          {shown("rules") ? <HowItWorks challenge={challenge} doc={doc} /> : null}
          {shown("items") ? <Items model={model} doc={doc} people={people} showWhen={showWhen} /> : null}
          {shown("diary") ? <Diary model={model} doc={doc} people={people} /> : null}
          {shown("scoreboard") ? (model.sessionMode ? <Records model={model} doc={doc} showDates={showWhen} /> : <Scoreboard model={model} doc={doc} showDates={showWhen} />) : null}
          {onlyCover ? null : colophon}
        </article>
      </div>
    </div>
  );
}
