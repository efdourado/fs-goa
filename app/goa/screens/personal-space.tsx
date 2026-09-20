"use client";

import { useTranslations } from "next-intl";

import { CARD_GRID } from "../card-grid";
import { CatalogShelf } from "../catalog-shelf";
import { ActiveChallengeCard } from "./dashboard";
import { ShelfAddButton } from "../shelf";
import type { ChallengeSummary, Id } from "../types";
import { BackButton, EmptyState, PageHeading } from "../ui";
import { canManage } from "../utils";

/** The hidden solo workspace, treated as a group of one: its own page, its challenges and a preview of its catalogue. */
export function PersonalSpaceScreen({
  challenges,
  onBack,
  backLabel,
  onOpenChallenge,
  onOpenAdmin,
  onCreateChallenge,
  onOpenCatalog,
  onOpenCatalogItem,
}: {
  challenges: ChallengeSummary[];
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateChallenge: () => void;
  onOpenCatalog: () => void;
  onOpenCatalogItem: (itemId: Id) => void;
}) {
  const t = useTranslations("personalSpace");
  const tc = useTranslations("common");
  // Colours are a Home feature; one set earlier doesn't tint these cards.
  const plain = (challenge: ChallengeSummary): ChallengeSummary => ({ ...challenge, colorTag: null });
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");

  // One "new challenge" pill, in the header of the first section shown.
  const newChallenge = <ShelfAddButton label={t("createShort")} onClick={onCreateChallenge} />;

  function open(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />

      <PageHeading title={t("title")} description={t("subtitle")} />

      <div className="mt-8 space-y-10">
        {challenges.length ? (
          <>
            {active.length ? (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("sectionActive")}</h2>
                  {newChallenge}
                </div>
                <div className={CARD_GRID}>
                  {active.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={plain(challenge)} onOpen={onOpenChallenge} fluid />)}
                </div>
              </section>
            ) : null}
            {other.length ? (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("sectionArchive")}</h2>
                  {active.length ? null : newChallenge}
                </div>
                <div className={CARD_GRID}>
                  {other.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={plain(challenge)} onOpen={() => open(challenge)} fluid />)}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <EmptyState title={t("emptyTitle")} onClick={onCreateChallenge} />
        )}
        <CatalogShelf scope="personal" canManage onOpenCatalog={onOpenCatalog} onOpenItem={onOpenCatalogItem} />
      </div>
    </main>
  );
}
