"use client";

import { useTranslations } from "next-intl";
import { type DragEvent, type FormEvent, type ReactNode, useState } from "react";

import { KebabMenu, menuRowClass } from "../card-menu";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { applyColorFilter, OrganizeBar, useChallengeOrganizer } from "../organize";
import { Shelf, ShelfAddButton } from "../shelf";
import { WelcomePanel } from "../welcome";
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
  Field,
  inputClass,
  PageHeading,
  StatusMessage,
} from "../ui";
import { canManage, isChallengeScheduled, isLivingList, isPersonalChallenge } from "../utils";

// ── shelf helpers (pure, unit-tested) ────────────────────────────────────

type ShelfKey = "pinned" | "running" | "space" | "archive";
const CHALLENGE_SHELF_ORDER: ShelfKey[] = ["pinned", "running", "space", "archive"];

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

export { applyColorFilter };

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

// ── the challenge card + its per-viewer menu ────────────────────────────

export function ColorSwatch({ tag, selected, onClick, label }: {
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
  challenge, canManageIt, canMoveUp, canMoveDown, onTogglePin, onSetColor, onMove, onOpen, onManage,
}: {
  challenge: ChallengeSummary;
  canManageIt: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onTogglePin: () => void;
  onSetColor: (tag: ChallengeColorTag | null) => void;
  onMove: (dir: -1 | 1) => void;
  onOpen: () => void;
  onManage: () => void;
}) {
  const t = useTranslations("dashboard");
  const rowClass = menuRowClass;

  return (
    <KebabMenu label={t("card.more")}>
      {(close) => (
        <>
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
            <button type="button" className={rowClass} onClick={() => { onTogglePin(); close(); }}>
              <CirclePinIcon className="h-[18px] w-[18px] text-[var(--muted)]" filled={challenge.pinned} />
              {challenge.pinned ? t("card.unpin") : t("card.pin")}
            </button>
            {canMoveUp ? (
              <button type="button" className={rowClass} onClick={() => { onMove(-1); close(); }}>
                <CircleChevronIcon className="h-[18px] w-[18px] text-[var(--muted)]" dir="up" />{t("card.moveUp")}
              </button>
            ) : null}
            {canMoveDown ? (
              <button type="button" className={rowClass} onClick={() => { onMove(1); close(); }}>
                <CircleChevronIcon className="h-[18px] w-[18px] text-[var(--muted)]" dir="down" />{t("card.moveDown")}
              </button>
            ) : null}
          </div>
          <div className="border-t border-[var(--line)] pt-1">
            <button type="button" className="flex min-h-10 w-full items-center rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onOpen(); close(); }}>{t("card.open")}</button>
            {canManageIt ? (
              <button type="button" className="flex min-h-10 w-full items-center rounded-xl px-3 hover:bg-[var(--wash)]" onClick={() => { onManage(); close(); }}>{t("card.manage")}</button>
            ) : null}
          </div>
        </>
      )}
    </KebabMenu>
  );
}

export function ActiveChallengeCard({
  challenge,
  onOpen,
  onTogglePin,
  onSetColor,
  onMove,
  onManage,
  canMoveUp = true,
  canMoveDown = true,
  reorderMode = false,
  fluid = false,
  dragHandlers,
}: {
  challenge: ChallengeSummary;
  onOpen: (id: Id) => void;
  onTogglePin?: (id: Id) => void;
  onSetColor?: (id: Id, tag: ChallengeColorTag | null) => void;
  onMove?: (id: Id, dir: -1 | 1) => void;
  onManage?: (id: Id) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  reorderMode?: boolean;
  /** Fill the container instead of the fixed shelf width (grids on My space / a group). */
  fluid?: boolean;
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
        "group relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition",
        fluid ? "w-full" : "w-[78vw] max-w-[19rem] shrink-0 snap-start sm:w-[19rem]",
        reorderMode ? "cursor-grab active:cursor-grabbing" : "hover:-translate-y-0.5",
        livingList ? "border-[var(--line)]" : tone.border,
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
                  canMoveUp={Boolean(onMove) && canMoveUp}
                  canMoveDown={Boolean(onMove) && canMoveDown}
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
      {!challenge.colorTag ? <span className={cx("block w-full px-5 py-2.5", livingList ? "bg-[var(--line)]" : tone.solid)} /> : null}
    </article>
  );
}

function ArchiveChallengeRow({
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
  onQuickCreate,
  onOpenTemplates,
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
  onQuickCreate: () => void;
  onOpenTemplates: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("dashboard");
  const tWelcome = useTranslations("welcome");
  const tr = useTranslations("roles");
  const tQuick = useTranslations("quickCreate");

  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const { shelves, colorFilter, setColorFilter, reorderMode, setReorderMode, error, cardProps } = useChallengeOrganizer({
    challenges,
    csrfToken,
    onChanged,
    keys: CHALLENGE_SHELF_ORDER,
    split: (ordered) => splitShelves(ordered, personalWorkspaceId),
  });

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
    archive: applyColorFilter(shelves.archive, colorFilter),
  };
  const filteredCount = filtered.pinned.length + filtered.running.length + filtered.archive.length;
  // Personal challenges live on their own page (My space); only a pinned one shows here.
  const hasAnyChallenge = shelves.pinned.length + shelves.running.length + shelves.archive.length > 0;
  // Brand new = nothing anywhere, My space included.
  const brandNew = challenges.length === 0 && !standardGroups.length;

  function renderRail(shelfKey: ShelfKey, list: ChallengeSummary[]): ReactNode {
    return list.map((challenge) => (
      <ActiveChallengeCard
        key={challenge.id}
        challenge={challenge}
        onOpen={onOpenChallenge}
        {...cardProps(shelfKey, challenge, onOpenAdmin)}
      />
    ));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={t("greeting", { name: user.name.split(" ")[0] })} description={brandNew ? tWelcome("lede") : t("subtitle")} />

      {showGroupDialog ? <GroupCreateDialog onClose={() => setShowGroupDialog(false)} onCreate={onCreateGroup} /> : null}

      {hasAnyChallenge ? (
        <OrganizeBar colorFilter={colorFilter} onColorFilter={setColorFilter} reorderMode={reorderMode} onReorderMode={setReorderMode} filteredCount={filteredCount} />
      ) : null}

      <StatusMessage error={error} />

      {brandNew ? (
        <WelcomePanel onCreateGroup={() => setShowGroupDialog(true)} onQuickCreate={onQuickCreate} onOpenTemplates={onOpenTemplates} />
      ) : null}

      {brandNew ? null : (
        <>
          {filtered.pinned.length ? (
            <Shelf title={t("shelf.pinned")} count={filtered.pinned.length}>
              {renderRail("pinned", filtered.pinned)}
            </Shelf>
          ) : null}

          <Shelf title={t("shelf.running")} count={filtered.running.length} actions={<ShelfAddButton label={tQuick("entryCta")} onClick={onQuickCreate} />}>
            {filtered.running.length
              ? renderRail("running", filtered.running)
              : <div className="w-full max-w-xl"><EmptyState title={colorFilter ? t("filter.empty") : t("noChallengesTitle")} /></div>}
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
                : <div className="w-full max-w-xl"><EmptyState title={t("emptyGroupsTitle")} onClick={atGroupLimit ? undefined : () => setShowGroupDialog(true)} /></div>}
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
