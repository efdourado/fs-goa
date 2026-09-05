"use client";

import { useTranslations } from "next-intl";

import { ActiveChallengeCard, ArchiveChallengeRow } from "./dashboard";
import type { ChallengeSummary, Id } from "../types";
import { backLinkClass, Button, cx, EmptyState, linkClass, PageHeading } from "../ui";
import { canManage } from "../utils";

/** The hidden solo workspace, treated as a group of one: its own page, its own catalogue link. */
export function PersonalSpaceScreen({
  challenges,
  onBack,
  onOpenChallenge,
  onOpenAdmin,
  onCreateChallenge,
  onOpenCatalog,
  onOpenTrash,
}: {
  challenges: ChallengeSummary[];
  onBack: () => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateChallenge: () => void;
  onOpenCatalog: () => void;
  onOpenTrash: () => void;
}) {
  const t = useTranslations("personalSpace");
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");

  function openChallenge(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading
        title={t("title")}
        description={t("subtitle")}
        action={
          <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <button type="button" className={cx(linkClass, "text-sm")} onClick={onOpenCatalog}>{t("catalog")}</button>
            <button type="button" className={cx(linkClass, "text-sm")} onClick={onOpenTrash}>{t("trash")}</button>
            <button type="button" className={cx(linkClass, "text-sm")} onClick={onCreateChallenge}>{t("create")}</button>
          </span>
        }
      />

      {challenges.length ? (
        <div className="space-y-6">
          {active.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {active.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />)}
            </div>
          ) : null}
          {other.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {other.map((challenge) => <ArchiveChallengeRow key={challenge.id} challenge={challenge} onOpen={() => openChallenge(challenge)} />)}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} action={<Button onClick={onCreateChallenge}>{t("create")}</Button>} />
      )}
    </main>
  );
}
