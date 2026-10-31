"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { apiRequest } from "../api";
import { coverColors, coverToneOf, ScoreRing } from "../catalog-cover";
import { EditCatalogItemDialog } from "../catalog-item-dialogs";
import { useGoaFormat } from "../format";
import { useLibraryProperties, useNativePropertyName } from "../property-inputs";
import { type CatalogScope, LibraryGlyph, useCatalogLibraries, useLibraryName } from "../libraries";
import type { CatalogItemDetail, CatalogLibrary, Id, LibraryProperty, Member } from "../types";
import { BackButton, Button, EmptyState, LoadingView, SlidersIcon } from "../ui";
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
  const { properties } = useLibraryProperties(library);

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

  return <CatalogItemPage item={item} library={library} properties={properties} recommendationsEnabled={recommendationsEnabled} onBack={onBack} backLabel={backLabel} onOpenChallenge={onOpenChallenge} editAction={editing ? (
    <EditItemAction item={item} scope={scope} recommendationsEnabled={recommendationsEnabled} editing={editing} onSaved={() => setNonce((value) => value + 1)} onRemove={onDelete} />
  ) : undefined} />;
}

interface ItemProperty { key: string; label: string; value: string }

function ItemProperties({ properties, label }: { properties: ItemProperty[]; label: string }) {
  if (!properties.length) return null;
  return <dl className="catalog-item-properties" aria-label={label}>
    {properties.map((property) => <div key={property.key} className={property.value.length > 60 || property.value.includes("\n") ? "catalog-item-longProperty" : undefined}>
      <dt>{property.label}</dt><dd>{property.value}</dd>
    </div>)}
  </dl>;
}

/** Item identity and properties share one collection panel, followed by the rating and timeline. */
export function CatalogItemPage({ item, library, properties, recommendationsEnabled = true, onBack, backLabel, onOpenChallenge, editAction }: {
  item: CatalogItemDetail;
  library: CatalogLibrary | null;
  properties?: LibraryProperty[] | null;
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
  const nameProperty = useNativePropertyName();
  const native = (key: string, fallback: string, value: string | number | null | undefined): ItemProperty[] => {
    const property = properties?.find((entry) => entry.storage === "native" && entry.key === key);
    if (property?.hidden || value === null || value === undefined || value === "") return [];
    return [{ key, label: property ? nameProperty(property) : fallback, value: String(value) }];
  };
  const allProperties: ItemProperty[] = [
    ...native("author", t("specAuthor"), item.author),
    ...native("year", t("specYear"), item.year),
    ...native("main_genre", t("specGenre"), item.mainGenre),
    ...native("page_count", t("specPages"), item.pageCount),
    ...native("runtime_minutes", t("specRuntime"), formatRuntime(item.runtimeMinutes)),
    ...native("scheduled_at", t("specWhen"), item.scheduledAt ? f.eventWhen(item.scheduledAt) : null),
    ...(item.attributes ?? []).map((attribute) => ({ key: `attribute:${attribute.key}`, label: attribute.label, value: attribute.type === "boolean" ? attribute.value ? tc("yes") : tc("no") : attribute.type === "date" ? f.date(String(attribute.value)) : String(attribute.value) })),
    ...(recommendationsEnabled && item.recommendedBy ? [{ key: "recommended_by", label: t("specRecommendedBy"), value: item.recommendedBy.name }] : []),
    ...(recommendationsEnabled && !item.recommendedBy && item.originNote ? [{ key: "origin", label: t("specOrigin"), value: item.originNote }] : []),
  ];
  const creator = allProperties.find((property) => ["author", "attribute:direcao", "attribute:director"].includes(property.key));
  const details = allProperties.filter((property) => property !== creator);
  const rated = item.ratingAvg !== null && item.ratingAvg !== undefined;
  const rounds = [...item.rounds].reverse();

  return <div className="catalog-item-canvas">
    <main className="catalog-item-page">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="catalog-item-back" />
      <header className="catalog-item-info" style={coverColors(coverToneOf(item.title))}>
        {library ? <span className="catalog-item-libraryLabel"><LibraryGlyph source={library.source} className="h-4 w-4" />{libraryName(library)}</span> : null}
        <div className="catalog-item-identityRow"><h1>{item.title}</h1>{editAction}</div>
        {creator ? <p className="catalog-item-creator"><span>{creator.label}</span>{creator.value}</p> : null}
        <ItemProperties properties={details} label={t("detailsTitle")} />
      </header>

      {rated ? <section className="catalog-item-rating">
        <ScoreRing value={item.ratingAvg} size={112} strokeWidth={2} label={t("ratedAria", { value: item.ratingAvg ?? 0 })} caption={t("outOfFive")} textClassName="text-[38px] font-light leading-none tracking-[-0.05em]" />
        <p>{t("ratingSummary", { ratings: item.ratingCount ?? 0, rounds: item.rounds.length })}</p>
      </section> : null}

      <section className="catalog-item-history">
        <h2>{t("historyTitle")}</h2>
        {rounds.length ? <ol>
          {rounds.map((round) => <li key={round.challengeId} data-active={round.status === "active"}>
            <span className="catalog-item-historyDot" aria-hidden="true" />
            <div className="catalog-item-historyText">
              <button type="button" className="catalog-item-roundTitle" onClick={() => onOpenChallenge(round.challengeId)}>{round.title}</button>
              <p>{[round.startsOn || round.endsOn ? f.dateRange(round.startsOn, round.endsOn) : null, t(`status.${round.status}`), round.recommendedBy ? t("recommendedBy", { name: round.recommendedBy }) : null].filter(Boolean).join(" · ")}</p>
              {round.ratingAvg !== null ? <div className="catalog-item-ratingTrack" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, round.ratingAvg / 5 * 100))}%` }} /></div> : null}
            </div>
            {round.ratingAvg !== null ? <div className="catalog-item-roundRating"><strong>{round.ratingAvg}</strong><span>{t("roundRatings", { count: round.ratingCount })}</span></div> : null}
          </li>)}
        </ol> : <p>{t("noRounds")}</p>}
      </section>
    </main>
  </div>;
}
