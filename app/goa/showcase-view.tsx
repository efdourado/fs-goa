"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { MetricBlock } from "./metrics-view";
import { PagedView } from "./paged-view";
import { AffinityBlockView, PersonalRankingsBlock } from "./rankings-view";
import type { AffinityBlock, Metric, PersonalRanking, WrappedBlock } from "./types";
import { cx } from "./ui";
import { metricHasData, metricTheme } from "./utils";

type Translator = ReturnType<typeof useTranslations>;

/** "Ana", "Ana • Bruno", "Ana • Bruno • Caio", "Ana • Bruno • +4". */
export function namesWithBullets(names: string[], max = 6): string {
  if (names.length <= max) return names.join(" • ");
  return [...names.slice(0, max), `+${names.length - max}`].join(" • ");
}

type ShowcaseComment = { id: string; text: string; itemTitle?: string | null };
type SeriesTheme = "ranking" | "debate" | "people";

const CARDS_PER_PAGE = 4;
const SERIES_THEME_ORDER: SeriesTheme[] = ["ranking", "people", "debate"];
const SERIES_PAGE_KEY: Record<SeriesTheme, string> = {
  ranking: "pageSeriesRanking",
  debate: "pageSeriesDebate",
  people: "pageSeriesPeople",
};

type Page =
  | { id: string; title: string; kind: "cards"; metrics: Metric[] }
  | { id: string; title: string; kind: "series"; metrics: Metric[] }
  | { id: string; title: string; kind: "ranking"; rankings: PersonalRanking[] }
  | { id: string; title: string; kind: "affinity"; affinity: AffinityBlock }
  | { id: string; title: string; kind: "comments"; comments: ShowcaseComment[] };

/**
 * Splits the ordered Wrapped blocks into titled pages the reader flips through:
 * the plain numbers as a grid of cards first, then one page per family of
 * breakdowns (rankings, per-person, what split the room), the personal profiles,
 * the affinities and the comments. The summary text block feeds the header;
 * other non-headline prose becomes intro paragraphs.
 */
function buildShowcasePages(blocks: WrappedBlock[], t: Translator): { intro: string[]; pages: Page[]; summary: string | null } {
  const ordered = blocks.filter((block) => block.visible).sort((a, b) => a.position - b.position);

  let summary: string | null = null;
  const intro: string[] = [];
  const scalarMetrics: Metric[] = [];
  const seriesByTheme = new Map<SeriesTheme, Metric[]>();
  const tailPages: Page[] = [];
  let commentBuf: ShowcaseComment[] = [];

  const flushComments = () => {
    if (!commentBuf.length) return;
    tailPages.push({ id: `comments-${tailPages.length}`, title: t("pageComments"), kind: "comments", comments: commentBuf });
    commentBuf = [];
  };

  for (const block of ordered) {
    if (block.kind !== "entry_value" && commentBuf.length) flushComments();
    if (block.kind === "text") {
      if (block.heading === "summary") summary = block.text ?? summary;
      else if (block.heading !== "headline" && block.text) intro.push(block.text);
      continue;
    }
    if (block.kind === "metric" && block.metric && metricHasData(block.metric as unknown as Record<string, unknown>)) {
      if (block.metric.series?.length) {
        const theme = metricTheme(block.metric);
        seriesByTheme.set(theme, [...(seriesByTheme.get(theme) ?? []), block.metric]);
      } else {
        scalarMetrics.push(block.metric);
      }
      continue;
    }
    if (block.kind === "ranking" && (block.ranking?.length ?? 0) > 1) {
      tailPages.push({ id: block.id, title: t("pageRankings"), kind: "ranking", rankings: block.ranking! });
      continue;
    }
    if (block.kind === "affinity" && block.affinity && block.affinity.pairs.length) {
      tailPages.push({ id: block.id, title: t("pageAffinity"), kind: "affinity", affinity: block.affinity });
      continue;
    }
    if (block.kind === "entry_value" && block.comment?.text) {
      commentBuf.push({ id: block.id, text: block.comment.text, itemTitle: block.comment.itemTitle });
    }
  }
  flushComments();

  const pages: Page[] = [];
  for (let index = 0; index < scalarMetrics.length; index += CARDS_PER_PAGE) {
    pages.push({ id: `cards-${index}`, title: t("pageMain"), kind: "cards", metrics: scalarMetrics.slice(index, index + CARDS_PER_PAGE) });
  }
  for (const theme of SERIES_THEME_ORDER) {
    const metrics = seriesByTheme.get(theme);
    if (metrics?.length) pages.push({ id: `series-${theme}`, title: t(SERIES_PAGE_KEY[theme]), kind: "series", metrics });
  }
  pages.push(...tailPages);
  return { intro, pages, summary };
}

/** Whether any visible block would actually render something. */
export function hasShowcaseContent(blocks: WrappedBlock[]): boolean {
  return blocks.some((block) => {
    if (!block.visible) return false;
    if (block.kind === "metric") return Boolean(block.metric) && metricHasData(block.metric as unknown as Record<string, unknown>);
    if (block.kind === "ranking") return (block.ranking?.length ?? 0) > 1;
    if (block.kind === "affinity") return Boolean(block.affinity?.pairs.length);
    if (block.kind === "entry_value") return Boolean(block.comment?.text);
    return false;
  });
}

