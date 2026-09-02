"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import type { CatalogItem, Id } from "../types";
import { backLinkClass, cardClass, cx, EmptyState, PageHeading, StatusMessage } from "../ui";

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

  const sorted = useMemo(() => [...(items ?? [])].sort((left, right) =>
    sort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1)
      : left.title.localeCompare(right.title),
  ), [items, sort]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading
        title={t("title")}
        description={t("subtitle")}
        action={sorted.length ? (
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
      {items === null ? (
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : sorted.length ? (
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
      )}
    </main>
  );
}
