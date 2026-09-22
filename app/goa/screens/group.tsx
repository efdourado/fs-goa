"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { copyText } from "../clipboard";
import { ActionMenu, ActionMenuItem } from "../action-menu";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { CatalogTile, resolveCoverTop } from "../catalog-views";
import { LibraryGlyph, useCatalogLibraries, useLibraryName } from "../libraries";
import { Rail, RailArrows, ShelfAddButton, useShelfRail } from "../shelf";
import type { CatalogItem, ChallengeSummary, GroupInviteResult, GroupSummary, Id, Member, PendingGroupRequest } from "../types";
import { BackButton, Button, cx, EmptyState, Field, inputClass, StatusMessage, Toggle } from "../ui";
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
}) {
  const t = useTranslations("group");
  const tCat = useTranslations("catalog");
  const tl = useTranslations("libraries");
  const tx = useTranslations("managementUX");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
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
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogKind, setCatalogKind] = useState<string | null>(null);
  const { data: libraries } = useCatalogLibraries({ groupId: group.id });
  const libraryName = useLibraryName();
  const { railRef: catalogRailRef, showFade: catalogShowFade, onScroll: onCatalogScroll, nudge: nudgeCatalog } = useShelfRail();

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.groupCatalog(group.id), { signal: controller.signal })
      .then((response) => setCatalog(response.items))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [group.id]);

  // Each library is its own shelf — one sorted list never mixes them.
  const catalogLibraries = (libraries ?? []).filter((library) => (catalog ?? []).some((item) => item.kind === library.kind));
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
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
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

  async function leave() {
    if (!onLeaveGroup) return;
    if (!window.confirm(t("leaveConfirm"))) return;
    setLeaveBusy(true);
    setLeaveError(null);
    try {
      await onLeaveGroup();
    } catch (cause) {
      setLeaveError(f.error(cause));
      setLeaveBusy(false);
    }
  }

  function toggleGroupEdit() {
    if (!showGroupEdit) {
      setGroupName(group.name);
      setGroupDescription(group.description ?? "");
      setGroupRecommendations(group.recommendationsEnabled !== false);
      setGroupError(null);
      setGroupSuccess(null);
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

  async function deleteGroup() {
    if (!onDeleteGroup) return;
    if (!window.confirm(t("deleteConfirm", { name: group.name }))) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      await onDeleteGroup();
    } catch (cause) {
      setGroupError(f.error(cause));
      setGroupBusy(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateInvite({
        expiresInDays: Number(form.get("expiresInDays") ?? 7),
        maxUses: Number(form.get("maxUses") ?? 1),
        challengeId: String(form.get("challengeId") ?? "") || undefined,
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

  async function copyInvite() {
    setCopyBusy(true);
    setCopySuccess(null);
    setCopyError(null);
    try {
      await copyText(inviteUrl, inviteInputRef.current);
      setCopySuccess(t("linkCopied"));
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
        {canManage(group.role) ? (
          <ActionMenu label={tx("groupActions")} iconOnly>
            <ActionMenuItem onClick={toggleGroupEdit}>{t("editToggleClosed")}</ActionMenuItem>
            <ActionMenuItem onClick={() => setShowInvite(true)}>{t("inviteTitle")}</ActionMenuItem>
          </ActionMenu>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-[var(--line)] pb-5">
        <div className="flex">
          {(group.members ?? []).slice(0, 5).map((member, index) => (
            <span key={member.id} className={cx("grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)] text-[10px] font-black", index > 0 && "-ml-2")}>
              {member.name.split(/\s+/).slice(0, 1).map((part) => part[0]).join("")}
            </span>
          ))}
          {memberCount > 5 ? <span className="-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--wash-strong)] text-[10px] font-black text-[var(--muted)]">+{memberCount - 5}</span> : null}
        </div>
        <span className="text-xs text-[var(--muted)]">{t("peopleCount", { count: memberCount })} · {tr(group.role)}</span>
        <span className="flex-1" />
        {canManage(group.role) ? <Button variant="secondary" className="min-h-9" onClick={() => setShowInvite(true)}>{t("inviteTitle")}</Button> : null}
      </div>

      {showGroupEdit ? (
        <Dialog title={t("editTitle")} onClose={() => setShowGroupEdit(false)} busy={groupBusy}>
          <form className="space-y-5" onSubmit={updateGroup}>
            <Field label={t("nameLabel")}><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={120} /></Field>
            <Field label={t("descriptionLabel")} optional><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} maxLength={1000} placeholder={t("descriptionPlaceholder")} /></Field>
            <Toggle checked={groupRecommendations} onChange={setGroupRecommendations} label={t("recommendationsLabel")} hint={t("recommendationsHint")} />
            <StatusMessage error={groupError} success={groupSuccess} />
            <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4">
              <Button variant="secondary" type="button" disabled={groupBusy} onClick={toggleGroupEdit}>{tc("cancel")}</Button>
              <Button type="submit" disabled={groupBusy}>{groupBusy ? tc("saving") : t("saveGroup")}</Button>
            </div>
          </form>
          {onDeleteGroup ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Button variant="danger" disabled={groupBusy} onClick={() => void deleteGroup()}>{t("deleteGroup")}</Button>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {showInvite ? (
        <Dialog title={t("inviteTitle")} onClose={() => setShowInvite(false)} busy={busy || memberBusy}>
          <p className="text-sm leading-6 text-[var(--muted)]">{t("inviteBody")}</p>
          <form className="mt-4 space-y-3" onSubmit={inviteMember}>
            <Field label={t("inviteUsernameLabel")}><input className={inputClass} name="username" placeholder={t("inviteUsernamePlaceholder")} required maxLength={33} disabled={memberBusy} spellCheck={false} /></Field>
            <Button type="submit" variant="secondary" disabled={memberBusy}>{memberBusy ? t("sendingInvite") : t("sendInvite")}</Button>
            <StatusMessage error={memberError} success={memberSuccess} />
          </form>
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <p className="text-[13px] font-medium">{t("inviteLinkLabel")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("inviteLinkBody")}</p>
            <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={createInvite}>
              <Field label={t("destinationLabel")} className="sm:col-span-2"><select className={inputClass} name="challengeId" defaultValue=""><option value="">{t("destinationGroupOnly")}</option>{challenges.filter((challenge) => challenge.status === "active").map((challenge) => <option value={challenge.id} key={challenge.id}>{t("destinationChallenge", { title: challenge.title })}</option>)}</select></Field>
              <Field label={t("expiresLabel")}><select className={inputClass} name="expiresInDays" defaultValue="7"><option value="1">{t("expires1")}</option><option value="7">{t("expires7")}</option><option value="30">{t("expires30")}</option></select></Field>
              <Field label={t("maxUsesLabel")}><input className={inputClass} name="maxUses" type="number" min={1} max={100} defaultValue={1} /></Field>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? t("generating") : t("generateLink")}</Button></div>
            </form>
            <div className="mt-3"><StatusMessage error={error} /></div>
            {inviteUrl ? (
              <div className="mt-3 flex flex-col gap-2 rounded-xl bg-[var(--main-soft)] p-3 sm:flex-row sm:items-center">
                <input ref={inviteInputRef} className={cx(inputClass, "font-mono text-xs")} value={inviteUrl} readOnly aria-label={t("inviteUrlAria")} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="secondary" disabled={copyBusy} onClick={() => void copyInvite()}>{copyBusy ? t("copying") : copySuccess ? t("copied") : t("copy")}</Button>
              </div>
            ) : null}
            <div className="mt-3"><StatusMessage error={copyError} success={copySuccess} /></div>
          </div>
          <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-4"><Button variant="secondary" disabled={busy || memberBusy} onClick={() => setShowInvite(false)}>{tc("close")}</Button></div>
        </Dialog>
      ) : null}

      <div className="mt-8 space-y-12">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("challengesTitle")}</h2>
              <span className="text-xs text-[var(--muted)]">{challenges.length}</span>
            </div>
            {canManage(group.role) && challenges.length < challengeLimit ? <ShelfAddButton label={t("createChallengeCta")} onClick={onCreateChallenge} /> : null}
          </div>
          {challenges.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {challenges.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} fluid />)}
            </div>
          ) : canManage(group.role) && challenges.length < challengeLimit
            ? <EmptyState title={t("noChallengesTitle")} onClick={onCreateChallenge} />
            : <EmptyState title={t("noChallengesTitle")} hint={canManage(group.role) ? t("challengeLimitReached", { limit: challengeLimit }) : t("noChallengesMember")} />}
        </section>

        {sortedCatalog.length || canManage(group.role) ? (
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
                  {(catalog ?? []).length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {sortedCatalog.length ? <RailArrows nudge={nudgeCatalog} /> : null}
              </div>
            </div>
            {sortedCatalog.length ? (
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
                            <span className="text-[11px] opacity-70">{(catalog ?? []).filter((item) => item.kind === library.kind).length}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <span />}
                </div>
                <Rail railRef={catalogRailRef} showFade={catalogShowFade} onScroll={onCatalogScroll}>
                  {canManage(group.role) ? (
                    <button
                      type="button"
                      onClick={onOpenCatalog}
                      className="flex aspect-[3/4] w-44 flex-none cursor-pointer snap-start flex-col items-center justify-center gap-2.5 self-start rounded-[20px] border border-dashed border-[var(--main-line)] text-[var(--main-strong)] transition hover:bg-[var(--main-soft)]"
                    >
                      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-[var(--main-soft)] text-lg">＋</span>
                      <span className="text-[13px]">{t("catalogAddItem")}</span>
                    </button>
                  ) : null}
                  {visibleCatalog.map((item) => (
                    <CatalogTile
                      key={item.id}
                      size="sm"
                      className="w-44 flex-none snap-start"
                      title={item.title}
                      year={resolveCoverTop(item, activeCatalogLibrary?.coverTopProperty, f)}
                      avg={item.ratingAvg}
                      badgeHidden={activeCatalogLibrary?.coverBadgeHidden}
                      ratingLabel={item.ratingAvg === null || item.ratingAvg === undefined ? tCat("notRated") : tCat("ratedAria", { value: item.ratingAvg })}
                      caption={[item.scheduledAt ? f.eventWhen(item.scheduledAt) : item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter(Boolean).slice(0, 2).join(" · ")}
                      onOpen={() => onOpenCatalogItem(item.id)}
                    />
                  ))}
                  {sortedCatalog.length > visibleCatalog.length ? (
                    <button
                      type="button"
                      onClick={onOpenCatalog}
                      className="flex aspect-[3/4] w-44 flex-none cursor-pointer snap-start flex-col items-center justify-center gap-1.5 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] transition hover:border-[var(--main-line)]"
                    >
                      <span className="text-3xl font-light tracking-[-0.04em]">{sortedCatalog.length - visibleCatalog.length}</span>
                      <span className="px-3 text-center text-xs text-[var(--muted)]">{t("catalogMoreIn", { name: activeCatalogLibrary ? libraryName(activeCatalogLibrary) : t("catalogTitle") })}</span>
                      <span className="mt-2.5 text-[13px] text-[var(--main-strong)]">{t("catalogSeeAll")} →</span>
                    </button>
                  ) : null}
                </Rail>
              </>
            ) : (
              <EmptyState title={t("catalogEmptyTitle")} onClick={onOpenCatalog} />
            )}
          </section>
        ) : null}

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
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--wash-strong)] text-[11px] font-bold text-[var(--muted)]">
                      {member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[13.5px] font-medium">{member.name}</strong>
                      <small className="text-[var(--muted)]">@{member.username}</small>
                    </span>
                  </div>
                  {onSetMemberRole && group.role === "owner" && member.role !== "owner" ? (
                    <button
                      type="button"
                      className="min-h-8 flex-none rounded-full border border-[var(--line)] px-3 text-[11px] text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)] disabled:opacity-50"
                      disabled={roleBusyId === member.id}
                      onClick={() => void toggleRole(member)}
                    >
                      {roleBusyId === member.id ? tc("saving") : member.role === "admin" ? t("makeParticipant") : t("makeAdmin")}
                    </button>
                  ) : (
                    <span className="flex-none rounded-full bg-[var(--wash)] px-2.5 py-1 text-[11px] text-[var(--muted)]">{tr(member.role)}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm leading-6 text-[var(--muted)]">{t("membersUnavailable")}</p>}
          {onSetMemberRole && group.role === "owner" ? <div className="mt-2"><StatusMessage error={roleError} /></div> : null}

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
              <button type="button" className="min-h-9 text-xs font-light text-[var(--danger)] underline underline-offset-2 disabled:opacity-50" disabled={leaveBusy} onClick={() => void leave()}>{leaveBusy ? tc("saving") : t("leaveToggle")}</button>
              <div className="mt-2"><StatusMessage error={leaveError} /></div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
