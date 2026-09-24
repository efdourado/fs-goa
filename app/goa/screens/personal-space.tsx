"use client";

import { useTranslations } from "next-intl";

import { CatalogShelf } from "../catalog-shelf";
import { applyColorFilter, OrganizeBar, useChallengeOrganizer } from "../organize";
import { ActiveChallengeCard } from "./dashboard";
import { ShelfAddButton } from "../shelf";
import type { ChallengeSummary, Id } from "../types";
import { BackButton, Button, EmptyState, PageHeading, StatusMessage } from "../ui";
import { canManage, isPersonalChallenge } from "../utils";

type SpaceSection = "pinned" | "active" | "archive";
const SPACE_SECTIONS: SpaceSection[] = ["pinned", "active", "archive"];

/**
 * My space's sections, like Home's shelves: what the viewer pinned first, then what is running, then everything
 * closed or still a draft. Only the space's own challenges, in the order they are given.
 */
export function splitSpace(challenges: ChallengeSummary[], personalWorkspaceId: Id | null): Record<SpaceSection, ChallengeSummary[]> {
  const out: Record<SpaceSection, ChallengeSummary[]> = { pinned: [], active: [], archive: [] };
  for (const challenge of challenges) {
    if (!isPersonalChallenge(challenge, personalWorkspaceId)) continue;
    if (challenge.pinned) out.pinned.push(challenge);
    else if (challenge.status === "active") out.active.push(challenge);
    else out.archive.push(challenge);
  }
  return out;
}

/**
 * The hidden solo workspace, treated as a group of one: its own page, its challenges and a preview of its catalogue.
 * The challenges are organised the way Home organises them — pin, colour, order — and it is the same setting:
 * a challenge pinned here is pinned there.
 */
export function PersonalSpaceScreen({
  challenges,
  personalWorkspaceId,
  csrfToken,
  onBack,
  backLabel,
  onOpenChallenge,
  onOpenAdmin,
  onCreateChallenge,
  onQuickCreate,
  onOpenCatalog,
  onOpenCatalogItem,
  onChanged,
}: {
  /** All of the viewer's challenges — the order is one list across Home and here, so it is sent whole. */
  challenges: ChallengeSummary[];
  personalWorkspaceId: Id | null;
  csrfToken: string;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateChallenge: () => void;
  /** The guided, question-by-question way to start a challenge here. */
  onQuickCreate: () => void;
  onOpenCatalog: () => void;
  onOpenCatalogItem: (itemId: Id) => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("personalSpace");
  const tDash = useTranslations("dashboard");
  const tQuick = useTranslations("quickCreate");
  const tc = useTranslations("common");
  const { shelves, colorFilter, setColorFilter, reorderMode, setReorderMode, error, cardProps } = useChallengeOrganizer({
    challenges,
    csrfToken,
    onChanged,
    keys: SPACE_SECTIONS,
    split: (ordered) => splitSpace(ordered, personalWorkspaceId),
  });
  const filtered = {
    pinned: applyColorFilter(shelves.pinned, colorFilter),
    active: applyColorFilter(shelves.active, colorFilter),
    archive: applyColorFilter(shelves.archive, colorFilter),
  };
  const shown = SPACE_SECTIONS.filter((key) => filtered[key].length);
  const filteredCount = filtered.pinned.length + filtered.active.length + filtered.archive.length;
  const hasAny = shelves.pinned.length + shelves.active.length + shelves.archive.length > 0;
  const sectionTitle: Record<SpaceSection, string> = { pinned: tDash("shelf.pinned"), active: t("sectionActive"), archive: t("sectionArchive") };

  // One "new challenge" pill, in the header of the first section shown.
  const newChallenge = (
    <div className="flex flex-wrap items-center gap-2">
      <ShelfAddButton label={tQuick("entryCta")} onClick={onQuickCreate} />
      <ShelfAddButton label={t("createShort")} onClick={onCreateChallenge} />
    </div>
  );

  function open(challenge: ChallengeSummary) {
    if (challenge.status === "draft" && canManage(challenge.viewerRole)) onOpenAdmin(challenge.id);
    else onOpenChallenge(challenge.id);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />

      <PageHeading title={t("title")} description={t("subtitle")} />

      <div className="mt-8">
        {hasAny ? (
          <OrganizeBar colorFilter={colorFilter} onColorFilter={setColorFilter} reorderMode={reorderMode} onReorderMode={setReorderMode} filteredCount={filteredCount} />
        ) : null}
        <StatusMessage error={error} />
        <div className="space-y-10">
          {hasAny ? (
            shown.length ? shown.map((key, index) => (
              <section key={key}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.02em]">{sectionTitle[key]}</h2>
                  {index === 0 ? newChallenge : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered[key].map((challenge) => (
                    <ActiveChallengeCard key={challenge.id} challenge={challenge} onOpen={() => open(challenge)} fluid {...cardProps(key, challenge, onOpenAdmin)} />
                  ))}
                </div>
              </section>
            )) : <EmptyState title={tDash("filter.empty")} action={newChallenge} />
          ) : (
            <EmptyState
              title={t("emptyTitle")}
              action={(
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={onQuickCreate}>{tQuick("entryCta")}</Button>
                  <Button variant="secondary" onClick={onCreateChallenge}>{t("createShort")}</Button>
                </div>
              )}
            />
          )}
          <CatalogShelf scope="personal" canManage onOpenCatalog={onOpenCatalog} onOpenItem={onOpenCatalogItem} />
        </div>
      </div>
    </main>
  );
}
