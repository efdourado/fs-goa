"use client";

import { useTranslations } from "next-intl";
import { type DragEvent, type FormEvent, type ReactNode, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { Shelf } from "../shelf";
import {
  CHALLENGE_COLOR_TAGS,
  type ChallengeColorTag,
  type ChallengeSummary,
  type GroupSummary,
  type Id,
  type Limits,
  type User,
} from "../types";
import {
  Button,
  cardClass,
  challengeStatusTone,
  ChallengeStatusBadge,
  CircleChevronIcon,
  CircleMinusIcon,
  CirclePinIcon,
  cx,
  DragDotsIcon,
  EmptyState,
  EmptyStateAction,
  Field,
  inputClass,
  PageHeading,
  StatusMessage,
} from "../ui";
import { canManage, isChallengeScheduled, isLivingList, isPersonalChallenge } from "../utils";

// ── shelf helpers (pure, unit-tested) ────────────────────────────────────

export type ShelfKey = "pinned" | "running" | "space" | "archive";
export const CHALLENGE_SHELF_ORDER: ShelfKey[] = ["pinned", "running", "space", "archive"];

/**
 * Split the viewer's challenges into the four homepage shelves. A pinned
 * challenge shows only in "pinned" (pulled out of its normal shelf); the rest
 * split by workspace and status. Order within each shelf is preserved.
 */
export function splitShelves(
  challenges: ChallengeSummary[],
  personalWorkspaceId: Id | null,
): Record<ShelfKey, ChallengeSummary[]> {
  const out: Record<ShelfKey, ChallengeSummary[]> = { pinned: [], running: [], space: [], archive: [] };
  for (const challenge of challenges) {
    if (challenge.pinned) { out.pinned.push(challenge); continue; }
    if (isPersonalChallenge(challenge, personalWorkspaceId)) { out.space.push(challenge); continue; }
    if (challenge.status === "active") out.running.push(challenge);
    else out.archive.push(challenge);
  }
  return out;
}

/** Stable sort by the viewer's manual `sortIndex` (unset falls to the end). */
export function sortByIndex(challenges: ChallengeSummary[]): ChallengeSummary[] {
  return challenges
    .map((challenge, i) => ({ challenge, i }))
    .sort((a, b) => {
      const ai = a.challenge.sortIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.challenge.sortIndex ?? Number.MAX_SAFE_INTEGER;
      return ai === bi ? a.i - b.i : ai - bi;
    })
    .map((entry) => entry.challenge);
}

export function applyColorFilter(
  challenges: ChallengeSummary[],
  tag: ChallengeColorTag | null,
): ChallengeSummary[] {
  return tag ? challenges.filter((challenge) => challenge.colorTag === tag) : challenges;
}

// ── group-create dialog ─────────────────────────────────────────────────

/** Group creation lives in a modal — the "+ New group" button in the groups shelf header opens it. */
function GroupCreateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name);
      onClose();
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("createGroup")} busy={busy} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <Field label={t("groupNameLabel")}>
          <input className={inputClass} name="name" placeholder={t("groupNamePlaceholder")} required maxLength={100} disabled={busy} />
        </Field>
        <StatusMessage error={error} />
        <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4">
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>{tc("cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("creating") : t("create")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A small dashed "+ new…" pill that sits in a shelf header, not in the rail. */
function ShelfAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-3 text-xs text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
    >
      <span aria-hidden="true" className="text-sm leading-none">+</span>
      {label}
    </button>
  );
}

// ── the challenge card + its per-viewer menu ────────────────────────────

function ColorSwatch({ tag, selected, onClick, label }: {
  tag: ChallengeColorTag | null; selected: boolean; onClick: () => void; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className={cx(
        "grid h-6 w-6 place-items-center rounded-full ring-1 ring-inset ring-[var(--edge)] transition",
        selected && "outline outline-2 outline-offset-2 outline-[var(--main)]",
      )}
      style={{ backgroundColor: tag ? `var(--tag-${tag})` : "var(--paper)" }}
    >
      {tag ? null : <CircleMinusIcon className="h-3.5 w-3.5 text-[var(--muted)]" />}
    </button>
  );
}

