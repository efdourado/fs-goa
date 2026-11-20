"use client";

import { StateButton } from "./state-button";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddItemsDialog } from "./cine-items";
import { Dialog, FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { ItemEditorDialog } from "./item-editor-dialog";
import type { CatalogScope } from "./libraries";
import { applyOrder, type OrderStrategy } from "./ordering";
import type { ChallengeDetail, ChallengeItem, ChallengeItemInput, CheckpointInput, Entry, Id, Member } from "./types";
import { itemIdForEntry, formatRuntime } from "./utils";
import { AddRow, Button, ChevronIcon, Field, inputClass, rowIconClass, Select, SlidersIcon, StatusMessage } from "./ui";

type Stage = ChallengeDetail["checkpoints"][number];
export interface ChallengeItemTools {
  scope: CatalogScope;
  members?: Member[];
  onAdd: (items: ChallengeItemInput[]) => Promise<void>;
  onUpdate: (id: Id, payload: Record<string, unknown>) => Promise<void>;
  onRemove: (id: Id) => Promise<void>;
}
const stageInput = (stage: Stage): CheckpointInput => ({id: stage.id, title: stage.title, kind: stage.kind ?? "session", startsAt: stage.opensAt ?? null, dueAt: stage.dueAt ?? null, description: stage.description ?? null});

export function CheckpointPlanner({ challenge, entries = [], itemTools, onSaveCheckpoints, onAssign }: {
  challenge: ChallengeDetail; entries?: Entry[]; itemTools?: ChallengeItemTools;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssign: (assignments: Array<{itemId: Id; checkpointId: Id | null; position: number}>) => Promise<void>;
}) {
  const t = useTranslations("checkpointPlanner");
  const ta = useTranslations("adminChallenge");
  const ti = useTranslations("cineItems");
  const f = useGoaFormat();
  const locked = challenge.status === "closed";
  const autoDays = challenge.checkpoints.some((stage) => stage.kind === "day");
  const stages = [...challenge.checkpoints].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const items = [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const [visibleItems, setVisibleItems] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editingStage, setEditingStage] = useState<Stage | "new" | null>(null);
  const [assigning, setAssigning] = useState<Stage | null>(null);
  const [movingItem, setMovingItem] = useState<ChallengeItem | null>(null);
  const [editingItem, setEditingItem] = useState<ChallengeItem | null>(null);
  const [addingItems, setAddingItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }
  function reorderStage(index: number, delta: number) {
    const next = [...stages]; [next[index], next[index + delta]] = [next[index + delta], next[index]];
    void run(() => onSaveCheckpoints(next.map(stageInput)));
  }
  function organise(strategy: OrderStrategy) {
    const next = applyOrder(items.map((item, position) => ({key: item.id, checkpointId: item.checkpointId ?? null, position})), strategy);
    void run(() => onAssign(next.map((item, position) => ({itemId: item.key, checkpointId: item.checkpointId, position}))));
  }
  function itemRows(list: ChallengeItem[], key = "unassigned") {
    const limit = visibleItems[key] ?? 12;
    return <><ul className="divide-y divide-[var(--line)]">{list.slice(0, limit).map((item) => <li key={item.id} className="flex min-h-14 items-center gap-3 py-2">
      <StateButton type="button" className="min-w-0 flex-1 cursor-pointer py-1 text-left transition-opacity hover:opacity-75" onClick={() => setEditingItem(item)}>
        <span className="block text-sm font-medium">{item.title}</span>
        <span className="block text-xs text-[var(--muted)]">{[item.catalogItem?.author, item.catalogItem?.year, formatRuntime(item.catalogItem?.runtimeMinutes)].filter(Boolean).join(" · ")}</span>
      </StateButton>
      {!locked && !autoDays && stages.length ? <StateButton type="button" className={rowIconClass} aria-label={t("moveItem", {title: item.title})} onClick={() => setMovingItem(item)}><SlidersIcon className="h-4 w-4" /></StateButton> : null}
    </li>)}</ul>{list.length > limit ? <Button variant="secondary" className="mt-3 w-full" onClick={() => setVisibleItems((current) => ({...current, [key]:limit + 12}))}>{ta("showMoreItems", {count:Math.min(12,list.length-limit)})}</Button> : null}</>;
  }
  const stageIds = new Set(stages.map((stage) => stage.id));
  const loose = items.filter((item) => !item.checkpointId || !stageIds.has(item.checkpointId));
  return <div className="mx-auto max-w-2xl">
    <div className="mb-7 flex items-start justify-between gap-4">
      <div className="min-w-0"><h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{t("title")}</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("itemsDescription")}</p></div>
      {!locked && itemTools && challenge.libraries?.length ? <StateButton type="button" aria-label={ti("addItems")} title={ti("addItems")} onClick={() => setAddingItems(true)} className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"><svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg></StateButton> : null}
    </div>
    <StatusMessage error={error} />
    {autoDays ? <p className="mb-5 text-sm text-[var(--muted)]">{t("dailyAutoNote")}</p> : null}
    <div className="space-y-4">
      {!stages.length || loose.length ? <section className="rounded-[20px] border border-[var(--line)] px-5 py-4 sm:px-6">
        <div className="mb-2 flex items-baseline justify-between gap-3"><h2 className="text-base font-medium">{stages.length ? t("unassigned") : t("allItems")}</h2><span className="text-xs text-[var(--muted)]">{t("itemsTally", {count: loose.length})}</span></div>
        {loose.length ? itemRows(loose) : <p className="py-3 text-sm text-[var(--muted)]">{t("noItems")}</p>}
      </section> : null}
      {stages.map((stage, index) => {
        const list = items.filter((item) => item.checkpointId === stage.id);
        const expanded = open.has(stage.id);
        const when = stage.opensAt || stage.dueAt ? f.dateRange(stage.opensAt, stage.dueAt) : null;
        const runtime = formatRuntime(list.reduce((sum, item) => sum + (item.catalogItem?.runtimeMinutes ?? 0), 0));
        return <section key={stage.id} className="rounded-[20px] border border-[var(--line)] px-5 sm:px-6">
          <div className="flex items-center gap-2">
            <StateButton type="button" aria-expanded={expanded} onClick={() => setOpen((current) => {const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next;})} className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 text-left">
              <span className="text-xs tabular-nums text-[var(--muted)]">{index + 1}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{stage.title}</strong><span className="block text-xs text-[var(--muted)]">{[when, t("itemsTally", {count: list.length}), runtime].filter(Boolean).join(" · ")}</span></span><ChevronIcon dir={expanded ? "up" : "down"} />
            </StateButton>
            {!locked && !autoDays ? <>
              <StateButton className={rowIconClass} type="button" disabled={busy || index === 0} onClick={() => reorderStage(index, -1)} aria-label={t("moveUp")}><ChevronIcon dir="up" /></StateButton>
              <StateButton className={rowIconClass} type="button" disabled={busy || index === stages.length - 1} onClick={() => reorderStage(index, 1)} aria-label={t("moveDown")}><ChevronIcon dir="down" /></StateButton>
              <StateButton className={rowIconClass} type="button" disabled={busy} onClick={() => setEditingStage(stage)} aria-label={t("stageSettings", {title: stage.title})}><SlidersIcon className="h-4 w-4" /></StateButton>
            </> : null}
          </div>
          {expanded ? <div className="border-t border-[var(--line)] pb-4">
            {stage.description ? <p className="my-3 text-sm text-[var(--muted)]">{stage.description}</p> : null}
            {list.length ? itemRows(list, stage.id) : <p className="py-3 text-sm text-[var(--muted)]">{t("emptyCheckpoint")}</p>}
            {!locked && !autoDays ? <Button variant="secondary" className="mt-2 w-full" onClick={() => setAssigning(stage)}>{t("chooseItems")}</Button> : null}
          </div> : null}
        </section>;
      })}
      {!locked && !autoDays ? <AddRow label={t("stageWord")} ariaLabel={t("addCheckpoint")} onClick={() => setEditingStage("new")} /> : null}
      {!locked && !autoDays && stages.length > 1 ? <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        <StateButton type="button" disabled={busy} className="cursor-pointer underline underline-offset-4" onClick={() => organise({kind: "distribute", checkpointIds: stages.map((stage) => stage.id)})}>{t("distribute")}</StateButton>
        <StateButton type="button" disabled={busy} className="cursor-pointer underline underline-offset-4" onClick={() => {setSeed(seed + 1); organise({kind: "shuffle", seed: `all-${seed + 1}`});}}>{t("shuffleAll")}</StateButton>
        <StateButton type="button" disabled={busy} className="cursor-pointer underline underline-offset-4" onClick={() => organise({kind: "shuffle_within", seed: crypto.randomUUID()})}>{t("shuffleWithin")}</StateButton>
      </div> : null}
    </div>
    {editingStage ? <StageEditor stage={editingStage === "new" ? undefined : editingStage} hasDeadline={Boolean(challenge.endsOn)} onCancel={() => setEditingStage(null)} onSave={async (value) => {await onSaveCheckpoints(editingStage === "new" ? [...stages.map(stageInput), value] : stages.map((stage) => stage.id === editingStage.id ? value : stageInput(stage))); setEditingStage(null);}} onRemove={editingStage === "new" ? undefined : async () => {await onSaveCheckpoints(stages.filter((stage) => stage.id !== editingStage.id).map(stageInput)); setEditingStage(null);}} /> : null}
    {assigning ? <StageItemsDialog stage={assigning} stages={stages} items={items} onCancel={() => setAssigning(null)} onSave={async (selected) => {await onAssign(items.map((item, position) => ({itemId: item.id, position, checkpointId: selected.has(item.id) ? assigning.id : item.checkpointId === assigning.id ? null : item.checkpointId ?? null}))); setAssigning(null); setOpen((current) => new Set([...current, assigning.id]));}} /> : null}
    {movingItem ? <MoveItemDialog item={movingItem} stages={stages} onCancel={() => setMovingItem(null)} onSave={async (checkpointId) => {await onAssign([{itemId: movingItem.id, position: movingItem.position ?? items.indexOf(movingItem), checkpointId}]); setMovingItem(null);}} /> : null}
    {addingItems && itemTools ? <AddItemsDialog members={itemTools.members ?? []} scope={itemTools.scope} libraries={challenge.libraries ?? []} checkpoints={autoDays ? undefined : stages} onClose={() => setAddingItems(false)} onAdd={async (added) => {await itemTools.onAdd(added); setAddingItems(false);}} /> : null}
    {editingItem ? locked || !itemTools ? <ItemDetails item={editingItem} onClose={() => setEditingItem(null)} /> : <ItemEditorDialog item={{...editingItem.catalogItem, title: editingItem.title}} library={editingItem.catalogItem ? (challenge.libraries ?? []).find((library) => library.kind === editingItem.catalogItem?.kind) ?? null : null} maxTitleLength={200} onCancel={() => setEditingItem(null)} onSave={async (value) => {await itemTools.onUpdate(editingItem.id, value); setEditingItem(null);}} onRemove={{body: ta("itemRemoveConfirmWithEntries", {title: editingItem.title, count: entries.filter((entry) => itemIdForEntry(entry) === editingItem.id).length}), onConfirm: async () => {await itemTools.onRemove(editingItem.id); setEditingItem(null);}}} /> : null}
  </div>;
}

function StageEditor({stage, hasDeadline, onCancel, onSave, onRemove}: {stage?: Stage; hasDeadline: boolean; onCancel: () => void; onSave: (value: CheckpointInput) => Promise<void>; onRemove?: () => Promise<void>}) {
  const t = useTranslations("checkpointPlanner");
  const f = useGoaFormat();
  const [title, setTitle] = useState(stage?.title ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const initialStart = stage?.opensAt?.slice(0, 10) ?? "";
  const initialEnd = stage?.dueAt?.slice(0, 10) ?? "";
  const [starts, setStarts] = useState(initialStart);
  const [ends, setEnds] = useState(initialEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title !== (stage?.title ?? "") || description !== (stage?.description ?? "") || starts !== initialStart || ends !== initialEnd;
  return <FormDialog title={stage ? stage.title : t("addCheckpoint")} dirty={dirty} busy={busy} error={error} onCancel={onCancel} submitDisabled={!title.trim() || Boolean(starts && ends && ends < starts) || !dirty} onSubmit={async () => {setBusy(true); setError(null); try {await onSave({...(stage ? {id: stage.id} : {}), title: title.trim(), kind: stage?.kind ?? "session", description: description.trim() || null, startsAt: starts === initialStart ? stage?.opensAt ?? null : starts || null, dueAt: ends === initialEnd ? stage?.dueAt ?? null : ends || null});} catch (cause) {setError(f.error(cause)); setBusy(false);}}} onDelete={onRemove ? {body: t("removeStageBody"), onConfirm: onRemove} : undefined}>
    <Field label={t("cpTitle")}><input className={inputClass} value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} /></Field>
    <Field label={t("cpDescription")}><textarea className={inputClass} value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} /></Field>
    {hasDeadline || initialStart || initialEnd ? <div className="grid gap-4 sm:grid-cols-2"><Field label={t("cpStarts")}><input className={inputClass} type="date" value={starts} onChange={(event) => setStarts(event.target.value)} /></Field><Field label={t("cpDue")}><input className={inputClass} type="date" min={starts || undefined} value={ends} onChange={(event) => setEnds(event.target.value)} /></Field></div> : <p className="text-xs text-[var(--muted)]">{t("undatedHint")}</p>}
  </FormDialog>;
}

function StageItemsDialog({stage, stages, items, onCancel, onSave}: {stage: Stage; stages: Stage[]; items: ChallengeItem[]; onCancel: () => void; onSave: (ids: Set<Id>) => Promise<void>}) {
  const t = useTranslations("checkpointPlanner");
  const f = useGoaFormat();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set(items.filter((item) => item.checkpointId === stage.id).map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = items.some((item) => selected.has(item.id) !== (item.checkpointId === stage.id));
  return <FormDialog title={t("itemsForStage", {title: stage.title})} dirty={dirty} busy={busy} error={error} onCancel={onCancel} submitDisabled={!dirty} onSubmit={async () => {setBusy(true); try {await onSave(selected);} catch (cause) {setError(f.error(cause)); setBusy(false);}}}>
    <p className="text-sm text-[var(--muted)]">{t("chooseItemsHint")}</p>
    <Field label={t("searchItems")}><input className={inputClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
    <div className="space-y-2">{items.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((item) => <label key={item.id} aria-label={item.title} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] p-3"><input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => {const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next;})} /><span className="min-w-0"><strong className="block text-sm font-medium">{item.title}</strong><small className="text-[var(--muted)]">{stages.find((candidate) => candidate.id === item.checkpointId)?.title ?? t("unassigned")}</small></span></label>)}</div>
  </FormDialog>;
}
function MoveItemDialog({item, stages, onCancel, onSave}: {item: ChallengeItem; stages: Stage[]; onCancel: () => void; onSave: (id: Id | null) => Promise<void>}) {
  const t = useTranslations("checkpointPlanner"); const f = useGoaFormat();
  const [stage, setStage] = useState(item.checkpointId ?? ""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  return <FormDialog title={t("moveItem", {title: item.title})} dirty={stage !== (item.checkpointId ?? "")} busy={busy} error={error} onCancel={onCancel} submitDisabled={stage === (item.checkpointId ?? "")} onSubmit={async () => {setBusy(true); try {await onSave(stage || null);} catch (cause) {setError(f.error(cause)); setBusy(false);}}}><Field label={t("stageWord")}><Select ariaLabel={t("stageWord")} value={stage} onChange={setStage} options={[{value: "", label: t("unassigned")}, ...stages.map((candidate) => ({value: candidate.id, label: candidate.title}))]} /></Field></FormDialog>;
}
function ItemDetails({item, onClose}: {item: ChallengeItem; onClose: () => void}) {
  const t = useTranslations("cineItems");
  const data = item.catalogItem;
  const facts = [data?.author, data?.year, data?.pageCount != null ? t("pagesCount", {count: data.pageCount}) : null, formatRuntime(data?.runtimeMinutes), data?.mainGenre].filter((value) => value !== null && value !== undefined && value !== "");
  return <Dialog title={item.title} onClose={onClose}>{item.description ? <p className="mb-4 text-sm">{item.description}</p> : null}<p className="text-sm text-[var(--muted)]">{facts.join(" · ")}</p><dl className="mt-4 space-y-3">{data?.attributes?.map((attribute) => <div key={attribute.key}><dt className="text-xs text-[var(--muted)]">{attribute.label}</dt><dd className="text-sm">{String(attribute.value)}</dd></div>)}</dl></Dialog>;
}
