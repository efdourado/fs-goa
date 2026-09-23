"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { useLibraryName } from "./libraries";
import type { ChallengeDetail, ChallengeField, ChallengeItem, Entry, EntryTypeView, FieldConfig, Id } from "./types";
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

/** The picker's "+ New item" entry — never a real item id. */
const NEW_ITEM = "__new__";

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

/** One field of one record, in the compact shape a table cell needs. */
function CellInput({ field, value, disabled, id, onChange }: {
  field: ChallengeField; value: unknown; disabled: boolean; id: string; onChange: (value: unknown) => void;
}) {
  const t = useTranslations("entryForm");
  const tc = useTranslations("common");
  if (field.type === "number") {
    return (
      <input
        id={id} className={inputClass} type="number" inputMode="decimal" min={field.config?.min} max={field.config?.max}
        step={field.config?.step ?? "any"} disabled={disabled}
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
    );
  }
  if (field.type === "rating") {
    return (
      <select id={id} className={inputClass} disabled={disabled} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}>
        <option value="">—</option>
        {ratingChoices(field.config).map((rating) => <option key={rating} value={String(rating)}>{String(rating).replace(".", ",")}</option>)}
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select id={id} className={inputClass} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("select")}</option>
        {(field.config?.options ?? []).filter((option) => !option.archived).map((option) => (
          <option key={option.id ?? option.value ?? option.label} value={option.id ?? option.value ?? option.label}>{option.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <select id={id} className={inputClass} disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "yes")}>
        <option value="">—</option>
        <option value="yes">{tc("yes")}</option>
        <option value="no">{tc("no")}</option>
      </select>
    );
  }
  if (field.type === "date") {
    return <input id={id} className={inputClass} type="date" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.config?.multiline) {
    return <textarea id={id} className={inputClass} rows={2} maxLength={field.config.maxLength} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input id={id} className={inputClass} maxLength={field.config?.maxLength} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
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

/**
 * A workout-style challenge on Today: the form for one check-in (a date and a row per item, each row filled with
 * the fields the creator defined), the person's past check-ins, and — per item — the history and the records
 * that fall out of it. Nothing here asks for a "current best": the records are read off what was logged.
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
  /** Present for someone who may add items to the challenge — makes "+ New item" available in every row's picker. */
  onAddItem?: (title: string) => Promise<Id>;
}) {
  const t = useTranslations("sessionLog");
  const tf = useTranslations("entryForm");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const showValue = useShowValue();
  const today = dateKeyInSaoPaulo(new Date());
  const shortDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
  const recordFields = useMemo(() => spec.record.fields.filter((field) => field.id), [spec.record.fields]);
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

  const blankRow = (): Row => ({ key: newRowKey(), itemId: "", values: {} });
  const [editing, setEditing] = useState<Entry | null>(null);
  const [occurredOn, setOccurredOn] = useState(today);
  const [visitValues, setVisitValues] = useState<Record<Id, unknown>>({});
  const [rows, setRows] = useState<Row[]>(() => [blankRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [showAll, setShowAll] = useState(false);
  // The row that is naming a brand-new item instead of picking one.
  const [creating, setCreating] = useState<{ rowKey: string; title: string; busy: boolean; error: string | null } | null>(null);
  const newItemInput = useRef<HTMLInputElement>(null);
  const creatingRow = creating?.rowKey;
  // Picking "+ New item" is a request to type a name — put the cursor there.
  useEffect(() => { if (creatingRow) newItemInput.current?.focus(); }, [creatingRow]);
  const disabled = !canEdit || busy;

  function reset() {
    setEditing(null);
    setOccurredOn(today);
    setVisitValues({});
    setRows([blankRow()]);
    setError(null);
  }

  function startEditing(visit: Entry) {
    const records = (recordsByVisit.get(visit.id) ?? []).slice().sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
    setEditing(visit);
    setOccurredOn(visit.occurredOn ?? today);
    setVisitValues(valuesAsRecord(visit.values));
    setRows(records.map((record) => ({ key: newRowKey(), id: record.id, itemId: record.itemId ?? "", values: valuesAsRecord(record.values) })));
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function createItem() {
    if (!creating || !onAddItem) return;
    const title = creating.title.trim();
    if (!title) return;
    setCreating({ ...creating, busy: true, error: null });
    try {
      const itemId = await onAddItem(title);
      patchRow(creating.rowKey, { itemId });
      setCreating(null);
    } catch (cause) {
      setCreating((current) => (current ? { ...current, busy: false, error: f.error(cause) } : current));
    }
  }

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setSuccess(null);
  }

  /** The most recent record of an item, before the check-in being edited — "last time: 55 kg × 8". */
  function lastTimeFor(itemId: Id): string | null {
    let latest: Entry | null = null;
    for (const [visitId, records] of recordsByVisit) {
      if (visitId === editing?.id) continue;
      for (const record of records) {
        if (record.itemId !== itemId) continue;
        if (!latest || (record.occurredOn ?? "") > (latest.occurredOn ?? "")) latest = record;
      }
    }
    if (!latest) return null;
    const values = valuesAsRecord(latest.values);
    const summary = recordFields.map((field) => showValue(field, values[field.id as Id])).filter(Boolean).join(" · ");
    return t("lastTime", { values: summary, date: f.date(latest.occurredOn, shortDate) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const filled = rows.filter((row) => row.itemId || Object.values(row.values).some((value) => value !== "" && value !== undefined && value !== null));
    if (!filled.length) { setError(t("errNoRows")); return; }
    if (filled.some((row) => !row.itemId)) { setError(t("errPickItem")); return; }
    for (const row of filled) {
      const missing = findMissingRequiredField(recordFields, row.values);
      if (missing) { setError(tf("fillField", { label: `${itemTitle(row.itemId)} · ${missing.label}` })); return; }
    }
    const missingVisit = findMissingRequiredField(visitFields, visitValues);
    if (missingVisit) { setError(tf("fillField", { label: missingVisit.label })); return; }
    setBusy(true);
    try {
      await onSave({
        occurredOn,
        values: visitValues,
        children: filled.map((row) => ({ ...(row.id ? { id: row.id } : {}), itemId: row.itemId as Id, values: row.values })),
      }, editing ?? undefined);
      setSuccess(t("saved"));
      reset();
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  const gridStyle = { "--cols": `minmax(0,1.4fr) repeat(${Math.max(1, recordFields.length)}, minmax(0,1fr)) 2.5rem` } as CSSProperties;
  const rowGrid = "sm:grid sm:[grid-template-columns:var(--cols)] sm:items-end sm:gap-2";

  // Per item: how many check-ins it appeared in, the best of each numeric field, and its latest records.
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
        return { item, list, records, sessions: new Set(list.map((row) => row.entry.parentEntryId)).size };
      });
  }, [recordsByVisit, items, recordFields]);

  if (!items.length) return <EmptyState title={t("noItems")} />;

  const shownVisits = showAll ? ownVisits : ownVisits.slice(0, 5);

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
        <form onSubmit={submit} noValidate>
          <div className="mb-5 flex flex-col gap-3 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-light tracking-[-0.04em]">
              {editing ? t("editTitle", { name: spec.visit.name, date: f.date(editing.occurredOn, shortDate) }) : t("composerTitle", { name: spec.visit.name })}
            </h2>
            <label className="block sm:w-48">
              <span className={labelClass}>{t("dateLabel")}</span>
              <input className={inputClass} type="date" max={today} value={occurredOn} disabled={disabled} onChange={(event) => setOccurredOn(event.target.value || today)} />
            </label>
          </div>

          <div className="hidden pb-2 sm:grid sm:[grid-template-columns:var(--cols)] sm:gap-2" style={gridStyle} aria-hidden="true">
            <span className="text-xs font-medium text-[var(--muted)]">{itemsHeading}</span>
            {recordFields.map((field) => <span key={field.id} className="text-xs font-medium text-[var(--muted)]">{field.label}</span>)}
            <span />
          </div>
          <ul className="space-y-3">
            {rows.map((row) => {
              const last = row.itemId ? lastTimeFor(row.itemId) : null;
              return (
                <li key={row.key} className="rounded-2xl border border-[var(--line)] p-3 sm:rounded-none sm:border-0 sm:p-0" style={gridStyle}>
                  <div className={rowGrid}>
                    <label className="block">
                      <span className={cx(labelClass, "sm:sr-only")}>{itemsHeading}</span>
                      <select
                        className={inputClass} disabled={disabled} value={row.itemId}
                        onChange={(event) => {
                          if (event.target.value === NEW_ITEM) setCreating({ rowKey: row.key, title: "", busy: false, error: null });
                          else patchRow(row.key, { itemId: event.target.value });
                        }}
                      >
                        <option value="">{t("pickItem")}</option>
                        {items.map((item: ChallengeItem) => <option key={item.id} value={item.id}>{item.title}</option>)}
                        {onAddItem ? <option value={NEW_ITEM}>{t("newItem")}</option> : null}
                      </select>
                    </label>
                    {recordFields.map((field) => (
                      <label className="mt-2 block sm:mt-0" key={field.id}>
                        <span className={cx(labelClass, "sm:sr-only")}>{field.label}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={tf("required")}>*</span> : null}</span>
                        <CellInput
                          id={`${row.key}-${field.id}`} field={field} disabled={disabled} value={row.values[field.id as Id]}
                          onChange={(value) => patchRow(row.key, { values: { ...row.values, [field.id as Id]: value } })}
                        />
                      </label>
                    ))}
                    <button
                      type="button" disabled={disabled || rows.length === 1}
                      className="mt-2 min-h-11 rounded-xl px-2 text-sm text-[var(--danger)] hover:bg-[var(--wash)] disabled:opacity-40 sm:mt-0"
                      aria-label={t("removeRow")} title={t("removeRow")}
                      onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      ✕
                    </button>
                  </div>
                  {creating?.rowKey === row.key ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--wash)] p-2.5">
                      <input
                        ref={newItemInput} className={cx(inputClass, "min-w-0 flex-1")} value={creating.title} maxLength={200} disabled={creating.busy}
                        placeholder={t("newItemPlaceholder")} aria-label={t("newItemPlaceholder")}
                        onChange={(event) => setCreating({ ...creating, title: event.target.value })}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createItem(); } }}
                      />
                      <Button type="button" disabled={creating.busy || !creating.title.trim()} onClick={() => void createItem()}>{creating.busy ? tc("saving") : t("newItemAdd")}</Button>
                      <Button type="button" variant="ghost" disabled={creating.busy} onClick={() => setCreating(null)}>{tc("cancel")}</Button>
                      {creating.error ? <span className="w-full"><StatusMessage error={creating.error} /></span> : null}
                    </div>
                  ) : null}
                  {last ? <p className="mt-1.5 text-xs text-[var(--muted)]">{last}</p> : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button" disabled={disabled}
            className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-[var(--main-line)] px-4 text-sm text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            <span aria-hidden="true">+</span>{t("addRow")}
          </button>

          {visitFields.length ? (
            <div className="mt-5 space-y-3 border-t border-[var(--line)] pt-5">
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
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="w-full sm:flex-1" disabled={disabled}>
              {busy ? tc("saving") : editing ? tc("saveChanges") : t("save", { name: spec.visit.name })}<span aria-hidden="true">→</span>
            </Button>
            {editing ? <Button type="button" variant="secondary" className="w-full sm:flex-1" disabled={busy} onClick={reset}>{tc("cancel")}</Button> : null}
          </div>
        </form>
      </section>

      <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className={sectionLabelClass}>{t("historyTitle")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("checkinCount", { count: ownVisits.length })}</span>
        </div>
        {ownVisits.length ? (
          <>
            <ul className="divide-y divide-[var(--line)]">
              {shownVisits.map((visit) => {
                const records = (recordsByVisit.get(visit.id) ?? []).slice().sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
                const note = visitFields.length ? valuesAsRecord(visit.values) : null;
                return (
                  <li key={visit.id} className="py-4 first:pt-0 last:pb-0">
                    <details className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0">
                          <strong className="block text-base font-medium">{f.date(visit.occurredOn, shortDate)}</strong>
                          <span className="block truncate text-xs text-[var(--muted)]">{t("itemCount", { count: records.length })} · {records.slice(0, 3).map((record) => itemTitle(record.itemId)).join(", ")}{records.length > 3 ? "…" : ""}</span>
                        </span>
                        <span aria-hidden="true" className="text-[var(--muted)] transition-transform group-open:rotate-180">⌄</span>
                      </summary>
                      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]">
                        <table className="w-full min-w-[20rem] text-left text-sm">
                          <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
                            <tr>
                              <th className="px-3 py-2 font-medium">{itemsHeading}</th>
                              {recordFields.map((field) => <th className="px-3 py-2 font-medium" key={field.id}>{field.label}</th>)}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--line)]">
                            {records.map((record) => {
                              const values = valuesAsRecord(record.values);
                              return (
                                <tr key={record.id}>
                                  <td className="px-3 py-2 font-medium">{itemTitle(record.itemId)}</td>
                                  {recordFields.map((field) => <td className="px-3 py-2 tabular-nums" key={field.id}>{showValue(field, values[field.id as Id]) || "—"}</td>)}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {note && visitFields.some((field) => showValue(field, note[field.id as Id])) ? (
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{visitFields.map((field) => showValue(field, note[field.id as Id])).filter(Boolean).join(" · ")}</p>
                      ) : null}
                      {canEdit ? (
                        <div className="mt-3 flex gap-2">
                          <Button variant="secondary" onClick={() => startEditing(visit)}>{t("edit")}</Button>
                          {onDelete ? <button type="button" className="min-h-11 px-3 text-sm text-[var(--danger)] hover:underline" onClick={() => setRemoving(visit)}>{t("remove")}</button> : null}
                        </div>
                      ) : null}
                    </details>
                  </li>
                );
              })}
            </ul>
            {ownVisits.length > 5 ? (
              <button type="button" className="mt-4 min-h-10 w-full rounded-xl border border-[var(--line)] text-xs font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
                {showAll ? t("showLess") : t("showAll", { count: ownVisits.length })}
              </button>
            ) : null}
          </>
        ) : <p className="text-sm text-[var(--muted)]">{t("historyEmpty")}</p>}
      </section>

      {byItem.length ? (
        <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
          <h2 className={cx(sectionLabelClass, "mb-4")}>{t("byItemTitle")}</h2>
          <ul className="divide-y divide-[var(--line)]">
            {byItem.map(({ item, list, records, sessions }) => (
              <li key={item.id} className="py-4 first:pt-0 last:pb-0">
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <strong className="block text-base font-medium">{item.title}</strong>
                      <span className="block text-xs text-[var(--muted)]">{t("performedIn", { count: sessions })}</span>
                    </span>
                    <span className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                      {records.map((record) => (
                        <span key={record.field.id} className="rounded-full bg-[var(--main-soft)] px-2.5 py-1 text-xs text-[var(--main-strong)]">
                          {t("recordChip", { field: record.field.label, value: String(record.value).replace(".", ",") })}
                        </span>
                      ))}
                      <span aria-hidden="true" className="text-[var(--muted)] transition-transform group-open:rotate-180">⌄</span>
                    </span>
                  </summary>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]">
                    <table className="w-full min-w-[20rem] text-left text-sm">
                      <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
                        <tr>
                          <th className="px-3 py-2 font-medium">{t("dateLabel")}</th>
                          {recordFields.map((field) => <th className="px-3 py-2 font-medium" key={field.id}>{field.label}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line)]">
                        {list.slice(0, 6).map((row) => (
                          <tr key={row.entry.id}>
                            <td className="px-3 py-2 text-[var(--muted)]">{f.date(row.entry.occurredOn, shortDate)}</td>
                            {recordFields.map((field) => <td className="px-3 py-2 tabular-nums" key={field.id}>{showValue(field, row.values[field.id as Id]) || "—"}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {list.length > 6 ? <p className="mt-2 text-xs text-[var(--muted)]">{t("latestOnly", { count: 6 })}</p> : null}
                </details>
              </li>
            ))}
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
            await onDelete(removing.id);
            if (editing?.id === removing.id) reset();
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}
