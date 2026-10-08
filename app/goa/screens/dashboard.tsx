"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";

import { KebabMenu, menuRowClass } from "../card-menu";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { CatalogShelf } from "../catalog-shelf";
import { applyColorFilter, OrganizeBar, useChallengeOrganizer } from "../organize";
import { NewChallengeTile } from "../add-tile";
import { Shelf, ShelfAddButton, shelfCardWidth } from "../shelf";
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
  CircleMinusIcon,
  CirclePinIcon,
  cx,
  EmptyState,
  Field,
  inputClass,
  PageHeading,
  StatusMessage,
} from "../ui";
import { canManage, isChallengeScheduled, isLivingList, isPersonalChallenge } from "../utils";

// ── shelf helpers (pure, unit-tested) ────────────────────────────────────

type ShelfKey = "pinned" | "personal" | "group" | "archive";

/**
 * Split the viewer's challenges into Home's shelves. A pinned challenge shows only in "pinned"; the rest go by
 * status — running ones into their side's shelf ("personal"/"group") and everything closed or still a draft into
 * "archive". Order within each shelf is preserved.
 */
export function splitShelves(challenges: ChallengeSummary[], personalWorkspaceId: Id | null): Record<ShelfKey, ChallengeSummary[]> {
  const out: Record<ShelfKey, ChallengeSummary[]> = { pinned: [], personal: [], group: [], archive: [] };
  for (const challenge of challenges) {
    if (challenge.pinned) out.pinned.push(challenge);
    else if (challenge.status !== "active") out.archive.push(challenge);
    else out[isPersonalChallenge(challenge, personalWorkspaceId) ? "personal" : "group"].push(challenge);
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
  challenge, canManageIt, onTogglePin, onSetColor, onOpen, onManage,
}: {
  challenge: ChallengeSummary;
  canManageIt: boolean;
  onTogglePin: () => void;
  onSetColor: (tag: ChallengeColorTag | null) => void;
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
  onManage,
  fluid = false,
  context,
}: {
  challenge: ChallengeSummary;
  onOpen: (id: Id) => void;
  onTogglePin?: (id: Id) => void;
  onSetColor?: (id: Id, tag: ChallengeColorTag | null) => void;
  onManage?: (id: Id) => void;
  /** Fill the container instead of the fixed shelf width (a group's grid). */
  fluid?: boolean;
  /** Whose challenge it is — "Just you" or the group's name — on the pinned shelf, which holds both sides. */
  context?: string;
}) {
  const t = useTranslations("dashboard");
  const f = useGoaFormat();
  const tone = challengeStatusTone(challenge.status, challenge.startsOn, challenge.submissionMode);
  const total = challenge.totalCount ?? 0;
  const done = challenge.completedCount ?? 0;
  const livingList = isLivingList(challenge);
  const interactive = Boolean(onTogglePin || onSetColor);
  const menu = interactive ? (
    <CardMenu
      challenge={challenge}
      canManageIt={canManage(challenge.viewerRole)}
      onTogglePin={() => onTogglePin?.(challenge.id)}
      onSetColor={(tag) => onSetColor?.(challenge.id, tag)}
      onOpen={() => onOpen(challenge.id)}
      onManage={() => onManage?.(challenge.id)}
    />
  ) : null;

  return (
    <article
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition",
        fluid ? "w-full" : shelfCardWidth,
        "hover:-translate-y-0.5",
        livingList ? "border-[var(--line)]" : tone.border,
        "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25",
      )}
    >
      {challenge.colorTag ? (
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: `var(--tag-${challenge.colorTag})` }} aria-hidden="true" />
      ) : null}

      <div className={cx("flex flex-1 flex-col p-3.5 sm:p-5", challenge.colorTag && "pl-4.5 sm:pl-6")}>
        {/* A phone-sized card keeps the status dot and the menu; the date or count and the pin come in from `sm:` up. */}
        <div className="flex items-center justify-between gap-2">
          {livingList ? <span /> : <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />}
          <span className="hidden min-w-0 flex-1 truncate text-right text-xs text-[var(--muted)] sm:block">
            {livingList
              ? t("listMeta", { count: total })
              : isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode)
                ? t("startsOn", { date: f.date(challenge.startsOn) })
                : challenge.endsOn
                  ? t("endsOn", { date: f.date(challenge.endsOn) })
                  : t("noDeadline")}
          </span>
          {interactive ? (
            <div className="relative z-10 flex flex-none items-center gap-0.5">
              {onTogglePin ? (
                <button
                  type="button"
                  onClick={() => onTogglePin(challenge.id)}
                  aria-label={challenge.pinned ? t("card.unpin") : t("card.pin")}
                  title={challenge.pinned ? t("card.unpin") : t("card.pin")}
                  aria-pressed={challenge.pinned}
                  className={cx(
                    "hidden h-7 w-7 place-items-center rounded-full transition sm:grid",
                    challenge.pinned
                      ? "text-[var(--main)] opacity-100"
                      : "text-[var(--muted)] opacity-0 hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100",
                  )}
                >
                  <CirclePinIcon className="h-[18px] w-[18px]" filled={challenge.pinned} />
                </button>
              ) : null}
              {menu}
            </div>
          ) : null}
        </div>

        <h3 className="mt-2.5 text-base font-light leading-tight tracking-[-0.03em] sm:mt-5 sm:text-2xl sm:tracking-[-0.04em]">
          <button type="button" onClick={() => onOpen(challenge.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {challenge.title}
          </button>
        </h3>
        {context ? <p className="mt-1 truncate text-xs text-[var(--muted)]">{context}</p> : null}
        {/* A phone-sized card has no room for the description; the title says enough. */}
        {challenge.description ? <p className="mt-1.5 line-clamp-1 hidden text-sm leading-6 text-[var(--muted)] sm:block">{challenge.description}</p> : null}

        {total > 0 ? (
          <div className="mt-3 sm:mt-5">
            <div className="mb-2 flex justify-between text-[11px] text-[var(--muted)] sm:text-xs"><span>{t("progress", { done, total })}</span><span>{Math.round((done / total) * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
          </div>
        ) : null}
      </div>
      {!challenge.colorTag ? <span className={cx("block w-full px-5 py-1.5 sm:py-2.5", livingList ? "bg-[var(--line)]" : tone.solid)} /> : null}
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
      className={cx(cardClass, shelfCardWidth, "relative flex items-center gap-2.5 overflow-hidden px-3.5 py-3.5 text-left text-sm hover:border-[var(--muted)] sm:px-4 sm:py-4")}
    >
      {challenge.colorTag ? <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: `var(--tag-${challenge.colorTag})` }} aria-hidden="true" /> : null}
      <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
      <span className="min-w-0 flex-1 truncate">{challenge.title}</span>
    </button>
  );
}


