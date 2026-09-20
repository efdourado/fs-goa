"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { CatalogShelf } from "../catalog-shelf";
import { ActiveChallengeCard } from "./dashboard";
import { ShelfAddButton } from "../shelf";
import type { ChallengeSummary, Id } from "../types";
import { BackButton, EmptyState, PageHeading } from "../ui";
import { canManage } from "../utils";

/** A quiet toolbar button — the bin. */
function ToolButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] px-3.5 text-[13px] text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
    >
      {children}
    </button>
  );
}

/** The hidden solo workspace, treated as a group of one: its own page, its own catalogue link. */
export function PersonalSpaceScreen({
  challenges,
  onBack,
  backLabel,
  onOpenChallenge,
  onOpenAdmin,
  onCreateChallenge,
  onOpenCatalog,
  onOpenCatalogItem,
  onOpenTrash,
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
  onOpenTrash: () => void;
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

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-5">
        <ToolButton onClick={onOpenTrash}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h10M6 5V3.5h4V5M5 5l.6 8h4.8L11 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t("trash")}
        </ToolButton>
      </div>

      <div className="mt-8 space-y-10">
        {challenges.length ? (
          <>
            {active.length ? (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.02em]">{t("sectionActive")}</h2>
                  {newChallenge}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
