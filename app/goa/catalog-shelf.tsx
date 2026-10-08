"use client";

import { useTranslations } from "next-intl";

import { catalogCardHeight, CatalogTile, resolveCoverTop } from "./catalog-views";
import { useGoaFormat } from "./format";
import { type CatalogScope, useCatalogShelf } from "./libraries";
import { Rail, RailArrows, shelfCardWidth, useShelfRail } from "./shelf";
import type { Id } from "./types";
import { cx, EmptyState } from "./ui";
import { formatRuntime } from "./utils";

/** A page shows only the head of the catalogue; the rest is one tap away. */
const PREVIEW_COUNT = 10;

/** Where the shelf's covers will be, drawn while the first answer is still on its way. */
export function CatalogShelfSkeleton({ title }: { title: string }) {
  return (
    <section aria-busy="true">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="text-lg font-semibold tracking-[-0.02em]">{title}</span>
        <span className="h-3 w-5 animate-pulse rounded bg-[var(--wash-strong)]" aria-hidden="true" />
      </div>
      <div className="flex gap-4 overflow-hidden" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className={cx(shelfCardWidth, catalogCardHeight, "block animate-pulse rounded-[20px] bg-[var(--wash)]")} style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
    </section>
  );
}

/**
 * The catalogue as a preview on a page: the newest items of every library together, as one rail of cards with a
 * "N more" card at the end — no library tabs; the catalogue page is where they're told apart.
 * One request brings all of it (the server sends only the newest few of each library, plus the counts), and
 * the last answer is painted straight away when the page is opened again.
 */
export function CatalogShelf({ scope, canManage, onOpenCatalog, onOpenItem }: {
  scope: CatalogScope;
  canManage: boolean;
  onOpenCatalog: () => void;
  onOpenItem: (itemId: Id) => void;
}) {
  const t = useTranslations("group");
  const tCat = useTranslations("catalog");
  const f = useGoaFormat();
  const data = useCatalogShelf(scope);
  const { railRef, showFade, onScroll, nudge } = useShelfRail();
  const title = scope === "personal" ? t("myCatalogTitle") : t("catalogTitle");

  // Every library together, newest first; each card still follows its own library's cover settings.
  const counts = data?.counts ?? {};
  const all = data?.items ?? [];
  const libraryOf = new Map((data?.libraries ?? []).map((library) => [library.kind, library]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const addedAt = (item: (typeof all)[number]) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = [...all].sort((a, b) => addedAt(b) - addedAt(a) || a.title.localeCompare(b.title));
  const visible = sorted.slice(0, PREVIEW_COUNT);
  // The server sends only the newest few of each library, so how many more there are comes from the counts.
  const remaining = Math.max(0, Math.max(total, sorted.length) - visible.length);

  if (data === null) return <CatalogShelfSkeleton title={title} />;
  if (!sorted.length && !canManage) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden="true" className="h-2 w-2 flex-none -translate-y-0.5 self-center rounded-full bg-[var(--main)]" />
          <button type="button" onClick={onOpenCatalog} className="cursor-pointer text-lg font-semibold tracking-[-0.02em] hover:underline">
            {title}
          </button>
          <span className="text-xs text-[var(--muted)]">{total}</span>
        </div>
        {sorted.length ? <RailArrows nudge={nudge} /> : null}
      </div>
      {sorted.length ? (
        <>
          <Rail railRef={railRef} showFade={showFade} onScroll={onScroll}>
            {visible.map((item) => (
              <CatalogTile
                key={item.id}
                className={shelfCardWidth}
                title={item.title}
                year={resolveCoverTop(item, libraryOf.get(item.kind)?.coverTopProperty, f)}
                avg={item.ratingAvg}
                badgeHidden={libraryOf.get(item.kind)?.coverBadgeHidden}
                ratingLabel={item.ratingAvg === null || item.ratingAvg === undefined ? tCat("notRated") : tCat("ratedAria", { value: item.ratingAvg })}
                caption={[item.scheduledAt ? f.eventWhen(item.scheduledAt) : item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter(Boolean).slice(0, 2).join(" · ")}
                onOpen={() => onOpenItem(item.id)}
              />
            ))}
            {remaining > 0 ? (
              <button
                type="button"
                onClick={onOpenCatalog}
                className={cx(shelfCardWidth, catalogCardHeight, "flex cursor-pointer items-center gap-3 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] px-4 text-left transition hover:border-[var(--main-line)]")}
              >
                <span className="text-2xl font-light tracking-[-0.04em]">{remaining}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{t("catalogMoreIn", { name: title })}</span>
                <span className="flex-none text-[13px] text-[var(--main-strong)]">{t("catalogSeeAll")} →</span>
              </button>
            ) : null}
          </Rail>
        </>
      ) : (
        <EmptyState title={t("catalogEmptyTitle")} onClick={onOpenCatalog} />
      )}
    </section>
  );
}
