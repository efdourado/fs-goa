"use client";

import { StateButton } from "../state-button";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Dialog, ModalActions } from "../dialog";
import { useGoaFormat } from "../format";
import { CatalogShelfView } from "../catalog-shelf";
import { useCatalogShelf } from "../libraries";
import { Shelf, ShelfAddButton, shelfCardWidth } from "../shelf";
import { ReadyMadeTemplatesSection } from "../template-gallery";
import { NewChallengeButton, WelcomePanel } from "../welcome";
import {
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
  cx,
  EmptyState,
  FaceEmptyState,
  Field,
  inputClass,
  PageHeading,
  StatusMessage,
} from "../ui";
import { canManage, isChallengeScheduled, isLivingList, isPersonalChallenge } from "../utils";

// ── shelf helpers (pure, unit-tested) ────────────────────────────────────

type ShelfKey = "personal" | "group" | "archive";

/**
 * Split the viewer's challenges into Home's shelves by status: running ones into their side's shelf
 * ("personal"/"group") and everything closed or still a draft into "archive". Order within each shelf is preserved.
 */
export function splitShelves(challenges: ChallengeSummary[], personalWorkspaceId: Id | null): Record<ShelfKey, ChallengeSummary[]> {
  const out: Record<ShelfKey, ChallengeSummary[]> = { personal: [], group: [], archive: [] };
  for (const challenge of challenges) {
    if (challenge.status !== "active") out.archive.push(challenge);
    else out[isPersonalChallenge(challenge, personalWorkspaceId) ? "personal" : "group"].push(challenge);
  }
  return out;
}


// ── group-create dialog ─────────────────────────────────────────────────

/** Group creation lives in a modal — the "+ New group" button in the groups shelf header opens it. */
function GroupCreateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const t = useTranslations("dashboard");
  const f = useGoaFormat();
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = groupName.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name) return;
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
          <input className={inputClass} name="name" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("groupNamePlaceholder")} required maxLength={100} disabled={busy} />
        </Field>
        <StatusMessage error={error} />
        <ModalActions className="border-t border-[var(--line)] pt-4">
          <Button type="submit" disabled={busy || !name}>{busy ? t("creating") : t("create")}</Button>
        </ModalActions>
      </form>
    </Dialog>
  );
}

// ── the challenge card ──────────────────────────────────────────────────

export function ActiveChallengeCard({
  challenge,
  onOpen,
}: {
  challenge: ChallengeSummary;
  onOpen: (id: Id) => void;
}) {
  const t = useTranslations("dashboard");
  const f = useGoaFormat();
  const tone = challengeStatusTone(challenge.status, challenge.startsOn, challenge.submissionMode);
  const total = challenge.totalCount ?? 0;
  const done = challenge.completedCount ?? 0;
  const livingList = isLivingList(challenge);

  return (
    <article
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition",
        shelfCardWidth,
        "hover:-translate-y-0.5",
        livingList ? "border-[var(--line)]" : tone.border,
        "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25",
      )}
    >
      <div className="flex flex-1 flex-col p-3.5 sm:p-5">
        {/* A phone-sized card keeps the status dot; the date or count comes in from `sm:` up. */}
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
        </div>

        <h3 className="mt-2.5 text-base font-light leading-tight tracking-[-0.03em] sm:mt-5 sm:text-2xl sm:tracking-[-0.04em]">
          <StateButton type="button" onClick={() => onOpen(challenge.id)} title={challenge.title} className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {challenge.title}
          </StateButton>
        </h3>
        {/* A phone-sized card has no room for the description; the title says enough. */}
        {challenge.description ? <p className="mt-1.5 hidden text-sm leading-6 text-[var(--muted)] sm:line-clamp-2">{challenge.description}</p> : null}

        {total > 0 ? (
          <div className="mt-3 sm:mt-5">
            <div className="mb-2 flex justify-between text-[11px] text-[var(--muted)] sm:text-xs"><span>{t("progress", { done, total })}</span><span>{Math.round((done / total) * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
          </div>
        ) : null}
      </div>
      <span className={cx("block w-full px-5 py-1.5 sm:py-2.5", livingList ? "bg-[var(--line)]" : tone.solid)} />
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
    <StateButton
      type="button"
      onClick={onOpen}
      className={cx(cardClass, shelfCardWidth, "relative flex items-center gap-2.5 overflow-hidden px-3.5 py-3.5 text-left text-sm hover:border-[var(--muted)] sm:px-4 sm:py-4")}
    >
      <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
      <span className="min-w-0 flex-1 truncate">{challenge.title}</span>
    </StateButton>
  );
}