function CardMenu({
  challenge, canManageIt, onTogglePin, onSetColor, onMove, onOpen, onManage,
}: {
  challenge: ChallengeSummary;
  canManageIt: boolean;
  onTogglePin: () => void;
  onSetColor: (tag: ChallengeColorTag | null) => void;
  onMove: (dir: -1 | 1) => void;
  onOpen: () => void;
  onManage: () => void;
}) {
  const t = useTranslations("dashboard");
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };

  return (
    <details
      ref={ref}
      className="relative flex-none"
      onToggle={(event) => {
        if (!(event.currentTarget as HTMLDetailsElement).open) return;
        const onOutside = (e: PointerEvent) => {
          if (ref.current && !ref.current.contains(e.target as Node)) {
            ref.current.open = false;
            document.removeEventListener("pointerdown", onOutside);
          }
        };
        document.addEventListener("pointerdown", onOutside);
      }}
    >
      <summary
        aria-label={t("card.more")}
        title={t("card.more")}
        className="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-full text-[var(--muted)] opacity-60 transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100 [details[open]_&]:bg-[var(--wash)] [details[open]_&]:text-[var(--ink)] [details[open]_&]:opacity-100 [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg>
      </summary>
      <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-60 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-1.5 text-sm shadow-[var(--elevate-2)]">
        <div className="px-3 pb-2 pt-1.5">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">{t("card.color")}</span>
          <div className="flex items-center gap-2">
            <ColorSwatch tag={null} label={t("color.none")} selected={!challenge.colorTag} onClick={() => { onSetColor(null); close(); }} />
            {CHALLENGE_COLOR_TAGS.map((tag) => (
              <ColorSwatch key={tag} tag={tag} label={t(`color.${tag}`)} selected={challenge.colorTag === tag} onClick={() => { onSetColor(tag); close(); }} />
            ))}
          </div>
        </div>
        <div className="border-t border-[var(--line)] pt-1">
          <button type="button" className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onTogglePin(); close(); }}>
            <CirclePinIcon className="h-[18px] w-[18px] text-[var(--muted)]" filled={challenge.pinned} />
            {challenge.pinned ? t("card.unpin") : t("card.pin")}
          </button>
          <button type="button" className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onMove(-1); close(); }}>
            <CircleChevronIcon className="h-[18px] w-[18px] text-[var(--muted)]" dir="up" />{t("card.moveUp")}
          </button>
          <button type="button" className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onMove(1); close(); }}>
            <CircleChevronIcon className="h-[18px] w-[18px] text-[var(--muted)]" dir="down" />{t("card.moveDown")}
          </button>
        </div>
        <div className="border-t border-[var(--line)] pt-1">
          <button type="button" className="flex min-h-10 w-full items-center rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onOpen(); close(); }}>{t("card.open")}</button>
          {canManageIt ? (
            <button type="button" className="flex min-h-10 w-full items-center rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onManage(); close(); }}>{t("card.manage")}</button>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function ActiveChallengeCard({
  challenge,
  onOpen,
  onTogglePin,
  onSetColor,
  onMove,
  onManage,
  reorderMode = false,
  dragHandlers,
}: {
  challenge: ChallengeSummary;
  onOpen: (id: Id) => void;
  onTogglePin?: (id: Id) => void;
  onSetColor?: (id: Id, tag: ChallengeColorTag | null) => void;
  onMove?: (id: Id, dir: -1 | 1) => void;
  onManage?: (id: Id) => void;
  reorderMode?: boolean;
  dragHandlers?: {
    onDragStart: () => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}) {
  const t = useTranslations("dashboard");
  const f = useGoaFormat();
  const tone = challengeStatusTone(challenge.status, challenge.startsOn, challenge.submissionMode);
  const total = challenge.totalCount ?? 0;
  const done = challenge.completedCount ?? 0;
  const livingList = isLivingList(challenge);
  const interactive = Boolean(onTogglePin || onSetColor || onMove);

  return (
    <article
      draggable={reorderMode}
      onDragStart={dragHandlers?.onDragStart}
      onDragOver={dragHandlers?.onDragOver}
      onDrop={dragHandlers?.onDrop}
      onDragEnd={dragHandlers?.onDragEnd}
      className={cx(
        "group relative flex w-[78vw] max-w-[19rem] shrink-0 snap-start flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition sm:w-[19rem]",
        reorderMode ? "cursor-grab active:cursor-grabbing" : "hover:-translate-y-0.5",
        challenge.pinned
          ? "border-[var(--main-line)] shadow-[0_0_0_3px_var(--main-soft),var(--elevate-1)]"
          : livingList ? "border-[var(--line)]" : tone.border,
        "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25",
      )}
    >
      {challenge.colorTag ? (
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: `var(--tag-${challenge.colorTag})` }} aria-hidden="true" />
      ) : null}
      {reorderMode ? (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true"><DragDotsIcon className="h-4 w-4" /></span>
      ) : null}

      <div className={cx("flex flex-1 flex-col p-4 sm:p-5", challenge.colorTag && "pl-5 sm:pl-6", reorderMode && "pl-7")}>
        <div className="flex items-center justify-between gap-2">
          {livingList ? <span /> : <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />}
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--muted)] sm:text-xs">
            {livingList
              ? t("listMeta", { count: total })
              : isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode)
                ? t("startsOn", { date: f.date(challenge.startsOn) })
                : challenge.endsOn
                  ? t("endsOn", { date: f.date(challenge.endsOn) })
                  : t("noDeadline")}
          </span>
          {interactive && !reorderMode ? (
            <div className="relative z-10 flex flex-none items-center gap-0.5">
              {onTogglePin ? (
                <button
                  type="button"
                  onClick={() => onTogglePin(challenge.id)}
                  aria-label={challenge.pinned ? t("card.unpin") : t("card.pin")}
                  title={challenge.pinned ? t("card.unpin") : t("card.pin")}
                  aria-pressed={challenge.pinned}
                  className={cx(
                    "grid h-7 w-7 place-items-center rounded-full transition",
                    challenge.pinned
                      ? "text-[var(--main)] opacity-100"
                      : "text-[var(--muted)] opacity-0 hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100",
                  )}
                >
                  <CirclePinIcon className="h-[18px] w-[18px]" filled={challenge.pinned} />
                </button>
              ) : null}
              {interactive ? (
                <CardMenu
                  challenge={challenge}
                  canManageIt={canManage(challenge.viewerRole)}
                  onTogglePin={() => onTogglePin?.(challenge.id)}
                  onSetColor={(tag) => onSetColor?.(challenge.id, tag)}
                  onMove={(dir) => onMove?.(challenge.id, dir)}
                  onOpen={() => onOpen(challenge.id)}
                  onManage={() => onManage?.(challenge.id)}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <h3 className="mt-4 text-lg font-light leading-tight tracking-[-0.03em] sm:mt-5 sm:text-2xl sm:tracking-[-0.04em]">
          <button type="button" onClick={() => onOpen(challenge.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {challenge.title}
          </button>
        </h3>
        {challenge.description ? <p className="mt-1.5 line-clamp-1 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}

        {total > 0 ? (
          <div className="mt-4 sm:mt-5">
            <div className="mb-2 flex justify-between text-[11px] text-[var(--muted)] sm:text-xs"><span>{t("progress", { done, total })}</span><span>{Math.round((done / total) * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
          </div>
        ) : null}
      </div>
      {!challenge.colorTag ? <span className={cx("block w-full px-5 py-2.5", livingList ? "bg-[var(--wash-strong)]" : tone.solid)} /> : null}
    </article>
  );
}

export function ArchiveChallengeRow({
  challenge,
  onOpen,
}: {
  challenge: ChallengeSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(cardClass, "relative flex w-[78vw] max-w-[19rem] shrink-0 snap-start items-center gap-2.5 overflow-hidden px-4 py-4 text-left text-sm hover:border-[var(--muted)] sm:w-[19rem]")}
    >
      {challenge.colorTag ? <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: `var(--tag-${challenge.colorTag})` }} aria-hidden="true" /> : null}
      <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
      <span className="min-w-0 flex-1 truncate">{challenge.title}</span>
    </button>
  );
}

// ── the screen ──────────────────────────────────────────────────────────

export function DashboardScreen({
  user,
  groups,
  challenges,
  personalWorkspaceId,
  limits,
  csrfToken,
  onOpenGroup,
  onOpenChallenge,
  onOpenAdmin,
  onCreateGroup,
  onOpenPersonalSpace,
  onCreatePersonalChallenge,
  onChanged,
}: {
  user: User;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  personalWorkspaceId: Id | null;
  limits: Limits;
  csrfToken: string;
  onOpenGroup: (id: Id) => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onOpenPersonalSpace: () => void;
  onCreatePersonalChallenge: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("dashboard");
  const tr = useTranslations("roles");
  const tPersonal = useTranslations("personalSpace");

  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [colorFilter, setColorFilter] = useState<ChallengeColorTag | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local overlay for optimistic pin/colour/order edits; resynced whenever the
  // bootstrap challenge list changes underneath us.
  const propKey = challenges.map((c) => `${c.id}:${c.pinned ? 1 : 0}:${c.colorTag ?? ""}:${c.sortIndex ?? ""}`).join("|");
  const [items, setItems] = useState(challenges);
  const [order, setOrder] = useState<Id[]>(() => challenges.map((c) => c.id));
  const [prevKey, setPrevKey] = useState(propKey);
  if (propKey !== prevKey) {
    setPrevKey(propKey);
    setItems(challenges);
    setOrder(challenges.map((c) => c.id));
  }
  const dragId = useRef<Id | null>(null);

  const byId = new Map(items.map((c) => [c.id, c]));
  const ordered = order.map((id) => byId.get(id)).filter((c): c is ChallengeSummary => Boolean(c));
  const shelves = splitShelves(ordered, personalWorkspaceId);
  const shelfOf = (id: Id): ShelfKey | null =>
    CHALLENGE_SHELF_ORDER.find((key) => shelves[key].some((c) => c.id === id)) ?? null;

  async function patchPref(id: Id, patch: { pinned?: boolean; colorTag?: ChallengeColorTag | null }) {
    const snapshot = items;
    setItems((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setError(null);
    try {
      await apiRequest(API_PATHS.challengePrefs(id), { method: "PATCH", csrfToken, body: patch });
      onChanged?.();
    } catch (cause) {
      setItems(snapshot);
      setError((cause as Error).message || t("prefError"));
    }
  }

  async function persistOrder(nextOrder: Id[]) {
    setError(null);
    try {
      await apiRequest(API_PATHS.challengeOrder, { method: "PATCH", csrfToken, body: { ids: nextOrder } });
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message || t("prefError"));
    }
  }

  /** Slot one shelf's ids back into the global order, keeping every other id put. */
  function withShelfReordered(shelfKey: ShelfKey, nextShelfIds: Id[]): Id[] {
    const shelfSet = new Set(shelves[shelfKey].map((c) => c.id));
    let cursor = 0;
    return order.map((id) => (shelfSet.has(id) ? nextShelfIds[cursor++] ?? id : id));
  }

  function move(id: Id, dir: -1 | 1) {
    const shelfKey = shelfOf(id);
    if (!shelfKey) return;
    const ids = shelves[shelfKey].map((c) => c.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const next = withShelfReordered(shelfKey, ids);
    setOrder(next);
    void persistOrder(next);
  }

  function dragOver(shelfKey: ShelfKey, overId: Id) {
    const source = dragId.current;
    if (!source || source === overId) return;
    const ids = shelves[shelfKey].map((c) => c.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(withShelfReordered(shelfKey, ids));
  }

  function cardProps(shelfKey: ShelfKey, challenge: ChallengeSummary) {
    return {
      onTogglePin: (id: Id) => patchPref(id, { pinned: !byId.get(id)?.pinned }),
      onSetColor: (id: Id, tag: ChallengeColorTag | null) => patchPref(id, { colorTag: tag }),
      onMove: move,
      onManage: onOpenAdmin,
      reorderMode,
      dragHandlers: reorderMode
        ? {
            onDragStart: () => { dragId.current = challenge.id; },
            onDragOver: (event: DragEvent) => { event.preventDefault(); dragOver(shelfKey, challenge.id); },
            onDrop: () => { void persistOrder(order); },
            onDragEnd: () => { dragId.current = null; void persistOrder(order); },
          }
        : undefined,
    };
  }

  const standardGroups = groups.filter((group) => group.kind !== "personal");
  const ownedGroups = standardGroups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner;

  function openChallenge(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  const filtered = {
    pinned: applyColorFilter(shelves.pinned, colorFilter),
    running: applyColorFilter(shelves.running, colorFilter),
    space: applyColorFilter(shelves.space, colorFilter),
    archive: applyColorFilter(shelves.archive, colorFilter),
  };
  const filteredCount = filtered.pinned.length + filtered.running.length + filtered.space.length + filtered.archive.length;
  const hasAnyChallenge = challenges.length > 0;
  const brandNew = !hasAnyChallenge && !standardGroups.length;

  function renderRail(shelfKey: ShelfKey, list: ChallengeSummary[]): ReactNode {
    return list.map((challenge) => (
      <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} {...cardProps(shelfKey, challenge)} />
    ));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={t("greeting", { name: user.name.split(" ")[0] })} description={t("subtitle")} />

      {showGroupDialog ? <GroupCreateDialog onClose={() => setShowGroupDialog(false)} onCreate={onCreateGroup} /> : null}

      {hasAnyChallenge ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-4">
          <button
            type="button"
            onClick={() => setColorFilter(null)}
            aria-pressed={colorFilter === null}
            className={cx(
              "inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] transition",
              colorFilter === null
                ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]"
                : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)]",
            )}
          >
            {t("filter.all")}
          </button>
          {CHALLENGE_COLOR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setColorFilter((cur) => (cur === tag ? null : tag))}
              aria-label={t(`color.${tag}`)}
              aria-pressed={colorFilter === tag}
              className={cx(
                "grid h-9 w-9 place-items-center rounded-full border transition",
                colorFilter === tag ? "border-[var(--main)] bg-[var(--main-soft)]" : "border-[var(--line)] hover:border-[var(--main-line)]",
              )}
            >
              <span className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-[var(--edge)]" style={{ backgroundColor: `var(--tag-${tag})` }} />
            </button>
          ))}
          <span className="flex-1" />
          {colorFilter ? (
            <button type="button" onClick={() => setColorFilter(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]">
              <CircleMinusIcon className="h-4 w-4" />
              {t("filter.context", { count: filteredCount })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setReorderMode((v) => !v)}
              aria-pressed={reorderMode}
              className={cx(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition",
                reorderMode
                  ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]"
                  : "border-dashed border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)]",
              )}
            >
              <DragDotsIcon className="h-3.5 w-3.5" />
              {reorderMode ? t("filter.reorderDone") : t("filter.reorder")}
            </button>
          )}
        </div>
      ) : null}

      <StatusMessage error={error} />

      {brandNew ? (
        <EmptyState
          title={t("emptyGroupsTitle")}
          description={t.rich("emptyGroupsCreatePrompt", { action: (chunks) => <EmptyStateAction onClick={() => setShowGroupDialog(true)}>{chunks}</EmptyStateAction> })}
          action={<Button variant="secondary" onClick={onCreatePersonalChallenge}>{tPersonal("create")}</Button>}
        />
      ) : null}

      {brandNew ? null : (
        <>
          {filtered.pinned.length ? (
            <Shelf title={t("shelf.pinned")} count={filtered.pinned.length}>
              {renderRail("pinned", filtered.pinned)}
            </Shelf>
          ) : null}

          <Shelf title={t("shelf.running")} count={filtered.running.length}>
            {filtered.running.length
              ? renderRail("running", filtered.running)
              : <div className="w-full max-w-xl"><EmptyState title={t("noChallengesTitle")} description={colorFilter ? t("filter.empty") : t("noChallengesBody")} /></div>}
          </Shelf>

          <Shelf
            title={tPersonal("title")}
            count={filtered.space.length}
            onTitleClick={onOpenPersonalSpace}
            actions={colorFilter ? undefined : <ShelfAddButton label={t("shelfAdd.personal")} onClick={onCreatePersonalChallenge} />}
          >
            {filtered.space.length
              ? renderRail("space", filtered.space)
              : <div className="w-full max-w-xl"><EmptyState title={tPersonal("emptyTitle")} description={colorFilter ? t("filter.empty") : tPersonal("emptyBody")} /></div>}
          </Shelf>

          {colorFilter ? null : (
            <Shelf
              title={t("groupsTitle")}
              count={standardGroups.length}
              actions={atGroupLimit ? undefined : <ShelfAddButton label={t("shelfAdd.group")} onClick={() => setShowGroupDialog(true)} />}
            >
              {standardGroups.length
                ? standardGroups.map((group) => {
                    const count = group.memberCount ?? group.members?.length ?? 0;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => onOpenGroup(group.id)}
                        className={cx(cardClass, "flex min-h-[5.5rem] w-[78vw] max-w-[19rem] shrink-0 snap-start flex-col justify-center gap-1 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--muted)] sm:w-[19rem]")}
                      >
                        <span className="text-sm">{group.name}</span>
                        <small className="text-[var(--muted)]">{t("peopleCount", { count })} · {tr(group.role)}</small>
                      </button>
                    );
                  })
                : <div className="w-full max-w-xl"><EmptyState title={t("emptyGroupsTitle")} description={t("emptyGroupsShort")} /></div>}
            </Shelf>
          )}

          {filtered.archive.length ? (
            <Shelf title={t("archiveTitle")} count={filtered.archive.length}>
              {filtered.archive.map((challenge) => (
                <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />
              ))}
            </Shelf>
          ) : null}
        </>
      )}
    </main>
  );
}
