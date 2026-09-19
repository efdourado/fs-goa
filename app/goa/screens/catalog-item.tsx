"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { apiRequest } from "../api";
import { EditCatalogItemDialog } from "../catalog-item-dialogs";
import { useGoaFormat } from "../format";
import { type CatalogScope, LibraryGlyph, useCatalogLibraries, useLibraryName } from "../libraries";
import { recommenderLine, useRecommenderSource } from "../recommender-picker";
import type { CatalogItemDetail, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, LoadingView, PageHeading } from "../ui";
import { formatRuntime } from "../utils";

export interface CatalogItemEditing {
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
      <Button variant="secondary" disabled={!libraries} onClick={() => setOpen(true)}>{t("edit")}</Button>
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
  onOpenChallenge,
  onDelete,
  editing,
}: {
  scope: CatalogScope;
  recommendationsEnabled?: boolean;
  detailPath: string;
  itemId: Id;
  onBack: () => void;
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
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
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

  if (error) return <main className="mx-auto max-w-3xl px-4 py-10"><EmptyState title={t("errorTitle")} hint={error} action={<Button variant="secondary" onClick={onBack}>{t("back")}</Button>} /></main>;
  if (!item) return <LoadingView />;

  const titleWithYear = item.year ? `${item.title} (${item.year})` : item.title;
  const customAttributes = (item.attributes ?? []).map((attribute) =>
    attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
  const byline = !recommendationsEnabled
    ? null
    : recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text }));
  const attrs = [
    item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
    item.author ? t("byAuthor", { name: item.author }) : null,
    item.pageCount ? t("pages", { count: item.pageCount }) : null,
    formatRuntime(item.runtimeMinutes),
    item.mainGenre,
    ...customAttributes,
    byline,
  ].filter(Boolean);

  async function remove() {
    if (!onDelete || !window.confirm(t("removeConfirm", { title: item!.title }))) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onDelete();
    } catch (cause) {
      setRemoveError(f.error(cause));
      setRemoving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={t("back")} className="mb-6" />
      {library ? (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--wash)] px-3 py-1 text-xs text-[var(--muted)]">
          <LibraryGlyph source={library.source} />{libraryName(library)}
        </p>
      ) : null}
      <PageHeading
        title={titleWithYear}
        description={attrs.join(" · ")}
        action={item.ratingAvg !== null && item.ratingAvg !== undefined ? (
          <div className="text-right">
            <strong className="block text-4xl tracking-[-0.05em]">{item.ratingAvg}</strong>
            <span className="text-xs text-[var(--muted)]">{t("groupRating", { count: item.ratingCount ?? 0 })}</span>
          </div>
        ) : undefined}
      />

      <section className={cx(cardClass, "mt-6 p-5 sm:p-7")}>
        <h2 className="text-lg font-light">{t("historyTitle")}</h2>
        {item.rounds.length ? (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {item.rounds.map((round) => (
              <li key={round.challengeId} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <button type="button" onClick={() => onOpenChallenge(round.challengeId)} className="block cursor-pointer truncate text-sm font-light hover:underline">{round.title}</button>
                  <span className="text-xs text-[var(--muted)]">
                    {[round.startsOn || round.endsOn ? f.dateRange(round.startsOn, round.endsOn) : t(`status.${round.status}`),
                      round.recommendedBy ? t("recommendedBy", { name: round.recommendedBy }) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex-none text-sm tabular-nums">
                  {round.ratingAvg === null
                    ? <span className="text-[var(--muted)]">—</span>
                    : <>{round.ratingAvg}<span className="ml-1.5 text-[10px] font-light text-[var(--muted)]">n={round.ratingCount}</span></>}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-[var(--muted)]">{t("noRounds")}</p>}
      </section>

      {editing ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] p-5">
          <p className="text-sm leading-6 text-[var(--muted)]">{t("editHint")}</p>
          <EditItemAction item={item} scope={scope} recommendationsEnabled={recommendationsEnabled} editing={editing} onSaved={() => setNonce((value) => value + 1)} />
        </section>
      ) : null}

      {onDelete ? (
        <section className="mt-6 rounded-2xl border border-[var(--line)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-6 text-[var(--muted)]">{t("removeHint")}</p>
            <Button variant="danger" disabled={removing} onClick={remove}>{removing ? tc("saving") : t("remove")}</Button>
          </div>
          {removeError ? <p className="mt-3 text-sm text-[var(--danger)]">{removeError}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
