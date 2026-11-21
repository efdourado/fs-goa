"use client";

import { StateButton } from "../state-button";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useRef, useState } from "react";

import { copyText } from "../clipboard";
import { ConfirmDialog, DeleteButton, DeleteConfirm, Dialog, InlineConfirmation, ModalActions } from "../dialog";
import { useGoaFormat } from "../format";
import { CatalogShelfView } from "../catalog-shelf";
import { TasteMap } from "../taste-map";
import { useCatalogShelf } from "../libraries";
import { NewChallengeButton } from "../welcome";
import type { ChallengeSummary, GroupInviteResult, GroupSummary, Id, PendingGroupRequest } from "../types";
import { AvatarMark, BackButton, Button, cx, FaceEmptyState, Field, InlineSubmit, inputClass, LinkPill, ListMoreButton, Select, SlidersIcon, StatusMessage } from "../ui";


/** A word of the line under the invite link that opens its select. */
const summaryPart = "max-w-[60vw] rounded-md text-[13px] text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline focus-visible:text-[var(--ink)] focus-visible:underline aria-expanded:text-[var(--ink)]";
import { canManage } from "../utils";
import { ActiveChallengeCard, ChallengeShelf } from "./dashboard";

const groupActionClass = "grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25";
const groupActionIconClass = "h-[18px] w-[18px]";
const groupAvatarClass = "size-7 place-items-center overflow-hidden rounded-full border-2 border-[var(--paper)]";
const groupAvatarOverlap = "-ml-3 sm:-ml-2";
const groupAvatarCountClass = cx(groupAvatarClass, "grid bg-[var(--wash-strong)] text-[10px] font-black text-[var(--muted)]");
const personRowClass = "flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left";
const personRowButtonClass = cx(personRowClass, "cursor-pointer transition hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]");
const memberRoleClass = "flex-none rounded-full bg-[var(--wash)] px-2.5 py-1 text-[11px] text-[var(--muted)]";
const PEOPLE_PREVIEW_SIZE = 3;

type SelectedPerson = { kind: "member"; id: Id } | { kind: "invite"; request: PendingGroupRequest };
type PersonAction = { label: string; confirmation?: { label: string; body: string }; danger?: boolean; run: () => Promise<void> };

function PersonRowIdentity({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-[var(--wash-strong)]">
        <AvatarMark />
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[13.5px] font-medium">{name}</strong>
        <small className="text-[var(--muted)]">{detail}</small>
      </span>
    </span>
  );
}

function PeopleList<Person extends { id: Id }>({ people, renderPerson, className }: {
  people: Person[];
  renderPerson: (person: Person) => ReactNode;
  className?: string;
}) {
  const t = useTranslations("group");
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? people : people.slice(0, PEOPLE_PREVIEW_SIZE);
  const hiddenCount = people.length - visible.length;

  return (
    <ul className={cx("divide-y divide-[var(--line)]", className)}>
      {visible.map((person) => <li key={person.id}>{renderPerson(person)}</li>)}
      {hiddenCount > 0 ? (
        <li>
          <ListMoreButton onClick={() => setExpanded(true)}>{t("showMorePeople", { count: hiddenCount })}</ListMoreButton>
        </li>
      ) : null}
    </ul>
  );
}

