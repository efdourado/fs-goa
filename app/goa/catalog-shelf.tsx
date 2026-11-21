"use client";

import { StateButton } from "./state-button";

import { useTranslations } from "next-intl";

import { catalogCardHeight, CatalogTile, useCatalogPropertyText } from "./catalog-views";
import { type CatalogScope, type CatalogShelfData } from "./libraries";
import { Rail, RailArrows, shelfCardWidth, useShelfRail } from "./shelf";
import { ArrowRightIcon, cx, EmptyState } from "./ui";

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

/** The shelf drawn from an answer the page already holds (Home reads it to know whether there's anything at all). */
export function CatalogShelfView({ scope, canManage, onOpenCatalog, data }: {
  scope: CatalogScope;
  canManage: boolean;
  onOpenCatalog: () => void;
  data: CatalogShelfData | null;
}) {
  const t = useTranslations("group");
  const propertyText = useCatalogPropertyText();
  const { railRef, canScroll, showFade, onScroll, nudge } = useShelfRail();
  const personal = scope === "personal";
  const title = personal ? t("myCatalogTitle") : t("catalogTitle");

  // Every library together, newest first.
  const counts = data?.counts ?? {};
  const all = data?.items ?? [];
  const total = Math.max(all.length, Object.values(counts).reduce((sum, count) => sum + count, 0));
  const addedAt = (item: (typeof all)[number]) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = [...all].sort((a, b) => addedAt(b) - addedAt(a) || a.title.localeCompare(b.title));
  const visible = sorted.slice(0, PREVIEW_COUNT);

  if (data === null) return <CatalogShelfSkeleton title={title} />;
  if (!sorted.length && (!personal || !canManage)) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          <span className="text-xs text-[var(--muted)]">{total}</span>
        </div>
        {sorted.length && (personal || canScroll) ? <RailArrows nudge={nudge} /> : null}
      </div>
      {sorted.length ? (
        <>
          <Rail railRef={railRef} showFade={showFade} onScroll={onScroll}>
            {visible.map((item) => (
              <CatalogTile
                key={item.id}
                className={shelfCardWidth}
                title={item.title}
                properties={propertyText(item, data.hiddenProperties?.[item.kind])}
              />
            ))}
            {total > PREVIEW_COUNT ? (
              <StateButton
                type="button"
                onClick={onOpenCatalog}
                className={cx(shelfCardWidth, catalogCardHeight, "flex cursor-pointer items-center gap-3 self-start rounded-[20px] border border-[var(--line)] bg-[var(--paper)] px-4 text-left transition hover:border-[var(--muted)]")}
              >
                <span className="text-2xl font-light tracking-[-0.04em]">{total}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{t("catalogIn", { name: title })}</span>
                <span className="inline-flex flex-none items-center gap-1.5 text-[13px] text-[var(--ink)]">
                  {t("catalogView")}
                  <ArrowRightIcon className="h-3.5 w-3.5 flex-none" />
                </span>
              </StateButton>
            ) : null}
          </Rail>
        </>
      ) : (
        <EmptyState title={t("catalogEmptyTitle")} onClick={onOpenCatalog} />
      )}
    </section>
  );
}
