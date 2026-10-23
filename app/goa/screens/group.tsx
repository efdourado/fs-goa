"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";

import { copyText } from "../clipboard";
import { ConfirmDialog, DeleteButton, DeleteConfirm, Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { CatalogShelfSkeleton } from "../catalog-shelf";
import { TasteMap } from "../taste-map";
import { catalogCardHeight, CatalogTile, resolveCoverTop } from "../catalog-views";
import { LibraryGlyph, useCatalogShelf, useLibraryName } from "../libraries";
import { Rail, RailArrows, ShelfAddButton, shelfCardWidth, useShelfRail } from "../shelf";
import type { CatalogItem, ChallengeSummary, GroupInviteResult, GroupSummary, Id, Member, PendingGroupRequest } from "../types";
import { AvatarMark, BackButton, Button, cx, FaceEmptyState, Field, inputClass, LinkPill, Select, SlidersIcon, StatusMessage, Toggle } from "../ui";


/** A word of the line under the invite link that opens its select. */
const summaryPart = "max-w-[60vw] rounded-md text-[13px] text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline focus-visible:text-[var(--ink)] focus-visible:underline aria-expanded:text-[var(--ink)]";
import { canManage, formatRuntime } from "../utils";
import { ActiveChallengeCard } from "./dashboard";

/** The group page shows only the head of the catalog; the rest is one tap away. */
const CATALOG_PREVIEW_COUNT = 10;

export function GroupScreen({
  group,
  challenges,
  pendingRequests,
  onBack,
  backLabel,
  onCreateChallenge,
  onQuickCreate,
  onOpenChallenge,
  onOpenCatalogItem,
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
  onOpenCatalogItem: (itemId: Id) => void;
  onOpenCatalog: () => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number; challengeId?: Id }) => Promise<{ token?: string; url?: string }>;
  onInviteByUsername: (username: string) => Promise<GroupInviteResult>;
  onCancelRequest: (id: Id) => Promise<void>;
  onUpdateGroup: (payload: { name: string; description: string; recommendationsEnabled: boolean }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
  /** Present for non-owners: leave the group. */
  onLeaveGroup?: () => Promise<void>;
  /** Present for owners: promote a participant to admin or demote an admin back. */
  onSetMemberRole?: (userId: Id, role: "admin" | "participant") => Promise<void>;
  /** Present for those who run the group: ban a member (everything of theirs here is erased) or lift a ban. */
  onSetMemberBan?: (userId: Id, banned: boolean) => Promise<void>;
}) {
  const t = useTranslations("group");
  const canCreateChallenge = canManage(group.role) && challenges.length < challengeLimit;
  const tCat = useTranslations("catalog");
  const tl = useTranslations("libraries");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(group.description ?? "");
  const [groupRecommendations, setGroupRecommendations] = useState(group.recommendationsEnabled !== false);
  const [inviteUrl, setInviteUrl] = useState("");
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);
  const [catalogKind, setCatalogKind] = useState<string | null>(null);
  // One request brings the libraries, how many items each holds and the newest few of each; the last answer
  // paints at once when the page is opened again.
  const shelfData = useCatalogShelf({ groupId: group.id });
  const catalog = shelfData ? shelfData.items : null;
  const catalogCounts = shelfData?.counts ?? {};
  const libraryName = useLibraryName();
  const { railRef: catalogRailRef, showFade: catalogShowFade, onScroll: onCatalogScroll, nudge: nudgeCatalog } = useShelfRail();

  // Each library is its own shelf — one sorted list never mixes them.
  const catalogLibraries = (shelfData?.libraries ?? []).filter((library) => (catalogCounts[library.kind] ?? 0) > 0);
  const totalCatalogItems = Object.values(catalogCounts).reduce((sum, count) => sum + count, 0);
  const bothCatalogKinds = catalogLibraries.length > 1;
  const activeCatalogKind = catalogKind && catalogLibraries.some((library) => library.kind === catalogKind)
    ? catalogKind
    : catalogLibraries[0]?.kind ?? null;
  const addedAt = (item: CatalogItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sortedCatalog = [...(catalog ?? [])]
    .filter((item) => !bothCatalogKinds || item.kind === activeCatalogKind)
    .sort((a, b) => addedAt(b) - addedAt(a) || a.title.localeCompare(b.title));
  const visibleCatalog = sortedCatalog.slice(0, CATALOG_PREVIEW_COUNT);
  const activeCatalogLibrary = catalogLibraries.find((library) => library.kind === activeCatalogKind) ?? null;
  // The server sends only the newest few of each library, so how many more there are comes from the counts.
  const remainingCatalog = Math.max(0, (activeCatalogKind ? catalogCounts[activeCatalogKind] ?? sortedCatalog.length : sortedCatalog.length) - visibleCatalog.length);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<Id | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const memberCount = group.memberCount ?? group.members?.length ?? 0;

  async function toggleRole(member: Member) {
    if (!onSetMemberRole) return;
    const nextRole = member.role === "admin" ? "participant" : "admin";
    setRoleBusyId(member.id);
    setRoleError(null);
    try {
      await onSetMemberRole(member.id, nextRole);
    } catch (cause) {
      setRoleError(f.error(cause));
    } finally {
      setRoleBusyId(null);
    }
  }

  // The owner bans anyone but themselves; an admin bans participants only (the server holds the same line).
  const canBan = (member: Member) => Boolean(onSetMemberBan) && member.role !== "owner" && (group.role === "owner" || member.role === "participant");
  const [banning, setBanning] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [unbanBusyId, setUnbanBusyId] = useState<Id | null>(null);

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

  function toggleGroupEdit() {
    if (!showGroupEdit) {
      setGroupName(group.name);
      setGroupDescription(group.description ?? "");
      setGroupRecommendations(group.recommendationsEnabled !== false);
      setGroupError(null);
      setGroupSuccess(null);
      setDeletingGroup(false);
    }
    setShowGroupEdit(!showGroupEdit);
  }

  async function updateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGroupBusy(true);
    setGroupError(null);
    setGroupSuccess(null);
    try {
      await onUpdateGroup({ name: groupName.trim(), description: groupDescription.trim(), recommendationsEnabled: groupRecommendations });
      setGroupSuccess(t("updated"));
    } catch (cause) {
      setGroupError(f.error(cause));
    } finally {
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
    const form = event.currentTarget;
    const username = String(new FormData(form).get("username") ?? "").trim();
    if (!username) return;
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
      if (result.status === "requested") form.reset();
    } catch (cause) {
      setMemberError(f.error(cause));
    } finally {
      setMemberBusy(false);
    }
  }

  async function cancelRequest(id: Id, name: string) {
    setMemberError(null);
    setMemberSuccess(null);
    try {
      await onCancelRequest(id);
      setMemberSuccess(t("inviteCancelled", { name }));
    } catch (cause) {
      setMemberError(f.error(cause));
    }
  }

  const groupHeaderDescription = group.description || undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-10">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2rem]">{group.name}</h1>
          {groupHeaderDescription ? <p className="mt-2 max-w-[52ch] text-sm leading-6 text-[var(--muted)]">{groupHeaderDescription}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-[var(--line)] pb-5">
        <div className="flex">
          {(group.members ?? []).slice(0, 5).map((member, index) => (
            <span key={member.id} title={member.name} className={cx("grid h-7 w-7 place-items-center overflow-hidden rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)]", index > 0 && "-ml-2")}>
              <AvatarMark />
            </span>
          ))}
          {memberCount > 5 ? <span className="-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--wash-strong)] text-[10px] font-black text-[var(--muted)]">+{memberCount - 5}</span> : null}
          {/* An empty seat at the end of the faces: the quiet way in to inviting someone. */}
          {canManage(group.role) ? (
            <button type="button" onClick={openInvite} aria-label={t("inviteTitle")} title={t("inviteTitle")} className="-ml-2 grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--canvas)] text-[var(--muted)] outline-1 outline-dashed -outline-offset-[3px] outline-[var(--line)] transition hover:text-[var(--ink-strong)] hover:outline-[var(--main-line)]">
              <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          ) : null}
        </div>
        <span className="text-xs text-[var(--muted)]">{t("peopleCount", { count: memberCount })} · {tr(group.role)}</span>
        <span className="flex-1" />
        {canManage(group.role) ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleGroupEdit} aria-label={t("editToggleClosed")} title={t("editToggleClosed")} className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25">
              <SlidersIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
        ) : null}
      </div>

      {showGroupEdit ? (
        <Dialog title={t("editTitle")} onClose={() => setShowGroupEdit(false)} busy={groupBusy}>
          <form className="space-y-5" onSubmit={updateGroup}>
            <Field label={t("nameLabel")}><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={120} /></Field>
            <Field label={t("descriptionLabel")} optional><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} maxLength={1000} placeholder={t("descriptionPlaceholder")} /></Field>
            <Toggle checked={groupRecommendations} onChange={setGroupRecommendations} label={t("recommendationsLabel")} hint={t("recommendationsHint")} />
            <StatusMessage error={groupError} success={groupSuccess} />
            {/* One footer: delete on the left, away from Save on the right. */}
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
              {onDeleteGroup ? <DeleteButton open={deletingGroup} disabled={groupBusy} onClick={() => setDeletingGroup((open) => !open)} /> : <span className="flex-1" />}
              <Button type="submit" disabled={groupBusy}>{groupBusy ? tc("saving") : tc("save")}</Button>
            </div>
            {onDeleteGroup && deletingGroup ? <DeleteConfirm body={t("deleteConfirm", { name: group.name })} onConfirm={onDeleteGroup} /> : null}
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
            <div className="flex h-[46px] items-center gap-1 rounded-full border border-[var(--line)] pl-4 pr-1 transition focus-within:border-[var(--main)] focus-within:ring-4 focus-within:ring-[var(--main)]/15">
              <input className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]" name="username" placeholder={t("inviteUsernamePlaceholder")} aria-label={t("inviteUsernameLabel")} required maxLength={33} disabled={memberBusy} spellCheck={false} />
              <button type="submit" disabled={memberBusy} aria-label={t("sendInvite")} title={t("sendInvite")} className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white transition hover:opacity-90 disabled:opacity-55">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" /></svg>
              </button>
            </div>
            <StatusMessage error={memberError} success={memberSuccess} />
          </form>
        </Dialog>
      ) : null}

      <div className="mt-8 space-y-12">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("challengesTitle")}</h2>
              <span className="text-xs text-[var(--muted)]">{challenges.length}</span>
            </div>
            {canCreateChallenge ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ShelfAddButton label={tc("newChallengePill")} onClick={onCreateChallenge} />
                <ShelfAddButton label={tc("newChatPill")} onClick={onQuickCreate} />
              </div>
            ) : null}
          </div>
          {challenges.length ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {challenges.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} fluid />)}
            </div>
          ) : <FaceEmptyState title={t("noChallengesTitle")} compact />}
        </section>

        {shelfData === null ? <CatalogShelfSkeleton title={t("catalogTitle")} /> : sortedCatalog.length ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <button
                  type="button"
                  onClick={onOpenCatalog}
                  className="cursor-pointer text-lg font-semibold tracking-[-0.02em] hover:underline"
                >
                  {t("catalogTitle")}
                </button>

                <span className="text-xs text-[var(--muted)]">
                  {totalCatalogItems}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {sortedCatalog.length ? <RailArrows nudge={nudgeCatalog} /> : null}
              </div>
            </div>
            <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  {bothCatalogKinds && activeCatalogKind ? (
                    <div role="group" aria-label={tl("tabsLabel")} className="flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-[var(--wash-strong)]/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {catalogLibraries.map((library) => {
                        const active = library.kind === activeCatalogKind;
                        return (
                          <button
                            key={library.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setCatalogKind(library.kind)}
                            className={cx(
                              "inline-flex min-h-9 flex-none cursor-pointer items-center gap-2 rounded-full px-3.5 text-[13px] transition",
                              active ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]",
                            )}
                          >
                            <LibraryGlyph source={library.source} className="h-4 w-4" />
                            {libraryName(library)}
                            <span className="text-[11px] opacity-70">{catalogCounts[library.kind] ?? 0}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <span />}
                </div>
                <Rail railRef={catalogRailRef} showFade={catalogShowFade} onScroll={onCatalogScroll}>
                  {visibleCatalog.map((item) => (
                    <CatalogTile
                      key={item.id}
                      className={shelfCardWidth}
                      title={item.title}
                      year={resolveCoverTop(item, activeCatalogLibrary?.coverTopProperty, f)}
                      avg={item.ratingAvg}
                      badgeHidden={activeCatalogLibrary?.coverBadgeHidden}
                      ratingLabel={item.ratingAvg === null || item.ratingAvg === undefined ? tCat("notRated") : tCat("ratedAria", { value: item.ratingAvg })}
                      caption={[item.scheduledAt ? f.eventWhen(item.scheduledAt) : item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter(Boolean).slice(0, 2).join(" · ")}
                      onOpen={() => onOpenCatalogItem(item.id)}
                    />
                  ))}
                  {remainingCatalog > 0 ? (
                    <button
                      type="button"
                      onClick={onOpenCatalog}
                      className={cx(shelfCardWidth, catalogCardHeight, "flex cursor-pointer items-center gap-3 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] px-4 text-left transition hover:border-[var(--muted)]")}
                    >
                      <span className="text-2xl font-light tracking-[-0.04em]">{remainingCatalog}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{t("catalogMoreIn", { name: activeCatalogLibrary ? libraryName(activeCatalogLibrary) : t("catalogTitle") })}</span>
                      <span className="flex-none text-[13px] text-[var(--ink)]">{t("catalogSeeAll")} →</span>
                    </button>
                  ) : null}
                </Rail>
            </>
          </section>
        ) : null}

        {memberCount > 1 ? <TasteMap groupId={group.id} youLabel={t("tasteYou")} /> : null}

        <section>
          <div className="mb-4 flex items-baseline gap-2.5">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("peopleTitle")}</h2>
            <span className="text-xs text-[var(--muted)]">{memberCount}</span>
          </div>
          {group.members?.length ? (
            <ul className="divide-y divide-[var(--line)]">
              {group.members.map((member) => (
                <li className="flex items-center justify-between gap-3 py-3" key={member.id}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-[var(--wash-strong)]">
                      <AvatarMark />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[13.5px] font-medium">{member.name}</strong>
                      <small className="text-[var(--muted)]">@{member.username}</small>
                    </span>
                  </div>
                  {/* What can be done with this person sits together at the row's right: their role, then banning. */}
                  <div className="flex flex-none items-center justify-end gap-2">
                    {onSetMemberRole && group.role === "owner" && member.role !== "owner" ? (
                      <button
                        type="button"
                        className="min-h-8 flex-none cursor-pointer rounded-full border border-[var(--line)] px-3 text-[11px] text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)] disabled:opacity-50"
                        disabled={roleBusyId === member.id}
                        onClick={() => void toggleRole(member)}
                      >
                        {roleBusyId === member.id ? tc("saving") : member.role === "admin" ? t("makeParticipant") : t("makeAdmin")}
                      </button>
                    ) : (
                      <span className="flex-none rounded-full bg-[var(--wash)] px-2.5 py-1 text-[11px] text-[var(--muted)]">{tr(member.role)}</span>
                    )}
                    {canBan(member) ? (
                      <button
                        type="button"
                        className="min-h-8 flex-none cursor-pointer rounded-full border border-[var(--danger-line)] px-3 text-[11px] text-[var(--danger)] transition hover:bg-[var(--danger-soft)]"
                        onClick={() => setBanning(member)}
                      >
                        {t("ban")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
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

          {canManage(group.role) && pendingRequests.length ? (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <h3 className="text-sm font-semibold">{t("pendingInvitesTitle")}</h3>
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {pendingRequests.map((request) => (
                  <li className="flex items-center justify-between gap-3 py-3" key={request.id}>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">{request.name}</strong>
                      <small className="text-[var(--muted)]">{t("pendingInviteMeta", { username: request.username, date: f.date(request.createdAt) })}</small>
                    </span>
                    <Button className="min-h-9 flex-none px-3 py-1 text-xs" variant="ghost" onClick={() => void cancelRequest(request.id, request.name)}>{tc("cancel")}</Button>
                  </li>
                ))}
              </ul>
              {!showInvite ? <div className="mt-3"><StatusMessage error={memberError} success={memberSuccess} /></div> : null}
            </div>
          ) : null}

          {onLeaveGroup ? (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <button type="button" className="min-h-9 text-xs font-light text-[var(--danger)] underline underline-offset-2" onClick={() => setLeaving(true)}>{t("leaveToggle")}</button>
            </div>
          ) : null}

          {banning && onSetMemberBan ? (
            <ConfirmDialog
              title={t("banTitle", { name: banning.name })}
              body={t("banBody")}
              confirmLabel={t("ban")}
              danger
              onClose={() => setBanning(null)}
              onConfirm={async () => { await onSetMemberBan(banning.id, true); setBanning(null); }}
            />
          ) : null}
          {leaving && onLeaveGroup ? (
            <ConfirmDialog title={t("leaveTitle")} body={t("leaveConfirm")} confirmLabel={t("leaveToggle")} danger onClose={() => setLeaving(false)} onConfirm={onLeaveGroup} />
          ) : null}
        </section>
      </div>
    </main>
  );
}
