"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { monthCells } from "../checkin-days";
import type { ChallengeDetail, ChallengeField, Entry, Id } from "../types";
import { dateKeyInSaoPaulo, parseCommentBlocks } from "../utils";
import {
  buildExportModel, coverLines, DOC_COLORS, type DocChapter, type DocColor, type DocEntry, type DocItem,
  type DocPerson, type DocStat, type ExportModel,
} from "./model";

type Section = "cover" | "rules" | "items" | "diary" | "scoreboard";
const SECTIONS: Section[] = ["cover", "rules", "items", "diary", "scoreboard"];
const COVER_COLORS: DocColor[] = ["coral", "blue"];
const RIBBON = [100, 84, 68, 52, 36];

function tone(color: DocColor | undefined): string {
  return color ? `xd-c-${color}` : "";
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
  if (value.type === "number" && Number.isFinite(Number(value.text))) return doc.n(Number(value.text));
  if (value.type === "date" && /^\d{4}-\d{2}-\d{2}/.test(value.text)) return doc.day(value.text.slice(0, 10));
  return value.text;
}

/** One answer: the short values on a line, the comments as paragraphs underneath. */
function EntryBody({ entry, doc, showType }: { entry: DocEntry; doc: Doc; showType: boolean }) {
  const short = entry.values.filter((value) => !value.long);
  const long = entry.values.filter((value) => value.long);
  const shown = (value: DocEntry["values"][number]) => answerText(value, doc);
  return (
    <>
      {showType || short.length || entry.day ? (
        <div className="xd-line">
          {showType && entry.typeName ? <span className="xd-type">{entry.typeName}</span> : null}
          {short.map((value, index) => (
            <span className="xd-kv" key={index}>
              <span>{value.label} </span>
              <b>{shown(value)}</b>
            </span>
          ))}
          {entry.day ? <span className="xd-kv"><span>{doc.day(entry.day, { day: "numeric", month: "short" })}</span></span> : null}
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

function Cover({ challenge, model, doc }: { challenge: ChallengeDetail; model: ExportModel; doc: Doc }) {
  const lines = coverLines(challenge.title);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const size = Math.max(34, Math.min(92, Math.floor(610 / (longest * 0.68))));
  const names = model.people.filter((person) => person.key !== "shared").map((person) => person.name);
  const eyebrow = names.length === 0 ? doc.t("eyebrowSolo")
    : names.length === 1 ? doc.t("presentsOne", { name: names[0] })
      : names.length <= 4 ? doc.t("presents", { names: `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` })
        : doc.t("presentsGroup", { count: names.length });
  const range = model.firstDay
    ? model.firstDay === model.lastDay ? doc.day(model.firstDay) : doc.t("range", { from: doc.day(model.firstDay), to: doc.day(model.lastDay) })
    : null;
  return (
    <section className="xd-cover">
      <p className="xd-eyebrow">{eyebrow}</p>
      <h1 className="xd-cover-title" style={{ fontSize: `min(${size}px, calc((100vw - 40px) / ${(longest * 0.7).toFixed(2)}))` }}>
        {lines.map((line, index) => (
          <span key={index} className={index === 0 ? undefined : `xd-ink ${tone(COVER_COLORS[(index - 1) % COVER_COLORS.length])}`}>{line}</span>
        ))}
      </h1>
      <p className="xd-cover-lede">{challenge.description?.trim() || doc.t("coverLede", { title: challenge.title })}</p>
      {range ? <p className="xd-eyebrow" style={{ marginTop: "6mm" }}>{range}</p> : null}
      <div className="xd-ribbon" aria-hidden="true">
        {RIBBON.map((width, index) => <span key={index} className={tone(DOC_COLORS[index])} style={{ width: `${width}%` }} />)}
      </div>
      {model.people.length ? (
        <div className={`xd-people${model.people.length > 4 ? " is-many" : ""}`}>
          {model.people.slice(0, 6).map((person) => <PersonCard key={person.key} person={person} model={model} doc={doc} />)}
        </div>
      ) : null}
      <div className="xd-stats">
        {model.stats.map((stat) => <StatBlock key={stat.kind} stat={stat} doc={doc} />)}
      </div>
    </section>
  );
}

function PersonCard({ person, model, doc }: { person: DocPerson; model: ExportModel; doc: Doc }) {
  const parts = [
    model.hasRecommenders && person.recommendedCount ? doc.t("recommendedCount", { count: person.recommendedCount }) : null,
    doc.t("entryCount", { count: person.entryCount }),
    person.ratingAvg !== null ? doc.t("average", { value: doc.n(person.ratingAvg) }) : null,
  ].filter(Boolean);
  return (
    <div className={`xd-person ${tone(person.color)}`}>
      <strong>{person.name}</strong>
      <p>{parts.join(" · ")}</p>
    </div>
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

function fieldHint(field: ChallengeField, doc: Doc): string {
  switch (field.type) {
    case "rating": return doc.t("fieldType.rating", { min: field.config?.min ?? 0, max: field.config?.max ?? 5 });
    case "select": {
      const options = (field.config?.options ?? []).filter((option) => !option.archived).map((option) => option.label);
      return options.length ? doc.t("fieldType.select", { options: options.join(" · ") }) : doc.t("fieldType.text");
    }
    default: return doc.t(`fieldType.${field.type}`);
  }
}

function HowItWorks({ challenge, model, doc }: { challenge: ChallengeDetail; model: ExportModel; doc: Doc }) {
  const rules = challenge.ruleSections ?? [];
  // A legend alone is too little for a page of its own — the next section follows right under it.
  return (
    <section className={rules.length ? "xd-page" : "xd-page xd-legend-band"}>
      {rules.length ? (
        <>
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
        </>
      ) : null}
      {model.legend.length ? (
        <div className={rules.length ? "xd-section-gap" : undefined}>
          <h2 className="xd-h2">{doc.t("legendTitle")}</h2>
          <p className="xd-lede">{doc.t("legendLede")}</p>
          <div className="xd-legend">
            {model.legend.map((type) => (
              <div className="xd-legend-card" key={type.id}>
                <h3>{type.name}</h3>
                <ul>
                  {type.fields.map((field) => (
                    <li key={field.id ?? field.key}><b>{field.label}</b> <span>{fieldHint(field, doc)}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ItemCard({ item, chapter, model, doc, people, showWhen }: {
  item: DocItem; chapter: DocChapter; model: ExportModel; doc: Doc; people: Map<string, DocPerson>; showWhen: boolean;
}) {
  const multiPeople = model.people.length > 1;
  const types = new Set(item.entries.map((entry) => entry.typeName));
  const recommender = item.recommender;
  const by = recommender ? (
    <div className={`xd-by ${tone(people.get(recommender.personKey ?? "")?.color ?? chapter.color)}`}>
      <span>{doc.t("recommendedBy")}</span>
      <strong>{recommender.name.split(" ")[0]}</strong>
    </div>
  ) : null;
  const number = <span className="xd-num">{String(item.number).padStart(2, "0")}</span>;
  const meta = item.subtitle || item.meta.length ? <p>{[item.subtitle, ...item.meta].filter(Boolean).join(" · ")}</p> : null;
  // Nothing logged yet: the title and a line saying so — no empty tiles.
  if (!item.entries.length && !item.progress.length) {
    return (
      <article className={`xd-card is-empty ${tone(chapter.color)}`}>
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
    <article className={`xd-card ${tone(chapter.color)}${long ? " is-long" : ""}`}>
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
        {item.entries.map((entry) => {
          const person = people.get(entry.personKey);
          return (
            <div className={`xd-row ${tone(person?.color)}`} key={entry.id}>
              <dt>{person?.name ?? "—"}</dt>
              <dd><EntryBody entry={entry} doc={doc} showType={types.size > 1} /></dd>
            </div>
          );
        })}
        {item.progress.map((row) => {
          const person = people.get(row.personKey);
          return (
            <div className={`xd-row ${tone(person?.color)}`} key={`progress-${row.personKey}`}>
              <dt>{person?.name ?? "—"}{row.label ? <small>{row.label}</small> : null}</dt>
              <dd>
                <div className="xd-points">
                  {row.points.map((point, index) => (
                    <span className="xd-point" key={index}><span>{doc.day(point.day, { day: "numeric", month: "short" })} · </span>{point.text}</span>
                  ))}
                </div>
                {row.total !== null && row.points.length > 1 ? <p className="xd-total">{doc.t("total", { value: doc.n(row.total) })}</p> : null}
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
  const labelled = model.chapters.length > 1;
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("itemsTitle")}</h2>
      <p className="xd-lede">{doc.t("itemsLede", { items: itemCount, chapters: labelled ? model.chapters.length : 0 })}</p>
      {model.chapters.map((chapter, index) => (
        <div key={chapter.index}>
          {labelled || chapter.title ? (
            <div className={`xd-chapter ${tone(chapter.color)}${index === 0 ? " xd-first-chapter" : ""}`}>
              <h3>{doc.t("chapter", { n: index + 1 })}{chapter.title ? ` · ${chapter.title}` : ""}</h3>
              {chapter.subtitle ? <p>{chapter.subtitle}</p> : null}
            </div>
          ) : <div style={{ height: "4mm" }} />}
          {chapter.items.map((item) => <ItemCard key={item.id} item={item} chapter={chapter} model={model} doc={doc} people={people} showWhen={showWhen} />)}
        </div>
      ))}
    </section>
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
      {model.diary.map((month, monthIndex) => {
        const color = DOC_COLORS[monthIndex % (DOC_COLORS.length - 1)];
        const logged = new Map(month.days.map((row) => [row.day, row.personKeys]));
        const written = month.entries.filter((entry) => entry.values.length || entry.children.length);
        return (
          <div className={`xd-month ${tone(color)}`} key={month.month || "undated"}>
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
                    const keys = logged.get(day);
                    const first = keys ? people.get(keys[0]) : undefined;
                    const second = keys && keys.length > 1 ? people.get(keys[1]) : undefined;
                    const style = (first && multiPeople ? { "--c": `var(--xd-${first.color})`, "--c2": second ? `var(--xd-${second.color})` : undefined } : undefined) as CSSProperties | undefined;
                    return <i key={index} className={keys ? `on${second ? " many" : ""}` : undefined} style={style}>{Number(day.slice(8))}</i>;
                  })}
                </div>
              ) : <div />}
              <ol className="xd-timeline">
                {written.map((entry) => {
                  const person = people.get(entry.personKey);
                  return (
                    <li className="xd-day" key={entry.id}>
                      <div className="xd-day-date">
                        {entry.day ? <><b>{Number(entry.day.slice(8))}</b><span>{doc.day(entry.day, { weekday: "short" }).replace(".", "")}</span></> : <b>·</b>}
                      </div>
                      <div className={tone(person?.color)}>
                        {multiPeople ? <p className="xd-who">{person?.name}</p> : null}
                        <EntryBody entry={{ ...entry, day: null }} doc={doc} showType={false} />
                        {entry.children.length ? (
                          <table className="xd-sets">
                            <tbody>
                              {entry.children.map((child) => (
                                <tr key={child.id}>
                                  <td>{child.itemTitle ?? child.typeName}</td>
                                  <td>{child.values.filter((value) => !value.long).map((value) => `${value.label} ${answerText(value, doc)}`).join(" · ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {!written.length ? <li className="xd-empty">{doc.t("onlyMarks")}</li> : null}
              </ol>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Scoreboard({ model, doc }: { model: ExportModel; doc: Doc }) {
  const items = model.chapters.flatMap((chapter) => chapter.items.map((item) => ({ item, chapter })));
  const raters = model.people.filter((person) => person.ratingAvg !== null).slice(0, 4);
  const perPerson = raters.length > 1;
  const showYear = items.some(({ item }) => item.year);
  const showBy = model.hasRecommenders;
  const colorOf = (item: DocItem | null) => (item ? model.chapters.find((chapter) => chapter.index === item.chapter)?.color : undefined);
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("scoreboardTitle")}</h2>
      <p className="xd-lede">{doc.t(model.hasRatings ? "scoreboardLede" : "scoreboardLedePlain")}</p>
      <div className="xd-table-wrap">
        <table className="xd-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{doc.t("col.item")}</th>
              {showYear ? <th>{doc.t("col.year")}</th> : null}
              {showBy ? <th>{doc.t("recommendedBy")}</th> : null}
              {model.hasRatings && perPerson ? raters.map((person) => <th className={`score ${tone(person.color)}`} style={{ color: "var(--c)" }} key={person.key}>{person.name.split(" ")[0]}</th>) : null}
              {model.hasRatings ? <th className="score">{doc.t(perPerson ? "col.avg" : "col.rating")}</th> : <th className="score">{doc.t("col.entries")}</th>}
              <th>{doc.t("col.date")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ item, chapter }) => (
              <tr key={item.id} className={tone(chapter.color)}>
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
                <td className="small muted">{item.lastDay ? doc.day(item.lastDay, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {model.hasRatings ? (
        <div className="xd-podium">
          <div className={tone(colorOf(model.champion))}>
            <span>{doc.t("champion")}</span>
            <b>{model.champion?.title ?? "—"}</b>
            {model.champion?.ratingAvg != null ? <small>{doc.n(model.champion.ratingAvg)}/{model.ratingMax}</small> : null}
          </div>
          <div className={tone(colorOf(model.disappointment))}>
            <span>{doc.t("disappointment")}</span>
            <b>{model.disappointment?.title ?? "—"}</b>
            {model.disappointment?.ratingAvg != null ? <small>{doc.n(model.disappointment.ratingAvg)}/{model.ratingMax}</small> : null}
          </div>
          <div>
            <span>{doc.t("overall")}</span>
            <b>{model.overallAvg !== null ? doc.n(model.overallAvg) : "—"}</b>
            <small>{doc.t("ratingsCount", { count: items.reduce((sum, { item }) => sum + item.ratings.length, 0) })}</small>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Records({ model, doc }: { model: ExportModel; doc: Doc }) {
  return (
    <section className="xd-page">
      <h2 className="xd-h2">{doc.t("recordsTitle")}</h2>
      <p className="xd-lede">{doc.t("recordsLede")}</p>
      <div className="xd-table-wrap">
        <table className="xd-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{doc.t("col.item")}</th>
              <th className="score">{doc.t("col.sessions")}</th>
              <th>{doc.t("col.best")}</th>
              <th>{doc.t("col.date")}</th>
            </tr>
          </thead>
          <tbody>
            {model.records.map((record, index) => (
              <tr key={record.itemId} className={tone(DOC_COLORS[record.chapter % (DOC_COLORS.length - 1)])}>
                <td className="num">{String(index + 1).padStart(2, "0")}</td>
                <td className="title">{record.title}</td>
                <td className="score">{doc.n(record.sessions)}</td>
                <td className="small">{record.bests.map((best) => `${best.label} ${doc.n(best.value)}`).join(" · ") || "—"}</td>
                <td className="small muted">{record.lastDay ? doc.day(record.lastDay, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</td>
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
  const [showWhen, setShowWhen] = useState(true);
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
    rules: Boolean(challenge.ruleSections?.length || model.legend.length),
    items: !model.sessionMode && model.chapters.length > 0,
    diary: model.diary.length > 0,
    scoreboard: model.sessionMode ? model.records.length > 0 : model.chapters.length > 0,
  };
  const [hidden, setHidden] = useState<Set<Section>>(new Set());
  const shown = (section: Section) => available[section] && !hidden.has(section);
  const toggle = (section: Section) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

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
          {shown("cover") ? <Cover challenge={challenge} model={model} doc={doc} /> : null}
          {shown("rules") ? <HowItWorks challenge={challenge} model={model} doc={doc} /> : null}
          {shown("items") ? <Items model={model} doc={doc} people={people} showWhen={showWhen} /> : null}
          {shown("diary") ? <Diary model={model} doc={doc} people={people} /> : null}
          {shown("scoreboard") ? (model.sessionMode ? <Records model={model} doc={doc} /> : <Scoreboard model={model} doc={doc} />) : null}
          <p className="xd-colophon">{doc.t("colophon", { date: doc.day(dateKeyInSaoPaulo(new Date())) })}</p>
        </article>
      </div>
    </div>
  );
}
