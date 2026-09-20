"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { apiRequest } from "../api";
import { ItemCover, ScoreRing } from "../catalog-cover";
import { EditCatalogItemDialog } from "../catalog-item-dialogs";
import { ConfirmDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { type CatalogScope, LibraryGlyph, useCatalogLibraries, useLibraryName } from "../libraries";
import { useRecommenderSource } from "../recommender-picker";
import type { CatalogItemDetail, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, LoadingView } from "../ui";
import { formatRuntime } from "../utils";

interface CatalogItemEditing {
  members: Member[];
}

/** The "Edit" control and its dialog. Its own component so the libraries load only when someone may actually edit. */
function EditItemAction({ item, scope, recommendationsEnabled, editing, onSaved }: { item: CatalogItemDetail; scope: CatalogScope; recommendationsEnabled: boolean; editing: CatalogItemEditing; onSaved: () => void }) {
  const t = useTranslations("catalog");
  const { data: libraries } = useCatalogLibraries(scope);
  const source = useRecommenderSource(scope, recommendationsEnabled);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="min-h-11 flex-1" disabled={!libraries} onClick={() => setOpen(true)}>{t("edit")}</Button>
      {open && libraries ? (
        <EditCatalogItemDialog
          scope={scope}
          item={item}
          libraries={libraries as CatalogLibrary[]}
          members={editing.members}
          recommendationsEnabled={recommendationsEnabled}
          source={source}
          onCancel={() => setOpen(false)}
          onSaved={() => { setOpen(false); onSaved(); }}
        />
      ) : null}
    </>
  );
}

