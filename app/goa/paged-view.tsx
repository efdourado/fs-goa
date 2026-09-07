"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { cx } from "./ui";

export interface PagedPage {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * A header plus a stack of titled pages the reader flips through with named section links and a
 * previous/next paginator. Server render — and any client before hydration —
 * shows every page stacked with its heading; once mounted it collapses to one
 * page at a time. So there is no content behind JavaScript, and a static render
 * (tests, crawlers) sees everything.
 *
 * Used by the challenge showcase and the template detail page.
 */
export function PagedView({
  header,
  pages,
  initialPage = 0,
  contentAriaLabel,
}: {
  header?: ReactNode;
  pages: PagedPage[];
  initialPage?: number;
  contentAriaLabel?: string;
}) {
  const t = useTranslations("paginator");
  const [page, setPage] = useState(initialPage);
  const [paged, setPaged] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration flag
  useEffect(() => setPaged(true), []);
  const bounded = Math.min(page, Math.max(0, pages.length - 1));

  const arrow =
    "grid size-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] transition enabled:hover:text-[var(--ink)] disabled:opacity-35";

  return (
    <div className="space-y-6">
      {header}
      {pages.length ? (
        <div className="space-y-4" aria-label={contentAriaLabel}>
          {paged && pages.length > 1 ? <nav className="flex gap-2 overflow-x-auto border-b border-[var(--line)] pb-3" aria-label={t("pages")}>
            {pages.map((item, index) => <button key={item.id} type="button" aria-current={bounded === index ? "page" : undefined} onClick={() => setPage(index)} className={cx("min-h-11 shrink-0 rounded-xl px-4 text-sm transition", bounded === index ? "bg-[var(--ink)] text-[var(--canvas)]" : "text-[var(--muted)] hover:bg-[var(--wash)]")}>{item.title}</button>)}
          </nav> : null}
          {pages.map((pageItem, index) => (
            <section key={pageItem.id} className="space-y-4" aria-labelledby={`${pageItem.id}-title`} hidden={paged && index !== bounded}>
              {/* The heading is the section label for SSR, no-JS and screen
                  readers; once the pill-nav above is doing that job visually it
                  drops to sr-only. */}
              <h2
                id={`${pageItem.id}-title`}
                className={cx(
                  "text-lg font-medium tracking-[-0.02em]",
                  paged && pages.length > 1 ? "sr-only" : "",
                )}
              >
                {pageItem.title}
              </h2>
              {pageItem.body}
            </section>
          ))}

          {paged && pages.length > 1 ? (
            <nav className="flex items-center justify-center gap-3 pt-2" aria-label={t("pages")}>
              <button type="button" className={arrow} onClick={() => setPage(bounded - 1)} disabled={bounded === 0} aria-label={t("prev")}>‹</button>
              <span className="text-xs tabular-nums text-[var(--muted)]">{t("pageOf", { current: bounded + 1, total: pages.length })}</span>
              <button type="button" className={arrow} onClick={() => setPage(bounded + 1)} disabled={bounded === pages.length - 1} aria-label={t("next")}>›</button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