export function GroupScreen({
  group,
  challenges,
  pendingRequests,
  onBack,
  backLabel,
  onCreateChallenge,
  onQuickCreate,
  onOpenChallenge,
  onOpenCatalog,
  onCreateInvite,
  onInviteByUsername,
  onCancelRequest,
  onUpdateGroup,
  onDeleteGroup,
  onLeaveGroup,
  onSetMemberRole,
  onSetMemberBan,
  challengeLimit,
}: {
  group: GroupSummary;
  challenges: ChallengeSummary[];
  challengeLimit: number;
  pendingRequests: PendingGroupRequest[];
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onCreateChallenge: () => void;
  /** The guided, question-by-question way to start a challenge here. */
  onQuickCreate: () => void;
  onOpenChallenge: (id: Id) => void;
  onOpenCatalog: () => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number; challengeId?: Id }) => Promise<{ token?: string; url?: string }>;
  onInviteByUsername: (username: string) => Promise<GroupInviteResult>;
  onCancelRequest: (id: Id) => Promise<void>;
  onUpdateGroup: (payload: { name: string; description: string }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
  /** Present for non-owners: leave the group. */
  onLeaveGroup?: () => Promise<void>;
  /** Present for owners: promote a participant to admin or demote an admin back. */
  onSetMemberRole?: (userId: Id, role: "admin" | "participant") => Promise<void>;
  /** Present for those who run the group: ban a member (everything of theirs here is erased) or lift a ban. */
  onSetMemberBan?: (userId: Id, banned: boolean) => Promise<void>;
}) {
  const t = useTranslations("group");
  const canManageGroup = canManage(group.role);
  const canCreateChallenge = canManageGroup && challenges.length < challengeLimit;
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(group.description ?? "");
  const [inviteUrl, setInviteUrl] = useState("");
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const memberActionRef = useRef(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);
  const catalogScope = { groupId: group.id };
  const shelfData = useCatalogShelf(catalogScope);
  const groupActionRef = useRef(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson | null>(null);
  const [confirmation, setConfirmation] = useState<PersonAction | null>(null);
  const memberCount = group.memberCount ?? group.members?.length ?? 0;
  const headerMembers = (group.members ?? []).slice(0, memberCount > 3 ? 2 : 3);
  const remainingMemberCount = memberCount - headerMembers.length;
  const [leaving, setLeaving] = useState(false);
  const [unbanBusyId, setUnbanBusyId] = useState<Id | null>(null);

  const selectedMember = selectedPerson?.kind === "member" ? group.members?.find((member) => member.id === selectedPerson.id) : undefined;
  const selectedInvite = selectedPerson?.kind === "invite" ? selectedPerson.request : undefined;
  const person = selectedMember ?? selectedInvite;
  const personActions: PersonAction[] = [];
  if (selectedMember && selectedMember.role !== "owner") {
    if (onSetMemberBan && (group.role === "owner" || selectedMember.role === "participant")) {
      personActions.push({
        label: t("ban"),
        confirmation: { label: t("confirmBan"), body: t("banBody", { name: selectedMember.name }) },
        danger: true,
        run: () => onSetMemberBan(selectedMember.id, true),
      });
    }
    if (onSetMemberRole && group.role === "owner") {
      const promote = selectedMember.role !== "admin";
      personActions.push({
        label: t(promote ? "makeAdmin" : "makeParticipant"),
        run: () => onSetMemberRole(selectedMember.id, promote ? "admin" : "participant"),
      });
    }
  }
  if (selectedInvite && canManageGroup) {
    personActions.push({
      label: t("cancelInvite"),
      confirmation: { label: t("confirmCancelInvite"), body: t("cancelInviteConfirm", { name: selectedInvite.name }) },
      danger: true,
      run: async () => {
        await onCancelRequest(selectedInvite.id);
        setMemberSuccess(t("inviteCancelled"));
      },
    });
  }

  async function unban(userId: Id) {
    if (!onSetMemberBan) return;
    setUnbanBusyId(userId);
    setRoleError(null);
    try {
      await onSetMemberBan(userId, false);
    } catch (cause) {
      setRoleError(f.error(cause));
    } finally {
      setUnbanBusyId(null);
    }
  }

  function openGroupEdit() {
    setGroupName(group.name);
    setGroupDescription(group.description ?? "");
    setGroupError(null);
    setGroupSuccess(null);
    setDeletingGroup(false);
    setShowGroupEdit(true);
  }

  async function updateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageGroup || groupActionRef.current) return;
    groupActionRef.current = true;
    setGroupBusy(true);
    setGroupError(null);
    setGroupSuccess(null);
    try {
      await onUpdateGroup({ name: groupName.trim(), description: groupDescription.trim() });
      setGroupSuccess(t("updated"));
    } catch (cause) {
      setGroupError(f.error(cause));
    } finally {
      groupActionRef.current = false;
      setGroupBusy(false);
    }
  }


  // The link's settings; a link can't be edited, only replaced ("New link").
  const [linkDestination, setLinkDestination] = useState("");
  const [linkDays, setLinkDays] = useState("7");
  const [linkUses, setLinkUses] = useState("1");

  async function createInvite(settings = { destination: linkDestination, days: linkDays, uses: linkUses }) {
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateInvite({
        expiresInDays: Number(settings.days),
        maxUses: Number(settings.uses),
        challengeId: settings.destination || undefined,
      });
      const token = created.token ?? "";
      setInviteUrl(created.url ?? (token ? `${window.location.origin}/invites/${encodeURIComponent(token)}` : ""));
      setCopySuccess(null);
      setCopyError(null);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  // Changing what the link opens makes a new one at once, so the line under the link always describes it.
  function changeLink(patch: Partial<{ destination: string; days: string; uses: string }>) {
    const next = { destination: linkDestination, days: linkDays, uses: linkUses, ...patch };
    setLinkDestination(next.destination);
    setLinkDays(next.days);
    setLinkUses(next.uses);
    void createInvite(next);
  }

  // The ticket is ready when the dialog opens: its link is made the first time, then kept for this visit.
  function openInvite() {
    setShowInvite(true);
    if (!inviteUrl && !busy) void createInvite();
  }

  async function copyInvite() {
    if (copyBusy) return;
    setCopyBusy(true);
    setCopySuccess(null);
    setCopyError(null);
    try {
      await copyText(inviteUrl, inviteInputRef.current);
      setCopySuccess(t("linkCopied"));
      // The check answers for a moment, then the icon is ready to copy again.
      window.setTimeout(() => setCopySuccess(null), 1600);
    } catch (cause) {
      setCopyError(f.error(cause));
    } finally {
      setCopyBusy(false);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (memberActionRef.current) return;
    const form = event.currentTarget;
    const username = String(new FormData(form).get("username") ?? "").trim();
    if (!username) return;
    memberActionRef.current = true;
    setMemberBusy(true);
    setMemberError(null);
    setMemberSuccess(null);
    try {
      const result = await onInviteByUsername(username);
      const handle = `@${result.member.username}`;
      setMemberSuccess(
        result.status === "requested" ? t("inviteRequested", { handle })
          : result.status === "already_pending" ? t("invitePending", { handle })
          : t("alreadyMember", { handle }),
      );
      form.reset();
    } catch (cause) {
      setMemberError(f.error(cause));
    } finally {
      memberActionRef.current = false;
      setMemberBusy(false);
    }
  }

  function selectPerson(person: SelectedPerson | null) {
    setSelectedPerson(person);
    setConfirmation(null);
    setMemberError(null);
  }

  async function runPersonAction(action: PersonAction) {
    if (memberActionRef.current) return;
    memberActionRef.current = true;
    setMemberBusy(true);
    setMemberError(null);
    setMemberSuccess(null);
    try {
      await action.run();
      selectPerson(null);
    } catch (cause) {
      setMemberError(f.error(cause));
    } finally {
      memberActionRef.current = false;
      setMemberBusy(false);
    }
  }

  const groupHeaderDescription = group.description || undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-10">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
      <StatusMessage error={memberError} success={memberSuccess} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2rem]">{group.name}</h1>
          {groupHeaderDescription ? <p className="mt-2 max-w-[52ch] text-sm leading-6 text-[var(--muted)]">{groupHeaderDescription}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-b border-[var(--line)] pb-5 sm:gap-3">
        <div className="flex shrink-0">
          {headerMembers.map((member, index) => (
            <span key={member.id} title={member.name} className={cx(groupAvatarClass, "grid bg-[var(--main-line)]", index > 0 && groupAvatarOverlap)}>
              <AvatarMark />
            </span>
          ))}
          {remainingMemberCount > 0 ? <span className={cx(groupAvatarCountClass, headerMembers.length > 0 && groupAvatarOverlap)}>+{remainingMemberCount}</span> : null}
          {/* An empty seat at the end of the faces: the quiet way in to inviting someone. */}
          {canManageGroup ? (
            <StateButton type="button" onClick={openInvite} aria-label={t("inviteTitle")} title={t("inviteTitle")} className={cx(groupAvatarClass, "grid cursor-pointer bg-[var(--canvas)] text-[var(--muted)] opacity-75 outline-1 outline-dashed -outline-offset-[3px] outline-[var(--line)] transition-opacity hover:opacity-100", memberCount > 0 && groupAvatarOverlap)}>
              <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </StateButton>
          ) : null}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{t("peopleCount", { count: memberCount })} · {tr(group.role)}</span>
        {canManageGroup || onLeaveGroup ? (
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {canManageGroup ? (
              <StateButton type="button" onClick={openGroupEdit} aria-label={t("editToggleClosed")} title={t("editToggleClosed")} aria-haspopup="dialog" className={cx(groupActionClass, "hover:text-[var(--ink)]")}>
                <SlidersIcon className={groupActionIconClass} />
              </StateButton>
            ) : null}
            {onLeaveGroup ? (
              <StateButton type="button" onClick={() => setLeaving(true)} aria-label={t("leaveToggle")} title={t("leaveToggle")} aria-haspopup="dialog" className={cx(groupActionClass, "hover:text-[var(--danger)]")}>
                <svg viewBox="0 0 16 16" className={groupActionIconClass} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 3H12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9.5M5.25 11.25 2 8l3.25-3.25M2 8h8.5" />
                </svg>
              </StateButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {leaving && onLeaveGroup ? (
        <ConfirmDialog
          title={t("leaveTitle")}
          body={t("leaveConfirm")}
          confirmLabel={t("confirmLeave")}
          busyLabel={tc("wait")}
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            await onLeaveGroup();
            setLeaving(false);
          }}
        />
      ) : null}

      {canManageGroup && person ? (
        <Dialog title={t(selectedInvite ? "inviteDetailsTitle" : "memberDetailsTitle", { name: person.name })} busy={memberBusy} onClose={() => selectPerson(null)}>
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--wash)] p-3">
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--wash-strong)]"><AvatarMark /></span>
            <p className="min-w-0 flex-1 break-words text-sm text-[var(--muted)]">
              {selectedInvite ? t("pendingInviteMeta", { username: person.username, date: f.date(selectedInvite.createdAt) }) : `@${person.username}`}
            </p>
            {selectedMember ? <span className={memberRoleClass}>{tr(selectedMember.role)}</span> : null}
          </div>
          {personActions.length ? (
            <ModalActions className="mt-6 border-t border-[var(--line)] pt-4">
              {personActions.map((action) => (
                <Button key={action.label} variant={action.danger ? "danger" : "secondary"} disabled={memberBusy} aria-expanded={action.confirmation ? confirmation?.label === action.label : undefined} onClick={() => {
                  if (!action.confirmation) {
                    setConfirmation(null);
                    void runPersonAction(action);
                    return;
                  }
                  setMemberError(null);
                  setConfirmation(confirmation?.label === action.label ? null : action);
                }}>
                  {action.label}
                </Button>
              ))}
            </ModalActions>
          ) : null}
          {confirmation?.confirmation ? (
            <div className="mt-4">
              <InlineConfirmation
                key={confirmation.label}
                body={confirmation.confirmation.body}
                danger={confirmation.danger}
                busy={memberBusy}
                label={memberBusy ? tc("saving") : confirmation.confirmation.label}
                onConfirm={() => void runPersonAction(confirmation)}
              />
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {showGroupEdit && canManageGroup ? (
        <Dialog title={t("editTitle")} onClose={() => setShowGroupEdit(false)} busy={groupBusy} stickyActions>
          <form className="space-y-5" onSubmit={updateGroup}>
            <Field label={t("nameLabel")}><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} disabled={groupBusy} required maxLength={120} /></Field>
            <Field label={t("descriptionLabel")} optional><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} disabled={groupBusy} maxLength={1000} placeholder={t("descriptionPlaceholder")} /></Field>
            <StatusMessage error={groupError} success={groupSuccess} />
            {onDeleteGroup && deletingGroup ? <DeleteConfirm body={t("deleteConfirm", { name: group.name })} onConfirm={onDeleteGroup} /> : null}
            <ModalActions className="border-t border-[var(--line)] pt-4" sticky>
              {onDeleteGroup ? <DeleteButton open={deletingGroup} disabled={groupBusy} onClick={() => setDeletingGroup((open) => !open)} /> : null}
              <Button type="submit" disabled={groupBusy}>{groupBusy ? tc("saving") : tc("save")}</Button>
            </ModalActions>
          </form>
        </Dialog>
      ) : null}

      {showInvite ? (
        <Dialog title={t("inviteTitle")} onClose={() => setShowInvite(false)} busy={busy || memberBusy}>
          {/* The link, then what it opens: each part of the line its own select. */}
          <LinkPill url={inviteUrl || null} placeholder={busy ? t("generating") : undefined} copied={Boolean(copySuccess)} busy={busy}
            onCopy={() => void copyInvite()} onRenew={() => void createInvite()} inputRef={inviteInputRef}
            copyLabel={t("copy")} copiedLabel={t("copied")} renewLabel={t("newLink")} urlLabel={t("inviteUrlAria")} />
          <div className="mt-2 flex min-w-0 flex-wrap items-center pl-3 text-[13px] text-[var(--muted)]">
            <Select look="bare" chevron={false} className={summaryPart} value={linkDestination} disabled={busy} ariaLabel={t("destinationLabel")} onChange={(next) => changeLink({ destination: next })}
              options={[{ value: "", label: group.name }, ...challenges.filter((challenge) => challenge.status === "active").map((challenge) => ({ value: challenge.id, label: challenge.title }))]} />
            <span className="mx-1.5 opacity-60" aria-hidden="true">·</span>
            <Select look="bare" chevron={false} className={summaryPart} value={linkDays} disabled={busy} ariaLabel={t("expiresLabel")} onChange={(next) => changeLink({ days: next })}
              options={["1", "7", "30"].map((days) => ({ value: days, label: t(`expires${days}` as "expires7") }))} />
            <span className="mx-1.5 opacity-60" aria-hidden="true">·</span>
            <Select look="bare" chevron={false} className={summaryPart} value={linkUses} disabled={busy} ariaLabel={t("maxUsesLabel")} onChange={(next) => changeLink({ uses: next })}
              options={[1, 5, 10, 25, 100].map((count) => ({ value: String(count), label: t("usesOption", { count }) }))} />
          </div>
          <StatusMessage error={error ?? copyError} />
          <form onSubmit={inviteMember} className="mt-6">
            <div className="flex min-h-[46px] items-center gap-1 rounded-full border border-[var(--control-line)] py-1 pl-4 pr-1 transition focus-within:border-[var(--focus)] focus-within:ring-2 focus-within:ring-[var(--focus)]/35">
              <input className="min-h-9 min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]" name="username" placeholder={t("inviteUsernamePlaceholder")} aria-label={t("inviteUsernameLabel")} required maxLength={33} disabled={memberBusy} spellCheck={false} />
              <InlineSubmit label={t("sendInvite")} disabled={memberBusy} />
            </div>
          </form>
        </Dialog>
      ) : null}

      <div className="mt-8 space-y-12">
        <ChallengeShelf
          title={t("challengesTitle")}
          challenges={challenges}
          actions={canCreateChallenge ? <NewChallengeButton label={tc("newChallengePill")} onChat={onQuickCreate} onManual={onCreateChallenge} /> : undefined}
          empty={<div className="w-full"><FaceEmptyState title={t("noChallengesTitle")} compact /></div>}
          renderCard={(challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />}
        />

        <CatalogShelfView scope={catalogScope} canManage={canManage(group.role)} data={shelfData} onOpenCatalog={onOpenCatalog} />

        {memberCount > 1 ? <TasteMap groupId={group.id} youLabel={t("tasteYou")} /> : null}

        <section>
          <div className="mb-4 flex items-baseline gap-2.5">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("peopleTitle")}</h2>
            <span className="text-xs text-[var(--muted)]">{memberCount}</span>
          </div>
          {group.members?.length ? (
            <PeopleList
              people={group.members}
              renderPerson={(member) => {
                const content = (
                  <>
                    <PersonRowIdentity name={member.name} detail={`@${member.username}`} />
                    <span className={memberRoleClass}>{tr(member.role)}</span>
                  </>
                );
                return canManageGroup
                  ? <StateButton type="button" aria-haspopup="dialog" className={personRowButtonClass} onClick={() => selectPerson({ kind: "member", id: member.id })}>{content}</StateButton>
                  : <div className={personRowClass}>{content}</div>;
              }}
            />
          ) : <p className="text-sm leading-6 text-[var(--muted)]">{t("membersUnavailable")}</p>}
          {onSetMemberRole || onSetMemberBan ? <div className="mt-2"><StatusMessage error={roleError} /></div> : null}

          {onSetMemberBan && group.banned?.length ? (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <h3 className="text-sm font-semibold">{t("bannedTitle")}</h3>
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {group.banned.map((person) => (
                  <li className="flex items-center justify-between gap-3 py-3" key={person.id}>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">{person.name}</strong>
                      <small className="text-[var(--muted)]">@{person.username}</small>
                    </span>
                    <Button className="min-h-9 flex-none px-3 py-1 text-xs" variant="ghost" disabled={unbanBusyId === person.id} onClick={() => void unban(person.id)}>{unbanBusyId === person.id ? tc("saving") : t("unban")}</Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canManageGroup && pendingRequests.length ? (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <h3 className="text-sm font-semibold">{t("pendingInvitesTitle")}</h3>
              <PeopleList className="mt-2" people={pendingRequests} renderPerson={(request) => (
                <StateButton type="button" aria-haspopup="dialog" className={personRowButtonClass} onClick={() => selectPerson({ kind: "invite", request })}>
                  <PersonRowIdentity name={request.name} detail={t("pendingInviteMeta", { username: request.username, date: f.date(request.createdAt) })} />
                </StateButton>
              )} />
            </div>
          ) : null}

        </section>
      </div>
    </main>
  );
}