export function CatalogItemScreen({
  scope,
  recommendationsEnabled = true,
  detailPath,
  itemId,
  onBack,
  backLabel,
  onOpenChallenge,
  onDelete,
  editing,
}: {
  scope: CatalogScope;
  recommendationsEnabled?: boolean;
  detailPath: string;
  itemId: Id;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onOpenChallenge: (id: Id) => void;
  /** Present only when the viewer may remove the item from the catalog. */
  onDelete?: () => Promise<void>;
  /** Present only when the viewer may edit it. */
  editing?: CatalogItemEditing;
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [item, setItem] = useState<CatalogItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [nonce, setNonce] = useState(0);
  const libraryName = useLibraryName();
  const { data: libraries } = useCatalogLibraries(scope);
  const library = libraries?.find((entry) => entry.kind === item?.kind) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<CatalogItemDetail>(detailPath, { signal: controller.signal })
      .then(setItem)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPath, itemId, nonce]);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-10"><EmptyState title={t("errorTitle")} hint={error} action={<Button variant="secondary" onClick={onBack}>{backLabel ?? t("back")}</Button>} /></main>;
  if (!item) return <LoadingView />;

  const specs: Array<{ label: string; value: string }> = [
    item.year ? { label: t("specYear"), value: String(item.year) } : null,
    item.scheduledAt ? { label: t("specWhen"), value: f.eventWhen(item.scheduledAt) } : null,
    item.author ? { label: t("specAuthor"), value: item.author } : null,
    item.mainGenre ? { label: t("specGenre"), value: item.mainGenre } : null,
    item.runtimeMinutes ? { label: t("specRuntime"), value: formatRuntime(item.runtimeMinutes) ?? "" } : null,
    item.pageCount ? { label: t("specPages"), value: String(item.pageCount) } : null,
    ...(item.attributes ?? []).map((attribute) => ({
      label: attribute.label,
      value: attribute.type === "boolean" ? (attribute.value ? tc("yes") : tc("no")) : String(attribute.value),
    })),
    recommendationsEnabled && item.recommendedBy ? { label: t("specRecommendedBy"), value: item.recommendedBy.name } : null,
    recommendationsEnabled && !item.recommendedBy && item.originNote ? { label: t("specOrigin"), value: item.originNote } : null,
  ].filter((spec): spec is { label: string; value: string } => Boolean(spec?.value));
  const rated = item.ratingAvg !== null && item.ratingAvg !== undefined;
  // Newest round first: what the group is doing with it now, then how it went before.
  const rounds = [...item.rounds].reverse();
  const dotClass: Record<string, string> = {
    active: "bg-[var(--ok-line)] ring-[var(--ok-line)]",
    draft: "bg-[var(--warn-line)] ring-[var(--warn-line)]",
    closed: "bg-[var(--line)] ring-[var(--line)]",
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-8" />

      <div className="grid items-start gap-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-16">
        <div className="w-full max-w-[280px] sm:max-w-[340px]">
          <ItemCover size="xl" title={item.title} year={item.year} />
          {editing || onDelete ? (
            <div className="mt-5 flex items-center gap-2.5">
              {editing ? <EditItemAction item={item} scope={scope} recommendationsEnabled={recommendationsEnabled} editing={editing} onSaved={() => setNonce((value) => value + 1)} /> : null}
              {onDelete ? (
                <ActionMenu label={t("moreActions")} iconOnly>
                  <ActionMenuItem danger onClick={() => setConfirmingRemoval(true)}>{t("remove")}</ActionMenuItem>
                </ActionMenu>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          {library ? (
            <p className="flex items-center gap-2.5 text-xs uppercase tracking-[0.12em] text-[var(--muted)]" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--main-soft)] text-[var(--main-strong)]" aria-hidden="true"><LibraryGlyph source={library.source} className="h-[18px] w-[18px]" /></span>
              {libraryName(library)}
            </p>
          ) : null}
          <h1 className="mt-4 text-4xl font-light leading-[1.02] tracking-[-0.055em] sm:text-6xl">{item.title}</h1>

          {specs.length ? (
            <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-[var(--line)] py-5 sm:grid-cols-3 xl:grid-cols-4">
              {specs.map((spec) => (
                <div key={`${spec.label}:${spec.value}`} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">{spec.label}</dt>
                  <dd className="mt-1.5 break-words text-base">{spec.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <section className={cx(cardClass, "mt-7 flex flex-wrap items-center gap-x-8 gap-y-5 p-6 sm:p-7")} aria-label={t("ratingTitle")}>
            <ScoreRing value={item.ratingAvg} size={132} strokeWidth={2} label={rated ? t("ratedAria", { value: item.ratingAvg ?? 0 }) : t("notRatedYet")} caption={rated ? t("outOfFive") : undefined} textClassName="text-[44px] font-light leading-none tracking-[-0.05em]" />
            <div className="min-w-0 flex-1 basis-56">
              <h2 className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{t("ratingTitle")}</h2>
              <p className="mt-2 text-xl font-light leading-snug tracking-[-0.03em] sm:text-2xl">
                {rated ? t("ratingSummary", { ratings: item.ratingCount ?? 0, rounds: item.rounds.length }) : t("notRatedYet")}
              </p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-light tracking-[-0.03em] sm:text-2xl">{t("historyTitle")}</h2>
            {rounds.length ? (
              <ol className="relative mt-6 space-y-7 pl-8">
                <span aria-hidden="true" className="absolute bottom-3 left-[6px] top-3 w-0.5 bg-[var(--line)]" />
                {rounds.map((round) => (
                  <li key={round.challengeId} className="relative flex items-center gap-5">
                    <span aria-hidden="true" className={cx("absolute -left-8 top-1.5 h-3.5 w-3.5 rounded-full border-[3px] border-[var(--canvas)] ring-1", dotClass[round.status] ?? dotClass.closed)} />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpenChallenge(round.challengeId)} className="block max-w-full cursor-pointer truncate text-left text-base tracking-[-0.02em] hover:underline sm:text-[17px]">{round.title}</button>
                      <p className="mt-1 text-[13px] text-[var(--muted)]">
                        {[round.startsOn || round.endsOn ? f.dateRange(round.startsOn, round.endsOn) : null, t(`status.${round.status}`),
                          round.recommendedBy ? t("recommendedBy", { name: round.recommendedBy }) : null].filter(Boolean).join(" · ")}
                      </p>
                      {round.ratingAvg !== null ? (
                        <div className="mt-3 h-2 max-w-md rounded-full bg-[var(--wash-strong)]" aria-hidden="true">
                          <div className="h-full rounded-full bg-[var(--main)]" style={{ width: `${Math.max(2, Math.min(100, (round.ratingAvg / 5) * 100))}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex-none text-right">
                      {round.ratingAvg === null
                        ? <span className="text-xl text-[var(--muted)]">—</span>
                        : <><strong className="block text-2xl font-light tracking-[-0.04em]">{round.ratingAvg}</strong><span className="text-xs text-[var(--muted)]">{t("roundRatings", { count: round.ratingCount })}</span></>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 text-sm text-[var(--muted)]">{t("noRounds")}</p>}
          </section>
        </div>
      </div>

      {confirmingRemoval && onDelete ? (
        <ConfirmDialog
          title={t("removeTitle", { title: item.title })}
          body={t("removeHint")}
          confirmLabel={t("remove")}
          busyLabel={tc("saving")}
          danger
          onClose={() => setConfirmingRemoval(false)}
          onConfirm={onDelete}
        />
      ) : null}
    </main>
  );
}
