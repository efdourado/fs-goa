"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { logRange } from "./checkin-days";
import { CheckinLog, type LogRecord } from "./checkin-log";

import { DeleteButton, DeleteConfirm } from "./dialog";
import { comparisonScore, type ProgressTracking } from "../../lib/progress-tracking";
import { useGoaFormat } from "./format";
import { useLibraryName } from "./libraries";
import type { ChallengeDetail, ChallengeField, Entry, EntryTypeView, FieldConfig, Id } from "./types";
import { SaveButton, cardClass, cx, EmptyState, inputClass, labelClass, Select, StatusMessage } from "./ui";
import { dateKeyInSaoPaulo, displayAnswer, entryValuesReady, findMissingRequiredField, valuesAsRecord } from "./utils";

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

export interface SessionSaveResult {
  id: Id;
  children: Array<{ id: Id; itemId: Id; values: Record<Id, unknown> }>;
}

interface SessionRow {
  key: string;
  id?: Id;
  itemId: Id | "";
  values: Record<Id, unknown>;
}

/** Match the response to the rows actually sent, even if rows changed during the request. */
function reconcileSessionRows(current: SessionRow[], sent: SessionRow[], saved: SessionSaveResult): SessionRow[] {
  const ids = new Map(sent.map((row, index) => [row.key, saved.children[index]?.id]));
  return current.map((row) => ids.has(row.key) ? { ...row, id: ids.get(row.key) } : row);
}

let rowCounter = 0;
/** What this device keeps of a check-in being logged, until it's saved whole. */
interface WorkoutDraft {
  visitId: Id | null;
  rows: Array<{ id?: Id; itemId: Id | ""; values: Record<Id, unknown> }>;
  visitValues: Record<Id, unknown>;
}

/** A stable React key for a row of the form — rows come and go, so an index would mix their inputs up. */
const newRowKey = () => `row-${(rowCounter += 1)}`;

function ratingChoices(config?: FieldConfig): number[] {
  const min = config?.min ?? 0;
  const max = config?.max ?? 5;
  const step = config?.step && config.step > 0 ? config.step : 0.5;
  const count = Math.min(41, Math.floor((max - min) / step) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => Number((min + index * step).toFixed(4)));
}

/** How many items the tray shows before "Show more". */
const TRAY_LIMIT = 8;

// Inputs keep a paper surface and a clear edge inside the tinted session form.
const sessionInputClass = inputClass.replace("bg-transparent", "bg-[var(--paper)]").replace("border-[var(--line)]", "border-[var(--input-edge)]");

