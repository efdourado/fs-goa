"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { AddCardTile } from "./add-tile";
import { CatalogTile, resolveCoverTop } from "./catalog-views";
import { useGoaFormat } from "./format";
import { type CatalogScope, LibraryGlyph, useCatalogShelf, useLibraryName } from "./libraries";
import { Rail, RailArrows, useShelfRail } from "./shelf";
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
          <span key={index} className="block aspect-[3/4] w-44 flex-none animate-pulse rounded-[20px] bg-[var(--wash)]" style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
    </section>
  );
}

/**
 * The catalogue as a preview on a page: the newest items of one library as a rail of covers, with the
 * libraries as tabs when more than one has items, an "Add item" tile, and a "N more" tile at the end.
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
  const tl = useTranslations("libraries");
  const tCat = useTranslations("catalog");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const data = useCatalogShelf(scope);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const { railRef, showFade, onScroll, nudge } = useShelfRail();
  const title = scope === "personal" ? t("myCatalogTitle") : t("catalogTitle");

  // Each library is its own shelf — one sorted list never mixes them.
  const counts = data?.counts ?? {};
  const all = data?.items ?? [];
  const shelves = (data?.libraries ?? []).filter((library) => (counts[library.kind] ?? 0) > 0);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const tabbed = shelves.length > 1;
  const kind = activeKind && shelves.some((library) => library.kind === activeKind) ? activeKind : shelves[0]?.kind ?? null;
  const addedAt = (item: (typeof all)[number]) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = all
    .filter((item) => !tabbed || item.kind === kind)
    .sort((a, b) => addedAt(b) - addedAt(a) || a.title.localeCompare(b.title));
  const visible = sorted.slice(0, PREVIEW_COUNT);
  const shelf = shelves.find((library) => library.kind === kind) ?? null;
  // The server sends only the newest few of each library, so how many more there are comes from the counts.
  const inShelf = kind ? counts[kind] ?? sorted.length : sorted.length;
  const remaining = Math.max(0, inShelf - visible.length);

  if (data === null) return <CatalogShelfSkeleton title={title} />;
  if (!sorted.length && !canManage) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <button type="button" onClick={onOpenCatalog} className="cursor-pointer text-lg font-semibold tracking-[-0.02em] hover:underline">
            {title}
          </button>
          <span className="text-xs text-[var(--muted)]">{total}</span>
        </div>
        {sorted.length ? <RailArrows nudge={nudge} /> : null}
      </div>
      {sorted.length ? (
        <>
          {tabbed && kind ? (
            <div role="group" aria-label={tl("tabsLabel")} className="mb-4 flex max-w-full gap-0.5 self-start overflow-x-auto rounded-full bg-[var(--wash-strong)]/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-fit">
              {shelves.map((library) => {
                const active = library.kind === kind;
                return (
                  <button
                    key={library.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveKind(library.kind)}
                    className={cx(
                      "inline-flex min-h-9 flex-none cursor-pointer items-center gap-2 rounded-full px-3.5 text-[13px] transition",
                      active ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    <LibraryGlyph source={library.source} className="h-4 w-4" />
                    {libraryName(library)}
                    <span className="text-[11px] opacity-70">{counts[library.kind] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <Rail railRef={railRef} showFade={showFade} onScroll={onScroll}>
            {canManage ? <AddCardTile label={t("catalogAddItem")} onClick={onOpenCatalog} className="aspect-[3/4] w-44 flex-none snap-start self-start" /> : null}
            {visible.map((item) => (
              <CatalogTile
                key={item.id}
                size="sm"
                className="w-44 flex-none snap-start"
                title={item.title}
                year={resolveCoverTop(item, shelf?.coverTopProperty, f)}
                avg={item.ratingAvg}
                badgeHidden={shelf?.coverBadgeHidden}
                ratingLabel={item.ratingAvg === null || item.ratingAvg === undefined ? tCat("notRated") : tCat("ratedAria", { value: item.ratingAvg })}
                caption={[item.scheduledAt ? f.eventWhen(item.scheduledAt) : item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter(Boolean).slice(0, 2).join(" · ")}
                onOpen={() => onOpenItem(item.id)}
              />
            ))}
            {remaining > 0 ? (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="flex aspect-[3/4] w-44 flex-none cursor-pointer snap-start flex-col items-center justify-center gap-1.5 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] transition hover:border-[var(--main-line)]"
              >
                <span className="text-3xl font-light tracking-[-0.04em]">{remaining}</span>
                <span className="px-3 text-center text-xs text-[var(--muted)]">{t("catalogMoreIn", { name: shelf ? libraryName(shelf) : title })}</span>
                <span className="mt-2.5 text-[13px] text-[var(--main-strong)]">{t("catalogSeeAll")} →</span>
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