/**
 * Turns a never-curated round's raw result parts into the same block list the
 * curated path produces, so both render through one component.
 */
export function defaultShowcaseBlocks(input: {
  metrics?: Metric[];
  personalRankings?: PersonalRanking[];
  affinity?: AffinityBlock | null;
  comments?: ShowcaseComment[];
}): WrappedBlock[] {
  const blocks: WrappedBlock[] = [];
  let position = 0;
  const add = (block: Omit<WrappedBlock, "position" | "visible">) =>
    blocks.push({ ...block, position: position++, visible: true } as WrappedBlock);

  for (const metric of (input.metrics ?? []).filter(metricHasData)) add({ id: metric.id, kind: "metric", metric });
  if ((input.personalRankings?.length ?? 0) > 1) add({ id: "rankings", kind: "ranking", ranking: input.personalRankings });
  if (input.affinity && input.affinity.pairs.length) add({ id: "affinity", kind: "affinity", affinity: input.affinity });
  for (const comment of input.comments ?? []) {
    add({ id: comment.id, kind: "entry_value", comment: { id: comment.id, text: comment.text, itemTitle: comment.itemTitle ?? undefined } });
  }
  return blocks;
}

function PageBody({ page, hideThinLabel }: { page: Page; hideThinLabel: boolean }) {
  if (page.kind === "cards") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {page.metrics.map((metric) => <MetricBlock key={metric.id} metric={metric} hideThinLabel={hideThinLabel} />)}
      </div>
    );
  }
  if (page.kind === "series") {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {page.metrics.map((metric) => <MetricBlock key={metric.id} metric={metric} hideThinLabel={hideThinLabel} />)}
      </div>
    );
  }
  if (page.kind === "ranking") {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-7">
        <PersonalRankingsBlock rankings={page.rankings} />
      </div>
    );
  }
  if (page.kind === "affinity") {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-7">
        <AffinityBlockView affinity={page.affinity} />
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {page.comments.map((comment) => (
        <blockquote className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5" key={comment.id}>
          <p className="text-base leading-7">“{comment.text}”</p>
          {comment.itemTitle ? <footer className="mt-3 text-xs font-light text-[var(--muted)]">{comment.itemTitle}</footer> : null}
        </blockquote>
      ))}
    </div>
  );
}

export function ShowcaseView({
  dateRange,
  headline,
  summary,
  participantNames,
  totalEntries,
  blocks,
  variant = "light",
  hideThinLabel = false,
}: {
  dateRange: string;
  headline: string;
  summary?: string | null;
  participantNames: string[];
  totalEntries?: number | null;
  blocks: WrappedBlock[];
  /** `dark` puts the header on the spotlight ground (public page). */
  variant?: "light" | "dark";
  /** Solo / two-person rounds: a thin ranking row shows its value, not "small sample". */
  hideThinLabel?: boolean;
}) {
  const t = useTranslations("wrapped");
  const { intro, pages, summary: builtSummary } = useMemo(() => buildShowcasePages(blocks, t), [blocks, t]);
  const shownSummary = summary || builtSummary;
  const onDark = variant === "dark";
  const hasHeader =
    Boolean(dateRange || headline || shownSummary) || intro.length > 0 || participantNames.length > 0 || Boolean(totalEntries);

  const header = hasHeader ? (
    <header
      className={cx(
        "space-y-4",
        onDark ? "overflow-hidden rounded-[28px] bg-[var(--spotlight)] px-6 py-11 text-[var(--spotlight-ink)] sm:px-11 sm:py-14" : "",
      )}
    >
      {dateRange ? <p className={cx("text-xs tracking-wide", onDark ? "text-white/50" : "text-[var(--muted)]")}>{dateRange}</p> : null}
      {headline ? (
        <h1 className={cx("max-w-4xl font-medium tracking-[-0.05em]", onDark ? "text-4xl leading-[1.02] sm:text-6xl" : "text-3xl leading-tight sm:text-4xl")}>
          {headline}
        </h1>
      ) : null}
      {shownSummary ? (
        <p className={cx("max-w-2xl text-base leading-7", onDark ? "text-white/70" : "text-[var(--muted)]")}>{shownSummary}</p>
      ) : null}
      {intro.map((paragraph, index) => (
        <p key={index} className={cx("max-w-2xl text-sm leading-6", onDark ? "text-white/65" : "text-[var(--muted)]")}>{paragraph}</p>
      ))}
      {participantNames.length || totalEntries ? (
        <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", onDark ? "text-white/70" : "text-[var(--muted)]")}>
          {participantNames.length ? <span>{namesWithBullets(participantNames)}</span> : null}
          {participantNames.length && totalEntries ? <span aria-hidden="true" className="opacity-40">•</span> : null}
          {totalEntries ? <span>{t("totalEntries", { count: totalEntries })}</span> : null}
        </div>
      ) : null}
    </header>
  ) : null;

  return (
    <PagedView
      header={header}
      contentAriaLabel={t("numbersAria")}
      pages={pages.map((page) => ({ id: page.id, title: page.title, body: <PageBody page={page} hideThinLabel={hideThinLabel} /> }))}
    />
  );
}
