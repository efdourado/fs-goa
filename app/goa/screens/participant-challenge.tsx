"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useGoaFormat } from "../format";
import { MetricBlock } from "../metrics-view";
import { RuleSectionsView, visibleRuleSections } from "../rules";
import type {
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  Entry,
  EntryTypeView,
  FieldConfig,
  Id,
  Metric,
  ParticipantTab,
  User,
} from "../types";
import {
  backLinkClass,
  Button,
  cardClass,
  ChallengeStatusBadge,
  cx,
  EmptyState,
  inputClass,
  labelClass,
  StatusMessage,
} from "../ui";
import {
  dateKeyInSaoPaulo,
  findMissingRequiredField,
  formatRuntime,
  isChallengeScheduled,
  isEmptySaveADelete,
  isLivingList,
  itemIdForEntry,
  metricHasData,
  metricTheme,
  participantsSentence,
  valuesAsRecord,
} from "../utils";

function ratingChoices(config?: FieldConfig): number[] {
  const min = config?.min ?? 0;
  const max = config?.max ?? 5;
  const step = config?.step && config.step > 0 ? config.step : 0.5;
  const count = Math.min(41, Math.floor((max - min) / step) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => Number((min + index * step).toFixed(4)));
}

/**
 * On desktop this is one clean row of equal pills (`sm:grid-cols-11`). On a phone
 * an odd count would wrap into a lopsided 6-over-5, so it becomes a single
 * horizontal snap-scroller of same-size pills, pre-scrolled to the current pick.
 * Tapping the already-picked pill clears it — the field goes blank, same as
 * never having answered, which on a required field lets a re-save delete the
 * entry instead of needing a separate delete button.
 */
