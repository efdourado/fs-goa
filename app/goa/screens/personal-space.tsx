"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { ActiveChallengeCard } from "./dashboard";
import type { ChallengeSummary, Id } from "../types";
import { BackButton, Button, cx, EmptyState, EmptyStateAction, PageHeading } from "../ui";
import { canManage } from "../utils";

/** A quiet toolbar button — catalogue / bin / new. */
function ToolButton({ children, onClick, primary = false }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-[13px] transition",
        primary
          ? "border-transparent bg-[var(--main)] text-white hover:opacity-90"
          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)] hover:text-[var(--ink)]",
      )}
    >
      {children}
    </button>
  );
}

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
  const tc = useTranslations("common");
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");

  function open(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-10">
      <BackButton onClick={onBack} label={tc("back")} className="mb-6" />

      <PageHeading title={t("title")} description={t("subtitle")} />

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-5">
        <ToolButton onClick={onOpenCatalog}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M5.5 6.5h5M5.5 9.5h3" strokeLinecap="round" /></svg>
          {t("catalog")}
        </ToolButton>
        <ToolButton onClick={onOpenTrash}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h10M6 5V3.5h4V5M5 5l.6 8h4.8L11 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t("trash")}
        </ToolButton>
        <span className="flex-1" />
        <ToolButton onClick={onCreateChallenge} primary>
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
          {t("createShort")}
        </ToolButton>
      </div>

      {challenges.length ? (
        <div className="mt-8 space-y-10">
          {active.length ? (
            <section>
              <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em]">{t("sectionActive")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {active.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpenChallenge} />)}
              </div>
            </section>
          ) : null}
          {other.length ? (
            <section>
              <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em]">{t("sectionArchive")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {other.map((challenge) => <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => open(challenge)} />)}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState title={t("emptyTitle")} description={t.rich("emptyCreatePrompt", { action: (chunks) => <EmptyStateAction onClick={onCreateChallenge}>{chunks}</EmptyStateAction> })} action={<Button variant="secondary" onClick={onCreateChallenge}>{t("createShort")}</Button>} />
        </div>
      )}
    </main>
  );
}
