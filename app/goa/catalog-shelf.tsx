"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AddCardTile } from "./add-tile";
import { API_PATHS, apiRequest } from "./api";
import { CatalogTile } from "./catalog-views";
import { useGoaFormat } from "./format";
import { type CatalogScope, LibraryGlyph, useCatalogLibraries, useLibraryName } from "./libraries";
import { Rail, RailArrows, useShelfRail } from "./shelf";
import type { CatalogItem, Id } from "./types";
import { cx, EmptyState } from "./ui";
import { formatRuntime } from "./utils";

/** A page shows only the head of the catalogue; the rest is one tap away. */
const PREVIEW_COUNT = 10;

/**
 * The catalogue as a preview on a page: the newest items of one library as a rail of covers, with the
 * libraries as tabs when more than one has items, an "Add item" tile, and a "N more" tile at the end.
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
  const { data: libraries } = useCatalogLibraries(scope);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const { railRef, showFade, onScroll, nudge } = useShelfRail();
  const scopeId = scope === "personal" ? "personal" : scope.groupId;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.catalogWorkspace(scope).list, { signal: controller.signal })
      .then((response) => setItems(response.items))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems([]);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);

  // Each library is its own shelf — one sorted list never mixes them.
  const all = items ?? [];
  const shelves = (libraries ?? []).filter((library) => all.some((item) => item.kind === library.kind));
  const tabbed = shelves.length > 1;
  const kind = activeKind && shelves.some((library) => library.kind === activeKind) ? activeKind : shelves[0]?.kind ?? null;
  const addedAt = (item: CatalogItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = all
    .filter((item) => !tabbed || item.kind === kind)
    .sort((a, b) => addedAt(b) - addedAt(a) || a.title.localeCompare(b.title));
  const visible = sorted.slice(0, PREVIEW_COUNT);
  const shelf = shelves.find((library) => library.kind === kind) ?? null;

  if (items === null || (!sorted.length && !canManage)) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <button type="button" onClick={onOpenCatalog} className="cursor-pointer text-lg font-semibold tracking-[-0.02em] hover:underline">
            {t("catalogTitle")}
          </button>
          <span className="text-xs text-[var(--muted)]">{all.length}</span>
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
                    <span className="text-[11px] opacity-70">{all.filter((item) => item.kind === library.kind).length}</span>
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
                year={item.year}
                avg={item.ratingAvg}
                ratingLabel={item.ratingAvg === null || item.ratingAvg === undefined ? tCat("notRated") : tCat("ratedAria", { value: item.ratingAvg })}
                caption={[item.scheduledAt ? f.eventWhen(item.scheduledAt) : item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter(Boolean).slice(0, 2).join(" · ")}
                onOpen={() => onOpenItem(item.id)}
              />
            ))}
            {sorted.length > visible.length ? (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="flex aspect-[3/4] w-44 flex-none cursor-pointer snap-start flex-col items-center justify-center gap-1.5 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] transition hover:border-[var(--main-line)]"
              >
                <span className="text-3xl font-light tracking-[-0.04em]">{sorted.length - visible.length}</span>
                <span className="px-3 text-center text-xs text-[var(--muted)]">{t("catalogMoreIn", { name: shelf ? libraryName(shelf) : t("catalogTitle") })}</span>
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