function RatingField({
  id,
  field,
  value,
  disabled,
  ariaLabel,
  onPick,
}: {
  id: string;
  field: ChallengeField;
  value: unknown;
  disabled: boolean;
  ariaLabel: (rating: string) => string;
  onPick: (rating: number | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <div
      ref={scroller}
      id={id}
      tabIndex={-1}
      className="flex w-full min-w-0 snap-x gap-1.5 overflow-x-auto pb-2 sm:grid sm:grid-cols-11 sm:overflow-visible sm:pb-0 [scrollbar-width:thin]"
    >
      {ratingChoices(field.config).map((rating) => {
        // `Number(null)` and `Number("")` are both 0 — without this guard, a
        // cleared field wrongly re-lights the "0" pill instead of showing
        // nothing picked.
        const picked = value !== null && value !== undefined && value !== "" && Number(value) === rating;
        const text = String(rating).replace(".", ",");
        return (
          <button
            key={rating}
            type="button"
            aria-pressed={picked}
            aria-label={ariaLabel(text)}
            disabled={disabled}
            onClick={() => onPick(picked ? null : rating)}
            className={cx(
              "h-10 w-10 flex-none snap-center rounded-xl border text-sm font-light tabular-nums sm:h-11 sm:w-auto sm:text-xs",
              picked
                ? "border-[var(--main)] bg-[var(--main)] text-white"
                : "border-transparent bg-[var(--wash)] hover:border-[var(--main-line)]",
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function ChevronGlyph({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx(className ?? "h-3 w-3", "transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/** A small bordered pill for a secondary action — deliberately more present than an underlined word. */
const actionChipClass =
  "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const ghostChipClass = "border-transparent bg-[var(--wash)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

export function DynamicEntryForm({
  fields,
  item,
  entry,
  canEdit,
  unavailableMessage,
  dateField,
  onSave,
  onDelete,
  alwaysEditable = false,
}: {
  fields: ChallengeField[];
  item: ChallengeItem | null;
  entry?: Entry;
  canEdit: boolean;
  unavailableMessage?: string | null;
  // An "when did it happen" date that rides with the optional fields — blank
  // means the entry is saved without a date. Owned by the caller.
  dateField?: { label: string; hint: string; value: string; max: string; onChange: (value: string) => void };
  onSave: (values: Record<Id, unknown>, entry?: Entry) => Promise<void>;
  // Present only when this form is editing a saved entry the viewer may
  // remove. There is no delete button: clearing a required field (e.g.
  // tapping the already-picked rating again) and submitting calls this
  // instead of blocking with a "fill this in" error.
  onDelete?: () => Promise<void>;
  // Admin correction always wants the live form, never the read-only summary —
  // that IS the point of that screen. The participant's Today tab leaves this
  // false: an already-answered checkpoint shows a quiet summary instead of a
  // save button and a delete link sitting there forever.
  alwaysEditable?: boolean;
}) {
  const t = useTranslations("entryForm");
  const tp = useTranslations("participant");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [values, setValues] = useState<Record<Id, unknown>>(() => entry ? valuesAsRecord(entry.values) : {});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // An already-answered checkpoint opens as a summary; editing is opt-in.
  const [editing, setEditing] = useState(alwaysEditable || !entry);

  function formatFieldValue(field: ChallengeField, value: unknown): string {
    if (value === undefined || value === null || value === "") return t("emptyValue");
    if (field.type === "boolean") return value === true ? tc("yes") : value === false ? tc("no") : t("emptyValue");
    if (field.type === "date" && typeof value === "string") return f.date(value);
    if (field.type === "select") {
      const option = field.config?.options?.find((candidate) => (candidate.id ?? candidate.value ?? candidate.label) === value);
      return option?.label ?? String(value);
    }
    if (field.type === "rating" && typeof value === "number") return String(value).replace(".", ",");
    return String(value);
  }

  const optionalFields = fields.filter((field) => field.id && !field.required);
  const isBlank = (value: unknown) => value === undefined || value === null || value === "";
  const optionalCount = optionalFields.length + (dateField ? 1 : 0);
  const hasFilledOptional = optionalFields.some((field) => field.id && !isBlank(values[field.id]))
    || Boolean(dateField?.value);
  // Optional fields (e.g. "Nota do livro") stay tucked away so nobody feels
  // nudged to rate a book they have not finished. Auto-open once one is filled.
  const [showOptional, setShowOptional] = useState(hasFilledOptional || !canEdit);

  function setValue(field: ChallengeField, value: unknown) {
    if (!field.id) return;
    setValues((current) => ({ ...current, [field.id as Id]: value }));
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = findMissingRequiredField(fields, values);
    if (missing) {
      // No separate delete button: clearing the required answer (e.g. tapping
      // the already-picked rating again) and saving removes the entry — the
      // same intent, without an extra control sitting on screen at all times.
      if (isEmptySaveADelete(missing, Boolean(entry), Boolean(onDelete))) {
        setDeleting(true);
        setError(null);
        try {
          await onDelete!();
        } catch (cause) {
          setError(f.error(cause));
          setDeleting(false);
        }
        return;
      }
      setError(t("fillField", { label: missing.label }));
      document.getElementById(`entry-field-${missing.id}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(values, entry);
      setSuccess(entry ? t("entryUpdated") : t("entrySaved"));
      if (!alwaysEditable) setEditing(false);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!fields.length) {
    return <EmptyState title={t("notConfiguredTitle")} description={t("notConfiguredBody")} />;
  }

  if (entry && canEdit && !editing) {
    const answered = fields.filter((field) => field.id && !isBlank(values[field.id]));
    const shown = answered.length ? answered : fields.slice(0, 1);
    return (
      <button
        type="button"
        className="w-full cursor-pointer rounded-2xl bg-[var(--wash)] p-4 text-left transition hover:bg-[var(--wash-strong)] sm:p-5"
        onClick={() => setEditing(true)}
      >
        <dl className="space-y-3">
          {shown.map((field) => (
            <div key={field.id}>
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-[var(--muted)]">{field.label}</dt>
              <dd className="mt-0.5 text-sm leading-6 whitespace-pre-wrap">{field.id ? formatFieldValue(field, values[field.id]) : t("emptyValue")}</dd>
            </div>
          ))}
        </dl>
        {item?.dueAt ? <p className="mt-4 text-center text-xs text-[var(--muted)]">{t("dueAt", { date: f.dateTime(item.dueAt) })}</p> : null}
      </button>
    );
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {fields.map((field) => {
        if (!field.id) return null;
        if (!field.required && !showOptional) return null;
        const id = `entry-field-${field.id}`;
        const value = values[field.id];
        return (
          <div key={field.id}>
            <label className={labelClass} htmlFor={field.type === "rating" || field.type === "boolean" ? undefined : id}>{field.label}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={t("required")}>*</span> : <small className="ml-2 font-light text-[var(--muted)]">{t("optional")}</small>}</label>
            {field.type === "text" && field.config?.multiline ? <textarea id={id} className={inputClass} rows={4} value={String(value ?? "")} maxLength={field.config.maxLength} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "text" && !field.config?.multiline ? <input id={id} className={inputClass} value={String(value ?? "")} maxLength={field.config?.maxLength} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "number" ? <input id={id} className={inputClass} type="number" inputMode="decimal" min={field.config?.min} max={field.config?.max} step={field.config?.step ?? "any"} value={typeof value === "number" || typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value === "" ? "" : Number(event.target.value))} /> : null}
            {field.type === "date" ? <input id={id} className={inputClass} type="date" value={typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "select" ? <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)}><option value="">{t("select")}</option>{(field.config?.options ?? []).map((option) => <option value={option.id ?? option.value ?? option.label} key={option.id ?? option.value ?? option.label}>{option.label}</option>)}</select> : null}
            {field.type === "boolean" ? <div id={id} className="grid grid-cols-2 gap-2" tabIndex={-1}>{[{ label: tc("yes"), value: true }, { label: tc("no"), value: false }].map((option) => <button className={cx("min-h-12 rounded-xl border text-sm font-light", value === option.value ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={value === option.value} disabled={!canEdit || busy} onClick={() => setValue(field, option.value)} key={option.label}>{option.label}</button>)}</div> : null}
            {field.type === "rating" ? <RatingField id={id} field={field} value={value} disabled={!canEdit || busy} ariaLabel={(rating) => t("ratingAria", { rating })} onPick={(rating) => setValue(field, rating)} /> : null}
          </div>
        );
      })}
      {dateField && showOptional ? (
        <div>
          <label className={labelClass} htmlFor="entry-occurred-on">{dateField.label}<small className="ml-2 font-light text-[var(--muted)]">{t("optional")}</small></label>
          <input id="entry-occurred-on" className={inputClass} type="date" max={dateField.max} value={dateField.value} disabled={!canEdit || busy} onChange={(event) => dateField.onChange(event.target.value)} />
          <small className="mt-1 block text-[var(--muted)]">{dateField.hint}</small>
        </div>
      ) : null}
      {optionalCount && canEdit ? (
        <button type="button" className={cx(actionChipClass, ghostChipClass)} onClick={() => setShowOptional((open) => !open)}>
          <ChevronGlyph open={showOptional} />
          {showOptional ? t("hideOptional") : t("showOptional", { count: optionalCount })}
        </button>
      ) : null}
      <StatusMessage error={error} success={success} />
      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="w-full sm:flex-1" disabled={busy || deleting}>{deleting ? tp("deletingEntry") : busy ? tc("saving") : entry ? tc("saveChanges") : t("saveEntry")}<span aria-hidden="true">→</span></Button>
          {entry && !alwaysEditable ? <Button type="button" variant="secondary" className="w-full sm:flex-1" disabled={busy || deleting} onClick={() => setEditing(false)}>{tc("cancel")}</Button> : null}
        </div>
      ) : <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage ?? t("readOnly")}</p>}
      {item?.dueAt ? <p className="text-center text-xs text-[var(--muted)]">{t("dueAt", { date: f.dateTime(item.dueAt) })}</p> : null}
    </form>
  );
}

/** Rankings past this length fold behind a "show more" toggle. */
const RANKING_PREVIEW_ROWS = 8;

/**
 * A ranking metric with a nicer, sortable presentation than `MetricBlock`:
 * sort by rating or by name, and optionally reveal who recommended each item
 * and its release year. When the metric's value is a bayesian-adjusted
 * average, the plain average shows alongside it in parentheses — the "here's
 * the math" the raw number came from, no separate override.
 */
function RankingCard({
  metric,
  hideThinLabel,
  smallSampleLabel,
  showMoreLabel,
  showLessLabel,
}: {
  metric: Metric;
  hideThinLabel: boolean;
  smallSampleLabel: string;
  showMoreLabel: (hiddenCount: number) => string;
  showLessLabel: string;
}) {
  const t = useTranslations("resultView");
  const [sort, setSort] = useState<"rating" | "name">("rating");
  const [showRecommender, setShowRecommender] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const series = metric.series;
  const sorted = useMemo(
    () => [...(series ?? [])].sort((a, b) => (sort === "name"
      ? a.label.localeCompare(b.label)
      : (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY))),
    [series, sort],
  );
  const visible = expanded ? sorted : sorted.slice(0, RANKING_PREVIEW_ROWS);
  const hasRecommenders = series?.some((row) => row.recommendedBy) ?? false;

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          <label className="flex cursor-pointer items-center gap-1"><input type="radio" name={`ranking-sort-${metric.id}`} checked={sort === "rating"} onChange={() => setSort("rating")} />{t("sortByRating")}</label>
          <label className="flex cursor-pointer items-center gap-1"><input type="radio" name={`ranking-sort-${metric.id}`} checked={sort === "name"} onChange={() => setSort("name")} />{t("sortByName")}</label>
          {hasRecommenders ? <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={showRecommender} onChange={(event) => setShowRecommender(event.target.checked)} />{t("showRecommender")}</label> : null}
        </div>
      </div>
      <ol className="mt-3 space-y-1.5">
        {visible.map((row, index) => {
          const thin = row.value === null;
          const meta = showRecommender && row.recommendedBy ? t("recommendedByShort", { name: row.recommendedBy }) : null;
          return (
            <li key={row.key} className={cx("flex items-center justify-between gap-3 text-sm", thin && "opacity-45")}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate">{row.label}{row.year ? ` (${row.year})` : ""}</span>
                  {meta ? <span className="block truncate text-[11px] text-[var(--muted)]">{meta}</span> : null}
                </span>
              </span>
              <span className="flex-none text-right tabular-nums">
                <strong>{thin ? (hideThinLabel ? row.formattedValue ?? "—" : smallSampleLabel) : row.formattedValue ?? row.value}</strong>
                {!thin && row.rawFormattedValue && row.rawFormattedValue !== row.formattedValue ? (
                  <span className="ml-1.5 text-[10px] font-light text-[var(--muted)]">({row.rawFormattedValue})</span>
                ) : null}
                <span className="ml-2 text-[10px] font-light text-[var(--muted)]">n={row.sampleSize}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {sorted.length > RANKING_PREVIEW_ROWS ? (
        <button type="button" className="mt-1.5 text-xs font-light text-[var(--muted)] transition hover:text-[var(--ink)]" onClick={() => setExpanded((value) => !value)}>
          {expanded ? showLessLabel : showMoreLabel(sorted.length - RANKING_PREVIEW_ROWS)}
        </button>
      ) : null}
    </article>
  );
}

export function ResultView({
  challenge,
  onBackToEntry,
  hideCompletionRate = false,
}: {
  challenge: ChallengeDetail;
  /** When the round is still open with nothing to show yet, offer a way back to logging. */
  onBackToEntry?: () => void;
  /** The participant tab shows a dedicated "completed" card, so the completion-rate metric is redundant there. */
  hideCompletionRate?: boolean;
}) {
  const t = useTranslations("resultView");
  const tm = useTranslations("metrics");
  const result = challenge.result;
  const source = result?.metrics?.length
    ? result.metrics
    : challenge.metrics.filter((metric) => metric.visibleInResults !== false);
  const metrics = source
    .filter((metric) => !hideCompletionRate || metric.operation !== "completion_rate")
    .filter(metricHasData);
  const solo = challenge.scope === "personal" || challenge.participants.length < 2;
  const hideThinLabel = solo;
  const names = solo ? [] : challenge.participants.map((participant) => participant.name);
  // Only a curated/generated headline — never fall back to the challenge title,
  // which the cover above already shows in full.
  const headline = result?.headline || null;
  const scalarMetrics = metrics.filter((metric) => !metric.series?.length);
  const seriesMetrics = metrics.filter((metric) => metric.series?.length);
  const themedSeries = (["ranking", "people", "debate"] as const)
    .map((theme) => ({ theme, items: seriesMetrics.filter((metric) => metricTheme(metric) === theme) }))
    .filter((group) => group.items.length);
  return (
    <div className="space-y-5">
      {headline || result?.summary || names.length ? (
        <header className="space-y-3">
          {headline ? <h2 className="max-w-3xl text-3xl font-medium leading-none tracking-[-0.045em] sm:text-4xl">{headline}</h2> : null}
          {result?.summary ? <p className="max-w-2xl text-base leading-7 text-[var(--muted)]">{result.summary}</p> : null}
          {names.length ? (
            <p className="text-sm text-[var(--muted)]">{t("participantsSentence", { names: participantsSentence(names, (count) => t("andMore", { count })) })}</p>
          ) : null}
        </header>
      ) : null}
      {metrics.length ? (
        <div className="space-y-5" aria-label={t("numbersAria")}>
          {scalarMetrics.length ? (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scalarMetrics.map((metric) => (
                <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} hideThinLabel={hideThinLabel} showMoreLabel={(count) => tm("showMore", { count })} showLessLabel={tm("showLess")} />
              ))}
            </section>
          ) : null}
          {themedSeries.map(({ theme, items }) => (
            <section key={theme} className="space-y-3">
              {themedSeries.length > 1 ? <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">{t(`theme.${theme}`)}</h3> : null}
              <div className="space-y-3">
                {items.map((metric) => (
                  theme === "ranking"
                    ? <RankingCard key={metric.id} metric={metric} hideThinLabel={hideThinLabel} smallSampleLabel={tm("smallSample")} showMoreLabel={(count) => tm("showMore", { count })} showLessLabel={tm("showLess")} />
                    : <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} hideThinLabel={hideThinLabel} showMoreLabel={(count) => tm("showMore", { count })} showLessLabel={tm("showLess")} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : onBackToEntry ? (
        <EmptyState title={t("liveEmptyTitle")} description={t("liveEmptyBody")} action={<Button onClick={onBackToEntry}>{t("backToEntry")}</Button>} />
      ) : <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />}
      {result?.comments?.length ? (
        <section className={cx(cardClass, "p-6 sm:p-8")}><h2 className="text-xl font-light">{t("momentsTitle")}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{result.comments.map((comment) => <blockquote className="rounded-2xl bg-[var(--wash)] p-5" key={comment.id}><p className="text-sm leading-6">“{comment.text}”</p><footer className="mt-3 text-xs font-light text-[var(--muted)]">{comment.authorName ?? t("participantFallback")}{comment.itemTitle ? ` · ${comment.itemTitle}` : ""}</footer></blockquote>)}</div></section>
      ) : null}
    </div>
  );
}

/** The entry types a round item can receive (expectation, rating, progress…). */
export function itemEntryTypes(challenge: ChallengeDetail): EntryTypeView[] {
  if (challenge.entryTypes.length) {
    // Expectation is a pre-watch note — always render it first, above the rating.
    return challenge.entryTypes
      .filter((type) => type.targetPolicy !== "none")
      .sort((a, b) => Number(b.purpose === "expectation") - Number(a.purpose === "expectation"));
  }
  // Legacy detail payload without `entryTypes` — reconstruct from the flat fields.
  return challenge.submissionMode === "item" && challenge.fields.length
    ? [{
        id: "",
        name: "",
        semanticKey: "registro",
        purpose: "rating",
        submissionMode: "item",
        targetPolicy: "required",
        cardinality: "once_per_item",
        schedulePolicy: "while_active",
        isPrimary: true,
        fields: challenge.fields,
      }]
    : [];
}

/**
 * One item, one or more forms. Cine Curadoria stacks an "Expectativa" form (which
 * locks once the film is rated) above the "Avaliação"; a reading club stacks
 * progress / completion / rating. A plain Cine round renders a single form.
 */
function GroupRatings({ ratings }: { ratings: Array<{ id: Id; name: string; value: number }> }) {
  const t = useTranslations("participant");
  const nf = useFormatter();
  return (
    <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--wash)]/50 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">{t("groupRatingsTitle")}</p>
      {ratings.length ? (
        <ul className="mt-2 space-y-1">
          {ratings.map((rating) => (
            <li className="flex items-center justify-between gap-3 text-sm" key={rating.id}>
              <span className="truncate font-light">{rating.name}</span>
              <span className="flex-none font-medium tabular-nums">{nf.number(rating.value, { maximumFractionDigits: 1 })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted)]">{t("groupRatingsEmpty")}</p>
      )}
    </div>
  );
}

function ItemEntryPanel({
  challenge,
  item,
  ownEntries,
  groupRatings,
  occurredOn,
  onOccurredOnChange,
  offerOptionalDate,
  today,
  unavailableMessage,
  canEdit,
  checkpointId,
  onSaveEntry,
  onDeleteEntry,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  ownEntries: Entry[];
  // Other participants' ratings for this item — `null` on a solo challenge,
  // where there is no group to compare against.
  groupRatings: Array<{ id: Id; name: string; value: number }> | null;
  // "" when the participant left the (optional) date blank; `today` is the
  // fallback for the day-keyed forms that still require one.
  occurredOn: string;
  onOccurredOnChange: (value: string) => void;
  // When a prominent date picker is already on screen (a per-day round), the
  // per-form optional date is skipped so there is only one control.
  offerOptionalDate: boolean;
  today: string;
  unavailableMessage: string | null;
  canEdit: boolean;
  // The session this item is being logged against — "filme X na sessão Y".
  checkpointId?: Id | null;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string | null, entryTypeId?: Id, checkpointId?: Id | null) => Promise<void>;
  // Present only while the round is active and the viewer may remove entries.
  onDeleteEntry?: (entryId: Id) => Promise<void>;
}) {
  const t = useTranslations("participant");
  const tv = useTranslations("visibility");
  const types = itemEntryTypes(challenge);
  const ratingTypeId = types.find((type) => type.purpose === "rating")?.id;
  const stacked = types.length > 1;
  return (
    <div className={stacked ? "space-y-8" : undefined}>
      {types.map((type) => {
        const perDay = type.cardinality === "once_per_item_day";
        const entry = ownEntries.find((candidate) =>
          itemIdForEntry(candidate) === item.id
          && (candidate.entryTypeId ?? "") === type.id
          && (!perDay || candidate.occurredOn === (occurredOn || today)));
        const rated = ratingTypeId
          ? ownEntries.some((candidate) => itemIdForEntry(candidate) === item.id && candidate.entryTypeId === ratingTypeId)
          : false;
        const locked = type.purpose === "expectation" && rated;
        // A first plain-round entry may carry a date; day-keyed forms take it
        // from the picker above, an expectation is pre-watch, and once an entry
        // exists the date is fixed.
        const offersDate = offerOptionalDate && !perDay && !entry && canEdit && !locked && type.purpose !== "expectation";
        return (
          <div key={type.id || "registro"}>
            {stacked ? <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{type.name}</h3> : null}
            {/* Always spell out who will see this answer, before the first submit (V1 §8). */}
            <p className="mb-3 rounded-lg bg-[var(--wash)] px-3 py-2 text-xs text-[var(--muted)]">{tv(`note.${type.visibilityPolicy ?? "group_realtime"}`)}</p>
            <DynamicEntryForm
              key={`${type.id}-${item.id}-${perDay ? occurredOn || today : "fixed"}-${entry?.id ?? "new"}`}
              fields={type.fields}
              item={item}
              entry={entry}
              canEdit={canEdit && !locked}
              unavailableMessage={locked ? t("expectationLocked") : unavailableMessage}
              dateField={offersDate ? { label: t("occurredOnLabel"), hint: t("occurredOnOptionalHint"), value: occurredOn, max: today, onChange: onOccurredOnChange } : undefined}
              onSave={(values, saved) => onSaveEntry(
                item.id,
                values,
                saved,
                saved ? undefined : perDay ? occurredOn || today : offersDate ? occurredOn || null : undefined,
                type.id || undefined,
                type.schedulePolicy === "checkpoint" ? checkpointId ?? null : undefined,
              )}
              onDelete={entry && onDeleteEntry ? () => onDeleteEntry(entry.id) : undefined}
            />
            {groupRatings && type.purpose === "rating" ? <GroupRatings ratings={groupRatings} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The "which one am I filling?" list in the sidebar — a stack of tappable rows
 * with a numbered chip that flips to a checkmark once the entry is in. Replaces a
 * bare `<select>` so progress reads at a glance on both phone and desktop.
 */
interface PickerOption {
  id: Id;
  label: string;
  done?: boolean;
  soon?: boolean;
  statusLabel?: string;
  /** The rating this participant gave the item, shown at the end of the row. */
  rating?: number | null;
}

function EntryPicker({
  title,
  tally,
  options,
  selectedId,
  onSelect,
}: {
  title: string;
  tally?: string;
  options: PickerOption[];
  selectedId: Id | null;
  onSelect: (id: Id) => void;
}) {
  const nf = useFormatter();
  return (
    <section className={cx(cardClass, "p-4 sm:p-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-light">{title}</h2>
        {tally ? <span className="text-xs text-[var(--muted)]">{tally}</span> : null}
      </div>
      <ol className="mt-3 max-h-[21rem] space-y-1.5 overflow-y-auto pr-0.5">
        {options.map((option, index) => {
          const active = option.id === selectedId;
          const rating = typeof option.rating === "number" ? option.rating : null;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={option.soon}
                aria-pressed={active}
                aria-label={`${index + 1}. ${option.label}${option.statusLabel ? ` — ${option.statusLabel}` : ""}`}
                onClick={() => onSelect(option.id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-45",
                  active
                    ? "border-[var(--main)] bg-[var(--main-soft)]"
                    : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]",
                )}
              >
                <span
                  className={cx(
                    "grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-medium tabular-nums",
                    option.done
                      ? "bg-[var(--ok)] text-white"
                      : active
                        ? "bg-[var(--main)] text-white"
                        : "bg-[var(--wash)] text-[var(--muted)]",
                  )}
                >
                  {option.done ? <CheckGlyph /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-sm", active ? "font-medium text-[var(--main-strong)]" : "font-light")}>{option.label}</span>
                  {option.statusLabel ? (
                    <span className={cx("text-[11px]", option.done ? "text-[var(--ok)]" : "text-[var(--muted)]")}>{option.statusLabel}</span>
                  ) : null}
                </span>
                {rating !== null ? (
                  <span className="flex-none text-sm font-medium tabular-nums text-[var(--ink)]">{nf.number(rating, { maximumFractionDigits: 1 })}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Read-only week/session view: each manual checkpoint as a card with its items,
 * a past/now/upcoming badge, and the total runtime when the items carry one.
 * Only shown for round-item challenges organised into non-daily checkpoints.
 */
function CheckpointSchedule({ challenge }: { challenge: ChallengeDetail }) {
  const t = useTranslations("participant");
  const tk = useTranslations("checkpointKind");
  const tp = useTranslations("checkpointPlanner");
  const planned = useMemo(
    () =>
      [...challenge.checkpoints]
        .filter((cp) => cp.kind && cp.kind !== "day")
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [challenge.checkpoints],
  );
  if (planned.length === 0) return null;
  const itemsByCheckpoint = new Map<Id, ChallengeItem[]>();
  for (const item of challenge.items) {
    if (!item.checkpointId) continue;
    const list = itemsByCheckpoint.get(item.checkpointId) ?? [];
    list.push(item);
    itemsByCheckpoint.set(item.checkpointId, list);
  }

  return (
    <section className="mt-5">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{tp("title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {planned.map((cp) => {
          const items = [...(itemsByCheckpoint.get(cp.id) ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          const runtime = formatRuntime(cp.totalRuntimeMinutes ?? items.reduce((sum, item) => sum + (item.catalogItem?.runtimeMinutes ?? 0), 0));
          return (
            <article
              className={cx(
                "rounded-2xl border p-4",
                cp.timeframe === "current"
                  ? "border-[var(--main)] bg-[var(--main-soft)]/40"
                  : "border-[var(--line)] bg-[var(--paper)]",
                cp.timeframe === "past" && "opacity-70",
              )}
              key={cp.id}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{cp.title}</strong>
                <span className="rounded-full bg-[var(--wash)] px-2 py-0.5 text-[10px] uppercase text-[var(--muted)]">
                  {tp(`timeframe.${cp.timeframe ?? "current"}`)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {tk(cp.kind ?? "session")}
                {runtime ? ` · ${runtime}` : ""}
              </p>
              {items.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {items.map((item) => (
                    <li className="truncate" key={item.id}>
                      {item.title}
                      {item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[var(--muted)]">{t("checkpointEmpty")}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ParticipantChallengeScreen({
  challenge,
  entries,
  user,
  tab,
  onTab,
  onBack,
  onAdmin,
  onSaveEntry,
  onDeleteEntry,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  user: User;
  tab: ParticipantTab;
  onTab: (tab: ParticipantTab) => void;
  onBack: () => void;
  onAdmin?: () => void;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string | null, entryTypeId?: Id, checkpointId?: Id | null) => Promise<void>;
  onDeleteEntry?: (entryId: Id) => Promise<void>;
}) {
  const t = useTranslations("participant");
  const trules = useTranslations("rules");
  const f = useGoaFormat();
  const longDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const ownEntries = entries.filter((entry) => !entry.userId || entry.userId === user.id);
  // Progress counts only the "done" signal — an expectation or a mid-round
  // progress note isn't a completion.
  const doneEntries = challenge.completionEntryTypeId
    ? ownEntries.filter((entry) => entry.entryTypeId === challenge.completionEntryTypeId)
    : ownEntries;
  const entriesByItem = useMemo(() => new Map(ownEntries.map((entry) => [itemIdForEntry(entry), entry])), [ownEntries]);
  // The "done" tick tracks completion only — any other entry (an expectation, a
  // half-read progress note) leaves the item still pending.
  const doneByItem = useMemo(
    () => new Set(doneEntries.map((entry) => itemIdForEntry(entry))),
    [doneEntries],
  );
  // The rating this participant gave each item (from whichever entry carries the
  // rating field) — shown at the end of every checkpoint row.
  const ratingByItem = useMemo(() => {
    const ratingFieldByType = new Map(
      challenge.entryTypes.map((type) => [type.id, type.fields.find((field) => field.type === "rating")?.id ?? null]),
    );
    const map = new Map<Id, number>();
    for (const entry of ownEntries) {
      const itemId = itemIdForEntry(entry);
      const fieldId = ratingFieldByType.get(entry.entryTypeId ?? "");
      if (!itemId || !fieldId) continue;
      const raw = valuesAsRecord(entry.values)[fieldId];
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isNaN(value)) map.set(itemId, value);
    }
    return map;
  }, [ownEntries, challenge.entryTypes]);
  // Everyone else's rating for each item — shown alongside the entry form so a
  // person can weigh their own take against the group's while filling it in,
  // not just after the round closes.
  const groupRatingsByItem = useMemo(() => {
    const ratingFieldByType = new Map(
      challenge.entryTypes.map((type) => [type.id, type.fields.find((field) => field.type === "rating")?.id ?? null]),
    );
    const map = new Map<Id, Array<{ id: Id; name: string; value: number }>>();
    for (const entry of entries) {
      if (entry.userId && entry.userId === user.id) continue;
      const itemId = itemIdForEntry(entry);
      const fieldId = ratingFieldByType.get(entry.entryTypeId ?? "");
      if (!itemId || !fieldId) continue;
      const raw = valuesAsRecord(entry.values)[fieldId];
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (Number.isNaN(value)) continue;
      const list = map.get(itemId) ?? [];
      list.push({ id: entry.userId ?? entry.id, name: entry.participantName ?? "—", value });
      map.set(itemId, list);
    }
    return map;
  }, [entries, user.id, challenge.entryTypes]);
  const sortedItems = useMemo(() => [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [challenge.items]);
  const sortedSessions = useMemo(
    () => [...(challenge.checkpoints ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [challenge.checkpoints],
  );
  // "Filme X na sessão Y" — a round whose entries carry both a round item and a
  // dated session. The session picker drives the item; a plain items-only or
  // sessions-only round never enters this branch.
  const sessionMode =
    sortedSessions.length > 0
    && sortedItems.length > 0
    && challenge.entryTypes.some((type) => type.targetPolicy !== "none" && type.schedulePolicy === "checkpoint");
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const today = dateKeyInSaoPaulo(new Date());
  // "" means the participant hasn't picked a date. The plain round form saves it
  // as-is (no date); the daily / per-day forms fall back to `today`.
  const [occurredOn, setOccurredOn] = useState("");
  const effectiveOccurredOn = occurredOn || today;
  const defaultItem = sortedItems.find((item) => item.status === "open" && !entriesByItem.has(item.id))
    ?? sortedItems.find((item) => !entriesByItem.has(item.id) && item.status !== "scheduled" && item.status !== "closed")
    ?? [...sortedItems].reverse().find((item) => entriesByItem.has(item.id))
    ?? sortedItems[0]
    ?? null;
  const [selectedItemId, setSelectedItemId] = useState<Id | null>(defaultItem?.id ?? null);
  const [selectedSessionId, setSelectedSessionId] = useState<Id | null>(null);
  const selectedSession = sessionMode
    ? sortedSessions.find((session) => session.id === selectedSessionId)
      ?? sortedSessions.find((session) => session.status === "open")
      ?? sortedSessions[0]
      ?? null
    : null;
  const selectedItem = sessionMode
    ? sortedItems.find((item) => item.checkpointId === selectedSession?.id) ?? null
    : sortedItems.find((item) => item.id === selectedItemId) ?? defaultItem;
  const currentEntry = undatedDaily
    ? ownEntries.find((entry) => entry.occurredOn === effectiveOccurredOn)
    : selectedItem
      ? entriesByItem.get(selectedItem.id)
      : ownEntries.find((entry) => !itemIdForEntry(entry));
  const completion = sortedItems.length ? Math.min(100, Math.round((doneEntries.length / sortedItems.length) * 100)) : 0;
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode);
  const livingList = isLivingList(challenge);
  const ruleSections = useMemo(
    () => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle")),
    [challenge.ruleSections, challenge.rules, trules],
  );
  const unavailableMessage = f.entryUnavailableMessage({
    challengeStatus: challenge.status,
    isParticipant: challenge.isParticipant,
    itemStatus: selectedItem?.status,
    opensAt: selectedItem?.opensAt,
  });
  const itemForms = itemEntryTypes(challenge);
  const useItemPanel = itemForms.length > 0 && !undatedDaily && Boolean(selectedItem);
  const perDayItem = itemForms.some((type) => type.cardinality === "once_per_item_day");
  // A retrospective list (Estante) has no "when" — its entry form skips the date.
  const collectsEntryDate = challenge.collectsEntryDate !== false;
  // A daily / per-day round needs a concrete date, so it gets a prominent picker.
  // A plain round instead offers the date among the entry form's optional fields.
  const dateRequired = undatedDaily || (useItemPanel && perDayItem);
  const canDeleteEntry = challenge.status === "active" ? onDeleteEntry : undefined;
  const doneCount = Math.min(doneEntries.length, sortedItems.length);
  const tabs: Array<{ id: ParticipantTab }> = [{ id: "today" }, { id: "results" }];

  // The picker on Today drives which checkpoint the form is filling; each row
  // ends with the rating this participant gave it.
  const checkpointPicker = sessionMode && sortedSessions.length > 1 ? (
    <EntryPicker
      title={t("sessionsTitle")}
      selectedId={selectedSession?.id ?? null}
      onSelect={(id) => setSelectedSessionId(id)}
      options={sortedSessions.map((session) => {
        const boundItem = sortedItems.find((item) => item.checkpointId === session.id);
        const soon = session.status === "scheduled";
        const label = boundItem?.title ?? session.title;
        return { id: session.id, label: boundItem?.catalogItem?.year ? `${label} (${boundItem.catalogItem.year})` : label, soon, statusLabel: soon ? t("checkpointSoonLabel") : undefined, rating: boundItem ? ratingByItem.get(boundItem.id) ?? null : null };
      })}
    />
  ) : sortedItems.length > 1 ? (
    <EntryPicker
      title={t("checkpointsTitle")}
      tally={t("checkpointTally", { done: doneCount, pending: Math.max(0, sortedItems.length - doneCount) })}
      selectedId={selectedItem?.id ?? null}
      onSelect={(id) => setSelectedItemId(id)}
      options={sortedItems.map((item) => {
        const done = doneByItem.has(item.id);
        const soon = item.status === "scheduled" && !entriesByItem.has(item.id);
        const label = item.catalogItem?.year ? `${item.title} (${item.catalogItem.year})` : item.title;
        return { id: item.id, label, done, soon, statusLabel: done ? t("checkpointDoneLabel") : soon ? t("checkpointSoonLabel") : undefined, rating: ratingByItem.get(item.id) ?? null };
      })}
    />
  ) : null;

  // Results shows only what's finished, with the ratings and a % complete.
  const doneItems = sortedItems.filter((item) => doneByItem.has(item.id));
  const completedCard = doneItems.length ? (
    <EntryPicker
      title={t("completedTitle")}
      tally={t("completedTally", { done: doneCount, total: sortedItems.length, pct: completion })}
      selectedId={null}
      onSelect={(id) => { setSelectedItemId(id); onTab("today"); }}
      options={doneItems.map((item) => ({ id: item.id, label: item.catalogItem?.year ? `${item.title} (${item.catalogItem.year})` : item.title, done: true, rating: ratingByItem.get(item.id) ?? null }))}
    />
  ) : null;

  return (
    <main className="mx-auto max-w-7xl overflow-x-clip px-4 py-6 pb-28 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("back")}</button>{onAdmin ? <Button variant="secondary" onClick={onAdmin}>{t("manage")}</Button> : null}</div>
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--spotlight)] p-6 text-[var(--spotlight-ink)] sm:p-9">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3">{livingList ? <span /> : <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />}<span className="text-xs text-white/65">{livingList ? t("livingListMeta", { count: sortedItems.length }) : f.dateRange(challenge.startsOn, challenge.endsOn)}</span></div>
          <h1 className="mt-10 max-w-3xl text-4xl font-medium leading-none tracking-[-0.055em] sm:text-6xl">{challenge.title}</h1>
          {challenge.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{challenge.description}</p> : null}
          {sortedItems.length ? <div className="mt-8 max-w-2xl"><div className="mb-2 flex justify-between text-xs text-white/70"><span>{t.rich("entriesProgress", { done: Math.min(doneEntries.length, sortedItems.length), total: sortedItems.length, b: (chunks) => <strong className="text-white">{chunks}</strong> })}</span><span>{completion}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, completion)}%` }} /></div></div> : null}
        </div>
        <span className="absolute -right-28 -top-36 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
      </section>

      {scheduled ? <section className="mt-5 rounded-2xl border border-[var(--main-line)] bg-[var(--paper)] px-5 py-4"><strong className="text-[var(--main-strong)]">{t("scheduledTitle", { date: f.date(challenge.startsOn, longDate) })}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("scheduledBody")}</p></section> : null}
      <RuleSectionsView rules={ruleSections} />
      <CheckpointSchedule challenge={challenge} />

      <nav className="mt-5 hidden gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1 sm:flex" aria-label={t("navAria")}>
        {tabs.map((item) => <button className={cx("min-h-11 flex-1 rounded-xl px-3 text-sm font-light", tab === item.id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{t(`tabs.${item.id}`)}</button>)}
      </nav>

      <div className="mt-5">
        {tab === "today" ? (
          <div className={cx("grid gap-5", checkpointPicker ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(270px,0.6fr)]" : "mx-auto max-w-3xl")}>
            <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
              {challenge.status === "closed" ? <EmptyState title={t("closedTitle")} description={t("closedBody")} action={<Button onClick={() => onTab("results")}>{t("seeResults")}</Button>} /> : challenge.submissionMode !== "free" && !selectedItem && !undatedDaily ? <EmptyState title={t("noCheckpointTitle")} description={t("noCheckpointBody")} /> : (
                <>
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="mt-2 text-2xl font-light tracking-[-0.04em]">
                        {selectedItem
                          ? `${selectedItem.title}${selectedItem.catalogItem?.year ? ` (${selectedItem.catalogItem.year})` : ""}`
                          : (undatedDaily ? t("checkInOf", { date: f.date(effectiveOccurredOn, longDate) }) : t("newEntry"))}
                      </h2>
                      {selectedItem?.description ? <p className="mt-1 text-sm text-[var(--muted)]">{selectedItem.description}</p> : null}
                      {selectedItem?.recommendedBy || selectedItem?.catalogItem?.author || selectedItem?.catalogItem?.mainGenre || selectedItem?.catalogItem?.runtimeMinutes ? <p className="mt-1 text-xs text-[var(--muted)]">{[selectedItem.catalogItem?.author ? t("byAuthor", { name: selectedItem.catalogItem.author }) : null, selectedItem.recommendedBy ? t("recommendedBy", { name: selectedItem.recommendedBy.name }) : null, selectedItem.catalogItem?.mainGenre || null, formatRuntime(selectedItem.catalogItem?.runtimeMinutes)].filter(Boolean).join(" · ")}</p> : null}</div>{selectedItem?.dueAt ? <span className="rounded-full bg-[var(--wash)] px-3 py-2 text-xs font-medium text-[var(--muted)]">{t("dueBy", { date: f.dateTime(selectedItem.dueAt) })}</span> : null}</div>
                  {dateRequired ? <label className="mb-5 block"><span className={labelClass}>{t("occurredOnLabel")}</span><input className={inputClass} type="date" max={today} value={effectiveOccurredOn} disabled={Boolean(unavailableMessage)} onChange={(event) => setOccurredOn(event.target.value || today)} /><small className="mt-1 block text-[var(--muted)]">{t("occurredOnHint")}</small></label> : !useItemPanel && currentEntry?.occurredOn ? <p className="mb-5 text-xs text-[var(--muted)]">{t("occurredOn", { date: f.date(currentEntry.occurredOn, longDate) })}</p> : null}
                  {useItemPanel && selectedItem ? (
                    <ItemEntryPanel key={`${selectedItem.id}-${selectedSession?.id ?? "no-session"}`} challenge={challenge} item={selectedItem} ownEntries={ownEntries} groupRatings={challenge.participants.length > 1 ? groupRatingsByItem.get(selectedItem.id) ?? [] : null} occurredOn={occurredOn} onOccurredOnChange={setOccurredOn} offerOptionalDate={!perDayItem && !sessionMode && collectsEntryDate} today={today} unavailableMessage={unavailableMessage} canEdit={!unavailableMessage} checkpointId={selectedSession?.id ?? null} onSaveEntry={onSaveEntry} onDeleteEntry={canDeleteEntry} />
                  ) : (
                    <DynamicEntryForm key={`${selectedItem?.id ?? "free"}-${undatedDaily ? effectiveOccurredOn : "fixed"}-${currentEntry?.id ?? "new"}`} fields={challenge.fields} item={selectedItem ?? null} entry={currentEntry} canEdit={!unavailableMessage} unavailableMessage={unavailableMessage} onSave={(values, entry) => onSaveEntry(selectedItem?.id ?? null, values, entry, undatedDaily ? effectiveOccurredOn : undefined)} onDelete={currentEntry && canDeleteEntry ? () => canDeleteEntry(currentEntry.id) : undefined} />
                  )}
                </>
              )}
            </section>
            {checkpointPicker ? <aside className="min-w-0">{checkpointPicker}</aside> : null}
          </div>
        ) : null}

        {tab === "results" ? (
          <div className="space-y-5">
            {completedCard}
            <ResultView challenge={challenge} hideCompletionRate onBackToEntry={() => onTab("today")} />
          </div>
        ) : null}
      </div>

      <nav className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-2 border-t border-[var(--line)] bg-[var(--paper)]/95 px-2 backdrop-blur-xl sm:hidden" aria-label={t("navMobileAria")}>
        {tabs.map((item) => <button className={cx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-light", tab === item.id ? "text-[var(--main-strong)]" : "text-[var(--muted)]")} type="button" onClick={() => onTab(item.id)} key={item.id}><span className="text-base" aria-hidden="true">{item.id === "today" ? "◉" : "〇"}</span>{t(`tabs.${item.id}`)}</button>)}
      </nav>
    </main>
  );
}
