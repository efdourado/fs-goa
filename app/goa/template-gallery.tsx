"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { FrontPageStories, pickFrontPage } from "./front-page";
import { useGoaFormat } from "./format";
import type { Id, TemplateSummary } from "./types";
import { EmptyState, StatusMessage } from "./ui";

type MoreHeadingLevel = "h2" | "h3";

function TemplateGallery({ templates, onOpen, moreHeadingLevel }: { templates: TemplateSummary[]; onOpen: (id: Id) => void; moreHeadingLevel: MoreHeadingLevel }) {
  const t = useTranslations("templates");
  const front = pickFrontPage(templates);
  const MoreHeading = moreHeadingLevel;

  return (
    <>
      <FrontPageStories featured={front.featured} onOpen={onOpen} />
      {front.rest.length ? (
        <MoreHeading className="mb-4 mt-10 border-t border-[var(--line)] pt-5 text-lg font-medium tracking-[-0.03em] sm:mb-5 sm:mt-14 sm:pt-6 sm:text-xl">{t("moreTitle")}</MoreHeading>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {front.rest.map((template) => (
          <article
            key={template.id}
            className="relative flex flex-col overflow-hidden rounded-[20px] border border-[var(--main-line)] bg-[var(--paper)] shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25"
          >
            <div className="flex flex-1 flex-col p-3.5 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-block h-2.5 w-2.5 flex-none rounded-full bg-[var(--main-line)] ring-1 ring-inset ring-[var(--edge)]" aria-hidden="true" />
                <span className="truncate text-[11px] text-[var(--muted)] sm:text-xs">{t(`mode.${template.submissionMode}`)}</span>
              </div>
              <h3 className="mt-3 text-base font-light leading-tight tracking-[-0.03em] sm:mt-5 sm:text-2xl sm:tracking-[-0.04em]">
                <button type="button" title={template.title} className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none" onClick={() => onOpen(template.id)}>{template.title}</button>
              </h3>
              {template.summary ? <p className="mt-2 hidden text-sm leading-6 text-[var(--muted)] sm:line-clamp-2">{template.summary}</p> : null}
              <p className="mt-4 hidden text-xs text-[var(--muted)] sm:block">
                {[
                  template.participantCount ? t("cardPeople", { count: template.participantCount }) : null,
                  template.ruleCount ? t("cardRules", { count: template.ruleCount }) : null,
                  template.fieldCount ? t("cardFields", { count: template.fieldCount }) : null,
                  template.itemCount ? t("cardItems", { count: template.itemCount }) : null,
                  template.metricCount ? t("cardMetrics", { count: template.metricCount }) : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="block w-full bg-[var(--main-line)] px-5 py-1.5 sm:py-3.5" aria-hidden="true" />
          </article>
        ))}
      </div>
    </>
  );
}

/** The published gallery's loading, error and empty states, shared by its full page and the new-account Home. */
export function PublishedTemplates({ onOpen, onEmpty, moreHeadingLevel = "h2" }: { onOpen: (id: Id) => void; onEmpty?: () => void; moreHeadingLevel?: MoreHeadingLevel }) {
  const t = useTranslations("templates");
  const f = useGoaFormat();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ templates: TemplateSummary[] }>(API_PATHS.templates, { signal: controller.signal })
      .then((response) => {
        setTemplates(response.templates);
        if (!response.templates.length) onEmpty?.();
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(f.error(cause));
      });
    return () => controller.abort();
    // Fetch once for this mounted gallery; callback/formatter identity must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="mt-2"><StatusMessage error={error} /></div>
      {templates === null ? (
        <p className="mt-6 text-sm text-[var(--muted)]" role="status">{t("loading")}</p>
      ) : templates.length === 0 ? (
        <EmptyState title={t("emptyTitle")} />
      ) : (
        <TemplateGallery templates={templates} onOpen={onOpen} moreHeadingLevel={moreHeadingLevel} />
      )}
    </>
  );
}

/** The ready-made templates shown only below Home's truly empty state. */
export function ReadyMadeTemplatesSection({ onOpen }: { onOpen: (id: Id) => void }) {
  const t = useTranslations("templates");
  return (
    <section className="mt-12 border-t border-[var(--line)] pt-8 sm:mt-16 sm:pt-10" aria-labelledby="ready-made-templates-title">
      <h2 id="ready-made-templates-title" className="mb-6 text-2xl font-light tracking-[-0.04em] sm:text-3xl">{t("title")}</h2>
      <PublishedTemplates onOpen={onOpen} moreHeadingLevel="h3" />
    </section>
  );
}
