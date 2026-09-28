"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { logRange } from "./checkin-days";
import { CheckinLog, type LogRecord } from "./checkin-log";

import { ConfirmDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { useLibraryName } from "./libraries";
import type { ChallengeDetail, ChallengeField, Entry, EntryTypeView, FieldConfig, Id } from "./types";
import { Button, cardClass, cx, EmptyState, inputClass, labelClass, sectionLabelClass, StatusMessage } from "./ui";
import { dateKeyInSaoPaulo, displayAnswer, findMissingRequiredField, valuesAsRecord } from "./utils";

/** The check-in and the type of record it holds — a workout and its exercise records. */
export interface SessionSpec {
  visit: EntryTypeView;
  record: EntryTypeView;
}

/** `null` for an ordinary challenge; otherwise the pair that makes "one check-in, several item records". */
export function sessionSpecOf(challenge: Pick<ChallengeDetail, "entryTypes">): SessionSpec | null {
  const record = challenge.entryTypes.find((type) => type.parentTypeId);
  const visit = record ? challenge.entryTypes.find((type) => type.id === record.parentTypeId) : null;
  return record && visit ? { visit, record } : null;
}

/** What "Save" sends: the check-in's date and own fields, and one record per row — with its id when it already exists. */
export interface SessionPayload {
  occurredOn: string;
  values: Record<Id, unknown>;
  children: Array<{ id?: Id; itemId: Id; values: Record<Id, unknown> }>;
}

interface Row {
  key: string;
  id?: Id;
  itemId: Id | "";
  values: Record<Id, unknown>;
}

let rowCounter = 0;
/** A stable React key for a row of the form — rows come and go, so an index would mix their inputs up. */
const newRowKey = () => `row-${(rowCounter += 1)}`;

function ratingChoices(config?: FieldConfig): number[] {
  const min = config?.min ?? 0;
  const max = config?.max ?? 5;
  const step = config?.step && config.step > 0 ? config.step : 0.5;
  const count = Math.min(41, Math.floor((max - min) / step) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => Number((min + index * step).toFixed(4)));
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeLinecap="round" />
    </svg>
  );
}

