"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { apiRequest } from "../api";
import { ScoreRing } from "../catalog-cover";
import { EditCatalogItemDialog } from "../catalog-item-dialogs";
import { useGoaFormat } from "../format";
import { type CatalogScope, LibraryGlyph, useCatalogLibraries, useLibraryName } from "../libraries";
import type { CatalogItemDetail, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, LoadingView, SlidersIcon } from "../ui";
import { formatRuntime } from "../utils";

interface CatalogItemEditing {
  members: Member[];
}

/** The "Edit" control and its dialog. Its own component so the libraries load only when someone may actually edit. */
function EditItemAction({ item, scope, onSaved, onRemove }: { item: CatalogItemDetail; scope: CatalogScope; recommendationsEnabled: boolean; editing: CatalogItemEditing; onSaved: () => void; onRemove?: () => Promise<void> }) {
  const t = useTranslations("catalog");
  const { data: libraries } = useCatalogLibraries(scope);
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Settings stay beside the item name at every screen size. */}
      <button
        type="button"
        disabled={!libraries}
        onClick={() => setOpen(true)}
        aria-label={t("edit")}
        title={t("edit")}
        className="grid h-12 w-12 flex-none cursor-pointer place-items-center rounded-xl text-[var(--muted)] transition duration-200 hover:scale-105 hover:text-[var(--ink)] focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SlidersIcon className="h-[18px] w-[18px]" />
      </button>
      {open && libraries ? (
        <EditCatalogItemDialog
          scope={scope}
          item={item}
          libraries={libraries as CatalogLibrary[]}
          onCancel={() => setOpen(false)}
          onSaved={() => { setOpen(false); onSaved(); }}
          onRemove={onRemove}
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
  const f = useGoaFormat();
  const [item, setItem] = useState<CatalogItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
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

  return <CatalogItemPage item={item} library={library} recommendationsEnabled={recommendationsEnabled} onBack={onBack} backLabel={backLabel} onOpenChallenge={onOpenChallenge} editAction={editing ? (
    <EditItemAction item={item} scope={scope} recommendationsEnabled={recommendationsEnabled} editing={editing} onSaved={() => setNonce((value) => value + 1)} onRemove={onDelete} />
  ) : undefined} />;
}

/** The rating, item identity, properties and round history each have their own section. */
export function CatalogItemPage({ item, library, recommendationsEnabled = true, onBack, backLabel, onOpenChallenge, editAction }: {
  item: CatalogItemDetail;
  library: CatalogLibrary | null;
  recommendationsEnabled?: boolean;
  onBack: () => void;
  backLabel?: string;
  onOpenChallenge: (id: Id) => void;
  editAction?: ReactNode;
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const specs: Array<{ label: string; value: string }> = [
    item.year ? { label: t("specYear"), value: String(item.year) } : null,
    item.scheduledAt ? { label: t("specWhen"), value: f.eventWhen(item.scheduledAt) } : null,
    item.author ? { label: t("specAuthor"), value: item.author } : null,
    item.mainGenre ? { label: t("specGenre"), value: item.mainGenre } : null,
    item.runtimeMinutes ? { label: t("specRuntime"), value: formatRuntime(item.runtimeMinutes) ?? "" } : null,
    item.pageCount ? { label: t("specPages"), value: String(item.pageCount) } : null,
    ...(item.attributes ?? []).map((attribute) => ({
      label: attribute.label,
      value: attribute.type === "boolean" ? (attribute.value ? tc("yes") : tc("no")) : attribute.type === "date" ? f.date(String(attribute.value)) : String(attribute.value),
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
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-5 sm:px-6 sm:pt-9">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-7 sm:mb-10" />

      {rated ? (
        <section className={cx(cardClass, "mb-7 flex items-center gap-5 p-5 sm:mb-9 sm:gap-8 sm:p-7")}>
          <ScoreRing value={item.ratingAvg} size={112} strokeWidth={2} label={t("ratedAria", { value: item.ratingAvg ?? 0 })} caption={t("outOfFive")} textClassName="text-[38px] font-light leading-none tracking-[-0.05em]" />
          <p className="min-w-0 flex-1 text-base font-light leading-relaxed tracking-[-0.02em] sm:text-2xl">
            {t("ratingSummary", { ratings: item.ratingCount ?? 0, rounds: item.rounds.length })}
          </p>
        </section>
      ) : null}

      <header className="mb-7 sm:mb-10">
        {library ? (
          <p className="mb-3 flex items-center gap-2 text-sm text-[var(--muted)]">
            <LibraryGlyph source={library.source} className="h-4 w-4 flex-none" />
            <span className="min-w-0 break-words">{libraryName(library)}</span>
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 break-words text-[32px] font-light leading-[1.12] tracking-[-0.04em] sm:text-5xl">{item.title}</h1>
          {editAction}
        </div>
      </header>

      {specs.length ? (
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-[var(--line)] py-5 sm:grid-cols-3 xl:grid-cols-4">
          {specs.map((spec) => (
            <div key={`${spec.label}:${spec.value}`} className="min-w-0">
              <dt className="text-[11px] text-[var(--muted)]">{spec.label}</dt>
              <dd className="mt-1.5 break-words text-base">{spec.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

          <section className="mt-9 sm:mt-12">
            <h2 className="text-xl font-light tracking-[-0.03em] sm:text-2xl">{t("historyTitle")}</h2>
            {rounds.length ? (
              <ol className="relative mt-6 space-y-7 pl-8">
                <span aria-hidden="true" className="absolute bottom-3 left-[6px] top-3 w-0.5 bg-[var(--line)]" />
                {rounds.map((round) => (
                  <li key={round.challengeId} className="relative flex items-start gap-4 sm:gap-5">
                    <span aria-hidden="true" className={cx("absolute -left-8 top-1.5 h-3.5 w-3.5 rounded-full border-[3px] border-[var(--canvas)] ring-1", dotClass[round.status] ?? dotClass.closed)} />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpenChallenge(round.challengeId)} className="block max-w-full cursor-pointer break-words text-left text-base tracking-[-0.02em] hover:underline sm:text-[17px]">{round.title}</button>
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
                    {round.ratingAvg === null ? null : (
                      <div className="flex-none pt-0.5 text-right">
                        <strong className="block text-2xl font-light tracking-[-0.04em]">{round.ratingAvg}</strong>
                        <span className="text-xs text-[var(--muted)]">{t("roundRatings", { count: round.ratingCount })}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 text-sm text-[var(--muted)]">{t("noRounds")}</p>}
          </section>
    </main>
  );
}
