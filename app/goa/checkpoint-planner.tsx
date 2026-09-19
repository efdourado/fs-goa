"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useGoaFormat } from "./format";
import { applyOrder, type OrderableItem, type OrderStrategy } from "./ordering";
import type { ChallengeDetail, CheckpointInput, CheckpointKind, Id } from "./types";
import { Button, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "./ui";
import { formatRuntime } from "./utils";

/** How many items a stage lists before "show more". */
const STAGE_PREVIEW = 8;

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
  const [seed, setSeed] = useState(0);
  // Items ticked for a bulk move, and the stages whose full item list is open ("show more").
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<Id | "none">>(new Set());
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignDone, setAssignDone] = useState<string | null>(null);

  const itemById = useMemo(() => new Map(challenge.items.map((item) => [item.id, item])), [challenge.items]);

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    [next[index], next[target]] = [next[target], next[index]];
    setDrafts(next);
  }

  function addDraft() {
    setDrafts((current) => [
      ...current,
      { key: crypto.randomUUID(), title: t("newTitle", { n: current.length + 1 }), kind: "session", startsAt: "", dueAt: "", description: "" },
    ]);
  }

  async function saveCheckpoints() {
    setCpBusy(true);
    setCpError(null);
    setCpDone(null);
    try {
      await onSaveCheckpoints(
        drafts.map((draft) => ({
          ...(draft.id ? { id: draft.id } : {}),
          title: draft.title.trim(),
          kind: draft.kind,
          startsAt: draft.startsAt || null,
          dueAt: draft.dueAt || null,
          description: draft.description.trim() || null,
        })),
      );
      setCpDone(t("saved"));
    } catch (cause) {
      setCpError(f.error(cause));
    } finally {
      setCpBusy(false);
    }
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

  async function saveAssignment() {
    setAssignBusy(true);
    setAssignError(null);
    setAssignDone(null);
    try {
      // Send in the arranged sequence so a shuffle / manual sort actually sticks.
      await onAssign(order.map((id, index) => ({ itemId: id, checkpointId: assignment[id] ?? null, position: index })));
      setAssignDone(t("organiseSaved"));
    } catch (cause) {
      setAssignError(f.error(cause));
    } finally {
      setAssignBusy(false);
    }
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

  function togglePicked(ids: Id[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  /** Puts every ticked item in `stageId` (`null` = no stage) and clears the ticks. */
  function moveTicked(stageId: Id | null) {
    setAssignment((current) => ({ ...current, ...Object.fromEntries([...picked].map((id) => [id, stageId])) }));
    setPicked(new Set());
  }

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

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <section>
        <PageHeading title={t("title")} description={t("subtitle")} />
        {locked ? (
          <p className="mt-4 text-sm text-[var(--muted)]">{t("lockedNote")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {drafts.length ? (
              <ol className="divide-y divide-[var(--line)]">
                {drafts.map((draft, index) => {
                  const saved = savedCheckpoints.find((cp) => cp.id === draft.id);
                  return (
                    <li className="py-5 first:pt-0" key={draft.key}>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label>
                          <span className="sr-only">{t("cpTitle")}</span>
                          <input className={inputClass} value={draft.title} maxLength={160} placeholder={t("cpTitlePlaceholder")}
                            onChange={(event) => setDrafts((cur) => cur.map((d) => d.key === draft.key ? { ...d, title: event.target.value } : d))} />
                        </label>
                        <div className="flex items-start gap-1">
                          <Button variant="ghost" className="px-2" disabled={index === 0} onClick={() => move(index, -1)}>↑<span className="sr-only">{t("moveUp")}</span></Button>
                          <Button variant="ghost" className="px-2" disabled={index === drafts.length - 1} onClick={() => move(index, 1)}>↓<span className="sr-only">{t("moveDown")}</span></Button>
                          <button type="button" className="min-h-11 px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => setDrafts((cur) => cur.filter((d) => d.key !== draft.key))}>{tc("remove")}</button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label><span className={labelClass}>{t("cpStarts")}</span><input className={inputClass} type="date" value={draft.startsAt}
                          onChange={(event) => setDrafts((cur) => cur.map((d) => d.key === draft.key ? { ...d, startsAt: event.target.value } : d))} /></label>
                        <label><span className={labelClass}>{t("cpDue")}</span><input className={inputClass} type="date" min={draft.startsAt || undefined} value={draft.dueAt}
                          onChange={(event) => setDrafts((cur) => cur.map((d) => d.key === draft.key ? { ...d, dueAt: event.target.value } : d))} /></label>
                      </div>
                      <label className="mt-2 block"><span className={labelClass}>{t("cpDescription")}</span>
                        <textarea className={inputClass} rows={2} maxLength={2000} value={draft.description} placeholder={t("cpDescriptionPlaceholder")}
                          onChange={(event) => setDrafts((cur) => cur.map((d) => d.key === draft.key ? { ...d, description: event.target.value } : d))} /></label>
                      {saved ? (
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          {t(`timeframe.${saved.timeframe ?? "current"}`)} · {t("itemsTally", { count: saved.itemCount ?? 0 })}
                          {formatRuntime(saved.totalRuntimeMinutes) ? ` · ${formatRuntime(saved.totalRuntimeMinutes)}` : ""}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState title={t("noCheckpointsTitle")} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={addDraft}>{t("addCheckpoint")}</Button>
              <Button disabled={cpBusy} onClick={() => void saveCheckpoints()}>{cpBusy ? tc("saving") : t("saveCheckpoints")}</Button>
            </div>
            <StatusMessage error={cpError} success={cpDone} />
          </div>
        )}
      </section>

      {savedCheckpoints.length && !locked ? (
        <section className="border-t border-[var(--line)] pt-10">
          <h2 className="text-lg font-medium tracking-tight">{t("organiseTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("organiseSubtitle")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={distribute}>{t("distribute")}</Button>
            <Button variant="secondary" onClick={shuffleAll}>{t("shuffleAll")}</Button>
            <Button variant="secondary" onClick={shuffleWithin}>{t("shuffleWithin")}</Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => togglePicked(order, picked.size < order.length)}>
              {picked.size < order.length ? t("selectAll", { count: order.length }) : t("clearSelection")}
            </Button>
          </div>
          {picked.size ? (
            <div className="sticky top-16 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)] p-3 shadow-[var(--elevate-1)]" role="region" aria-label={t("selectionBar")}>
              <strong className="text-sm font-medium">{t("selected", { count: picked.size })}</strong>
              <select
                className="min-h-10 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm"
                value=""
                aria-label={t("moveTo")}
                onChange={(event) => { if (event.target.value) moveTicked(event.target.value === "__none__" ? null : event.target.value); }}
              >
                <option value="">{t("moveTo")}</option>
                {savedCheckpoints.map((option) => <option value={option.id} key={option.id}>{option.title}</option>)}
                <option value="__none__">{t("unassigned")}</option>
              </select>
              <Button variant="secondary" onClick={() => moveTicked(null)}>{t("removeFromStage")}</Button>
              <Button variant="ghost" onClick={() => setPicked(new Set())}>{t("clearSelection")}</Button>
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {[...savedCheckpoints, null].map((cp) => {
              const key: Id | "none" = cp?.id ?? "none";
              const ids = grouped.get(key) ?? [];
              const runtime = formatRuntime(runtimeFor(ids));
              const open = expanded.has(key);
              const shown = open ? ids : ids.slice(0, STAGE_PREVIEW);
              const allPicked = ids.length > 0 && ids.every((id) => picked.has(id));
              return (
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={key}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-2.5">
                      <input type="checkbox" className="h-4 w-4 flex-none" disabled={!ids.length} checked={allPicked} aria-label={t("selectStage", { name: cp ? cp.title : t("unassigned") })} onChange={(event) => togglePicked(ids, event.target.checked)} />
                      <strong className="truncate text-sm">{cp ? cp.title : t("unassigned")}</strong>
                    </label>
                    <span className="text-xs text-[var(--muted)]">
                      {t("itemsTally", { count: ids.length })}{runtime ? ` · ${runtime}` : ""}
                    </span>
                  </div>
                  {ids.length ? (
                    <>
                      <ul className="space-y-1">
                        {shown.map((id) => {
                          const item = itemById.get(id);
                          if (!item) return null;
                          return (
                            <li className="flex items-center gap-3 rounded-lg bg-[var(--wash)] px-3 py-1.5 text-sm" key={id}>
                              <input type="checkbox" className="h-4 w-4 flex-none" checked={picked.has(id)} aria-label={item.title} onChange={(event) => togglePicked([id], event.target.checked)} />
                              <span className="min-w-0 flex-1 truncate">{item.title}{item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}</span>
                              <select className="min-h-9 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-xs"
                                value={assignment[id] ?? ""}
                                aria-label={t("moveItem", { title: item.title })}
                                onChange={(event) => setAssignment((cur) => ({ ...cur, [id]: event.target.value || null }))}>
                                <option value="">{t("unassigned")}</option>
                                {savedCheckpoints.map((option) => <option value={option.id} key={option.id}>{option.title}</option>)}
                              </select>
                            </li>
                          );
                        })}
                      </ul>
                      {ids.length > STAGE_PREVIEW ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          className="mt-2 min-h-10 w-full rounded-xl border border-[var(--line)] text-xs font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
                          onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(key); else next.add(key); return next; })}
                        >
                          {open ? t("showLess") : t("showMore", { count: ids.length - STAGE_PREVIEW })}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">{t("emptyCheckpoint")}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={assignBusy} onClick={() => void saveAssignment()}>{assignBusy ? tc("saving") : t("saveOrganise")}</Button>
          </div>
          <StatusMessage error={assignError} success={assignDone} />
        </section>
      ) : null}
    </div>
  );
}
