"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { useGoaFormat } from "../format";
import type { ChallengeSummary, GroupSummary, Id, Limits, User } from "../types";
import { Button, cardClass, challengeStatusTone, ChallengeStatusBadge, cx, EmptyState, inputClass, labelClass, linkClass, PageHeading, StatusMessage } from "../ui";
import { canManage, isChallengeScheduled } from "../utils";

export function DashboardScreen({
  user,
  groups,
  challenges,
  limits,
  onOpenGroup,
  onOpenChallenge,
  onOpenAdmin,
  onCreateGroup,
}: {
  user: User;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  limits: Limits;
  onOpenGroup: (id: Id) => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateGroup: (name: string) => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");
  const ownedGroups = groups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner;

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(name);
      setShowGroupForm(false);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={t("greeting", { name: user.name.split(" ")[0] })} description={t("subtitle")} action={atGroupLimit ? <span className="text-sm text-[var(--muted)]">{t("groupLimitReached", { limit: limits.groupsPerOwner })}</span> : <button type="button" className={cx(linkClass, "text-sm")} onClick={() => setShowGroupForm((open) => !open)}>{showGroupForm ? tc("close") : t("createGroupToggle", { limit: limits.groupsPerOwner })}</button>} />

      {showGroupForm ? (
        <form className={cx(cardClass, "mb-7 grid gap-4 p-5 sm:grid-cols-[1fr_auto]")} onSubmit={createGroup}>
          <label>
            <span className={labelClass}>{t("groupNameLabel")}</span>
            <input className={inputClass} name="name" placeholder={t("groupNamePlaceholder")} required maxLength={100} disabled={busy} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>{busy ? t("creating") : t("create")}</Button>
            <Button variant="ghost" onClick={() => setShowGroupForm(false)}>{tc("cancel")}</Button>
          </div>
          <div className="sm:col-span-2"><StatusMessage error={error} /></div>
        </form>
      ) : null}

      <section aria-labelledby="active-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="active-title" className="text-xl font-semibold tracking-[-0.03em]">{t("challengesTitle")}</h2>
          <span className="text-xs font-semibold text-[var(--muted)]">{t("challengesCount", { count: active.length })}</span>
        </div>
        {active.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((challenge) => {
              const tone = challengeStatusTone(challenge.status, challenge.startsOn, challenge.submissionMode);
              const total = challenge.totalCount ?? 0;
              const done = challenge.completedCount ?? 0;
              return (
                <article className={cx("relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25", tone.border)} key={challenge.id}>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><span className="text-xs text-[var(--muted)]">{isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode) ? t("startsOn", { date: f.date(challenge.startsOn) }) : challenge.endsOn ? t("endsOn", { date: f.date(challenge.endsOn) }) : t("noDeadline")}</span></div>
                    <h3 className="mt-5 text-2xl font-light tracking-[-0.04em]"><button type="button" onClick={() => onOpenChallenge(challenge.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{challenge.title}</button></h3>
                    {challenge.description ? <p className="mt-2 line-clamp-1 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}
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
        ) : (
          <EmptyState title={t("noChallengesTitle")} description={t("noChallengesBody")} />
        )}
      </section>

      <section className="mt-10" aria-labelledby="groups-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="groups-title" className="text-xl font-semibold tracking-[-0.03em]">{t("groupsTitle")}</h2>
          <span className="text-xs font-semibold text-[var(--muted)]">{t("groupsCount", { count: groups.length })}</span>
        </div>
        {groups.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const count = group.memberCount ?? group.members?.length ?? 0;
              return (
                <button className={cx(cardClass, "cursor-pointer flex min-h-24 items-center justify-between gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--main-line)]")} type="button" onClick={() => onOpenGroup(group.id)} key={group.id}>
                  <span>
                    {group.name}
                    <small className="mt-1 block text-[var(--muted)]">
                      {t("peopleCount", { count })} · {tr(group.role)}
                    </small>
                  </span>
                  <span className="text-lg text-[var(--main-strong)]" aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        ) : <EmptyState title={t("noGroupsTitle")} description={t("noGroupsBody")} action={<Button onClick={() => setShowGroupForm(true)}>{t("createGroup")}</Button>} />}
      </section>

      {other.length ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-semibold tracking-[-0.03em]">{t("archiveTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((challenge) => (
              <button className={cx(cardClass, "cursor-pointer flex items-center justify-between gap-3 p-4 text-left hover:border-[var(--main-line)]")} type="button" onClick={() => challenge.status === "draft" && canManage(challenge.viewerRole) ? onOpenAdmin(challenge.id) : onOpenChallenge(challenge.id)} key={challenge.id}>
                <span className="flex items-center gap-2"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />{challenge.title}</span><span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