/** One field of one record, sized for a card. */
function CellInput({ field, value, disabled, id, onChange, className }: {
  field: ChallengeField; value: unknown; disabled: boolean; id: string; onChange: (value: unknown) => void; className?: string;
}) {
  const cls = className ?? inputClass;
  const t = useTranslations("entryForm");
  const tc = useTranslations("common");
  if (field.type === "number") {
    return (
      <input
        id={id} className={cls} type="number" inputMode="decimal" min={field.config?.min} max={field.config?.max}
        step={field.config?.step ?? "any"} disabled={disabled}
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
    );
  }
  if (field.type === "rating") {
    return (
      <select id={id} className={cls} disabled={disabled} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}>
        <option value="">—</option>
        {ratingChoices(field.config).map((rating) => <option key={rating} value={String(rating)}>{String(rating).replace(".", ",")}</option>)}
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select id={id} className={cls} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("select")}</option>
        {(field.config?.options ?? []).filter((option) => !option.archived).map((option) => (
          <option key={option.id ?? option.value ?? option.label} value={option.id ?? option.value ?? option.label}>{option.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <select id={id} className={cls} disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "yes")}>
        <option value="">—</option>
        <option value="yes">{tc("yes")}</option>
        <option value="no">{tc("no")}</option>
      </select>
    );
  }
  if (field.type === "date") {
    return <input id={id} className={cls} type="date" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.config?.multiline) {
    return <textarea id={id} className={cls} rows={2} maxLength={field.config.maxLength} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input id={id} className={cls} maxLength={field.config?.maxLength} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

/** Numbers read best untouched; everything else reads the way the form showed it. */
function useShowValue() {
  const tc = useTranslations("common");
  return (field: ChallengeField, raw: unknown) => displayAnswer(field, raw, { yes: tc("yes"), no: tc("no") });
}

const numberValue = (raw: unknown): number | null => {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return null;
};

/** A best-so-far per numeric field of one item, read off the person's records (the check-in being edited left out). */
function bestValues(records: Iterable<Entry>, itemId: Id, fields: ChallengeField[], skipVisitId: Id | null): Map<Id, number> {
  const best = new Map<Id, number>();
  for (const record of records) {
    if (record.itemId !== itemId || (skipVisitId && record.parentEntryId === skipVisitId)) continue;
    const values = valuesAsRecord(record.values);
    for (const field of fields) {
      const value = numberValue(values[field.id as Id]);
      if (value !== null && (!best.has(field.id as Id) || value > (best.get(field.id as Id) as number))) best.set(field.id as Id, value);
    }
  }
  return best;
}

/**
 * A number with − / + on either side. Empty, the first tap takes last time's number (shown as the placeholder),
 * so "same as last time, one step heavier" is two taps; after that each tap moves one step.
 */
function NumberStepper({ id, field, value, last, disabled, onChange }: {
  id: string; field: ChallengeField; value: unknown; last: number | null; disabled: boolean; onChange: (value: unknown) => void;
}) {
  const t = useTranslations("sessionLog");
  const nf = useFormatter();
  const step = field.config?.step && field.config.step > 0 ? field.config.step : 1;
  const min = field.config?.min;
  const max = field.config?.max;
  const current = numberValue(value);
  const clamp = (next: number) => {
    let result = Number(next.toFixed(4));
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  };
  const nudge = (direction: 1 | -1) => {
    if (current === null) onChange(clamp(last ?? (direction > 0 ? step : 0)));
    else onChange(clamp(current + direction * step));
  };
  const button = "w-10 flex-none cursor-pointer bg-[var(--wash)] text-lg text-[var(--muted)] transition hover:bg-[var(--wash-strong)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] focus-within:border-[var(--main)] focus-within:ring-[3px] focus-within:ring-[var(--main-soft)]">
      <button type="button" className={button} disabled={disabled} aria-label={t("stepDown", { field: field.label })} onClick={() => nudge(-1)}>−</button>
      <input
        id={id}
        className="w-full min-w-0 border-0 bg-transparent px-1 py-2 text-center text-lg tabular-nums outline-none placeholder:text-[var(--muted)]/45 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        type="number" inputMode="decimal" min={min} max={max} step={field.config?.step ?? "any"} disabled={disabled}
        placeholder={last !== null ? nf.number(last, { maximumFractionDigits: 2 }) : undefined}
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
      <button type="button" className={button} disabled={disabled} aria-label={t("stepUp", { field: field.label })} onClick={() => nudge(1)}>+</button>
    </div>
  );
}

/** The best of the first number field in each check-in an item was in, oldest to newest, with the peak marked. */
/**
 * An item's numbers over time, full width: the line and its wash stretch with the card, while the latest
 * point sits on top as a plain dot — positioned in percent, so it stays round at any width.
 */
function TrendChart({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 300;
  const height = 64;
  const pad = 6;
  const high = Math.max(...values);
  const low = Math.min(...values);
  const x = (index: number) => (index * width) / (values.length - 1);
  const y = (value: number) => (high === low ? height / 2 : height - pad - ((value - low) / (high - low)) * (height - 2 * pad));
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = values[values.length - 1];
  return (
    <div className="relative mt-3 h-16" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" preserveAspectRatio="none">
        <path d={area} fill="var(--main-soft)" />
        <path d={line} fill="none" stroke="var(--main)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--main-2)] ring-[3px] ring-[var(--paper)]"
        style={{ left: "100%", top: `${(y(last) / height) * 100}%` }}
      />
    </div>
  );
}

/**
 * A workout-style challenge on Today: the days you checked in (the same strip / month as a daily log, each day
 * showing how many items it held), and the check-in of the picked day — a tray of the challenge's items to tap
 * in, a card per item with last time's numbers at hand, and one Save. Below, your check-ins and, per item, the
 * history and the bests that fall out of it. Nothing here asks for a "current best": it's read off what was logged.
 */
export function SessionLog({
  challenge,
  spec,
  entries,
  userId,
  canEdit,
  unavailableMessage,
  onSave,
  onDelete,
  onAddItem,
}: {
  challenge: ChallengeDetail;
  spec: SessionSpec;
  entries: Entry[];
  userId: Id | undefined;
  canEdit: boolean;
  unavailableMessage?: string | null;
  onSave: (payload: SessionPayload, entry?: Entry) => Promise<void>;
  onDelete?: (entryId: Id) => Promise<void>;
  /** Present for someone who may add items to the challenge — makes "New item" available in the tray. */
  onAddItem?: (title: string) => Promise<Id>;
}) {
  const t = useTranslations("sessionLog");
  const tf = useTranslations("entryForm");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const nf = useFormatter();
  const libraryName = useLibraryName();
  const showValue = useShowValue();
  const today = dateKeyInSaoPaulo(new Date());
  const shortDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
  const recordFields = useMemo(() => spec.record.fields.filter((field) => field.id), [spec.record.fields]);
  const numberFields = useMemo(() => recordFields.filter((field) => field.type === "number"), [recordFields]);
  const visitFields = useMemo(() => spec.visit.fields.filter((field) => field.id), [spec.visit.fields]);
  const items = useMemo(() => [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [challenge.items]);
  const itemTitle = (id: Id | null | undefined) => items.find((item) => item.id === id)?.title ?? "—";
  const itemsHeading = challenge.libraries?.length === 1 ? libraryName(challenge.libraries[0]) : t("itemColumn");

  // The person's own history — a group challenge lists everyone's entries, but a log is one person's.
  const ownVisits = useMemo(
    () => entries
      .filter((entry) => entry.entryTypeId === spec.visit.id && entry.userId === userId)
      .sort((a, b) => (b.occurredOn ?? "").localeCompare(a.occurredOn ?? "") || (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")),
    [entries, spec.visit.id, userId],
  );
  const recordsByVisit = useMemo(() => {
    const map = new Map<Id, Entry[]>();
    for (const entry of entries) {
      if (entry.entryTypeId !== spec.record.id || !entry.parentEntryId || entry.userId !== userId) continue;
      const list = map.get(entry.parentEntryId) ?? [];
      list.push(entry);
      map.set(entry.parentEntryId, list);
    }
    return map;
  }, [entries, spec.record.id, userId]);
  const ownRecords = useMemo(() => [...recordsByVisit.values()].flat(), [recordsByVisit]);
  const sortedRecords = (visitId: Id) => (recordsByVisit.get(visitId) ?? []).slice().sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));

  // Newest first within a day: a day with two check-ins opens the latest.
  const visitsByDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const visit of ownVisits) {
      if (!visit.occurredOn) continue;
      const list = map.get(visit.occurredOn) ?? [];
      list.push(visit);
      map.set(visit.occurredOn, list);
    }
    return map;
  }, [ownVisits]);
  // What the strip shows on each day: how many items went into it.
  const logRecords = useMemo(() => {
    const map = new Map<string, LogRecord>();
    for (const [day, visits] of visitsByDay) {
      const count = visits.reduce((sum, visit) => sum + (recordsByVisit.get(visit.id)?.length ?? 0), 0);
      map.set(day, { entry: visits[0], value: count });
    }
    return map;
  }, [visitsByDay, recordsByVisit]);
  const range = useMemo(
    () => logRange({ today, startsOn: challenge.startsOn, endsOn: challenge.endsOn, loggedDays: [...visitsByDay.keys()] }),
    [today, challenge.startsOn, challenge.endsOn, visitsByDay],
  );

  const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<Entry | null>(() => visitsByDay.get(today)?.[0] ?? null);
  const [occurredOn, setOccurredOn] = useState(today);
  const [visitValues, setVisitValues] = useState<Record<Id, unknown>>(() => (editing ? valuesAsRecord(editing.values) : {}));
  const [rows, setRows] = useState<Row[]>(() => (editing ? sortedRecords(editing.id).map((record) => ({ key: newRowKey(), id: record.id, itemId: record.itemId ?? "", values: valuesAsRecord(record.values) })) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  // "New item" being named in the tray. It never touches the rows until the item exists.
  const [creating, setCreating] = useState<{ title: string; busy: boolean; error: string | null } | null>(null);
  // After a save, the check-in to reopen once the reload brings it back: the edited one, or the newest of that day.
  const [reopen, setReopen] = useState<{ day: string; visitId?: Id; known: Set<Id> } | null>(null);
  const newItemInput = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLOListElement>(null);
  const isCreating = creating !== null;
  useEffect(() => { if (isCreating) newItemInput.current?.focus(); }, [isCreating]);
  const disabled = !canEdit || busy;

  function load(visit: Entry | null, onDay: string) {
    setEditing(visit);
    setOccurredOn(visit?.occurredOn ?? onDay);
    setVisitValues(visit ? valuesAsRecord(visit.values) : {});
    setRows(visit ? sortedRecords(visit.id).map((record) => ({ key: newRowKey(), id: record.id, itemId: record.itemId ?? "", values: valuesAsRecord(record.values) })) : []);
    setError(null);
  }

  useEffect(() => {
    if (!reopen) return;
    const visits = visitsByDay.get(reopen.day) ?? [];
    const found = reopen.visitId
      ? visits.find((visit) => visit.id === reopen.visitId)
      : visits.find((visit) => !reopen.known.has(visit.id));
    if (!found) return;
    setReopen(null);
    load(found, reopen.day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen, visitsByDay]);

  function selectDay(next: string) {
    setDay(next);
    setSuccess(null);
    setCreating(null);
    load(visitsByDay.get(next)?.[0] ?? null, next);
  }

  function focusCard(itemId: Id) {
    const card = cardsRef.current?.querySelector<HTMLElement>(`[data-item="${itemId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
  }

  function addItemRow(itemId: Id) {
    if (rows.some((row) => row.itemId === itemId)) { focusCard(itemId); return; }
    setRows((current) => [...current, { key: newRowKey(), itemId, values: {} }]);
    setSuccess(null);
    setError(null);
    requestAnimationFrame(() => focusCard(itemId));
  }

  async function createItem() {
    if (!creating || !onAddItem) return;
    const title = creating.title.trim();
    if (!title) return;
    const existing = items.find((item) => item.title.trim().toLowerCase() === title.toLowerCase());
    if (existing) { setCreating(null); addItemRow(existing.id); return; }
    setCreating({ ...creating, busy: true, error: null });
    try {
      const itemId = await onAddItem(title);
      setCreating(null);
      addItemRow(itemId);
    } catch (cause) {
      setCreating((current) => (current ? { ...current, busy: false, error: f.error(cause) } : current));
    }
  }

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setSuccess(null);
  }

  /** The most recent record of an item, before the check-in being edited — "last time: 55 kg × 8" — and its values. */
  function lastRecordFor(itemId: Id): { text: string; values: Record<Id, unknown> } | null {
    let latest: Entry | null = null;
    for (const [visitId, records] of recordsByVisit) {
      if (visitId === editing?.id) continue;
      for (const record of records) {
        if (record.itemId !== itemId) continue;
        if ((record.occurredOn ?? "") > occurredOn) continue;
        if (!latest || (record.occurredOn ?? "") > (latest.occurredOn ?? "")) latest = record;
      }
    }
    if (!latest) return null;
    const values = valuesAsRecord(latest.values);
    const summary = recordFields.map((field) => showValue(field, values[field.id as Id])).filter(Boolean).join(" · ");
    return { text: t("lastTime", { values: summary, date: f.date(latest.occurredOn, shortDate) }), values };
  }

  const missingCount = rows.filter((row) => findMissingRequiredField(recordFields, row.values)).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!rows.length) { setError(t("errNoRows")); return; }
    for (const row of rows) {
      const missing = findMissingRequiredField(recordFields, row.values);
      if (missing) {
        setError(tf("fillField", { label: `${itemTitle(row.itemId)} · ${missing.label}` }));
        focusCard(row.itemId as Id);
        return;
      }
    }
    const missingVisit = findMissingRequiredField(visitFields, visitValues);
    if (missingVisit) { setError(tf("fillField", { label: missingVisit.label })); return; }
    setBusy(true);
    try {
      const target = occurredOn || day;
      await onSave({
        occurredOn: target,
        values: visitValues,
        children: rows.map((row) => ({ ...(row.id ? { id: row.id } : {}), itemId: row.itemId as Id, values: row.values })),
      }, editing ?? undefined);
      setSuccess(editing ? t("savedChanges") : t("saved"));
      setDay(target);
      setReopen({ day: target, visitId: editing?.id, known: new Set((visitsByDay.get(target) ?? []).map((visit) => visit.id)) });
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  // Per item: how many check-ins it appeared in, the best of each numeric field, its trend and its latest records.
  const byItem = useMemo(() => {
    const groups = new Map<Id, Array<{ entry: Entry; values: Record<Id, unknown> }>>();
    for (const records of recordsByVisit.values()) {
      for (const entry of records) {
        if (!entry.itemId) continue;
        const list = groups.get(entry.itemId) ?? [];
        list.push({ entry, values: valuesAsRecord(entry.values) });
        groups.set(entry.itemId, list);
      }
    }
    const trendField = numberFields[0];
    return items
      .filter((item) => groups.has(item.id))
      .map((item) => {
        const list = (groups.get(item.id) ?? []).sort((a, b) => (b.entry.occurredOn ?? "").localeCompare(a.entry.occurredOn ?? "") || (b.entry.submittedAt ?? "").localeCompare(a.entry.submittedAt ?? ""));
        const records = recordFields.filter((field) => field.type === "number" || field.type === "rating").flatMap((field) => {
          let best: { value: number; on: string | null } | null = null;
          for (const row of list) {
            const value = numberValue(row.values[field.id as Id]);
            if (value !== null && (!best || value > best.value)) best = { value, on: row.entry.occurredOn ?? null };
          }
          return best ? [{ field, ...best }] : [];
        });
        const trend = trendField
          ? list.slice().reverse().map((row) => numberValue(row.values[trendField.id as Id])).filter((value): value is number => value !== null)
          : [];
        return { item, list, records, trend, sessions: new Set(list.map((row) => row.entry.parentEntryId)).size };
      })
      .sort((a, b) => b.sessions - a.sessions);
  }, [recordsByVisit, items, recordFields, numberFields]);

  // The tray lists the items used most first, so the usual ones are always at hand.
  const trayItems = useMemo(() => {
    const uses = new Map(byItem.map((row) => [row.item.id, row.sessions]));
    return [...items].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || (a.position ?? 0) - (b.position ?? 0));
  }, [items, byItem]);

  if (!items.length && !onAddItem) return <EmptyState title={t("noItems")} />;

  const dayVisits = visitsByDay.get(day) ?? [];
  const lastNumber = (last: { values: Record<Id, unknown> } | null, field: ChallengeField) => (last ? numberValue(last.values[field.id as Id]) : null);
  const deltaText = (field: ChallengeField, current: number, previous: number) => {
    const diff = Number((current - previous).toFixed(4));
    if (diff === 0) return { text: t("deltaSame"), tone: "same" as const };
    const value = nf.number(Math.abs(diff), { maximumFractionDigits: 2 });
    return diff > 0 ? { text: t("deltaUp", { value }), tone: "up" as const } : { text: t("deltaDown", { value }), tone: "down" as const };
  };

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
        <CheckinLog
          from={range.from}
          to={range.to}
          today={today}
          deadline={challenge.endsOn ?? null}
          records={logRecords}
          selectedDay={day}
          onSelectDay={selectDay}
          canEdit={canEdit}
          unavailableMessage={unavailableMessage}
        >
          <form onSubmit={submit} noValidate>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <h3 className="text-sm text-[var(--muted)]">
                {editing ? t("editTitle", { name: spec.visit.name, date: f.date(editing.occurredOn, shortDate) }) : t("composerTitle", { name: spec.visit.name })}
              </h3>
              {editing ? (
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  {t("dateLabel")}
                  <input className={cx(inputClass, "w-40")} type="date" max={today} value={occurredOn} disabled={disabled} onChange={(event) => setOccurredOn(event.target.value || day)} />
                </label>
              ) : null}
            </div>

            {dayVisits.length > 1 || (editing && dayVisits.length) ? (
              <div className="mb-5 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t("onThisDay")}>
                <span className="text-[var(--muted)]">{t("onThisDay")}</span>
                {dayVisits.slice().reverse().map((visit, index) => (
                  <button
                    key={visit.id} type="button" aria-pressed={editing?.id === visit.id} disabled={busy}
                    onClick={() => { setSuccess(null); load(visit, day); }}
                    className={cx("min-h-8 cursor-pointer rounded-full border px-3", editing?.id === visit.id ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] hover:border-[var(--main-line)]")}
                  >
                    {index + 1} · {t("itemCount", { count: recordsByVisit.get(visit.id)?.length ?? 0 })}
                  </button>
                ))}
                {canEdit ? (
                  <button type="button" disabled={busy} onClick={() => { setSuccess(null); load(null, day); }} className={cx("min-h-8 cursor-pointer rounded-full border border-dashed px-3", !editing ? "border-[var(--main)] text-[var(--main-strong)]" : "border-[var(--main-line)] text-[var(--main-strong)] hover:bg-[var(--main-soft)]")}>
                    + {t("newVisitOnDay", { name: spec.visit.name })}
                  </button>
                ) : null}
              </div>
            ) : null}

            <p className={cx("mb-2.5", sectionLabelClass)}>{t("trayLabel")}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={itemsHeading}>
              {trayItems.map((item) => {
                const inside = rows.some((row) => row.itemId === item.id);
                const last = lastRecordFor(item.id);
                const lastLead = last && numberFields[0] ? numberValue(last.values[numberFields[0].id as Id]) : null;
                return (
                  <button
                    key={item.id} type="button" aria-pressed={inside} disabled={disabled}
                    onClick={() => addItemRow(item.id)}
                    className={cx(
                      "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                      inside ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]",
                    )}
                  >
                    <span className={cx("grid h-6 w-6 place-items-center rounded-full text-xs", inside ? "bg-[var(--main)] text-white" : "bg-[var(--wash)] text-[var(--muted)]")} aria-hidden="true">{inside ? "✓" : "+"}</span>
                    {item.title}
                    {lastLead !== null ? <span className="text-[11px] tabular-nums text-[var(--muted)]">{nf.number(lastLead, { maximumFractionDigits: 2 })}</span> : null}
                  </button>
                );
              })}
              {onAddItem && !creating ? (
                <button type="button" disabled={disabled} onClick={() => setCreating({ title: "", busy: false, error: null })} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-dashed border-[var(--main-line)] py-1.5 pl-1.5 pr-3 text-sm text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--main-soft)] text-xs" aria-hidden="true">+</span>{t("newItemPill")}
                </button>
              ) : null}
            </div>
            {creating ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--wash)] p-2.5">
                <input
                  ref={newItemInput} className={cx(inputClass, "min-w-0 flex-1")} value={creating.title} maxLength={200} disabled={creating.busy}
                  placeholder={t("newItemPlaceholder")} aria-label={t("newItemPlaceholder")}
                  onChange={(event) => setCreating({ ...creating, title: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); void createItem(); }
                    if (event.key === "Escape") { event.preventDefault(); setCreating(null); }
                  }}
                />
                <Button type="button" disabled={creating.busy || !creating.title.trim()} onClick={() => void createItem()}>{creating.busy ? tc("saving") : t("newItemAdd")}</Button>
                <Button type="button" variant="ghost" disabled={creating.busy} onClick={() => setCreating(null)}>{tc("cancel")}</Button>
                {creating.error ? <span className="w-full"><StatusMessage error={creating.error} /></span> : null}
              </div>
            ) : null}

            {rows.length ? (
              <ol ref={cardsRef} className="mt-5 space-y-3">
                {rows.map((row, index) => {
                  const last = row.itemId ? lastRecordFor(row.itemId) : null;
                  const best = row.itemId ? bestValues(ownRecords, row.itemId, recordFields.filter((field) => field.type === "number" || field.type === "rating"), editing?.id ?? null) : new Map<Id, number>();
                  const newBests = recordFields.filter((field) => {
                    const value = numberValue(row.values[field.id as Id]);
                    const previous = best.get(field.id as Id);
                    return value !== null && previous !== undefined && value > previous;
                  });
                  return (
                    <li key={row.key} data-item={row.itemId} className="rounded-2xl border border-[var(--line)] bg-[var(--canvas)]/50 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--main-soft)] text-xs font-medium text-[var(--main-strong)]" aria-hidden="true">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <strong className="block text-base font-medium">{itemTitle(row.itemId)}</strong>
                          <span className="block text-xs text-[var(--muted)]">{last ? last.text : t("firstTime")}</span>
                        </div>
                        {last ? (
                          <button
                            type="button" disabled={disabled}
                            className="min-h-9 flex-none cursor-pointer rounded-full px-3 text-xs font-medium text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => patchRow(row.key, { values: { ...last.values } })}
                          >
                            {t("repeatLast")}
                          </button>
                        ) : null}
                        <button
                          type="button" disabled={disabled}
                          className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={t("removeRow", { name: itemTitle(row.itemId) })} title={t("removeRow", { name: itemTitle(row.itemId) })}
                          onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                        >
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] items-start gap-3">
                        {recordFields.map((field) => {
                          const id = `${row.key}-${field.id}`;
                          const current = numberValue(row.values[field.id as Id]);
                          const previous = lastNumber(last, field);
                          const delta = field.type === "number" && current !== null && previous !== null ? deltaText(field, current, previous) : null;
                          return (
                            <div key={field.id}>
                              <label className="mb-1 block text-xs font-medium leading-tight text-[var(--muted)]" htmlFor={id}>
                                {field.label}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : null}
                              </label>
                              {field.type === "number" ? (
                                <NumberStepper id={id} field={field} value={row.values[field.id as Id]} last={previous} disabled={disabled} onChange={(value) => patchRow(row.key, { values: { ...row.values, [field.id as Id]: value } })} />
                              ) : (
                                <CellInput id={id} field={field} disabled={disabled} value={row.values[field.id as Id]} className={cx(inputClass, "text-base")} onChange={(value) => patchRow(row.key, { values: { ...row.values, [field.id as Id]: value } })} />
                              )}
                              {delta ? (
                                <span className={cx("mt-1 block text-[11px] tabular-nums", delta.tone === "up" ? "text-[var(--ok)]" : delta.tone === "down" ? "text-[var(--warn)]" : "text-[var(--muted)]")}>{delta.text}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {newBests.length ? (
                        <p className="mt-3 flex flex-wrap gap-1.5">
                          {newBests.map((field) => (
                            <span key={field.id} className="rounded-full bg-[var(--main-2)]/15 px-2.5 py-1 text-xs font-medium text-[var(--main-2)]">
                              {t("newBest", { field: field.label, value: showValue(field, best.get(field.id as Id)) })}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-center text-sm text-[var(--muted)]">{t("emptyRows", { name: spec.visit.name })}</p>
            )}

            {visitFields.length ? (
              <div className="mt-6 space-y-3">
                {visitFields.map((field) => (
                  <label className="block" key={field.id}>
                    <span className={labelClass}>{field.label}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : <small className="ml-2 font-light text-[var(--muted)]">{tf("optional")}</small>}</span>
                    <CellInput id={`visit-${field.id}`} field={field} disabled={disabled} value={visitValues[field.id as Id]} onChange={(value) => { setVisitValues((current) => ({ ...current, [field.id as Id]: value })); setSuccess(null); }} />
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mt-5"><StatusMessage error={error} success={success} /></div>
            {!canEdit && unavailableMessage ? <p className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage}</p> : null}
            {canEdit ? (
              <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-20 mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-2.5 pl-4 shadow-[var(--elevate-card)] sm:bottom-4">
                <span className="min-w-0 flex-1 text-sm text-[var(--muted)]">
                  {rows.length
                    ? <>{t.rich("summary", { count: rows.length, b: (chunks) => <strong className="font-medium text-[var(--ink)]">{chunks}</strong> })} · {missingCount ? t("summaryMissing", { count: missingCount }) : t("summaryReady")}</>
                    : t("summaryEmpty")}
                </span>
                {editing && onDelete ? <button type="button" className="min-h-11 cursor-pointer px-3 text-sm text-[var(--muted)] hover:text-[var(--danger)]" disabled={busy} onClick={() => setRemoving(editing)}>{t("remove")}</button> : null}
                <Button type="submit" className="min-h-11" disabled={disabled || !rows.length}>
                  {busy ? tc("saving") : editing ? tc("saveChanges") : t("save", { name: spec.visit.name })}<span aria-hidden="true">→</span>
                </Button>
              </div>
            ) : null}
          </form>
        </CheckinLog>
      </section>

      {byItem.length ? (
        <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className={sectionLabelClass}>{t("byItemTitle")}</h2>
            <span className="text-xs text-[var(--muted)]">{t("byItemCount", { count: byItem.length })}</span>
          </div>
          <ul className="grid items-start gap-3 md:grid-cols-2">
            {byItem.map(({ item, list, records, trend, sessions }) => {
              const trendField = numberFields[0];
              const latest = trend.at(-1);
              const change = trend.length > 1 && latest !== undefined ? Number((latest - trend[0]).toFixed(4)) : null;
              const number = (value: number) => nf.number(value, { maximumFractionDigits: 2 });
              const answer = (field: ChallengeField, raw: unknown) => {
                const value = field.type === "number" ? numberValue(raw) : null;
                return value !== null ? number(value) : showValue(field, raw);
              };
              return (
                <li key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-[var(--line)] bg-[var(--canvas)]/50 p-4 sm:p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <strong className="min-w-0 truncate text-base font-medium">{item.title}</strong>
                    <span className="flex-none text-xs text-[var(--muted)]">{t("checkinCountShort", { count: sessions })}</span>
                  </div>

                  {trendField && latest !== undefined ? (
                    <div className="mt-3">
                      <span className="block text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">{t("latestLabel", { field: trendField.label })}</span>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-light tabular-nums tracking-[-0.03em]">{number(latest)}</span>
                        {change === null ? (
                          <span className="text-xs text-[var(--muted)]">{t("firstRecord")}</span>
                        ) : (
                          <span className={cx("text-xs font-medium tabular-nums", change > 0 ? "text-[var(--ok)]" : change < 0 ? "text-[var(--warn)]" : "text-[var(--muted)]")}>
                            {change === 0 ? t("sameAsFirst") : t("sinceFirst", { value: `${change > 0 ? "+" : "−"}${number(Math.abs(change))}` })}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {trend.length > 1 ? <TrendChart values={trend} /> : trendField ? <p className="mt-3 text-xs text-[var(--muted)]">{t("oneMore")}</p> : null}

                  <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-4 gap-y-3 border-t border-[var(--line)] pt-3">
                    {records.map((record) => (
                      <div key={record.field.id} className="min-w-0">
                        <dt className="truncate text-[11px] text-[var(--muted)]">{t("bestLabel", { field: record.field.label })}</dt>
                        <dd className="text-sm font-medium tabular-nums">{number(record.value)}</dd>
                      </div>
                    ))}
                    <div className="min-w-0">
                      <dt className="truncate text-[11px] text-[var(--muted)]">{t("lastOn")}</dt>
                      <dd className="text-sm font-medium">{f.date(list[0]?.entry.occurredOn)}</dd>
                    </div>
                  </dl>

                  <details className="group mt-3">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--ink)] [&::-webkit-details-marker]:hidden">
                      {t("historyToggle")}
                      <ChevronIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <ol className="mt-1 divide-y divide-[var(--line)] text-sm">
                      {list.slice(0, 8).map((row) => (
                        <li key={row.entry.id} className="flex items-baseline justify-between gap-4 py-2">
                          <span className="flex-none text-xs text-[var(--muted)]">{f.date(row.entry.occurredOn)}</span>
                          <span className="min-w-0 truncate text-right tabular-nums">
                            {recordFields.map((field) => {
                              const text = answer(field, row.values[field.id as Id]);
                              return text ? <span key={field.id} className="ml-3 first:ml-0">{text} <span className="text-xs text-[var(--muted)]">{field.label}</span></span> : null;
                            })}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {list.length > 8 ? <p className="mt-1 text-xs text-[var(--muted)]">{t("latestOnly", { count: 8 })}</p> : null}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {removing && onDelete ? (
        <ConfirmDialog
          title={t("deleteTitle", { name: spec.visit.name })}
          body={t("deleteBody", { count: (recordsByVisit.get(removing.id) ?? []).length })}
          confirmLabel={t("remove")}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const wasOpen = editing?.id === removing.id;
            await onDelete(removing.id);
            if (wasOpen) load(null, day);
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}
