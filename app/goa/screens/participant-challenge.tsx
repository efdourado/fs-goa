"use client";

import { useTranslations } from "next-intl";
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
  PageHeading,
  StatusMessage,
} from "../ui";
import {
  dateKeyInSaoPaulo,
  isChallengeScheduled,
  itemIdForEntry,
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
  onPick: (rating: number) => void;
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
        const picked = Number(value) === rating;
        const text = String(rating).replace(".", ",");
        return (
          <button
            key={rating}
            type="button"
            aria-pressed={picked}
            aria-label={ariaLabel(text)}
            disabled={disabled}
            onClick={() => onPick(rating)}
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

export function DynamicEntryForm({
  fields,
  item,
  entry,
  canEdit,
  unavailableMessage,
  dateField,
  onSave,
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
}) {
  const t = useTranslations("entryForm");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [values, setValues] = useState<Record<Id, unknown>>(() => entry ? valuesAsRecord(entry.values) : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    const missing = fields.find((field) => {
      if (!field.required || !field.id) return false;
      const value = values[field.id];
      return value === undefined || value === null || value === "";
    });
    if (missing) {
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
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!fields.length) {
    return <EmptyState title={t("notConfiguredTitle")} description={t("notConfiguredBody")} />;
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
        <button
          type="button"
          className="min-h-11 cursor-pointer text-sm font-light hover:underline"
          onClick={() => setShowOptional((open) => !open)}
        >
          {showOptional ? t("hideOptional") : t("showOptional", { count: optionalCount })}
        </button>
      ) : null}
      <StatusMessage error={error} success={success} />
      {canEdit ? <Button type="submit" className="w-full" disabled={busy}>{busy ? tc("saving") : entry ? tc("saveChanges") : t("saveEntry")}<span aria-hidden="true">→</span></Button> : <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage ?? t("readOnly")}</p>}
      {item?.dueAt ? <p className="text-center text-xs text-[var(--muted)]">{t("dueAt", { date: f.dateTime(item.dueAt) })}</p> : null}
    </form>
  );
}

export function ResultView({ challenge }: { challenge: ChallengeDetail }) {
  const t = useTranslations("resultView");
  const tm = useTranslations("metrics");
  const f = useGoaFormat();
  const result = challenge.result;
  const metrics = result?.metrics?.length ? result.metrics : challenge.metrics.filter((metric) => metric.visibleInResults);
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] bg-[var(--spotlight)] px-6 py-10 text-[var(--spotlight-ink)] sm:px-10 sm:py-14">
        <p className="text-xs font-light uppercase tracking-[0.16em] text-white/55">{challenge.startsOn || challenge.endsOn ? f.dateRange(challenge.startsOn, challenge.endsOn) : t("noDeadline")}</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-medium leading-none tracking-[-0.055em] sm:text-6xl">{result?.headline || challenge.title}</h2>
        {result?.summary ? <p className="mt-6 max-w-2xl text-base leading-7 text-white/70">{result.summary}</p> : null}
        <div className="mt-8 flex flex-wrap gap-2">{challenge.participants.map((participant) => <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs" key={participant.id}>{participant.name}</span>)}</div>
      </section>
      {metrics.length ? (
        <div className="space-y-3" aria-label={t("numbersAria")}>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.filter((metric) => !metric.series?.length).map((metric) => (
              <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />
            ))}
          </section>
          {metrics.filter((metric) => metric.series?.length).map((metric) => (
            <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />
          ))}
        </div>
      ) : <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />}
      {result?.comments?.length ? (
        <section className={cx(cardClass, "p-6 sm:p-8")}><h2 className="text-xl font-light">{t("momentsTitle")}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{result.comments.map((comment) => <blockquote className="rounded-2xl bg-[var(--wash)] p-5" key={comment.id}><p className="text-sm leading-6">“{comment.text}”</p><footer className="mt-3 text-xs font-light text-[var(--muted)]">{comment.authorName ?? t("participantFallback")}{comment.itemTitle ? ` · ${comment.itemTitle}` : ""}</footer></blockquote>)}</div></section>
      ) : null}
    </div>
  );
}

