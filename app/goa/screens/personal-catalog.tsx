"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { byRatingDesc, bucketize, type CatalogBucket, decadeOf, highlights } from "../catalog-insights";
import { Segmented } from "../Segmented";
import type { CatalogItem, Id } from "../types";
import { backLinkClass, cardClass, cx, EmptyState, PageHeading, StatusMessage } from "../ui";

type Kind = "film" | "book";
type View = "list" | "genre" | "year" | "decade";

/** Fixed 0–5 scale so a bar means the same thing across genre / year / decade. */
const RATING_MAX = 5;

function BucketBars({ buckets, emptyLabel }: { buckets: CatalogBucket[]; emptyLabel: string }) {
  const t = useTranslations("personalCatalog");
  const rows = byRatingDesc(buckets);
  return (
    <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
      {rows.map((bucket) => {
        const pct = bucket.ratingAvg === null ? 0 : Math.max(2, Math.min(100, (bucket.ratingAvg / RATING_MAX) * 100));
        return (
          <li key={bucket.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 px-5 py-3.5 sm:grid-cols-[9rem_1fr_auto]">
            <span className="truncate text-sm font-light" title={bucket.label || emptyLabel}>{bucket.label || emptyLabel}</span>
            <span className="h-2.5 rounded-full bg-[var(--wash)]" aria-hidden="true">
              <span className="block h-full rounded-full bg-[var(--main)]" style={{ width: `${pct}%` }} />
            </span>
            <span className="whitespace-nowrap text-right text-sm tabular-nums">
              {bucket.ratingAvg === null ? <span className="text-[var(--muted)]">—</span> : bucket.ratingAvg}
              <span className="ml-2 text-[10px] font-light text-[var(--muted)]">
                {t("bucketMeta", { ratings: bucket.ratingCount, items: bucket.itemCount })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PersonalCatalogScreen({
  onBack,
  onOpenItem,
}: {
  onBack: () => void;
  onOpenItem: (itemId: Id) => void;
}) {
  const t = useTranslations("personalCatalog");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [sort, setSort] = useState<"title" | "rating">("title");
  const [kindOverride, setKindOverride] = useState<Kind | null>(null);
  const [view, setView] = useState<View>("list");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.personalCatalog, { signal: controller.signal })
      .then((response) => setItems(response.items))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems([]);
        setError(cause instanceof Error ? cause.message : t("loadError"));
      });
    return () => controller.abort();
  }, [t]);

  const filmCount = useMemo(() => (items ?? []).filter((item) => item.kind === "film").length, [items]);
  const bookCount = useMemo(() => (items ?? []).filter((item) => item.kind === "book").length, [items]);
  // Film and book are separate shelves — never one list sorted across both.
  const bothKinds = filmCount > 0 && bookCount > 0;
  const kind: Kind = kindOverride ?? (bookCount > filmCount ? "book" : "film");
  const scoped = useMemo(
    () => (items ?? []).filter((item) => item.kind === kind),
    [items, kind],
  );

  const sorted = useMemo(() => [...scoped].sort((left, right) =>
    sort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1)
      : left.title.localeCompare(right.title),
  ), [scoped, sort]);

  const genreBuckets = useMemo(
    () => bucketize(scoped, (item) => ({ key: (item.mainGenre ?? "").toLowerCase() || "__none__", label: item.mainGenre?.trim() ?? "" })),
    [scoped],
  );
  const yearBuckets = useMemo(
    () => bucketize(scoped, (item) => (item.year ? { key: String(item.year), label: String(item.year) } : null)),
    [scoped],
  );
  const decadeBuckets = useMemo(
    () => bucketize(scoped, (item) => (item.year ? { key: decadeOf(item.year), label: decadeOf(item.year) } : null)),
    [scoped],
  );

  const activeBuckets = view === "genre" ? genreBuckets : view === "year" ? yearBuckets : view === "decade" ? decadeBuckets : [];
  const topGenres = useMemo(() => highlights(genreBuckets), [genreBuckets]);
  const topYears = useMemo(() => highlights(yearBuckets), [yearBuckets]);

  const views: View[] = ["list", "genre", "decade", "year"];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading
        title={t("title")}
        description={t("subtitle")}
        action={view === "list" && sorted.length ? (
          <label className="text-xs text-[var(--muted)]">
            <span className="sr-only">{t("sortLabel")}</span>
            <select className="min-h-10 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-sm text-[var(--ink)]" value={sort} onChange={(event) => setSort(event.target.value as "title" | "rating")}>
              <option value="title">{t("sortTitle")}</option>
              <option value="rating">{t("sortRating")}</option>
            </select>
          </label>
        ) : undefined}
      />
      <StatusMessage error={error} />

      {items && items.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <nav className="flex gap-1 rounded-full bg-[var(--wash-strong)]/70 p-1 text-xs" aria-label={t("viewLabel")}>
            {views.map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={view === option}
                className={cx("min-h-9 rounded-full px-3 font-light", view === option ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}
                onClick={() => setView(option)}
              >
                {t(`view.${option}`)}
              </button>
            ))}
          </nav>
          {bothKinds ? (
            <Segmented
              className="text-[11px]"
              ariaLabel={t("kindLabel")}
              value={kind}
              onChange={setKindOverride}
              options={[
                { value: "film", label: t("kind.film") },
                { value: "book", label: t("kind.book") },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {items === null ? (
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : !items.length ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : view === "list" ? (
        sorted.length ? (
          <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
            {sorted.map((item) => (
              <li key={item.id}>
                <button type="button" className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--wash)]" onClick={() => onOpenItem(item.id)}>
                  <span className="min-w-0">
                    <strong className="block truncate font-light">{item.title}</strong>
                    <small className="mt-1 block truncate text-[var(--muted)]">
                      {[item.author, item.year ? String(item.year) : null, item.mainGenre, t("rounds", { count: item.roundCount ?? 0 })].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <span className="flex-none text-sm tabular-nums">
                    {item.ratingAvg === null || item.ratingAvg === undefined ? "—" : `${item.ratingAvg} · n=${item.ratingCount ?? 0}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        )
      ) : activeBuckets.length ? (
        <div className="space-y-4">
          {(view === "genre" ? topGenres : topYears).length ? (
            <p className="text-sm text-[var(--muted)]">
              {t(view === "genre" ? "bestGenres" : "bestYears", {
                list: (view === "genre" ? topGenres : topYears).map((bucket) => `${bucket.label || t("noGenre")} (${bucket.ratingAvg})`).join(", "),
              })}
            </p>
          ) : null}
          <BucketBars buckets={activeBuckets} emptyLabel={t("noGenre")} />
        </div>
      ) : (
        <EmptyState title={t("bucketEmptyTitle")} description={t("bucketEmptyBody")} />
      )}
    </main>
  );
}