/** One field of one record, sized for a card. */
function CellInput({ field, value, disabled, id, onChange, className }: {
  field: ChallengeField; value: unknown; disabled: boolean; id: string; onChange: (value: unknown) => void; className?: string;
}) {
  const cls = className ?? sessionInputClass;
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
      <Select id={id} look="bare" className={cls} disabled={disabled} value={value === null || value === undefined ? "" : String(value)} onChange={(next) => onChange(next === "" ? "" : Number(next))}
        options={[{ value: "", label: "—" }, ...ratingChoices(field.config).map((rating) => ({ value: String(rating), label: String(rating).replace(".", ",") }))]} />
    );
  }
  if (field.type === "select") {
    return (
      <Select id={id} look="bare" className={cls} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={onChange}
        options={[{ value: "", label: t("select") }, ...(field.config?.options ?? []).filter((option) => !option.archived).map((option) => ({ value: option.id ?? option.value ?? option.label, label: option.label }))]} />
    );
  }
  if (field.type === "boolean") {
    return (
      <Select id={id} look="bare" className={cls} disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(next) => onChange(next === "" ? "" : next === "yes")}
        options={[{ value: "", label: "—" }, { value: "yes", label: tc("yes") }, { value: "no", label: tc("no") }]} />
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
export function bestValues(records: Iterable<Entry>, itemId: Id, fields: ChallengeField[], skipVisitId: Id | null,
  performance?: ProgressTracking["performance"], currentValues: Record<Id, unknown> = {}, day?: string): Map<Id, number> {
  const best = new Map<Id, number>();
  for (const record of records) {
    if (record.itemId !== itemId || (skipVisitId && record.parentEntryId === skipVisitId)) continue;
    if (day && record.occurredOn && record.occurredOn > day) continue;
    const values = valuesAsRecord(record.values);
    if (performance?.seriesFieldId && (numberValue(currentValues[performance.seriesFieldId]) === null || numberValue(values[performance.seriesFieldId]) !== numberValue(currentValues[performance.seriesFieldId]))) continue;
    for (const field of fields) {
      const rule = performance?.rules?.[field.id!];
      if (field.id === performance?.seriesFieldId || rule?.direction === "descriptive") continue;
      if (rule?.contextFieldId && (numberValue(currentValues[rule.contextFieldId]) === null || numberValue(values[rule.contextFieldId]) !== numberValue(currentValues[rule.contextFieldId]))) continue;
      const value = numberValue(values[field.id as Id]);
      if (value !== null && (!best.has(field.id as Id) || comparisonScore(value, rule) > comparisonScore(best.get(field.id as Id)!, rule))) best.set(field.id as Id, value);
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
    <div className="flex items-stretch overflow-hidden rounded-xl border border-[var(--input-edge)] bg-[var(--paper)] focus-within:border-[var(--main)] focus-within:ring-[3px] focus-within:ring-[var(--main-soft)]">
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

/**
 * A workout-style challenge on Today: the days you checked in (the same strip / month as a daily log, each day
 * showing how many items it held), and the inline editor for the picked day: pick its items, then each is one row —
 * last time's numbers a tap away, its fields, a new best marked — with more items behind "+ Add". Done saves now.
 * How each item went over time is Results' job, not this screen's.
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
  onSave: (payload: SessionPayload, entry?: Entry) => Promise<SessionSaveResult>;
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
  const performance = challenge.trackingSettings?.performance;
  const today = dateKeyInSaoPaulo(new Date());
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
    const visitDates = new Map(ownVisits.map((visit) => [visit.id, visit.occurredOn]));
    for (const entry of entries) {
      if (entry.entryTypeId !== spec.record.id || !entry.parentEntryId || entry.userId !== userId) continue;
      const list = map.get(entry.parentEntryId) ?? [];
      list.push({ ...entry, occurredOn: entry.occurredOn ?? visitDates.get(entry.parentEntryId) });
      map.set(entry.parentEntryId, list);
    }
    return map;
  }, [entries, ownVisits, spec.record.id, userId]);
  const ownRecords = useMemo(() => [...recordsByVisit.values()].flat(), [recordsByVisit]);
  const sortedRecords = (visitId: Id) => (recordsByVisit.get(visitId) ?? []).slice().sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  // A saved record without a required field was made before that field existed (a later one could never be saved
  // without it): there the field is optional, so adding "Carga 2" to the template never locks an old workout.
  const savedValues = useMemo(() => new Map([...recordsByVisit.values()].flat().map((record) => [record.id, valuesAsRecord(record.values)])), [recordsByVisit]);
  const requiredFor = (fields: ChallengeField[], saved: Record<Id, unknown> | undefined) => (saved
    ? fields.filter((field) => !field.required || !field.id || (saved[field.id] !== undefined && saved[field.id] !== null && saved[field.id] !== ""))
    : fields);
  const rowGap = (row: SessionRow) => findMissingRequiredField(requiredFor(recordFields, row.id ? savedValues.get(row.id) : undefined), row.values);
  const visitGapOf = (visit: Entry | null | undefined, values: Record<Id, unknown>) => findMissingRequiredField(requiredFor(visitFields, visit ? valuesAsRecord(visit.values) : undefined), values);

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
  const [rows, setRows] = useState<SessionRow[]>(() => (editing ? sortedRecords(editing.id).map((record) => ({ key: newRowKey(), id: record.id, itemId: record.itemId ?? "", values: valuesAsRecord(record.values) })) : []));
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // "New item" being named in the tray. It never touches the rows until the item exists.
  const [creating, setCreating] = useState<{ title: string; busy: boolean; error: string | null } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  // "+ Add" opened the list of items (it's folded away while there's a check-in to repeat).
  const [adding, setAdding] = useState(false);
  const newItemInput = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLOListElement>(null);
  const isCreating = creating !== null;
  useEffect(() => { if (isCreating) newItemInput.current?.focus(); }, [isCreating]);
  const [finishing, setFinishing] = useState(false);
  const actionBusy = useRef(false);
  const disabled = !canEdit || finishing || Boolean(creating?.busy);

  function load(visit: Entry | null, onDay: string) {
    skipNextChange.current = true;
    setEditing(visit);
    setAdding(false);
    setRemoving(false);
    setOccurredOn(visit?.occurredOn ?? onDay);
    setVisitValues(visit ? valuesAsRecord(visit.values) : {});
    setRows(visit ? sortedRecords(visit.id).map((record) => ({ key: newRowKey(), id: record.id, itemId: record.itemId ?? "", values: valuesAsRecord(record.values) })) : []);
    setError(null);
  }

  // The inline editor saves as you go; Done flushes any pending changes.
  // Every change is kept on this device at once (a draft), and a moment later the rows that are complete are
  // saved for real. Done flushes the same save chain immediately.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "incomplete" | "error">(editing ? "saved" : "idle");
  const saveRequest = useRef<Promise<void> | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveFailed = useRef(false);
  const retry = useRef(false);
  // A change made by loading or adopting a check-in, not by the person — nothing to save.
  const skipNextChange = useRef(true);
  const latest = useRef({ rows, visitValues, editing, occurredOn, day });
  useEffect(() => { latest.current = { rows, visitValues, editing, occurredOn, day }; });

  const draftKey = (onDay: string, visitId?: Id | null) => `goa.workout.${challenge.id}.${onDay}${visitId === undefined ? "" : `.${visitId ?? "new"}`}`;
  function readDraft(onDay: string, visitId: Id | null): WorkoutDraft | null {
    try {
      const raw = window.localStorage.getItem(draftKey(onDay, visitId)) ?? window.localStorage.getItem(draftKey(onDay));
      const draft = raw ? JSON.parse(raw) as WorkoutDraft : null;
      return draft?.visitId === visitId && Array.isArray(draft.rows) && draft.visitValues && typeof draft.visitValues === "object" ? draft : null;
    } catch { return null; }
  }
  function writeDraft(onDay: string, draft: WorkoutDraft) {
    try { window.localStorage.setItem(draftKey(onDay, draft.visitId), JSON.stringify(draft)); } catch { /* storage refused: the server save still runs */ }
  }
  function clearDraft(onDay: string, visitId: Id | null) {
    try {
      window.localStorage.removeItem(draftKey(onDay, visitId));
      const legacy = window.localStorage.getItem(draftKey(onDay));
      if (legacy && JSON.parse(legacy).visitId === visitId) window.localStorage.removeItem(draftKey(onDay));
    } catch { /* nothing to clear */ }
  }
  function restoreDraft(onDay: string, visit: Entry | null) {
    const draft = readDraft(onDay, visit?.id ?? null);
    if (!draft) return;
    skipNextChange.current = false;
    setRows(draft.rows.map((row) => ({ ...row, key: newRowKey() })));
    setVisitValues(draft.visitValues);
  }
  // Restore after hydration, without replacing the editor when autosave refreshes the server props.
  useEffect(() => {
    if (canEdit) restoreDraft(day, editing);
    skipNextChange.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancelSaveTimer() {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }

  /** Every caller awaits the same save chain, including edits queued during a request. */
  function autosave(): Promise<void> {
    if (saveRequest.current) { retry.current = true; return saveRequest.current; }
    const request = (async () => {
      do {
        retry.current = false;
        await saveCurrent();
      } while (retry.current);
    })();
    saveRequest.current = request;
    void request.finally(() => { if (saveRequest.current === request) saveRequest.current = null; });
    return request;
  }

  async function saveCurrent() {
    if (!canEdit) return;
    saveFailed.current = false;
    const { rows: current, visitValues: values, editing: visit, occurredOn: on, day: onDay } = latest.current;
    if (!current.length && !visit) { setSaveState("idle"); return; }
    const complete = current.filter((row) => row.itemId && !rowGap(row));
    if ((!complete.length && current.length > 0) || visitGapOf(visit, values)) { setSaveState("incomplete"); return; }
    setSaveState("saving");
    try {
      const target = on || onDay;
      const saved = await onSave({
        occurredOn: target,
        values,
        children: complete.map((row) => ({ ...(row.id ? { id: row.id } : {}), itemId: row.itemId as Id, values: row.values })),
      }, visit ?? undefined);
      // Learn identities before releasing the save lock. A timer or Done tap
      // queued during this request must PATCH this workout, never POST another.
      const changed = latest.current.rows !== current || latest.current.visitValues !== values;
      const nextRows = reconcileSessionRows(latest.current.rows, complete, saved);
      if (changed) retry.current = true;
      const savedVisit: Entry = { ...visit, id: saved.id, entryTypeId: spec.visit.id, userId, occurredOn: target, values };
      latest.current = { ...latest.current, editing: savedVisit, rows: nextRows };
      skipNextChange.current = true;
      setEditing(savedVisit);
      setRows(nextRows);
      const allSaved = complete.length === current.length;
      setSaveState(allSaved ? "saved" : "incomplete");
      clearDraft(onDay, visit?.id ?? null);
      if (allSaved && !changed) clearDraft(onDay, saved.id);
      else writeDraft(onDay, { visitId: saved.id, rows: nextRows, visitValues: latest.current.visitValues });
    } catch (cause) {
      saveFailed.current = true;
      setSaveState("error");
      setError(f.error(cause));
    }
  }

  // Each change: kept on the device now, saved for real a moment after the typing stops.
  useEffect(() => {
    if (!canEdit) return;
    if (skipNextChange.current) { skipNextChange.current = false; return; }
    writeDraft(day, { visitId: editing?.id ?? null, rows: rows.map(({ id, itemId, values }) => ({ id, itemId, values })), visitValues });
    saveTimer.current = window.setTimeout(() => { saveTimer.current = null; void autosave(); }, 900);
    return cancelSaveTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visitValues]);

  /** Saves the current editor before switching days/sessions, so a late response cannot overwrite another session. */
  async function switchEditor(visit: Entry | null, onDay = day) {
    if (actionBusy.current || disabled || (onDay === day && visit?.id === editing?.id)) return;
    actionBusy.current = true;
    setFinishing(true);
    cancelSaveTimer();
    try {
      await autosave();
      if (saveFailed.current) return;
      setDay(onDay);
      setCreating(null);
      load(visit, onDay);
      restoreDraft(onDay, visit);
      setSaveState(visit ? "saved" : "idle");
    } finally {
      actionBusy.current = false;
      setFinishing(false);
    }
  }

  async function finishSession() {
    if (actionBusy.current || disabled || !readyToFinish) return;
    actionBusy.current = true;
    setFinishing(true);
    cancelSaveTimer();
    try { await autosave(); }
    finally { actionBusy.current = false; setFinishing(false); }
  }

  function selectDay(next: string) {
    if (!canEdit) {
      setDay(next);
      load(visitsByDay.get(next)?.[0] ?? null, next);
      return;
    }
    void switchEditor(visitsByDay.get(next)?.[0] ?? null, next);
  }

  function focusCard(itemId: Id) {
    const card = cardsRef.current?.querySelector<HTMLElement>(`[data-item="${itemId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
  }

  /** The tray is a toggle: tapping an item in the check-in takes it (and its card) back out. */
  function toggleItemRow(itemId: Id) {
    if (rows.some((row) => row.itemId === itemId)) {
      setRows((current) => current.filter((row) => row.itemId !== itemId));
      return;
    }
    addItemRow(itemId);
  }

  const startCreating = () => setCreating({ title: "", busy: false, error: null });

  function addItemRow(itemId: Id) {
    if (rows.some((row) => row.itemId === itemId)) { focusCard(itemId); return; }
    setRows((current) => [...current, { key: newRowKey(), itemId, values: performance?.seriesFieldId ? { [performance.seriesFieldId]: 1 } : {} }]);
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

  function patchRow(key: string, patch: Partial<SessionRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /** The most recent record of an item before the check-in being edited: what each field's change is measured against. */
  function lastRecordFor(itemId: Id, currentValues?: Record<Id, unknown>): { values: Record<Id, unknown> } | null {
    let latest: Entry | null = null;
    for (const [visitId, records] of recordsByVisit) {
      if (visitId === editing?.id) continue;
      for (const record of records) {
        if (record.itemId !== itemId) continue;
        if (performance?.seriesFieldId && currentValues && numberValue(valuesAsRecord(record.values)[performance.seriesFieldId]) !== numberValue(currentValues[performance.seriesFieldId])) continue;
        if ((record.occurredOn ?? "") > occurredOn) continue;
        if (!latest || (record.occurredOn ?? "") > (latest.occurredOn ?? "")) latest = record;
      }
    }
    if (!latest) return null;
    return { values: valuesAsRecord(latest.values) };
  }

  // How many of your check-ins each item was in — the tray lists the usual ones first.
  const usage = useMemo(() => {
    const visitsOf = new Map<Id, Set<Id>>();
    for (const record of ownRecords) {
      if (!record.itemId || !record.parentEntryId) continue;
      const set = visitsOf.get(record.itemId) ?? new Set<Id>();
      set.add(record.parentEntryId);
      visitsOf.set(record.itemId, set);
    }
    return new Map([...visitsOf].map(([itemId, visits]) => [itemId, visits.size]));
  }, [ownRecords]);
  // The tray lists the items used most first, so the usual ones are always at hand.
  const trayItems = useMemo(
    () => [...items].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || (a.position ?? 0) - (b.position ?? 0)),
    [items, usage],
  );
  // The usual ones first; the rest behind "Show more". Whatever is already in this check-in stays in view
  // so it can be tapped back out.
  const picked = new Set(rows.map((row) => row.itemId));
  const visibleTray = trayOpen ? trayItems : trayItems.filter((item, index) => index < TRAY_LIMIT || picked.has(item.id));
  const hiddenTrayCount = trayItems.length - visibleTray.length;

  if (!items.length && !onAddItem) return <EmptyState title={t("noItems")} />;

  const dayVisits = visitsByDay.get(day) ?? [];
  const availableVisits = [...dayVisits].reverse();
  if (editing && !availableVisits.some((visit) => visit.id === editing.id)) availableVisits.push(editing);
  /** "62,5 kg · 8" — a saved record in one line. */
  const recordSummary = (record: Entry) => {
    const values = valuesAsRecord(record.values);
    return recordFields.map((field) => {
      const value = numberValue(values[field.id as Id]);
      return value !== null ? `${nf.number(value, { maximumFractionDigits: 2 })}${field.config?.unit ? ` ${field.config.unit}` : ""}` : showValue(field, values[field.id as Id]);
    }).filter(Boolean).join(" · ");
  };
  // What the draft still needs, said plainly: "Supino · Repetições".
  const firstGap = rows.map((row) => ({ row, missing: rowGap(row) })).find((candidate) => candidate.missing);
  const visitGap = visitGapOf(editing, visitValues);
  const readyToFinish = Boolean(rows.length || editing) && !firstGap && !visitGap
    && rows.every((row) => entryValuesReady(requiredFor(recordFields, row.id ? savedValues.get(row.id) : undefined), row.values))
    && entryValuesReady(requiredFor(visitFields, editing ? valuesAsRecord(editing.values) : undefined), visitValues);
  const missingText = firstGap?.missing ? `${itemTitle(firstGap.row.itemId)} · ${firstGap.missing.label}` : visitGap?.label ?? "";
  // One thing at a time: an empty check-in starts by picking its items; once it has some, more wait behind "+ Add".
  const showTray = adding || !rows.length;
  const lastNumber = (last: { values: Record<Id, unknown> } | null, field: ChallengeField) => (last ? numberValue(last.values[field.id as Id]) : null);
  const deltaText = (field: ChallengeField, current: number, previous: number) => {
    const diff = Number((current - previous).toFixed(4));
    if (diff === 0) return { text: t("deltaSame"), tone: "same" as const };
    const value = `${nf.number(Math.abs(diff), { maximumFractionDigits: 2 })}${field.config?.unit ? ` ${field.config.unit}` : ""}`;
    const rule = performance?.rules?.[field.id!];
    const tone = rule?.direction === "descriptive" || field.id === performance?.seriesFieldId ? "same" as const : comparisonScore(current, rule) > comparisonScore(previous, rule) ? "up" as const : "down" as const;
    return { text: t(diff > 0 ? "deltaUp" : "deltaDown", { value }), tone };
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
          openEnded={!challenge.startsOn && !challenge.endsOn}
          streakBy="week"
        >
          {canEdit ? <form className="rounded-[20px] border border-[var(--line)] bg-[var(--session-surface)] p-5 sm:p-6" aria-label={t("composerTitle", { name: spec.visit.name })} noValidate onSubmit={(event) => { event.preventDefault(); void finishSession(); }}>
            <h2 className="mb-4 text-lg font-medium tracking-[-0.02em]">{day === today ? t("sheetToday", { name: spec.visit.name }) : t("sheetOnDay", { name: spec.visit.name, date: f.date(day, { day: "numeric", month: "short" }) })}</h2>
            {availableVisits.length ? <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t("chooseSession")}>
              {availableVisits.map((visit, index) => <button key={visit.id} type="button" disabled={disabled} aria-pressed={editing?.id === visit.id} onClick={() => void switchEditor(visit)} className={cx("min-h-9 cursor-pointer rounded-full border px-3 text-xs transition disabled:opacity-50", editing?.id === visit.id ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]")}>{availableVisits.length > 1 ? t("visitNumbered", { name: spec.visit.name, number: index + 1 }) : spec.visit.name}</button>)}
              <button type="button" disabled={disabled} aria-pressed={!editing} onClick={() => void switchEditor(null)} className="min-h-9 cursor-pointer rounded-full border border-dashed border-[var(--line)] px-3 text-xs text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-50">＋ {t("newVisitOnDay", { name: spec.visit.name.toLowerCase() })}</button>
            </div> : null}
          {/* One even rhythm: status, today's items, the rest to pick from, the check-in's own fields. */}
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              {/* Saving happens on its own: this line says where it stands. */}
              <p className={cx("flex min-w-0 items-center gap-2 text-xs", saveState === "error" ? "text-[var(--danger)]" : saveState === "incomplete" ? "text-[var(--warn)]" : "text-[var(--muted)]")} role="status" aria-live="polite">
                <span className={cx("h-2 w-2 flex-none rounded-full", saveState === "saved" ? "bg-[var(--ok)]" : saveState === "saving" ? "animate-pulse bg-[var(--main)]" : saveState === "error" ? "bg-[var(--danger)]" : saveState === "incomplete" ? "bg-[var(--warn)]" : "bg-[var(--line)]")} aria-hidden="true" />
                <span className="min-w-0">{saveState === "saving" ? t("autoSaving") : saveState === "saved" ? t("autoSaved") : saveState === "error" ? t("autoError") : saveState === "incomplete" ? t("autoDraft", { what: missingText }) : t("autoIdle")}</span>
              </p>
            </div>
            {saveState === "error" && error ? <StatusMessage error={error} /> : null}
          {rows.length ? (
            <ol ref={cardsRef} className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] px-4">
              {rows.map((row) => {
                const last = row.itemId ? lastRecordFor(row.itemId, row.values) : null;
                const best = row.itemId ? bestValues(ownRecords, row.itemId, recordFields.filter((field) => field.type === "number" || field.type === "rating"), editing?.id ?? null, performance, row.values, occurredOn) : new Map<Id, number>();
                const newBests = recordFields.filter((field) => {
                  const value = numberValue(row.values[field.id as Id]);
                  const previous = best.get(field.id as Id);
                  return value !== null && previous !== undefined && comparisonScore(value, performance?.rules?.[field.id!]) > comparisonScore(previous, performance?.rules?.[field.id!]);
                });
                return (
                  <li key={row.key} data-item={row.itemId} className="py-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[15px] font-medium">{itemTitle(row.itemId)}</strong>
                      </div>
                      <button type="button" disabled={disabled} aria-label={t("removeRow", { item: itemTitle(row.itemId) })} onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))} className="min-h-9 flex-none cursor-pointer px-1 text-[13px] font-light text-[var(--muted)]/80 transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-50">
                        {tc("remove")}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 items-start gap-2.5 [&>*:last-child:nth-child(odd)]:col-span-2">
                      {recordFields.map((field) => {
                        const id = `${row.key}-${field.id}`;
                        const current = numberValue(row.values[field.id as Id]);
                        const context = performance?.rules?.[field.id!]?.contextFieldId;
                        const comparable = !context || (numberValue(row.values[context]) !== null && numberValue(row.values[context]) === numberValue(last?.values[context]));
                        const previous = comparable ? lastNumber(last, field) : null;
                        const delta = field.type === "number" && current !== null && previous !== null ? deltaText(field, current, previous) : null;
                        return (
                          <div key={field.id} className="min-w-0">
                            <label className="mb-1 block truncate text-[11px] font-medium text-[var(--muted)]" htmlFor={id}>
                              {field.label}{field.config?.unit ? ` (${field.config.unit})` : ""}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : null}
                            </label>
                            {field.type === "number" ? (
                              <NumberStepper id={id} field={field} value={row.values[field.id as Id]} last={previous} disabled={disabled} onChange={(value) => patchRow(row.key, { values: { ...row.values, [field.id as Id]: value } })} />
                            ) : (
                              <CellInput id={id} field={field} disabled={disabled} value={row.values[field.id as Id]} className={cx(sessionInputClass, "text-base")} onChange={(value) => patchRow(row.key, { values: { ...row.values, [field.id as Id]: value } })} />
                            )}
                            {delta ? (
                              <span className={cx("mt-1 block text-[11px] tabular-nums", delta.tone === "up" ? "text-[var(--ok)]" : delta.tone === "down" ? "text-[var(--warn)]" : "text-[var(--muted)]")}>{delta.text}</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" disabled={disabled} className="mt-3 cursor-pointer text-xs font-medium text-[var(--main-strong)] disabled:opacity-50" onClick={() => setRows((current) => {
                      const fieldId = performance?.seriesFieldId;
                      const next = fieldId ? Math.max(0, ...current.filter((candidate) => candidate.itemId === row.itemId).map((candidate) => numberValue(candidate.values[fieldId]) ?? 0)) + 1 : null;
                      return [...current, { key: newRowKey(), itemId: row.itemId, values: fieldId ? { [fieldId]: next } : {} }];
                    })}>{t(performance?.seriesFieldId ? "addSet" : "addRecord")}</button>
                    {newBests.length ? (
                      <p className="mt-2.5 flex flex-wrap gap-1.5">
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
          ) : null}
            {showTray ? (
              // The items to pick from: one roomy row each (big enough for a thumb at the gym), the usual ones first.
              <section>
                <h3 className="mb-2 text-xs font-medium text-[var(--muted)]">{itemsHeading}</h3>
                <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
                  {visibleTray.map((item) => {
                    const inside = rows.some((row) => row.itemId === item.id);
                    const last = lastRecordFor(item.id);
                    const lastLead = last && numberFields[0] ? numberValue(last.values[numberFields[0].id as Id]) : null;
                    return (
                      <li key={item.id}>
                        <button
                          type="button" aria-pressed={inside} disabled={disabled}
                          onClick={() => toggleItemRow(item.id)}
                          className={cx("flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50", inside ? "bg-[var(--main-soft)]" : "hover:bg-[var(--wash)]")}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cx("block truncate text-[15px]", inside && "font-medium text-[var(--main-strong)]")}>{item.title}</span>
                            {lastLead !== null ? <span className="block text-xs tabular-nums text-[var(--muted)]">{nf.number(lastLead, { maximumFractionDigits: 2 })}{numberFields[0]?.config?.unit ? ` ${numberFields[0].config.unit}` : ""}</span> : null}
                          </span>
                          <span className={cx("grid h-8 w-8 flex-none place-items-center rounded-full text-sm", inside ? "bg-[var(--main)] text-white" : "border border-[var(--line)] text-[var(--muted)]")} aria-hidden="true">{inside ? "✓" : "+"}</span>
                        </button>
                      </li>
                    );
                  })}
                  {hiddenTrayCount > 0 || trayOpen ? (
                    <li>
                      <button type="button" onClick={() => setTrayOpen((open) => !open)} className="flex min-h-11 w-full cursor-pointer items-center justify-center text-xs text-[var(--muted)] transition hover:text-[var(--ink-strong)]">
                        {trayOpen ? t("trayLess") : t("trayMore", { count: hiddenTrayCount })}
                      </button>
                    </li>
                  ) : null}
                </ul>
                {/* A new one: the same dashed pill as "add a field". It opens a small box right here (never a second
                    modal over the editor) with what it is, what it does, and the name to type. */}
                {onAddItem && creating ? (
                  // A soft card in the pill's place (never a second modal over the editor): what it is, a large line to
                  // type the name on, and underneath a way out on the left and an arrow to add on the right.
                  <div className="mt-3">
                    <div className="rounded-2xl bg-[var(--wash)] px-4 py-3">
                      <p className="text-xs text-[var(--muted)]">{t("newItemPill")}</p>
                      <input
                        ref={newItemInput}
                        className="mt-2 w-full bg-transparent py-0.5 text-[15px] outline-none"
                        value={creating.title} maxLength={200} disabled={creating.busy}
                        aria-label={t("newItemPlaceholder")}
                        enterKeyHint="done"
                        onChange={(event) => setCreating({ ...creating, title: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") { event.preventDefault(); void createItem(); }
                          if (event.key === "Escape") { event.preventDefault(); setCreating(null); }
                        }}
                      />
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-2">
                        <button type="button" disabled={creating.busy} onClick={() => setCreating(null)} className="cursor-pointer text-xs text-[var(--muted)] transition hover:text-[var(--ink-strong)]">{tc("cancel")}</button>
                        <button
                          type="button"
                          disabled={creating.busy || !creating.title.trim()}
                          aria-label={t("newItemAdd")}
                          title={t("newItemAdd")}
                          onClick={() => void createItem()}
                          className="grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)] transition hover:bg-[var(--ink-strong)] disabled:cursor-default disabled:bg-[var(--wash-strong)] disabled:text-[var(--muted)]"
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8h9M8.5 4l4 4-4 4" /></svg>
                        </button>
                      </div>
                    </div>
                    {creating.error ? <div className="mt-2"><StatusMessage error={creating.error} /></div> : null}
                  </div>
                ) : onAddItem ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={startCreating}
                    className="mt-3 flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-4 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ＋ {t("newItemPill")}
                  </button>
                ) : null}
              </section>
            ) : canEdit ? (
              <button type="button" disabled={disabled} aria-label={t("addRows")} title={t("addRows")} onClick={() => setAdding(true)} className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--line)] text-lg text-[var(--ink)] transition hover:border-[var(--muted)] hover:text-[var(--ink-strong)] disabled:opacity-50">
                <span aria-hidden="true">＋</span>
              </button>
            ) : null}

            {visitFields.length ? (
              <div className="space-y-3">
                {visitFields.map((field) => (
                  <label className="block" key={field.id}>
                    <span className={labelClass}>{field.label}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : <small className="ml-2 font-light text-[var(--muted)]">{tf("optional")}</small>}</span>
                    <CellInput id={`visit-${field.id}`} field={field} disabled={disabled} value={visitValues[field.id as Id]} onChange={(value) => { setVisitValues((current) => ({ ...current, [field.id as Id]: value })); }} />
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          {removing && editing && onDelete ? (
            <div className="mt-6">
              <DeleteConfirm
                body={t("deleteBody", { count: (recordsByVisit.get(editing.id) ?? []).length })}
                onConfirm={async () => {
                  if (actionBusy.current || disabled) return;
                  actionBusy.current = true;
                  setFinishing(true);
                  cancelSaveTimer();
                  try {
                    await autosave();
                    await onDelete(editing.id);
                    clearDraft(day, editing.id);
                    load(null, day);
                    setSaveState("idle");
                  } finally {
                    actionBusy.current = false;
                    setFinishing(false);
                  }
                }}
              />
            </div>
          ) : null}
          {/* The bar stays at the bottom, clear of the phone's home area. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-col items-stretch gap-3 rounded-b-[20px] border-t border-[var(--line)] bg-[var(--session-surface)] px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            {editing && onDelete ? <div className="self-start"><DeleteButton open={removing} disabled={disabled} onClick={() => setRemoving((open) => !open)} /></div> : null}
            <SaveButton type="submit" className="w-full px-6" disabled={disabled || !readyToFinish}>{finishing ? t("autoSaving") : t("done")}</SaveButton>
          </div>
          </form> : (
          <div className="space-y-3">
            {dayVisits.slice().reverse().map((visit, index) => {
              const records = sortedRecords(visit.id);
              // Closed/read-only sessions keep their compact summaries.
              const body = (
                <>
                  <span className="flex items-center gap-3">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[var(--main-soft)] text-[var(--main-strong)]" aria-hidden="true">
                      <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10.4l3.200 3.200L15 6.800" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[15px] font-medium tracking-[-0.01em]">{dayVisits.length > 1 ? t("visitNumbered", { name: spec.visit.name, number: index + 1 }) : spec.visit.name}</strong>
                      <span className="block text-xs text-[var(--muted)]">{t("visitCount", { count: records.length })}</span>
                    </span>
                  </span>
                  {records.length ? (
                    <span className="mt-3.5 block divide-y divide-[var(--line)] border-t border-[var(--line)]">
                      {records.map((record) => (
                        <span key={record.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm last:pb-0">
                          <span className="min-w-0 truncate">{itemTitle(record.itemId)}</span>
                          <span className="flex-none text-[13px] tabular-nums text-[var(--muted)]">{recordSummary(record)}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </>
              );
              const shell = "block w-full rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-left";
              return <div key={visit.id} className={shell}>{body}</div>;
            })}
            {unavailableMessage ? <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage}</p> : null}
          </div>
          )}
        </CheckinLog>
      </section>
    </div>
  );
}
