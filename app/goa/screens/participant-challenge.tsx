"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";

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

export function DynamicEntryForm({
  fields,
  item,
  entry,
  canEdit,
  unavailableMessage,
  onSave,
}: {
  fields: ChallengeField[];
  item: ChallengeItem | null;
  entry?: Entry;
  canEdit: boolean;
  unavailableMessage?: string | null;
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
  const hasFilledOptional = optionalFields.some((field) => field.id && !isBlank(values[field.id]));
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
            {field.type === "rating" ? <div id={id} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11" tabIndex={-1}>{ratingChoices(field.config).map((rating) => <button className={cx("min-h-11 rounded-xl border text-xs font-light", Number(value) === rating ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-transparent bg-[var(--wash)] hover:border-[var(--main-line)]")} type="button" aria-pressed={Number(value) === rating} aria-label={t("ratingAria", { rating: String(rating).replace(".", ",") })} disabled={!canEdit || busy} onClick={() => setValue(field, rating)} key={rating}>{String(rating).replace(".", ",")}</button>)}</div> : null}
          </div>
        );
      })}
      {optionalFields.length && canEdit ? (
        <button
          type="button"
          className="min-h-11 cursor-pointer text-sm font-light hover:underline"
          onClick={() => setShowOptional((open) => !open)}
        >
          {showOptional ? t("hideOptional") : t("showOptional", { count: optionalFields.length })}
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
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">{result?.headline || challenge.title}</h2>
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
  unavailableMessage,
  canEdit,
  onSaveEntry,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  ownEntries: Entry[];
  occurredOn: string;
  unavailableMessage: string | null;
  canEdit: boolean;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string, entryTypeId?: Id) => Promise<void>;
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
          && (!perDay || candidate.occurredOn === occurredOn));
        const rated = ratingTypeId
          ? ownEntries.some((candidate) => itemIdForEntry(candidate) === item.id && candidate.entryTypeId === ratingTypeId)
          : false;
        const locked = type.purpose === "expectation" && rated;
        return (
          <div key={type.id || "registro"}>
            {stacked ? <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{type.name}</h3> : null}
            <DynamicEntryForm
              key={`${type.id}-${perDay ? occurredOn : "fixed"}-${entry?.id ?? "new"}`}
              fields={type.fields}
              item={item}
              entry={entry}
              canEdit={canEdit && !locked}
              unavailableMessage={locked ? t("expectationLocked") : unavailableMessage}
              onSave={(values, saved) => onSaveEntry(
                item.id,
                values,
                saved,
                perDay || !saved ? occurredOn : undefined,
                type.id || undefined,
              )}
            />
          </div>
        );
      })}
    </div>
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
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  user: User;
  tab: ParticipantTab;
  onTab: (tab: ParticipantTab) => void;
  onBack: () => void;
  onAdmin?: () => void;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string, entryTypeId?: Id) => Promise<void>;
}) {
  const t = useTranslations("participant");
  const tc = useTranslations("common");
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
  const sortedItems = useMemo(() => [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [challenge.items]);
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const today = dateKeyInSaoPaulo(new Date());
  const [occurredOn, setOccurredOn] = useState(today);
  const defaultItem = sortedItems.find((item) => item.status === "open" && !entriesByItem.has(item.id))
    ?? sortedItems.find((item) => !entriesByItem.has(item.id) && item.status !== "scheduled" && item.status !== "closed")
    ?? [...sortedItems].reverse().find((item) => entriesByItem.has(item.id))
    ?? sortedItems[0]
    ?? null;
  const [selectedItemId, setSelectedItemId] = useState<Id | null>(defaultItem?.id ?? null);
  const selectedItem = sortedItems.find((item) => item.id === selectedItemId) ?? defaultItem;
  const currentEntry = undatedDaily
    ? ownEntries.find((entry) => entry.occurredOn === occurredOn)
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
  const tabs: Array<{ id: ParticipantTab }> = [
    { id: "today" },
    { id: "history" },
    { id: "progress" },
    { id: "results" },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("backHome")}</button>{onAdmin ? <Button variant="secondary" onClick={onAdmin}>{t("manage")}</Button> : null}</div>
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--spotlight)] p-6 text-[var(--spotlight-ink)] sm:p-9">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><span className="text-xs text-white/65">{f.dateRange(challenge.startsOn, challenge.endsOn)}</span></div>
          <h1 className="mt-10 max-w-3xl text-4xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">{challenge.title}</h1>
          {challenge.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{challenge.description}</p> : null}
          {challenge.meetingUrl ? <a className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-light text-white hover:bg-white/25" href={challenge.meetingUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">↗</span>{t("joinMeeting")}</a> : null}
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
            <section className={cx(cardClass, "p-5 sm:p-7")}>
              {challenge.status === "closed" ? <EmptyState title={t("closedTitle")} description={t("closedBody")} action={<Button onClick={() => onTab("results")}>{t("seeResults")}</Button>} /> : challenge.submissionMode !== "free" && !selectedItem && !undatedDaily ? <EmptyState title={t("noCheckpointTitle")} description={t("noCheckpointBody")} /> : (
                <>
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="mt-2 text-2xl font-light tracking-[-0.04em]">
                        {selectedItem?.title ?? (undatedDaily ? t("checkInOf", { date: f.date(occurredOn, longDate) }) : t("newEntry"))}
                      </h2>
                      {selectedItem?.description ? <p className="mt-1 text-sm text-[var(--muted)]">{selectedItem.description}</p> : null}
                      {selectedItem?.recommendedBy || selectedItem?.catalogItem?.year ? <p className="mt-1 text-xs text-[var(--muted)]">{[selectedItem.recommendedBy ? t("recommendedBy", { name: selectedItem.recommendedBy.name }) : null, selectedItem.catalogItem?.year ? String(selectedItem.catalogItem.year) : null, selectedItem.catalogItem?.genres.length ? selectedItem.catalogItem.genres.join(", ") : null].filter(Boolean).join(" · ")}</p> : null}</div>{selectedItem?.dueAt ? <span className="rounded-full bg-[var(--wash)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{t("dueBy", { date: f.dateTime(selectedItem.dueAt) })}</span> : null}</div>
                  {undatedDaily || (useItemPanel && (perDayItem || !currentEntry)) ? <label className="mb-5 block"><span className={labelClass}>{t("occurredOnLabel")}</span><input className={inputClass} type="date" max={today} value={occurredOn} disabled={Boolean(unavailableMessage)} onChange={(event) => setOccurredOn(event.target.value || today)} /><small className="mt-1 block text-[var(--muted)]">{t("occurredOnHint")}</small></label> : !useItemPanel && currentEntry?.occurredOn ? <p className="mb-5 text-xs text-[var(--muted)]">{t("occurredOn", { date: f.date(currentEntry.occurredOn, longDate) })}</p> : null}
                  {useItemPanel && selectedItem ? (
                    <ItemEntryPanel challenge={challenge} item={selectedItem} ownEntries={ownEntries} occurredOn={occurredOn} unavailableMessage={unavailableMessage} canEdit={!unavailableMessage} onSaveEntry={onSaveEntry} />
                  ) : (
                    <DynamicEntryForm key={`${selectedItem?.id ?? "free"}-${undatedDaily ? occurredOn : "fixed"}-${currentEntry?.id ?? "new"}`} fields={challenge.fields} item={selectedItem ?? null} entry={currentEntry} canEdit={!unavailableMessage} unavailableMessage={unavailableMessage} onSave={(values, entry) => onSaveEntry(selectedItem?.id ?? null, values, entry, undatedDaily ? occurredOn : undefined)} />
                  )}
                </>
              )}
            </section>
            <aside className="space-y-5">
              {sortedItems.length > 1 ? <section className={cx(cardClass, "p-5")}><h2 className="text-base font-light">{t("checkpointsTitle")}</h2><label className="mt-3 block"><span className="sr-only">{t("chooseCheckpoint")}</span><select className={inputClass} value={selectedItem?.id ?? ""} onChange={(event) => setSelectedItemId(event.target.value)}>{sortedItems.map((item, index) => <option value={item.id} key={item.id} disabled={item.status === "scheduled" && !entriesByItem.has(item.id)}>{entriesByItem.has(item.id) ? t("checkpointDone") : ""}{t("checkpointOption", { index: index + 1, title: item.title })}{item.status === "scheduled" ? t("checkpointSoon") : ""}</option>)}</select></label><ul className="mt-3 space-y-2 text-xs text-[var(--muted)]"><li>{t("checkpointTally", { done: Math.min(doneEntries.length, sortedItems.length), pending: Math.max(0, sortedItems.length - doneEntries.length) })}</li></ul></section> : null}
            </aside>
          </div>
        ) : null}

        {tab === "history" ? (
          <section className={cx(cardClass, "p-5 sm:p-7")}><PageHeading title={t("historyTitle")} description={t("historySubtitle")} />{ownEntries.length ? <ul className="divide-y divide-[var(--line)]">{[...ownEntries].sort((a, b) => String(b.occurredOn ?? b.submittedAt).localeCompare(String(a.occurredOn ?? a.submittedAt))).map((entry) => { const item = sortedItems.find((candidate) => candidate.id === itemIdForEntry(entry)); const values = valuesAsRecord(entry.values); const type = challenge.entryTypes.find((candidate) => candidate.id === entry.entryTypeId); const entryFields = type?.fields ?? challenge.fields; return <li className="py-5" key={entry.id}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><strong>{item?.title ?? (challenge.submissionMode === "daily" ? t("dailyCheckIn") : t("freeEntry"))}</strong>{type && challenge.entryTypes.length > 1 ? <span className="ml-2 rounded-full bg-[var(--wash)] px-2 py-0.5 text-[10px] font-light uppercase text-[var(--muted)]">{type.name}</span> : null}<p className="mt-1 text-xs text-[var(--muted)]">{entry.occurredOn ? t("occurredOnPrefix", { date: f.date(entry.occurredOn, longDate) }) : ""}{t("savedAt", { date: f.dateTime(entry.submittedAt ?? entry.updatedAt) })}{entry.isLate ? t("lateSuffix") : ""}</p></div><dl className="grid gap-2 text-sm sm:grid-cols-2">{entryFields.map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 font-semibold">{typeof values[field.id] === "boolean" ? values[field.id] ? tc("yes") : tc("no") : String(values[field.id])}</dd></div> : null)}</dl></div></li>; })}</ul> : <EmptyState title={t("noHistoryTitle")} description={t("noHistoryBody")} />}</section>
        ) : null}

        {tab === "progress" ? (
          <section><PageHeading title={t("progressTitle")} description={t("progressSubtitle")} />{challenge.metrics.filter((metric) => metric.visibleDuring).length ? <div className="space-y-3"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{challenge.metrics.filter((metric) => metric.visibleDuring && !metric.series?.length).map((metric) => <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />)}</div>{challenge.metrics.filter((metric) => metric.visibleDuring && metric.series?.length).map((metric) => <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />)}</div> : <EmptyState title={t("noProgressTitle")} description={t("noProgressBody")} />}</section>
        ) : null}

        {tab === "results" ? challenge.status === "closed" || challenge.result ? <ResultView challenge={challenge} /> : <EmptyState title={t("storyOngoingTitle")} description={t("storyOngoingBody")} action={<Button onClick={() => onTab("today")}>{t("backToEntry")}</Button>} /> : null}
      </div>

      <nav className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-4 border-t border-[var(--line)] bg-[var(--paper)]/95 px-2 backdrop-blur-xl sm:hidden" aria-label={t("navMobileAria")}>
        {tabs.map((item) => <button className={cx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-light", tab === item.id ? "text-[var(--main-strong)]" : "text-[var(--muted)]")} type="button" onClick={() => onTab(item.id)} key={item.id}><span className="text-base" aria-hidden="true">{item.id === "today" ? "●" : item.id === "history" ? "◷" : item.id === "progress" ? "↗" : "✦"}</span>{t(`tabs.${item.id}`)}</button>)}
      </nav>
    </main>
  );
}
