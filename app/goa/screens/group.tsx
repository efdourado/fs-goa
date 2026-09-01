"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";

import { copyText } from "../clipboard";
import { useGoaFormat } from "../format";
import type { ChallengeSummary, GroupInviteResult, GroupSummary, Id, PendingGroupRequest } from "../types";
import { backLinkClass, Button, cardClass, challengeStatusTone, ChallengeStatusBadge, cx, EmptyState, inputClass, labelClass, linkClass, PageHeading, StatusMessage } from "../ui";
import { canManage, isChallengeScheduled } from "../utils";

export function GroupScreen({
  group,
  challenges,
  pendingRequests,
  onBack,
  onCreateChallenge,
  onOpenChallenge,
  onCreateInvite,
  onInviteByUsername,
  onCancelRequest,
  onUpdateGroup,
  onDeleteGroup,
  challengeLimit,
}: {
  group: GroupSummary;
  challenges: ChallengeSummary[];
  challengeLimit: number;
  pendingRequests: PendingGroupRequest[];
  onBack: () => void;
  onCreateChallenge: () => void;
  onOpenChallenge: (id: Id) => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number; challengeId?: Id }) => Promise<{ token?: string; url?: string }>;
  onInviteByUsername: (username: string) => Promise<GroupInviteResult>;
  onCancelRequest: (id: Id) => Promise<void>;
  onUpdateGroup: (payload: { name: string; description: string }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
}) {
  const t = useTranslations("group");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(group.description ?? "");
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
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);
  const memberCount = group.memberCount ?? group.members?.length ?? 0;

  function toggleGroupEdit() {
    if (!showGroupEdit) {
      setGroupName(group.name);
      setGroupDescription(group.description ?? "");
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

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{tc("backHome")}</button>
      <PageHeading
        title={group.name}
        description={`${group.description ? `${group.description} · ` : ""}${t("peopleCount", { count: memberCount })} · ${tr(group.role)}`}
        action={
          canManage(group.role) ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:justify-end">
              <button type="button" className={linkClass} onClick={toggleGroupEdit}>
                {showGroupEdit ? t("editToggleOpen") : t("editToggleClosed")}
              </button>

              <button
                type="button"
                className={linkClass}
                onClick={() => setShowInvite((open) => !open)}
              >
                {showInvite ? t("inviteToggleOpen") : t("inviteToggleClosed")}
              </button>

              {challenges.length >= challengeLimit ? (
                <span className="text-[var(--muted)]">
                  {t("challengeLimitReached", { limit: challengeLimit })}
                </span>
              ) : (
                <button type="button" className={linkClass} onClick={onCreateChallenge}>
                  {t("createChallenge", { limit: challengeLimit })}
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {showGroupEdit ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="group-edit-title">
          <h2 id="group-edit-title" className="text-lg font-light">{t("editTitle")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("editBody")}</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={updateGroup}>
            <label className="sm:col-span-2"><span className={labelClass}>{t("nameLabel")}</span><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={120} /></label>
            <label className="sm:col-span-2"><span className={labelClass}>{t("descriptionLabel")}</span><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} maxLength={1000} placeholder={t("descriptionPlaceholder")} /></label>
            <div className="sm:col-span-2"><StatusMessage error={groupError} success={groupSuccess} /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={groupBusy}>{groupBusy ? tc("saving") : t("saveGroup")}</Button><Button variant="ghost" disabled={groupBusy} onClick={toggleGroupEdit}>{tc("cancel")}</Button></div>
          </form>
          {onDeleteGroup ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Button variant="danger" disabled={groupBusy} onClick={() => void deleteGroup()}>{t("deleteGroup")}</Button>
              <p className="mt-2 text-xs text-[var(--muted)]">{t("deleteHint")}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {showInvite ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="invite-create-title">
          <h2 id="invite-create-title" className="text-lg font-light">{t("inviteTitle")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("inviteBody")}</p>

          <form className="mt-4" onSubmit={inviteMember}>
            <label><span className={labelClass}>{t("inviteUsernameLabel")}</span><input className={inputClass} name="username" placeholder={t("inviteUsernamePlaceholder")} required maxLength={33} disabled={memberBusy} spellCheck={false} /></label>
            <Button type="submit" variant="secondary" disabled={memberBusy}>{memberBusy ? t("sendingInvite") : t("sendInvite")}</Button>
            <div className="mt-3"><StatusMessage error={memberError} success={memberSuccess} /></div>
          </form>

          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <span className={labelClass}>{t("inviteLinkLabel")}</span>
            <p className="text-sm text-[var(--muted)]">{t("inviteLinkBody")}</p>
            <form className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto]" onSubmit={createInvite}>
              <label><span className={labelClass}>{t("destinationLabel")}</span><select className={inputClass} name="challengeId" defaultValue=""><option value="">{t("destinationGroupOnly")}</option>{challenges.filter((challenge) => challenge.status === "active").map((challenge) => <option value={challenge.id} key={challenge.id}>{t("destinationChallenge", { title: challenge.title })}</option>)}</select></label>
              <label><span className={labelClass}>{t("expiresLabel")}</span><select className={inputClass} name="expiresInDays" defaultValue="7"><option value="1">{t("expires1")}</option><option value="7">{t("expires7")}</option><option value="30">{t("expires30")}</option></select></label>
              <label><span className={labelClass}>{t("maxUsesLabel")}</span><input className={inputClass} name="maxUses" type="number" min={1} max={100} defaultValue={1} /></label>
              <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? t("generating") : t("generateLink")}</Button></div>
            </form>
            <div className="mt-4"><StatusMessage error={error} /></div>
            {inviteUrl ? (
              <div className="mt-4 flex flex-col gap-2 rounded-xl bg-[var(--main-soft)] p-3 sm:flex-row sm:items-center">
                <input ref={inviteInputRef} className={cx(inputClass, "font-mono text-xs")} value={inviteUrl} readOnly aria-label={t("inviteUrlAria")} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="secondary" disabled={copyBusy} onClick={() => void copyInvite()}>{copyBusy ? t("copying") : copySuccess ? t("copied") : t("copy")}</Button>
              </div>
            ) : null}
            <div className="mt-3"><StatusMessage error={copyError} success={copySuccess} /></div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-7">
        <section>
          <h2 className="mb-4 text-xl font-light tracking-[-0.03em]">{t("challengesTitle")}</h2>
          {challenges.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {challenges.map((challenge) => {
                const tone = challengeStatusTone(challenge.status, challenge.startsOn, challenge.submissionMode);
                const total = challenge.totalCount ?? 0;
                const done = challenge.completedCount ?? 0;
                return (
                  <article className={cx("relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25", tone.border)} key={challenge.id}>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><span className="text-xs text-[var(--muted)]">{isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode) ? t("startsOn", { date: f.date(challenge.startsOn) }) : challenge.endsOn ? t("endsOn", { date: f.date(challenge.endsOn) }) : t("noDeadline")}</span></div>
                      <h3 className="mt-5 text-2xl font-light tracking-[-0.04em]"><button type="button" onClick={() => onOpenChallenge(challenge.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{challenge.title}</button></h3>
                      {challenge.description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}
                      {total > 0 ? (
                        <div className="mt-5">
                          <div className="mb-2 flex justify-between text-xs text-[var(--muted)]"><span>{t("progress", { done, total })}</span><span>{Math.round((done / total) * 100)}%</span></div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
                        </div>
                      ) : null}
                    </div>
                    <span className={cx("block w-full px-5 py-3.5", tone.solid)} />
                  </article>
                );
              })}
            </div>
          ) : <EmptyState title={t("noChallengesTitle")} description={canManage(group.role) ? t("noChallengesManage") : t("noChallengesMember")} action={canManage(group.role) ? <Button onClick={onCreateChallenge}>{t("createChallengeCta")}</Button> : undefined} />}
        </section>
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-light">{t("peopleTitle")}</h2>
            <span className="text-xs text-[var(--muted)]">{t("peopleCount", { count: memberCount })}</span>
          </div>
          {group.members?.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {group.members.map((member, index) =>
                <li className="flex items-center justify-between gap-3 py-3" key={member.id}>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light uppercase">{index + 1}</span>
                    <span>
                      <strong className="block text-sm">{member.name}</strong>
                      <small className="text-[var(--muted)]">@{member.username}</small>
                    </span>
                  </div>
                  <span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light uppercase">{tr(member.role)}</span>
                </li>
              )}
            </ul>
          ) : <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t("membersUnavailable")}</p>}

          {canManage(group.role) && pendingRequests.length ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <h3 className="text-sm font-medium text-[var(--ink)]">{t("pendingInvitesTitle")}</h3>
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {pendingRequests.map((request) => (
                  <li className="flex items-center justify-between gap-3 py-3" key={request.id}>
                    <span>
                      <strong className="block text-sm">{request.name}</strong>
                      <small className="text-[var(--muted)]">{t("pendingInviteMeta", { username: request.username, date: f.date(request.createdAt) })}</small>
                    </span>
                    <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" onClick={() => void cancelRequest(request.id, request.name)}>{tc("cancel")}</Button>
                  </li>
                ))}
              </ul>
              {!showInvite ? <div className="mt-3"><StatusMessage error={memberError} success={memberSuccess} /></div> : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
