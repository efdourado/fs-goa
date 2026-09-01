"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import type { CatalogItemDetail, Id } from "../types";
import { backLinkClass, Button, cardClass, cx, EmptyState, LoadingView, PageHeading } from "../ui";

export function CatalogItemScreen({
  groupId,
  itemId,
  onBack,
  onOpenChallenge,
}: {
  groupId: Id;
  itemId: Id;
  onBack: () => void;
  onOpenChallenge: (id: Id) => void;
}) {
  const t = useTranslations("catalog");
  const f = useGoaFormat();
  const [item, setItem] = useState<CatalogItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<CatalogItemDetail>(API_PATHS.groupCatalogItem(groupId, itemId), { signal: controller.signal })
      .then(setItem)
      .catch((cause: unknown) => setError(f.error(cause)));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, itemId]);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-10"><EmptyState title={t("errorTitle")} description={error} action={<Button variant="secondary" onClick={onBack}>{t("back")}</Button>} /></main>;
  if (!item) return <LoadingView />;

  const attrs = [
    item.year ? String(item.year) : null,
    item.runtimeMinutes ? t("runtime", { minutes: item.runtimeMinutes }) : null,
    item.pageCount ? t("pages", { count: item.pageCount }) : null,
    item.genres.length ? item.genres.join(", ") : null,
  ].filter(Boolean);
  const rated = item.rounds.filter((round) => round.ratingAvg !== null);
  const historyAvg = rated.length
    ? Number((rated.reduce((sum, round) => sum + (round.ratingAvg ?? 0), 0) / rated.length).toFixed(2))
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading title={item.title} description={attrs.join(" · ")} />

      <section className={cx(cardClass, "mt-6 p-5 sm:p-7")}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-light">{t("historyTitle")}</h2>
          {historyAvg !== null ? (
            <span className="text-sm text-[var(--muted)]">{t("historyAvg", { value: historyAvg, rounds: rated.length })}</span>
          ) : null}
        </div>
        {item.rounds.length ? (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {item.rounds.map((round) => (
              <li key={round.challengeId} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <button type="button" onClick={() => onOpenChallenge(round.challengeId)} className="block truncate text-sm font-light hover:underline">{round.title}</button>
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
    </main>
  );
}
