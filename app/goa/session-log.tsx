"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { logRange } from "./checkin-days";
import { CheckinLog, type LogRecord } from "./checkin-log";

import { BottomSheet } from "./bottom-sheet";
import { ConfirmDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { useLibraryName } from "./libraries";
import type { ChallengeDetail, ChallengeField, Entry, EntryTypeView, FieldConfig, Id } from "./types";
import { Button, cardClass, cx, EmptyState, inputClass, labelClass, StatusMessage } from "./ui";
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

/**
 * A workout-style challenge on Today: the days you checked in (the same strip / month as a daily log, each day
 * showing how many items it held), and the check-in of the picked day: pick its items, then each is one row —
 * last time's numbers a tap away, its fields, a new best marked — with more items behind "+ Add". One Save.
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
  onRename,
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
  /** Present for a manager — renames what one check-in is called ("Treino"). */
  onRename?: (name: string) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  // "New item" being named in the tray. It never touches the rows until the item exists.
  const [creating, setCreating] = useState<{ title: string; busy: boolean; error: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; busy: boolean; error: string | null } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  // "+ Add" opened the list of items (it's folded away while there's a check-in to repeat).
  const [adding, setAdding] = useState(false);
  // After a save, the check-in to reopen once the reload brings it back: the edited one, or the newest of that day.
  const [reopen, setReopen] = useState<{ day: string; visitId?: Id; known: Set<Id> } | null>(null);
  const newItemInput = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLOListElement>(null);
  const isCreating = creating !== null;
  useEffect(() => { if (isCreating) newItemInput.current?.focus(); }, [isCreating]);
  const renameInput = useRef<HTMLInputElement>(null);
  const isRenaming = renaming !== null;
  useEffect(() => { if (isRenaming) renameInput.current?.select(); }, [isRenaming]);
  const disabled = !canEdit;

  function load(visit: Entry | null, onDay: string) {
    setEditing(visit);
    setAdding(false);
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
    adopt(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen, visitsByDay]);

  // ── Logging in the sheet, saved as you go ───────────────────────────────
  // Every change is kept on this device at once (a draft), and a moment later the rows that are complete are
  // saved for real — so a dropped connection at the gym never loses a set, and there's no Save to remember.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "incomplete" | "error">("idle");
  const saving = useRef(false);
  const retry = useRef(false);
  // A new check-in was saved and is on its way back with its id; another save now would make a second one.
  const awaiting = useRef(false);
  // A change made by loading or adopting a check-in, not by the person — nothing to save.
  const skipNextChange = useRef(true);
  const latest = useRef({ rows, visitValues, editing, occurredOn, day, visitsByDay });
  useEffect(() => { latest.current = { rows, visitValues, editing, occurredOn, day, visitsByDay }; });

  const draftKey = (onDay: string) => `goa.workout.${challenge.id}.${onDay}`;
  function readDraft(onDay: string): WorkoutDraft | null {
    try {
      const raw = window.localStorage.getItem(draftKey(onDay));
      return raw ? (JSON.parse(raw) as WorkoutDraft) : null;
    } catch {
      return null;
    }
  }
  function writeDraft(onDay: string, draft: WorkoutDraft) {
    try { window.localStorage.setItem(draftKey(onDay), JSON.stringify(draft)); } catch { /* storage refused: the server save still runs */ }
  }
  function clearDraft(onDay: string) {
    try { window.localStorage.removeItem(draftKey(onDay)); } catch { /* nothing to clear */ }
  }

  /** The saved check-in came back: keep what's on screen, just learn the ids its rows were given. */
  function adopt(visit: Entry) {
    skipNextChange.current = true;
    setEditing(visit);
    const records = sortedRecords(visit.id);
    const used = new Set(latest.current.rows.map((row) => row.id).filter(Boolean));
    const next = latest.current.rows.map((row) => {
      if (row.id) return row;
      const match = records.find((record) => record.itemId === row.itemId && !used.has(record.id));
      if (!match) return row;
      used.add(match.id);
      return { ...row, id: match.id };
    });
    setRows(next);
    if (next.some((row) => findMissingRequiredField(recordFields, row.values))) {
      writeDraft(latest.current.day, { visitId: visit.id, rows: next.map(({ id, itemId, values }) => ({ id, itemId, values })), visitValues: latest.current.visitValues });
    }
    awaiting.current = false;
    if (retry.current) {
      retry.current = false;
      window.setTimeout(() => { void autosave(); }, 0);
    }
  }

  async function autosave() {
    if (!canEdit) return;
    if (saving.current || awaiting.current) { retry.current = true; return; }
    const { rows: current, visitValues: values, editing: visit, occurredOn: on, day: onDay, visitsByDay: byDay } = latest.current;
    if (!current.length) { setSaveState("idle"); return; }
    const complete = current.filter((row) => row.itemId && !findMissingRequiredField(recordFields, row.values));
    if (!complete.length || findMissingRequiredField(visitFields, values)) { setSaveState("incomplete"); return; }
    saving.current = true;
    setSaveState("saving");
    try {
      const target = on || onDay;
      const known = new Set((byDay.get(target) ?? []).map((candidate) => candidate.id));
      await onSave({
        occurredOn: target,
        values,
        children: complete.map((row) => ({ ...(row.id ? { id: row.id } : {}), itemId: row.itemId as Id, values: row.values })),
      }, visit ?? undefined);
      if (!visit) awaiting.current = true;
      setReopen({ day: target, visitId: visit?.id, known });
      const allSaved = complete.length === current.length;
      setSaveState(allSaved ? "saved" : "incomplete");
      if (allSaved) clearDraft(onDay);
    } catch (cause) {
      setSaveState("error");
      setError(f.error(cause));
    } finally {
      saving.current = false;
      if (retry.current && !awaiting.current) {
        retry.current = false;
        void autosave();
      }
    }
  }

  // Each change: kept on the device now, saved for real a moment after the typing stops.
  useEffect(() => {
    if (!sheetOpen) return;
    if (skipNextChange.current) { skipNextChange.current = false; return; }
    writeDraft(day, { visitId: editing?.id ?? null, rows: rows.map(({ id, itemId, values }) => ({ id, itemId, values })), visitValues });
    const timer = window.setTimeout(() => { void autosave(); }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visitValues]);

  /** Opens the sheet on a check-in (or a new one), with whatever this device kept of it. */
  function openSheet(visit: Entry | null) {
    skipNextChange.current = true;
    load(visit, day);
    const draft = readDraft(day);
    if (draft && draft.visitId === (visit?.id ?? null)) {
      skipNextChange.current = false;
      setRows(draft.rows.map((row) => ({ ...row, key: newRowKey() })));
      setVisitValues(draft.visitValues);
    }
    setSaveState(visit ? "saved" : "idle");
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    // Whatever was typed last gets its save now rather than waiting for the timer.
    void autosave();
  }

  function selectDay(next: string) {
    setDay(next);
    setCreating(null);
    load(visitsByDay.get(next)?.[0] ?? null, next);
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

  async function saveRename() {
    if (!renaming || !onRename) return;
    const name = renaming.name.trim();
    if (!name || name === spec.visit.name) { setRenaming(null); return; }
    setRenaming({ ...renaming, busy: true, error: null });
    try {
      await onRename(name);
      setRenaming(null);
    } catch (cause) {
      setRenaming({ ...renaming, busy: false, error: f.error(cause) });
    }
  }

  function addItemRow(itemId: Id) {
    if (rows.some((row) => row.itemId === itemId)) { focusCard(itemId); return; }
    setRows((current) => [...current, { key: newRowKey(), itemId, values: {} }]);
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
  // A check-in started on this device but not saved yet (its items still missing a number).
  const draftWaiting = !sheetOpen && !dayVisits.length && Boolean(readDraft(day)?.rows.length);
  /** "62,5 kg · 8" — a saved record in one line. */
  const recordSummary = (record: Entry) => {
    const values = valuesAsRecord(record.values);
    return recordFields.map((field) => {
      const value = numberValue(values[field.id as Id]);
      return value !== null ? `${nf.number(value, { maximumFractionDigits: 2 })}${field.config?.unit ? ` ${field.config.unit}` : ""}` : showValue(field, values[field.id as Id]);
    }).filter(Boolean).join(" · ");
  };
  // What the draft still needs, said plainly: "Supino · Repetições".
  const firstGap = rows.map((row) => ({ row, missing: findMissingRequiredField(recordFields, row.values) })).find((candidate) => candidate.missing);
  const visitGap = findMissingRequiredField(visitFields, visitValues);
  const missingText = firstGap?.missing ? `${itemTitle(firstGap.row.itemId)} · ${firstGap.missing.label}` : visitGap?.label ?? "";
  // One thing at a time: an empty check-in starts by picking its items; once it has some, more wait behind "+ Add".
  const showTray = adding || !rows.length;
  const lastNumber = (last: { values: Record<Id, unknown> } | null, field: ChallengeField) => (last ? numberValue(last.values[field.id as Id]) : null);
  const deltaText = (field: ChallengeField, current: number, previous: number) => {
    const diff = Number((current - previous).toFixed(4));
    if (diff === 0) return { text: t("deltaSame"), tone: "same" as const };
    const value = `${nf.number(Math.abs(diff), { maximumFractionDigits: 2 })}${field.config?.unit ? ` ${field.config.unit}` : ""}`;
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
          openEnded={!challenge.startsOn && !challenge.endsOn}
          streakBy="week"
        >
          {/* The picked day: what's been logged, and one clear way in. Logging itself happens in the sheet. */}
          <div className="space-y-3">
            {dayVisits.slice().reverse().map((visit, index) => {
              const records = sortedRecords(visit.id);
              return (
                <div key={visit.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm font-medium">{t("visitHeading", { name: spec.visit.name, number: index + 1, count: records.length })}</strong>
                    {canEdit ? <Button variant="secondary" className="min-h-9 rounded-full px-3 text-xs" onClick={() => openSheet(visit)}>{t("continueVisit")}</Button> : null}
                  </div>
                  {records.length ? (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {records.map((record) => (
                        <li key={record.id} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">{itemTitle(record.itemId)}</span>
                          <span className="flex-none tabular-nums text-[var(--muted)]">{recordSummary(record)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
            {draftWaiting ? (
              <button type="button" onClick={() => openSheet(null)} className="w-full cursor-pointer rounded-2xl border border-dashed border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-left text-sm text-[var(--warn)]">
                {t("draftWaiting")}
              </button>
            ) : null}
            {canEdit ? (
              <Button className="min-h-12 w-full rounded-full" onClick={() => openSheet(null)}>
                ＋ {dayVisits.length ? t("newVisitOnDay", { name: spec.visit.name.toLowerCase() }) : day === today ? t("logToday", { name: spec.visit.name.toLowerCase() }) : t("logOnDay", { name: spec.visit.name.toLowerCase(), date: f.date(day, { day: "numeric", month: "short" }) })}
              </Button>
            ) : unavailableMessage ? <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage}</p> : null}
          </div>
        </CheckinLog>
      </section>

      {sheetOpen ? (
        <BottomSheet tall title={day === today ? t("sheetToday", { name: spec.visit.name }) : t("sheetOnDay", { name: spec.visit.name, date: f.date(day, { day: "numeric", month: "short" }) })} onClose={closeSheet}>
          {/* One even rhythm: status, today's items, the rest to pick from, the check-in's own fields. */}
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              {/* Saving happens on its own: this line says where it stands. */}
              <p className={cx("flex min-w-0 items-center gap-2 text-xs", saveState === "error" ? "text-[var(--danger)]" : saveState === "incomplete" ? "text-[var(--warn)]" : "text-[var(--muted)]")} role="status" aria-live="polite">
                <span className={cx("h-2 w-2 flex-none rounded-full", saveState === "saved" ? "bg-[var(--ok)]" : saveState === "saving" ? "animate-pulse bg-[var(--main)]" : saveState === "error" ? "bg-[var(--danger)]" : saveState === "incomplete" ? "bg-[var(--warn)]" : "bg-[var(--line)]")} aria-hidden="true" />
                <span className="min-w-0">{saveState === "saving" ? t("autoSaving") : saveState === "saved" ? t("autoSaved") : saveState === "error" ? t("autoError") : saveState === "incomplete" ? t("autoDraft", { what: missingText }) : t("autoIdle")}</span>
              </p>
              {onRename && !renaming ? (
                <button type="button" className="flex-none cursor-pointer text-xs text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline" onClick={() => setRenaming({ name: spec.visit.name, busy: false, error: null })}>
                  {t("renameLabel")}
                </button>
              ) : null}
            </div>
            {saveState === "error" && error ? <StatusMessage error={error} /> : null}
            {renaming ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={renameInput} className={cx(inputClass, "min-w-0 flex-1 sm:max-w-xs")} value={renaming.name} maxLength={60} disabled={renaming.busy}
                  aria-label={t("renameLabel")}
                  onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); void saveRename(); }
                    if (event.key === "Escape") { event.preventDefault(); setRenaming(null); }
                  }}
                />
                <Button type="button" disabled={renaming.busy || !renaming.name.trim()} onClick={() => void saveRename()}>{renaming.busy ? tc("saving") : tc("save")}</Button>
                <Button type="button" variant="ghost" disabled={renaming.busy} onClick={() => setRenaming(null)}>{tc("cancel")}</Button>
                {renaming.error ? <span className="w-full"><StatusMessage error={renaming.error} /></span> : null}
              </div>
            ) : null}

          {rows.length ? (
            <ol ref={cardsRef} className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] px-4">
              {rows.map((row) => {
                const last = row.itemId ? lastRecordFor(row.itemId) : null;
                const best = row.itemId ? bestValues(ownRecords, row.itemId, recordFields.filter((field) => field.type === "number" || field.type === "rating"), editing?.id ?? null) : new Map<Id, number>();
                const newBests = recordFields.filter((field) => {
                  const value = numberValue(row.values[field.id as Id]);
                  const previous = best.get(field.id as Id);
                  return value !== null && previous !== undefined && value > previous;
                });
                return (
                  <li key={row.key} data-item={row.itemId} className="py-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[15px] font-medium">{itemTitle(row.itemId)}</strong>
                        {last ? (
                          // Last time's numbers, one tap away: tapping them fills this row in.
                          <button type="button" disabled={disabled} title={t("repeatLast")} onClick={() => patchRow(row.key, { values: { ...last.values } })} className="cursor-pointer text-left text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline disabled:cursor-not-allowed">
                            {last.text}
                          </button>
                        ) : <span className="block text-xs text-[var(--muted)]">{t("firstTime")}</span>}
                      </div>
                      <button type="button" disabled={disabled} aria-label={t("removeRow", { item: itemTitle(row.itemId) })} title={t("removeRow", { item: itemTitle(row.itemId) })} onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))} className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-50">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 items-start gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
                      {recordFields.map((field) => {
                        const id = `${row.key}-${field.id}`;
                        const current = numberValue(row.values[field.id as Id]);
                        const previous = lastNumber(last, field);
                        const delta = field.type === "number" && current !== null && previous !== null ? deltaText(field, current, previous) : null;
                        return (
                          <div key={field.id} className="min-w-0">
                            <label className="mb-1 block truncate text-[11px] font-medium text-[var(--muted)]" htmlFor={id}>
                              {field.label}{field.config?.unit ? ` (${field.config.unit})` : ""}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : null}
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
                </ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {hiddenTrayCount > 0 || trayOpen ? (
                    <button type="button" onClick={() => setTrayOpen((open) => !open)} className="min-h-10 cursor-pointer px-1 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]">
                      {trayOpen ? t("trayLess") : t("trayMore", { count: hiddenTrayCount })}
                    </button>
                  ) : <span />}
                  {onAddItem && !creating ? (
                    <button type="button" disabled={disabled} onClick={() => setCreating({ title: "", busy: false, error: null })} className="min-h-10 cursor-pointer px-1 text-sm font-medium text-[var(--main-strong)] hover:underline disabled:opacity-50">
                      ＋ {t("newItemPill")}
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
              </section>
            ) : canEdit ? (
              <button type="button" disabled={disabled} onClick={() => setAdding(true)} className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--main-line)] text-sm font-medium text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] disabled:opacity-50">
                ＋ {t("addRows")}
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
          {/* The bar stays at the bottom, clear of the phone's home area. */}
          <div className="sticky bottom-0 -mx-5 mt-6 flex items-center gap-3 border-t border-[var(--line)] bg-[var(--paper)] px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
            {editing && onDelete ? <Button variant="ghost" className="text-[var(--danger)]" onClick={() => setRemoving(editing)}>{t("remove")}</Button> : null}
            <span className="flex-1" />
            <Button className="min-h-11 px-6" onClick={closeSheet}>{t("done")}</Button>
          </div>
        </BottomSheet>
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