// ── the screen ──────────────────────────────────────────────────────────

/** A side of Home — the person's own challenges or their groups' — under one big heading. */
/** A side of Home — the person's own challenges or their groups' — under one big heading. */
function HomeSectionBlock({ title, first, children }: { title: string; first: boolean; children: ReactNode }) {
  return (
    <section className={first ? "" : "mt-12 border-t border-[var(--line)] pt-8"}>
      <h2 className="mb-6 text-2xl font-light tracking-[-0.04em] sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

/** The one line the groups side shrinks to while someone has no group yet — never an empty shelf. */
function HomeSideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--line)] px-4 text-left text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
    >
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}

/**
 * Home: the person's own challenges first, then their groups' — each side under its own heading. Pinned
 * challenges sit above both; closed ones and drafts below. Someone with no group sees one line inviting them
 * to start one instead of an empty groups side.
 */
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
  onQuickCreatePersonal,
  onCreatePersonalChallenge,
  onOpenPersonalCatalog,
  onOpenPersonalCatalogItem,
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
  onQuickCreatePersonal: () => void;
  onCreatePersonalChallenge: () => void;
  onOpenPersonalCatalog: () => void;
  onOpenPersonalCatalogItem: (itemId: Id) => void;
  onOpenTemplates: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("dashboard");
  const th = useTranslations("dashboard.home");
  const tWelcome = useTranslations("welcome");
  const tr = useTranslations("roles");
  const tQuick = useTranslations("quickCreate");

  const [showGroupDialog, setShowGroupDialog] = useState(false);

  const standardGroups = groups.filter((group) => group.kind !== "personal");
  const ownedGroups = standardGroups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner;
  const groupName = new Map(standardGroups.map((group) => [group.id, group.name]));

  const { shelves, colorFilter, setColorFilter, error, cardProps } = useChallengeOrganizer({
    challenges,
    csrfToken,
    onChanged,
    split: (all) => splitShelves(all, personalWorkspaceId),
  });

  function openChallenge(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  const contextOf = (challenge: ChallengeSummary) =>
    isPersonalChallenge(challenge, personalWorkspaceId) ? th("justYou") : groupName.get(challenge.groupId ?? "") ?? undefined;

  const filtered = {
    pinned: applyColorFilter(shelves.pinned, colorFilter),
    personal: applyColorFilter(shelves.personal, colorFilter),
    group: applyColorFilter(shelves.group, colorFilter),
    archive: applyColorFilter(shelves.archive, colorFilter),
  };
  const filteredCount = Object.values(filtered).reduce((sum, list) => sum + list.length, 0);
  const hasAnyChallenge = challenges.length > 0;
  // Brand new = nothing anywhere: no challenge of their own, no group.
  const brandNew = challenges.length === 0 && !standardGroups.length;

  function renderRail(list: ChallengeSummary[], labelled: boolean): ReactNode {
    return list.map((challenge) => (
      <ActiveChallengeCard
        key={challenge.id}
        challenge={challenge}
        onOpen={() => openChallenge(challenge)}
        context={labelled ? contextOf(challenge) : undefined}
        {...cardProps(onOpenAdmin)}
      />
    ));
  }

  const emptyRail = (title: string) => <div className="w-full max-w-xl"><EmptyState title={colorFilter ? t("filter.empty") : title} /></div>;

  // The way to start a challenge of your own: a card at the end of the row (hidden while a colour filters it).
  const newPersonalTile = colorFilter ? null : (
    <NewChallengeTile label={th("newChallenge")} chatLabel={tQuick("entryCta")} onCreate={onCreatePersonalChallenge} onChat={onQuickCreatePersonal} />
  );

  const groupsShelf = colorFilter ? null : (
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
                className={cx(cardClass, shelfCardWidth, "flex min-h-[4.5rem] flex-col justify-center gap-1 p-3.5 text-left transition hover:-translate-y-0.5 sm:min-h-[5.5rem] sm:p-4 hover:border-[var(--muted)] sm:w-[19rem]")}
              >
                <span className="text-sm">{group.name}</span>
                <small className="text-[var(--muted)]">{t("peopleCount", { count })} · {tr(group.role)}</small>
              </button>
            );
          })
        : <div className="w-full max-w-xl"><EmptyState title={t("emptyGroupsTitle")} onClick={atGroupLimit ? undefined : () => setShowGroupDialog(true)} /></div>}
    </Shelf>
  );

  const personalLibrary = colorFilter ? null : (
    <div className="mt-8">
      <CatalogShelf scope="personal" canManage onOpenCatalog={onOpenPersonalCatalog} onOpenItem={onOpenPersonalCatalogItem} />
    </div>
  );

  const hasGroups = standardGroups.length > 0;

  return (
    <main className="px-4 py-8 pb-24 sm:px-6 sm:py-12 lg:px-20">
      <PageHeading
        title={t("greeting", { name: user.name.split(" ")[0] })}
        description={brandNew ? tWelcome("lede") : t("subtitle")}
      />

      {showGroupDialog ? (
        <GroupCreateDialog
          onClose={() => setShowGroupDialog(false)}
          onCreate={onCreateGroup}
        />
      ) : null}


      {hasAnyChallenge ? (
        <OrganizeBar colorFilter={colorFilter} onColorFilter={setColorFilter} filteredCount={filteredCount} />
      ) : null}

      <StatusMessage error={error} />

      {brandNew ? (
        <WelcomePanel onCreateGroup={() => setShowGroupDialog(true)} onQuickCreate={onQuickCreate} onOpenTemplates={onOpenTemplates} />
      ) : (
        <>
          {filtered.pinned.length ? (
            <div className="mb-12">
              <Shelf title={t("shelf.pinned")} count={filtered.pinned.length}>
                {renderRail(filtered.pinned, true)}
              </Shelf>
            </div>
          ) : null}

          <HomeSectionBlock first={!filtered.pinned.length} title={th("sectionPersonal")}>
            <Shelf title={th("personalRunning")} count={filtered.personal.length}>
              {filtered.personal.length || newPersonalTile ? <>{renderRail(filtered.personal, false)}{newPersonalTile}</> : emptyRail(th("personalEmpty"))}
            </Shelf>
            {personalLibrary}
          </HomeSectionBlock>

          {hasGroups ? (
            <HomeSectionBlock first={false} title={th("sectionGroups")}>
              <Shelf title={t("shelf.running")} count={filtered.group.length}>
                {filtered.group.length ? renderRail(filtered.group, false) : emptyRail(t("noChallengesTitle"))}
              </Shelf>
              {groupsShelf}
            </HomeSectionBlock>
          ) : null}

          {filtered.archive.length ? (
            <div className="mt-12">
              <Shelf title={t("archiveTitle")} count={filtered.archive.length}>
                {filtered.archive.map((challenge) => (
                  <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />
                ))}
              </Shelf>
            </div>
          ) : null}

          {!hasGroups && !atGroupLimit && !colorFilter ? (
            <div className="mt-12"><HomeSideLink label={th("inviteGroups")} onClick={() => setShowGroupDialog(true)} /></div>
          ) : null}
        </>
      )}
    </main>
  );
}
