"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { splitSyntheticMarker, stripSyntheticMarker } from "../../../lib/goa/synthetic";
import { API_PATHS, apiRequest } from "../api";
import { copyText } from "../clipboard";
import { AddTile } from "../add-tile";
import { ActionMenu, ActionMenuItem } from "../action-menu";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import type { CatalogItem, ChallengeSummary, GroupInviteResult, GroupSummary, Id, Member, PendingGroupRequest } from "../types";
import { Segmented } from "../Segmented";
import { Button, cx, EmptyState, EmptyStateAction, Field, inputClass, StatusMessage } from "../ui";
import { canManage, formatRuntime } from "../utils";
import { ActiveChallengeCard } from "./dashboard";

/** The group page shows only the head of the catalog; the rest is one tap away. */
const CATALOG_PREVIEW_COUNT = 10;

export function GroupScreen({
  group,
  challenges,
  pendingRequests,
  onBack,
  onCreateChallenge,
  onOpenChallenge,
  onOpenCatalogItem,
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
  onCreateChallenge: () => void;
  onOpenChallenge: (id: Id) => void;
  onOpenCatalogItem: (itemId: Id) => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number; challengeId?: Id }) => Promise<{ token?: string; url?: string }>;
  onInviteByUsername: (username: string) => Promise<GroupInviteResult>;
  onCancelRequest: (id: Id) => Promise<void>;
  onUpdateGroup: (payload: { name: string; description: string }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
  /** Present for non-owners: leave the group. */
  onLeaveGroup?: () => Promise<void>;
  /** Present for owners: promote a participant to admin or demote an admin back. */
  onSetMemberRole?: (userId: Id, role: "admin" | "participant") => Promise<void>;
}) {
  const t = useTranslations("group");
  const tx = useTranslations("managementUX");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(stripSyntheticMarker(group.description));
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
  const [catalogSort, setCatalogSort] = useState<"title" | "rating">("title");
  const [catalogKind, setCatalogKind] = useState<"film" | "book" | null>(null);
  const [catalogExpanded, setCatalogExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.groupCatalog(group.id), { signal: controller.signal })
      .then((response) => setCatalog(response.items))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [group.id]);

  const catalogFilms = (catalog ?? []).filter((item) => item.kind === "film").length;
  const catalogBooks = (catalog ?? []).filter((item) => item.kind === "book").length;
  // Film and book are separate shelves — one sorted list never mixes the two.
  const bothCatalogKinds = catalogFilms > 0 && catalogBooks > 0;
  const activeCatalogKind: "film" | "book" = catalogKind ?? (catalogBooks > catalogFilms ? "book" : "film");
  const sortedCatalog = [...(catalog ?? [])]
    .filter((item) => !bothCatalogKinds || item.kind === activeCatalogKind)
    .sort((a, b) =>
      catalogSort === "rating"
        ? (b.ratingAvg ?? -1) - (a.ratingAvg ?? -1)
        : a.title.localeCompare(b.title),
    );
  const visibleCatalog = catalogExpanded ? sortedCatalog : sortedCatalog.slice(0, CATALOG_PREVIEW_COUNT);
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
      setGroupDescription(stripSyntheticMarker(group.description));
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
      await onUpdateGroup({ name: groupName.trim(), description: groupDescription.trim() });
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

  const { visible: groupDescriptionVisible, marker: groupDescriptionMarker } = splitSyntheticMarker(group.description);
  // The seed marker rides along in the DOM (select-all copies it) but never shows.
  const groupHeaderDescription = groupDescriptionVisible || groupDescriptionMarker ? (
    <>
      {groupDescriptionVisible}
      {groupDescriptionMarker ? <span className="select-text text-transparent"> {groupDescriptionMarker}</span> : null}
    </>
  ) : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-10">
      <button type="button" onClick={onBack} className="mb-6 inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {tc("home")}
      </button>

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
          <div className="mb-4 flex items-baseline gap-2.5">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("challengesTitle")}</h2>
            <span className="text-xs text-[var(--muted)]">{challenges.length}</span>
          </div>
          {challenges.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {challenges.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />)}
              {canManage(group.role) && challenges.length < challengeLimit ? <AddTile label={t("createChallengeCta")} onClick={onCreateChallenge} /> : null}
            </div>
          ) : <EmptyState title={t("noChallengesTitle")} description={canManage(group.role) ? challenges.length < challengeLimit ? t.rich("emptyCreatePrompt", { action: (chunks) => <EmptyStateAction onClick={onCreateChallenge}>{chunks}</EmptyStateAction> }) : t("challengeLimitReached", { limit: challengeLimit }) : t("noChallengesMember")} />}
        </section>

        {sortedCatalog.length ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("catalogTitle")}</h2>
                {bothCatalogKinds ? (
                  <Segmented
                    className="text-[11px]"
                    ariaLabel={t("catalogKindLabel")}
                    value={activeCatalogKind}
                    onChange={setCatalogKind}
                    options={[
                      { value: "film", label: t("catalogKindFilm") },
                      { value: "book", label: t("catalogKindBook") },
                    ]}
                  />
                ) : null}
              </div>
              <select
                aria-label={t("catalogSortLabel")}
                className="min-h-9 cursor-pointer appearance-none rounded-full border border-[var(--line)] bg-[var(--paper)] py-1.5 pl-3.5 pr-9 text-xs text-[var(--ink)] outline-none transition hover:border-[var(--main-line)] focus:border-[var(--main)]"
                value={catalogSort}
                onChange={(event) => setCatalogSort(event.target.value as "title" | "rating")}
              >
                <option value="title">{t("catalogSortTitle")}</option>
                <option value="rating">{t("catalogSortRating")}</option>
              </select>
            </div>
            <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
              {visibleCatalog.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenCatalogItem(item.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[var(--wash)]"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-medium">{item.title}{item.year ? ` (${item.year})` : ""}</strong>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">{[item.mainGenre, formatRuntime(item.runtimeMinutes), t("catalogRounds", { count: item.roundCount ?? 0 })].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex-none text-sm tabular-nums">
                      {item.ratingAvg === null || item.ratingAvg === undefined
                        ? <span className="text-[var(--muted)]">—</span>
                        : <>{item.ratingAvg}<span className="ml-1.5 text-[10px] font-light text-[var(--muted)]">n={item.ratingCount ?? 0}</span></>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {sortedCatalog.length > CATALOG_PREVIEW_COUNT ? (
              <button
                type="button"
                onClick={() => setCatalogExpanded((value) => !value)}
                aria-expanded={catalogExpanded}
                className="mt-3 min-h-10 w-full rounded-xl border border-[var(--line)] text-xs font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
              >
                {catalogExpanded ? t("catalogShowLess") : t("catalogShowAll", { count: sortedCatalog.length })}
              </button>
            ) : null}
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
