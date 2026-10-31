"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useGoaFormat } from "./format";
import { applyOrder, type OrderableItem, type OrderStrategy } from "./ordering";
import type { ChallengeDetail, CheckpointInput, CheckpointKind, Id } from "./types";
import { AddRow, BoxSection, Button, ChevronIcon, CircleMinusIcon, EmptyState, labelClass, PageHeading, rowIconClass, StartLine, StatusMessage } from "./ui";
import { formatRuntime } from "./utils";


interface DraftCheckpoint {
  key: string;
  id?: Id;
  title: string;
  kind: CheckpointKind;
  startsAt: string;
  dueAt: string;
  description: string;
}

function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export function CheckpointPlanner({
  challenge,
  onSaveCheckpoints,
  onAssign,
}: {
  challenge: ChallengeDetail;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssign: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position: number }>) => Promise<void>;
}) {
  const t = useTranslations("checkpointPlanner");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const locked = challenge.status === "closed";
  // Only a round that actually generated day-by-day checkpoints hides the manual
  // planner — a dated Library / reading round without them can still be
  // organised into weeks or sessions by hand.
  const dailyAuto = challenge.checkpoints.some((cp) => cp.kind === "day");

  const savedCheckpoints = useMemo(
    () => [...challenge.checkpoints].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [challenge.checkpoints],
  );

  const [initialDrafts] = useState<DraftCheckpoint[]>(() =>
    savedCheckpoints.map((cp) => ({
      key: cp.id,
      id: cp.id,
      title: cp.title,
      kind: (cp.kind ?? "session") as CheckpointKind,
      startsAt: toDateInput(cp.opensAt),
      dueAt: toDateInput(cp.dueAt),
      description: cp.description ?? "",
    })),
  );
  const [drafts, setDrafts] = useState<DraftCheckpoint[]>(() =>
    savedCheckpoints.map((cp) => ({
      key: cp.id,
      id: cp.id,
      title: cp.title,
      kind: (cp.kind ?? "session") as CheckpointKind,
      startsAt: toDateInput(cp.opensAt),
      dueAt: toDateInput(cp.dueAt),
      description: cp.description ?? "",
    })),
  );
  const [cpBusy, setCpBusy] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpDone, setCpDone] = useState<string | null>(null);

  // Local item→checkpoint map, seeded from the server and edited by the tools below.
  const [assignment, setAssignment] = useState<Record<Id, Id | null>>(() =>
    Object.fromEntries(challenge.items.map((item) => [item.id, item.checkpointId ?? null])),
  );
  const [order, setOrder] = useState<Id[]>(() =>
    [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((item) => item.id),
  );
  const [initialAssignment] = useState(assignment);
  const [initialOrder] = useState(order);
  const [seed, setSeed] = useState(0);
  // The one stage open in the list, the one whose form is showing, and the item whose "Mover" choices are out.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [moving, setMoving] = useState<Id | null>(null);

  const itemById = useMemo(() => new Map(challenge.items.map((item) => [item.id, item])), [challenge.items]);

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    [next[index], next[target]] = [next[target], next[index]];
    setDrafts(next);
  }

  const orderableItems: OrderableItem[] = useMemo(
    () =>
      order.map((id, index) => ({
        key: id,
        checkpointId: assignment[id] ?? null,
        position: index,
      })),
    [order, assignment],
  );

  function runStrategy(strategy: OrderStrategy) {
    const result = applyOrder(orderableItems, strategy);
    setOrder(result.map((row) => row.key));
    setAssignment(Object.fromEntries(result.map((row) => [row.key, row.checkpointId])));
  }

  function distribute() {
    runStrategy({ kind: "distribute", checkpointIds: savedCheckpoints.map((cp) => cp.id) });
  }
  function shuffleAll() {
    const next = seed + 1;
    setSeed(next);
    runStrategy({ kind: "shuffle", seed: `all-${next}` });
  }
  function shuffleWithin() {
    const next = seed + 1;
    setSeed(next);
    runStrategy({ kind: "shuffle_within", seed: `within-${next}` });
  }

  const grouped = useMemo(() => {
    const buckets = new Map<Id | "none", Id[]>();
    buckets.set("none", []);
    for (const cp of savedCheckpoints) buckets.set(cp.id, []);
    for (const id of order) {
      const key = assignment[id] ?? "none";
      (buckets.get(key) ?? buckets.get("none")!).push(id);
    }
    return buckets;
  }, [order, assignment, savedCheckpoints]);

  function runtimeFor(ids: Id[]): number {
    return ids.reduce((sum, id) => sum + (itemById.get(id)?.catalogItem?.runtimeMinutes ?? 0), 0);
  }

  if (dailyAuto) {
    return (
      <section className="mx-auto max-w-5xl">
        <PageHeading title={t("title")} description={t("dailyAutoNote")} />
      </section>
    );
  }

  // A check-in habit with no catalogue has nothing to organise; a Library round
  // reports `daily` for its progress type yet still has books to place.
  if (challenge.submissionMode !== "item" && challenge.items.length === 0) {
    return (
      <section className="mx-auto max-w-5xl">
        <PageHeading title={t("title")} description={t("noItemsNote")} />
      </section>
    );
  }

  // A closed challenge is frozen, but its stages and how the items were spread over them still read as they were.
  if (locked) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeading title={t("title")} />
        <div className="space-y-4">
          <BoxSection title={t("stagesTitle")} hint={t("lockedNote")}>
            {savedCheckpoints.length ? (
              <ol className="divide-y divide-[var(--line)]">
                {savedCheckpoints.map((cp) => {
                  const ids = grouped.get(cp.id) ?? [];
                  const when = cp.opensAt || cp.dueAt ? f.dateRange(cp.opensAt, cp.dueAt) : null;
                  return (
                    <li className="py-4 first:pt-0 last:pb-0" key={cp.id}>
                      <strong className="block text-sm font-medium">{cp.title}</strong>
                      <p className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">{[when, t("itemsTally", { count: ids.length })].filter(Boolean).join(" · ")}</p>
                      {cp.description ? <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{cp.description}</p> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState title={t("noCheckpointsTitle")} />
            )}
          </BoxSection>
          {savedCheckpoints.length ? (
            <BoxSection title={t("itemsByStage")}>
              <div className="divide-y divide-[var(--line)]">
                {[...savedCheckpoints, null].map((cp) => {
                  const ids = grouped.get(cp?.id ?? "none") ?? [];
                  if (!cp && !ids.length) return null;
                  return (
                    <div className="py-4 first:pt-0 last:pb-0" key={cp?.id ?? "none"}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <strong className="truncate text-sm">{cp ? cp.title : t("unassigned")}</strong>
                        <span className="text-xs tabular-nums text-[var(--muted)]">{t("itemsTally", { count: ids.length })}</span>
                      </div>
                      {ids.length ? (
                        <ul className="list-disc space-y-1 pl-5 marker:text-[var(--muted)]">
                          {ids.map((id) => {
                            const item = itemById.get(id);
                            return item ? <li className="text-sm leading-6" key={id}>{item.title}</li> : null;
                          })}
                        </ul>
                      ) : <p className="text-xs text-[var(--muted)]">{t("emptyCheckpoint")}</p>}
                    </div>
                  );
                })}
              </div>
            </BoxSection>
          ) : null}
        </div>
      </div>
    );
  }

  // The stages as a folding list: one row each (number, name, dates, how many items), opened one at a time to show
  // its items (each moves with "Mover") and, on demand, its form. Items with no stage wait in a dashed box above.
  // One Save for everything: the items' places first (while every stage they point at still exists), then the stages.
  const savedIds = new Set(drafts.flatMap((draft) => draft.id ? [draft.id] : []));
  const loose = order.filter((id) => !assignment[id] || !savedIds.has(assignment[id]!));
  const stageShape = (list: DraftCheckpoint[]) => JSON.stringify(list.map((d) => [d.id ?? null, d.title, d.kind, d.startsAt, d.dueAt, d.description]));
  const stagesDirty = stageShape(drafts) !== stageShape(initialDrafts);
  const assignDirty = JSON.stringify(order.map((id) => [id, assignment[id] ?? null])) !== JSON.stringify(initialOrder.map((id) => [id, initialAssignment[id] ?? null]));
  const dirty = stagesDirty || assignDirty;

  async function saveAll() {
    setCpBusy(true);
    setCpError(null);
    setCpDone(null);
    try {
      if (assignDirty) await onAssign(order.map((id, index) => ({ itemId: id, checkpointId: assignment[id] && savedIds.has(assignment[id]!) ? assignment[id]! : null, position: index })));
      if (stagesDirty) await onSaveCheckpoints(drafts.map((draft) => ({
        ...(draft.id ? { id: draft.id } : {}),
        title: draft.title.trim(),
        kind: draft.kind,
        startsAt: draft.startsAt || null,
        dueAt: draft.dueAt || null,
        description: draft.description.trim() || null,
      })));
      setCpDone(t("saved"));
    } catch (cause) {
      setCpError(f.error(cause));
    } finally {
      setCpBusy(false);
    }
  }

  function addStage() {
    const key = crypto.randomUUID();
    setDrafts((current) => [...current, { key, title: t("newTitle", { n: current.length + 1 }), kind: "session", startsAt: "", dueAt: "", description: "" }]);
    setOpenKey(key);
    setEditingKey(key);
  }

  const patchDraft = (key: string, patch: Partial<DraftCheckpoint>) => setDrafts((cur) => cur.map((d) => d.key === key ? { ...d, ...patch } : d));
  const tally = (ids: Id[]) => {
    const runtime = formatRuntime(runtimeFor(ids));
    return `${t("itemsTally", { count: ids.length })}${runtime ? ` · ${runtime}` : ""}`;
  };
  const pillClass = "min-h-8 cursor-pointer rounded-full border px-3 text-xs transition";

  function itemRow(id: Id, here: Id | null) {
    const item = itemById.get(id);
    if (!item) return null;
    const targets = [
      ...drafts.filter((draft) => draft.id && draft.id !== here).map((draft) => ({ id: draft.id as Id | null, title: draft.title || t("newTitle", { n: drafts.indexOf(draft) + 1 }) })),
      ...(here ? [{ id: null as Id | null, title: t("unassigned") }] : []),
    ];
    const isMoving = moving === id;
    return (
      <li className="border-t border-[var(--line)] py-2 first:border-t-0" key={id}>
        <div className="flex min-h-9 items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
          {item.catalogItem?.runtimeMinutes ? <span className="font-mono text-xs text-[var(--muted)]">{formatRuntime(item.catalogItem.runtimeMinutes)}</span> : null}
          {targets.length ? (
            <button type="button" aria-expanded={isMoving} onClick={() => setMoving(isMoving ? null : id)} className={`${pillClass} border-[var(--line)] hover:border-[var(--muted)]`}>
              {isMoving ? tc("cancel") : t("move")}
            </button>
          ) : null}
        </div>
        {isMoving ? (
          <div className="flex flex-wrap gap-1.5 pb-1 pt-2" role="group" aria-label={t("moveItem", { title: item.title })}>
            {targets.map((target) => (
              <button type="button" key={target.id ?? "none"} onClick={() => { setAssignment((cur) => ({ ...cur, [id]: target.id })); setMoving(null); }} className={`${pillClass} border-[var(--ink)] hover:bg-[var(--wash)]`}>
                {target.title}
              </button>
            ))}
          </div>
        ) : null}
      </li>
    );
  }

  const fieldClass = "min-h-10 w-full rounded-xl border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--main)]";

  return (
    <div className="mx-auto max-w-2xl">
      {/* Empty, the box's own title already says what stages are for. */}
      <PageHeading title={t("title")} description={drafts.length ? t("description") : undefined} />
      <div className="space-y-4">
        {drafts.length && loose.length ? (
          <section className="rounded-[20px] border border-dashed border-[var(--line)] px-5 py-4 sm:px-6">
            <div className="flex items-baseline justify-between gap-3 pb-1">
              <h2 className="text-[15px] font-medium">{t("unassigned")}</h2>
              <span className="text-xs tabular-nums text-[var(--muted)]">{tally(loose)}</span>
            </div>
            <ul>{loose.map((id) => itemRow(id, null))}</ul>
          </section>
        ) : null}

        {drafts.length ? (
          <section className="rounded-[20px] border border-[var(--line)] px-5 sm:px-6">
            <ol>
              {drafts.map((draft, index) => {
                const ids = draft.id ? grouped.get(draft.id) ?? [] : [];
                const open = openKey === draft.key;
                const editing = editingKey === draft.key;
                const when = draft.startsAt || draft.dueAt ? f.dateRange(draft.startsAt || null, draft.dueAt || null) : t("noDates");
                return (
                  <li className="border-t border-[var(--line)] first:border-t-0" key={draft.key}>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-expanded={open} onClick={() => { setOpenKey(open ? null : draft.key); setMoving(null); }} className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3.5 py-2.5 text-left">
                        <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--ink)] text-[13px] font-medium tabular-nums">{index + 1}</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[15px] font-medium">{draft.title || t("cpTitlePlaceholder")}</span>
                          <span className="text-xs tabular-nums text-[var(--muted)]">{when}</span>
                        </span>
                        {/* Same-width digits, right-aligned: the counts line up from row to row. */}
                        <span className="whitespace-nowrap text-right text-xs tabular-nums text-[var(--muted)]">{draft.id ? tally(ids) : ""}</span>
                      </button>
                      {/* Order and removal sit on the row itself, right of the count, always there. */}
                      <button type="button" className={rowIconClass} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp")} title={t("moveUp")}>
                        <ChevronIcon dir="up" />
                      </button>
                      <button type="button" className={rowIconClass} disabled={index === drafts.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown")} title={t("moveDown")}>
                        <ChevronIcon dir="down" />
                      </button>
                      <button type="button" className={`${rowIconClass} text-[var(--danger)] hover:text-[var(--danger)]`} onClick={() => { setDrafts((cur) => cur.filter((d) => d.key !== draft.key)); if (open) setOpenKey(null); }} aria-label={t("removeStage")} title={t("removeStage")}>
                        <CircleMinusIcon className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                    {open ? (
                      <div className="space-y-3 pb-5 pl-[46px]">
                        {editing ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="sm:col-span-2"><span className={labelClass}>{t("cpTitle")}</span>
                              <input className={fieldClass} value={draft.title} maxLength={160} placeholder={t("cpTitlePlaceholder")} onChange={(event) => patchDraft(draft.key, { title: event.target.value })} /></label>
                            <label><span className={labelClass}>{t("cpStarts")}</span>
                              <input className={fieldClass} type="date" value={draft.startsAt} onChange={(event) => patchDraft(draft.key, { startsAt: event.target.value })} /></label>
                            <label><span className={labelClass}>{t("cpDue")}</span>
                              <input className={fieldClass} type="date" min={draft.startsAt || undefined} value={draft.dueAt} onChange={(event) => patchDraft(draft.key, { dueAt: event.target.value })} /></label>
                            <label className="sm:col-span-2"><span className={labelClass}>{t("cpDescription")}</span>
                              <textarea className={`${fieldClass} py-2`} rows={2} maxLength={2000} value={draft.description} placeholder={t("cpDescriptionPlaceholder")} onChange={(event) => patchDraft(draft.key, { description: event.target.value })} /></label>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 text-[13px] text-[var(--muted)]">{draft.description}</span>
                          <button type="button" onClick={() => setEditingKey(editing ? null : draft.key)} className="flex-none cursor-pointer text-[13px] text-[var(--ink)] underline underline-offset-4">
                            {editing ? t("doneEditing") : t("editStage")}
                          </button>
                        </div>
                        {draft.id ? (
                          ids.length ? <ul>{ids.map((id) => itemRow(id, draft.id!))}</ul> : <p className="text-[13px] text-[var(--muted)]">{t("emptyCheckpoint")}</p>
                        ) : <p className="text-[13px] text-[var(--muted)]">{t("saveToFill")}</p>}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <AddRow label={t("stageWord")} ariaLabel={t("addCheckpoint")} onClick={addStage} />
          </section>
        ) : (
          <BoxSection title={t("createTitle")}>
            <StartLine label={t("stageWord")} ariaLabel={t("addCheckpoint")} onClick={addStage} />
          </BoxSection>
        )}

        {savedCheckpoints.length > 1 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[13px] text-[var(--muted)]">
            <button type="button" className="cursor-pointer underline-offset-4 hover:text-[var(--ink)] hover:underline" onClick={distribute}>{t("distribute")}</button>
            <button type="button" className="cursor-pointer underline-offset-4 hover:text-[var(--ink)] hover:underline" onClick={shuffleAll}>{t("shuffleAll")}</button>
            <button type="button" className="cursor-pointer underline-offset-4 hover:text-[var(--ink)] hover:underline" onClick={shuffleWithin}>{t("shuffleWithin")}</button>
          </div>
        ) : null}

        {drafts.length || savedCheckpoints.length ? (
          <Button className="w-full" disabled={cpBusy || !dirty} onClick={() => void saveAll()}>{cpBusy ? tc("saving") : t("saveStages")}</Button>
        ) : null}
        <StatusMessage error={cpError} success={cpDone} />
      </div>
    </div>
  );
}
