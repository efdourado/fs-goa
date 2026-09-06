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
 * A header plus a stack of titled pages the reader flips through with a small
 * paginator (‹ ● ○ ○ ›). Server render — and any client before hydration —
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
    "grid size-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] transition enabled:hover:text-[var(--ink)] disabled:opacity-35";

  return (
    <div className="space-y-6">
      {header}
      {pages.length ? (
        <div className="space-y-4" aria-label={contentAriaLabel}>
          {pages.map((pageItem, index) => (
            <section key={pageItem.id} className="space-y-4" hidden={paged && index !== bounded}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-medium tracking-[-0.02em]">{pageItem.title}</h2>
                {paged && pages.length > 1 ? (
                  <span className="flex-none text-xs text-[var(--muted)]">
                    {t("pageOf", { current: index + 1, total: pages.length })}
                  </span>
                ) : null}
              </div>
              {pageItem.body}
            </section>
          ))}

          {paged && pages.length > 1 ? (
            <nav className="flex items-center justify-center gap-3 pt-2" aria-label={t("pages")}>
              <button type="button" className={arrow} onClick={() => setPage(bounded - 1)} disabled={bounded === 0} aria-label={t("prev")}>‹</button>
              <div className="flex items-center gap-1.5">
                {pages.map((pageItem, index) => (
                  <button
                    key={pageItem.id}
                    type="button"
                    aria-label={t("goToPage", { n: index + 1 })}
                    aria-current={index === bounded ? "true" : undefined}
                    onClick={() => setPage(index)}
                    className={cx("size-2 rounded-full transition", index === bounded ? "bg-[var(--ink)]" : "bg-[var(--line)] hover:bg-[var(--muted)]")}
                  />
                ))}
              </div>
              <button type="button" className={arrow} onClick={() => setPage(bounded + 1)} disabled={bounded === pages.length - 1} aria-label={t("next")}>›</button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
