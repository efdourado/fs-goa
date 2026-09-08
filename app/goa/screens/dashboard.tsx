"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import type { ChallengeSummary, GroupSummary, Id, Limits, User } from "../types";
import { Button, cardClass, challengeStatusTone, ChallengeStatusBadge, cx, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";
import { canManage, isChallengeScheduled, isLivingList, isPersonalChallenge } from "../utils";

/**
 * A slim dashed "+" tile at the end of a card grid — one more slot to fill. It
 * stays narrow but stretches to the height of the card beside it (grid
 * `align-self: stretch`), with a floor for when it starts a row on its own.
 */
function AddTile({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid min-h-14 w-14 shrink-0 cursor-pointer select-none place-items-center justify-self-start rounded-xl border border-dashed border-[var(--line)] text-2xl font-light leading-none text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--line)] disabled:hover:text-[var(--muted)]"
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

/** Group creation moved into a modal — the "+" tile in the groups grid opens it. */
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
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className={labelClass}>{t("groupNameLabel")}</span>
          <input className={inputClass} name="name" placeholder={t("groupNamePlaceholder")} required maxLength={100} disabled={busy} />
        </label>
        <StatusMessage error={error} />
        <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4">
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>{tc("cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("creating") : t("create")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

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
    <article className={cx("relative flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25", livingList ? "border-[var(--line)]" : tone.border)}>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">{livingList ? <span /> : <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />}<span className="text-xs text-[var(--muted)]">{livingList ? t("listMeta", { count: total }) : isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode) ? t("startsOn", { date: f.date(challenge.startsOn) }) : challenge.endsOn ? t("endsOn", { date: f.date(challenge.endsOn) }) : t("noDeadline")}</span></div>
        <h3 className="mt-5 text-2xl font-light tracking-[-0.04em]"><button type="button" onClick={() => onOpen(challenge.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{challenge.title}</button></h3>
        {challenge.description ? <p className="mt-2 line-clamp-1 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}
        {total > 0 ? (
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-xs text-[var(--muted)]"><span>{t("progress", { done, total })}</span><span>{Math.round((done / total) * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
          </div>
        ) : null}
      </div>
      <span className={cx("block w-full px-5 py-3.5", livingList ? "bg-[var(--wash-strong)]" : tone.solid)} />
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
    <button className={cx(cardClass, "cursor-pointer flex items-center justify-between gap-3 p-4 text-left hover:border-[var(--muted)]")} type="button" onClick={onOpen}>
      <span className="flex items-center gap-2"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />{challenge.title}</span><span aria-hidden="true">→</span>
    </button>
  );
}

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
  onOpenPersonalSpace,
  onCreatePersonalChallenge,
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
  onOpenPersonalSpace: () => void;
  onCreatePersonalChallenge: () => void;
}) {
  const t = useTranslations("dashboard");
  const tr = useTranslations("roles");
  const tPersonal = useTranslations("personalSpace");
  const [showGroupDialog, setShowGroupDialog] = useState(false);

  const groupChallenges = challenges.filter((challenge) => !isPersonalChallenge(challenge, personalWorkspaceId));
  const active = groupChallenges.filter((challenge) => challenge.status === "active");
  const other = groupChallenges.filter((challenge) => challenge.status !== "active");

  const personalChallenges = challenges.filter((challenge) => isPersonalChallenge(challenge, personalWorkspaceId));
  const personalActive = personalChallenges.filter((challenge) => challenge.status === "active");
  const personalOther = personalChallenges.filter((challenge) => challenge.status !== "active");

  const standardGroups = groups.filter((group) => group.kind !== "personal");
  const ownedGroups = standardGroups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner;

  function openChallenge(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={t("greeting", { name: user.name.split(" ")[0] })} description={t("subtitle")} />

      {showGroupDialog ? (
        <GroupCreateDialog onClose={() => setShowGroupDialog(false)} onCreate={onCreateGroup} />
      ) : null}

      <section aria-labelledby="groups-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="groups-title" className="text-xl font-medium tracking-[-0.03em]">{t("groupsTitle")}</h2>
          <span className="text-xs font-medium text-[var(--muted)]">{t("groupsCount", { count: standardGroups.length })}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {standardGroups.map((group) => {
            const count = group.memberCount ?? group.members?.length ?? 0;
            return (
              <button className={cx(cardClass, "cursor-pointer flex min-h-24 items-center justify-between gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--muted)]")} type="button" onClick={() => onOpenGroup(group.id)} key={group.id}>
                <span>
                  {group.name}
                  <small className="mt-1 block text-[var(--muted)]">
                    {t("peopleCount", { count })} · {tr(group.role)}
                  </small>
                </span>
                <span className="text-lg text-[var(--muted)]" aria-hidden="true">→</span>
              </button>
            );
          })}
          <AddTile
            label={atGroupLimit ? t("groupLimitReached", { limit: limits.groupsPerOwner }) : t("createGroup")}
            onClick={() => setShowGroupDialog(true)}
            disabled={atGroupLimit}
          />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="active-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="active-title" className="text-xl font-medium tracking-[-0.03em]">{t("challengesTitle")}</h2>
          <span className="text-xs font-medium text-[var(--muted)]">{t("challengesCount", { count: active.length })}</span>
        </div>
        {active.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />)}
          </div>
        ) : (
          <EmptyState title={t("noChallengesTitle")} description={t("noChallengesBody")} />
        )}
      </section>

      <section className="mt-10" aria-labelledby="personal-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="personal-title" className="text-xl font-medium tracking-[-0.03em]">
            <button type="button" onClick={onOpenPersonalSpace} className="cursor-pointer underline-offset-4 hover:underline">{tPersonal("title")}</button>
          </h2>
        </div>
        {personalChallenges.length ? (
          <div className="space-y-4">
            {personalActive.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {personalActive.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />)}
                {personalOther.length === 0 ? <AddTile label={tPersonal("create")} onClick={onCreatePersonalChallenge} /> : null}
              </div>
            ) : null}
            {personalOther.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {personalOther.map((challenge) => <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />)}
                <AddTile label={tPersonal("create")} onClick={onCreatePersonalChallenge} />
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title={tPersonal("emptyTitle")} description={tPersonal("emptyBody")} action={<Button onClick={onCreatePersonalChallenge}>{tPersonal("create")}</Button>} />
        )}
      </section>

      {other.length ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-medium tracking-[-0.03em]">{t("archiveTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((challenge) => <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