/** The entry types a round item can receive (expectation, rating, progress…). */
function itemEntryTypes(challenge: ChallengeDetail): EntryTypeView[] {
  if (challenge.entryTypes.length) {
    return challenge.entryTypes.filter((type) => type.targetPolicy !== "none");
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
function ItemEntryPanel({
  challenge,
  item,
  ownEntries,
  occurredOn,
  onOccurredOnChange,
  offerOptionalDate,
  today,
  unavailableMessage,
  canEdit,
  checkpointId,
  onSaveEntry,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  ownEntries: Entry[];
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
}) {
  const t = useTranslations("participant");
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
            />
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
function EntryPicker({
  title,
  tally,
  options,
  selectedId,
  onSelect,
}: {
  title: string;
  tally?: string;
  options: Array<{ id: Id; label: string; done?: boolean; soon?: boolean; statusLabel?: string }>;
  selectedId: Id | null;
  onSelect: (id: Id) => void;
}) {
  return (
    <section className={cx(cardClass, "p-4 sm:p-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-light">{title}</h2>
        {tally ? <span className="text-xs text-[var(--muted)]">{tally}</span> : null}
      </div>
      <ol className="mt-3 max-h-[21rem] space-y-1.5 overflow-y-auto pr-0.5">
        {options.map((option, index) => {
          const active = option.id === selectedId;
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
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * "Seus registros" — the participant's own submissions, newest first. Each row
 * can be deleted while the challenge is active; the list refreshes from the
 * server after a delete so metrics and progress stay in sync.
 */
function HistoryTab({
  challenge,
  entries,
  items,
  canDelete,
  onDeleteEntry,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  items: ChallengeItem[];
  canDelete: boolean;
  onDeleteEntry?: (entryId: Id) => Promise<void>;
}) {
  const t = useTranslations("participant");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const longDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const [deletingId, setDeletingId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...entries].sort((a, b) =>
    String(b.occurredOn ?? b.submittedAt).localeCompare(String(a.occurredOn ?? a.submittedAt)));

  async function remove(entryId: Id) {
    if (!onDeleteEntry || !window.confirm(t("deleteEntryConfirm"))) return;
    setDeletingId(entryId);
    setError(null);
    try {
      await onDeleteEntry(entryId);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title={t("historyTitle")} description={t("historySubtitle")} />
      <div className="mb-4"><StatusMessage error={error} /></div>
      {sorted.length ? (
        <ul className="divide-y divide-[var(--line)]">
          {sorted.map((entry) => {
            const item = items.find((candidate) => candidate.id === itemIdForEntry(entry));
            const values = valuesAsRecord(entry.values);
            const type = challenge.entryTypes.find((candidate) => candidate.id === entry.entryTypeId);
            const entryFields = type?.fields ?? challenge.fields;
            return (
              <li className="py-5" key={entry.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <strong>{item?.title ?? (challenge.submissionMode === "daily" ? t("dailyCheckIn") : t("freeEntry"))}</strong>
                    {type && challenge.entryTypes.length > 1 ? <span className="ml-2 rounded-full bg-[var(--wash)] px-2 py-0.5 text-[10px] font-light uppercase text-[var(--muted)]">{type.name}</span> : null}
                    <p className="mt-1 text-xs text-[var(--muted)]">{entry.occurredOn ? t("occurredOnPrefix", { date: f.date(entry.occurredOn, longDate) }) : ""}{t("savedAt", { date: f.dateTime(entry.submittedAt ?? entry.updatedAt) })}{entry.isLate ? t("lateSuffix") : ""}</p>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">{entryFields.map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 font-medium">{typeof values[field.id] === "boolean" ? values[field.id] ? tc("yes") : tc("no") : String(values[field.id])}</dd></div> : null)}</dl>
                </div>
                {canDelete && onDeleteEntry ? (
                  <button type="button" className="mt-3 text-xs font-light text-[var(--danger)] underline underline-offset-2 disabled:opacity-50" disabled={deletingId === entry.id} onClick={() => void remove(entry.id)}>
                    {deletingId === entry.id ? t("deletingEntry") : t("deleteEntry")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title={t("noHistoryTitle")} description={t("noHistoryBody")} />}
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
  const tm = useTranslations("metrics");
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
  // A daily / per-day round needs a concrete date, so it gets a prominent picker.
  // A plain round instead offers the date among the entry form's optional fields.
  const dateRequired = undatedDaily || (useItemPanel && perDayItem);
  const tabs: Array<{ id: ParticipantTab }> = [
    { id: "today" },
    { id: "history" },
    { id: "progress" },
    { id: "results" },
  ];

  return (
    <main className="mx-auto max-w-7xl overflow-x-clip px-4 py-6 pb-28 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("backHome")}</button>{onAdmin ? <Button variant="secondary" onClick={onAdmin}>{t("manage")}</Button> : null}</div>
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--spotlight)] p-6 text-[var(--spotlight-ink)] sm:p-9">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><span className="text-xs text-white/65">{f.dateRange(challenge.startsOn, challenge.endsOn)}</span></div>
          <h1 className="mt-10 max-w-3xl text-4xl font-medium leading-none tracking-[-0.055em] sm:text-6xl">{challenge.title}</h1>
          {challenge.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{challenge.description}</p> : null}
          {sortedItems.length ? <div className="mt-8 max-w-2xl"><div className="mb-2 flex justify-between text-xs text-white/70"><span>{t.rich("entriesProgress", { done: Math.min(doneEntries.length, sortedItems.length), total: sortedItems.length, b: (chunks) => <strong className="text-white">{chunks}</strong> })}</span><span>{completion}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, completion)}%` }} /></div></div> : null}
        </div>
        <span className="absolute -right-28 -top-36 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
      </section>

      {scheduled ? <section className="mt-5 rounded-2xl border border-[var(--main-line)] bg-[var(--paper)] px-5 py-4"><strong className="text-[var(--main-strong)]">{t("scheduledTitle", { date: f.date(challenge.startsOn, longDate) })}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("scheduledBody")}</p></section> : null}
      <RuleSectionsView rules={ruleSections} />

      <nav className="mt-5 hidden gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1 sm:flex" aria-label={t("navAria")}>
        {tabs.map((item) => <button className={cx("min-h-11 flex-1 rounded-xl px-3 text-sm font-light", tab === item.id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{t(`tabs.${item.id}`)}</button>)}
      </nav>

      <div className="mt-5">
        {tab === "today" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(290px,0.65fr)]">
            <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
              {challenge.status === "closed" ? <EmptyState title={t("closedTitle")} description={t("closedBody")} action={<Button onClick={() => onTab("results")}>{t("seeResults")}</Button>} /> : challenge.submissionMode !== "free" && !selectedItem && !undatedDaily ? <EmptyState title={t("noCheckpointTitle")} description={t("noCheckpointBody")} /> : (
                <>
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="mt-2 text-2xl font-light tracking-[-0.04em]">
                        {selectedItem?.title ?? (undatedDaily ? t("checkInOf", { date: f.date(effectiveOccurredOn, longDate) }) : t("newEntry"))}
                      </h2>
                      {selectedItem?.description ? <p className="mt-1 text-sm text-[var(--muted)]">{selectedItem.description}</p> : null}
                      {selectedItem?.recommendedBy || selectedItem?.catalogItem?.author || selectedItem?.catalogItem?.year || selectedItem?.catalogItem?.mainGenre ? <p className="mt-1 text-xs text-[var(--muted)]">{[selectedItem.catalogItem?.author ? t("byAuthor", { name: selectedItem.catalogItem.author }) : null, selectedItem.recommendedBy ? t("recommendedBy", { name: selectedItem.recommendedBy.name }) : null, selectedItem.catalogItem?.year ? String(selectedItem.catalogItem.year) : null, selectedItem.catalogItem?.mainGenre || null].filter(Boolean).join(" · ")}</p> : null}</div>{selectedItem?.dueAt ? <span className="rounded-full bg-[var(--wash)] px-3 py-2 text-xs font-medium text-[var(--muted)]">{t("dueBy", { date: f.dateTime(selectedItem.dueAt) })}</span> : null}</div>
                  {dateRequired ? <label className="mb-5 block"><span className={labelClass}>{t("occurredOnLabel")}</span><input className={inputClass} type="date" max={today} value={effectiveOccurredOn} disabled={Boolean(unavailableMessage)} onChange={(event) => setOccurredOn(event.target.value || today)} /><small className="mt-1 block text-[var(--muted)]">{t("occurredOnHint")}</small></label> : !useItemPanel && currentEntry?.occurredOn ? <p className="mb-5 text-xs text-[var(--muted)]">{t("occurredOn", { date: f.date(currentEntry.occurredOn, longDate) })}</p> : null}
                  {useItemPanel && selectedItem ? (
                    <ItemEntryPanel key={`${selectedItem.id}-${selectedSession?.id ?? "no-session"}`} challenge={challenge} item={selectedItem} ownEntries={ownEntries} occurredOn={occurredOn} onOccurredOnChange={setOccurredOn} offerOptionalDate={!perDayItem && !sessionMode} today={today} unavailableMessage={unavailableMessage} canEdit={!unavailableMessage} checkpointId={selectedSession?.id ?? null} onSaveEntry={onSaveEntry} />
                  ) : (
                    <DynamicEntryForm key={`${selectedItem?.id ?? "free"}-${undatedDaily ? effectiveOccurredOn : "fixed"}-${currentEntry?.id ?? "new"}`} fields={challenge.fields} item={selectedItem ?? null} entry={currentEntry} canEdit={!unavailableMessage} unavailableMessage={unavailableMessage} onSave={(values, entry) => onSaveEntry(selectedItem?.id ?? null, values, entry, undatedDaily ? effectiveOccurredOn : undefined)} />
                  )}
                </>
              )}
            </section>
            <aside className="min-w-0 space-y-5">
              {sessionMode && sortedSessions.length > 1 ? (
                <EntryPicker
                  title={t("sessionsTitle")}
                  selectedId={selectedSession?.id ?? null}
                  onSelect={(id) => setSelectedSessionId(id)}
                  options={sortedSessions.map((session) => {
                    const boundItem = sortedItems.find((item) => item.checkpointId === session.id);
                    const soon = session.status === "scheduled";
                    return { id: session.id, label: boundItem?.title ?? session.title, soon, statusLabel: soon ? t("checkpointSoonLabel") : undefined };
                  })}
                />
              ) : sortedItems.length > 1 ? (
                <EntryPicker
                  title={t("checkpointsTitle")}
                  tally={t("checkpointTally", { done: Math.min(doneEntries.length, sortedItems.length), pending: Math.max(0, sortedItems.length - doneEntries.length) })}
                  selectedId={selectedItem?.id ?? null}
                  onSelect={(id) => setSelectedItemId(id)}
                  options={sortedItems.map((item) => {
                    const done = doneByItem.has(item.id);
                    const soon = item.status === "scheduled" && !entriesByItem.has(item.id);
                    return { id: item.id, label: item.title, done, soon, statusLabel: done ? t("checkpointDoneLabel") : soon ? t("checkpointSoonLabel") : undefined };
                  })}
                />
              ) : null}
            </aside>
          </div>
        ) : null}

        {tab === "history" ? (
          <HistoryTab challenge={challenge} entries={ownEntries} items={sortedItems} canDelete={challenge.status === "active"} onDeleteEntry={onDeleteEntry} />
        ) : null}

        {tab === "progress" ? (
          <section><PageHeading title={t("progressTitle")} description={t("progressSubtitle")} />{challenge.metrics.filter((metric) => metric.visibleDuring).length ? <div className="space-y-3"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{challenge.metrics.filter((metric) => metric.visibleDuring && !metric.series?.length).map((metric) => <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />)}</div>{challenge.metrics.filter((metric) => metric.visibleDuring && metric.series?.length).map((metric) => <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />)}</div> : <EmptyState title={t("noProgressTitle")} description={t("noProgressBody")} />}</section>
        ) : null}

        {tab === "results" ? challenge.status === "closed" || challenge.result ? <ResultView challenge={challenge} /> : <EmptyState title={t("storyOngoingTitle")} description={t("storyOngoingBody")} action={<Button onClick={() => onTab("today")}>{t("backToEntry")}</Button>} /> : null}
      </div>

      <nav className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-4 border-t border-[var(--line)] bg-[var(--paper)]/95 px-2 backdrop-blur-xl sm:hidden" aria-label={t("navMobileAria")}>
        {tabs.map((item) => <button className={cx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-light", tab === item.id ? "text-[var(--main-strong)]" : "text-[var(--muted)]")} type="button" onClick={() => onTab(item.id)} key={item.id}><span className="text-base" aria-hidden="true">{item.id === "today" ? "◉" : item.id === "history" ? "֎" : item.id === "progress" ? "◎" : "〇"}</span>{t(`tabs.${item.id}`)}</button>)}
      </nav>
    </main>
  );
}