const CHALLENGE_SHELF_BATCH = 24;

export function ChallengeShelf({ title, challenges, actions, empty, renderCard }: {
  title: string;
  challenges: ChallengeSummary[];
  actions?: ReactNode;
  empty?: ReactNode;
  renderCard: (challenge: ChallengeSummary) => ReactNode;
}) {
  const t = useTranslations("personalCatalog");
  const [shown, setShown] = useState(CHALLENGE_SHELF_BATCH);
  const end = useRef<HTMLSpanElement>(null);
  const more = shown < challenges.length;

  useEffect(() => {
    if (!more || !end.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      setShown((current) => Math.max(current, shown + CHALLENGE_SHELF_BATCH));
    });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [more, shown]);

  return (
    <Shelf title={title} count={challenges.length} actions={<>
      {actions}
      {more ? <Button variant="secondary" onClick={() => setShown(shown + CHALLENGE_SHELF_BATCH)}>
        {t("showMore", { count: Math.min(CHALLENGE_SHELF_BATCH, challenges.length - shown) })}
      </Button> : null}
    </>}>
      {challenges.length ? challenges.slice(0, shown).map(renderCard) : empty}
      {more ? <span ref={end} aria-hidden="true" className="w-px shrink-0" /> : null}
    </Shelf>
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

/** The one quiet line a side of Home shrinks to while it has nothing (no group yet, nothing of your own) — never an empty shelf. */
function HomeSideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <StateButton
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--ink-strong)]"
    >
      <span aria-hidden="true">＋</span>
      <span>{label}</span>
    </StateButton>
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
  onOpenGroup,
  onOpenChallenge,
  onOpenAdmin,
  onCreateGroup,
  onQuickCreate,
  onQuickCreatePersonal,
  onCreatePersonalChallenge,
  onCreateManually,
  onOpenTemplate,
  onOpenPersonalCatalog,
}: {
  user: User;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  personalWorkspaceId: Id | null;
  limits: Limits;
  onOpenGroup: (id: Id) => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onQuickCreate: () => void;
  onQuickCreatePersonal: () => void;
  onCreatePersonalChallenge: () => void;
  /** Building a first challenge by hand, once it's known who it's for (a new group is made on the way). */
  onCreateManually: (target: { personal: true } | { groupId: Id } | { newGroup: string }) => Promise<void>;
  onOpenTemplate: (id: Id) => void;
  onOpenPersonalCatalog: () => void;
}) {
  const t = useTranslations("dashboard");
  const th = useTranslations("dashboard.home");
  const tWelcome = useTranslations("welcome");
  const personalShelf = useCatalogShelf("personal");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");

  const [showGroupDialog, setShowGroupDialog] = useState(false);

  const standardGroups = groups.filter((group) => group.kind !== "personal");
  const ownedGroups = standardGroups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner || standardGroups.length >= limits.groupsPerMember;

  const shelves = splitShelves(challenges, personalWorkspaceId);

  function openChallenge(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  // Brand new = nothing anywhere: no challenge of their own, no group.
  const brandNew = challenges.length === 0 && !standardGroups.length;

  function renderCard(challenge: ChallengeSummary): ReactNode {
    return <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />;
  }

  const emptyRail = (title: string) => <div className="w-full max-w-xl"><EmptyState title={title} /></div>;

  // Starting a challenge of your own: one small button beside the shelf's title, like "new group", that asks chat or by
  // hand.
  const newPersonalActions = (
    <NewChallengeButton label={tc("newChallengePill")} onChat={onQuickCreatePersonal} onManual={onCreatePersonalChallenge} />
  );

  const groupsShelf = (
    <Shelf
      title={t("groupsTitle")}
      count={standardGroups.length}
      actions={atGroupLimit ? undefined : <ShelfAddButton label={t("shelfAdd.group")} onClick={() => setShowGroupDialog(true)} />}
    >
      {standardGroups.length
        ? standardGroups.map((group) => {
            const count = group.memberCount ?? group.members?.length ?? 0;
            return (
              <StateButton
                key={group.id}
                type="button"
                onClick={() => onOpenGroup(group.id)}
                className={cx(cardClass, shelfCardWidth, "flex min-h-[4.5rem] flex-col justify-center gap-1 p-3.5 text-left transition hover:-translate-y-0.5 sm:min-h-[5.5rem] sm:p-4 hover:border-[var(--muted)] sm:w-[19rem]")}
              >
                <span className="text-sm">{group.name}</span>
                <small className="text-[var(--muted)]">{t("peopleCount", { count })} · {tr(group.role)}</small>
              </StateButton>
            );
          })
        : <div className="w-full max-w-xl"><EmptyState title={t("emptyGroupsTitle")} onClick={atGroupLimit ? undefined : () => setShowGroupDialog(true)} /></div>}
    </Shelf>
  );

  // A phone reaches the catalogue from the dock, so the preview is a computer's only.
  const personalLibrary = (
    <div className="mt-8 hidden sm:block">
      <CatalogShelfView scope="personal" canManage data={personalShelf} onOpenCatalog={onOpenPersonalCatalog} />
    </div>
  );

  const hasGroups = standardGroups.length > 0;
  // Nothing of their own at all (no personal challenge, an empty catalogue): the "Just me" side steps aside for
  // one quiet line under the groups. Not everyone wants challenges of their own. While the catalogue is still
  // loading the side simply isn't drawn yet, so it never flashes in and out.
  const hasPersonalChallenge = challenges.some((challenge) => isPersonalChallenge(challenge, personalWorkspaceId));
  const personalItems = personalShelf ? personalShelf.items.length + Object.values(personalShelf.counts).reduce((sum, count) => sum + count, 0) : 0;
  const personalBlank = !hasPersonalChallenge && personalItems === 0;
  // A colour filter shows only the sections holding a challenge of that colour, and just the empty state when
  // none has it.
  const showPersonalSide = !personalBlank;

  return (
    <main className="px-4 py-8 pb-24 sm:px-6 sm:py-12 lg:px-20">
      {brandNew ? (
        <div className="mb-7">
          <div className="flex items-center justify-between gap-4">
            <h1 className="min-w-0 text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{t("greeting", { name: user.name.split(" ")[0] })}</h1>
            <WelcomePanel groups={standardGroups.filter((group) => canManage(group.role))} onQuickCreate={onQuickCreate} onCreateManually={onCreateManually} />
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{tWelcome("lede")}</p>
        </div>
      ) : (
        <PageHeading title={t("greeting", { name: user.name.split(" ")[0] })} />
      )}

      {showGroupDialog ? (
        <GroupCreateDialog
          onClose={() => setShowGroupDialog(false)}
          onCreate={onCreateGroup}
        />
      ) : null}


      {brandNew ? (
        <>
          <FaceEmptyState title={tWelcome("starts.quick.title")} />
          <ReadyMadeTemplatesSection onOpen={onOpenTemplate} />
        </>
      ) : (
        <>
          {showPersonalSide ? (
            <HomeSectionBlock first title={th("sectionPersonal")}>
              <ChallengeShelf title={th("personalRunning")} challenges={shelves.personal} actions={newPersonalActions} empty={emptyRail(th("personalEmpty"))} renderCard={(challenge) => renderCard(challenge)} />
              {personalLibrary}
            </HomeSectionBlock>
          ) : null}

          {hasGroups ? (
            <HomeSectionBlock first={!showPersonalSide} title={th("sectionGroups")}>
              {shelves.group.length ? (
                <ChallengeShelf title={t("shelf.running")} challenges={shelves.group} renderCard={(challenge) => renderCard(challenge)} />
              ) : null}
              {groupsShelf}
            </HomeSectionBlock>
          ) : null}

          {shelves.archive.length ? (
            <div className="mt-12">
              <ChallengeShelf title={t("archiveTitle")} challenges={shelves.archive} renderCard={(challenge) => (
                <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />
              )} />
            </div>
          ) : null}

          {(!hasGroups && !atGroupLimit) || (personalBlank && personalShelf !== null) ? (
            <div className="mt-12 flex flex-col items-start gap-1">
              {personalBlank && personalShelf !== null ? <NewChallengeButton label={th("startPersonal")} onChat={onQuickCreatePersonal} onManual={onCreatePersonalChallenge} /> : null}
              {!hasGroups && !atGroupLimit ? <HomeSideLink label={th("inviteGroups")} onClick={() => setShowGroupDialog(true)} /> : null}
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
