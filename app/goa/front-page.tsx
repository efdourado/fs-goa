"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useGoaFormat } from "./format";
import { challengeShowcaseBlocks } from "./showcase-view";
import type { ChallengeDetail, Id, TemplateSummary } from "./types";
import { CommentText, cx } from "./ui";
import { metricHasData } from "./utils";

// ── picking and excerpting (pure, unit-tested) ─────────────────────────────

/**
 * The two stories that lead the gallery: what a platform admin featured, most recent first, topped up with the
 * newest templates when fewer than two are featured. Everything else is the "more" grid, in the gallery's order.
 */
export function pickFrontPage(templates: TemplateSummary[], count = 2): { featured: TemplateSummary[]; rest: TemplateSummary[] } {
  const picked = templates
    .filter((template) => template.featuredAt)
    .sort((a, b) => (b.featuredAt ?? "").localeCompare(a.featuredAt ?? ""))
    .slice(0, count);
  for (const template of templates) {
    if (picked.length >= count) break;
    if (!picked.includes(template)) picked.push(template);
  }
  return { featured: picked, rest: templates.filter((template) => !picked.includes(template)) };
}

export interface StoryStat {
  label: string;
  value: string;
  /** The number under a winner (its score, a pair's affinity, a critic's average). */
  note?: string | null;
}

export interface StoryLabels {
  inTune: string;
  critic: string;
  criticNote: (average: string) => string;
  fmt: (value: number) => string;
}

/**
 * What a story shows of a template's Results without opening it — the parts that tell a story, not bookkeeping:
 * a ranking's winner first, then the most in-tune pair (affinity) and the toughest critic (per-person rankings),
 * then the other winners, and plain numbers only to fill what's left. The completion rate never shows. Plus the
 * first curated comment. Only what the showcase itself shows (visible blocks, in order).
 */
export function storyExcerpt(
  challenge: ChallengeDetail,
  maxStats: number,
  labels: StoryLabels,
): { stats: StoryStat[]; quote: { text: string; itemTitle?: string | null } | null } {
  const blocks = challengeShowcaseBlocks(challenge).filter((block) => block.visible).sort((a, b) => a.position - b.position);
  const itemWinners: StoryStat[] = [];
  const winners: StoryStat[] = [];
  const people: StoryStat[] = [];
  const scalars: StoryStat[] = [];
  let quote: { text: string; itemTitle?: string | null } | null = null;
  for (const block of blocks) {
    const metric = block.metric;
    if (block.kind === "metric" && metric && metricHasData(metric as unknown as Record<string, unknown>)) {
      if (metric.series?.length) {
        // A week-by-week series is a timeline, not a ranking — its first row isn't a winner.
        const top = metric.groupBy === "checkpoint" ? null : metric.series.find((entry) => entry.value !== null);
        const stat = top ? { label: metric.label, value: top.label, note: top.formattedValue ?? String(top.value) } : null;
        // Items ranked against each other (the best film, the favourite book) lead; other breakdowns follow.
        if (stat) (metric.groupBy === "item" ? itemWinners : winners).push(stat);
      } else if (metric.operation !== "completion_rate") {
        scalars.push({ label: metric.label, value: String(metric.formattedValue ?? metric.value ?? "—") });
      }
    }
    if (block.kind === "affinity" && block.affinity) {
      const best = block.affinity.pairs
        .filter((pair) => pair.direct !== null)
        .sort((a, b) => (b.direct ?? 0) - (a.direct ?? 0))[0];
      if (best) people.push({ label: labels.inTune, value: `${best.a.name} & ${best.b.name}`, note: labels.fmt(best.direct!) });
    }
    if (block.kind === "ranking" && (block.ranking?.length ?? 0) > 1) {
      const critic = block.ranking!
        .filter((person) => person.ratingsMean !== null)
        .sort((a, b) => (a.ratingsMean ?? 0) - (b.ratingsMean ?? 0))[0];
      if (critic) people.push({ label: labels.critic, value: critic.name, note: labels.criticNote(labels.fmt(critic.ratingsMean!)) });
    }
    if (!quote && block.kind === "entry_value" && block.comment?.text) quote = { text: block.comment.text, itemTitle: block.comment.itemTitle };
  }
  const ranked = [...itemWinners, ...winners];
  const stats = [...ranked.slice(0, 1), ...people, ...ranked.slice(1), ...scalars].slice(0, maxStats);
  return { stats, quote };
}

// ── the stories ─────────────────────────────────────────────────────────

function StorySkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="block h-3 w-32 animate-pulse rounded bg-[var(--wash-strong)]" />
      <span className="block h-24 animate-pulse rounded-xl bg-[var(--wash)]" />
      <span className="block h-4 w-3/4 animate-pulse rounded bg-[var(--wash)]" />
      <span className="block h-28 animate-pulse rounded-2xl bg-[var(--wash)]" />
    </div>
  );
}

/** One featured template, laid out like a newspaper story: kicker, headline, lede, its numbers and a quote. */
function Story({ template, onOpen }: { template: TemplateSummary; onOpen: (id: Id) => void }) {
  const t = useTranslations("templates");
  const f = useGoaFormat();
  const locale = useLocale();
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ChallengeDetail>(API_PATHS.template(template.id), { signal: controller.signal })
      .then(setDetail)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [template.id]);

  if (!detail && !failed) return <StorySkeleton />;

  const headline = detail?.result?.headline || template.title;
  const lede = detail?.result?.summary || template.summary;
  const labels: StoryLabels = {
    inTune: t("storyInTune"),
    critic: t("storyCritic"),
    criticNote: (average) => t("storyCriticNote", { average }),
    fmt: (value) => value.toLocaleString(locale, { maximumFractionDigits: 2 }),
  };
  const { stats, quote } = detail ? storyExcerpt(detail, 3, labels) : { stats: [], quote: null };
  const dates = detail ? f.dateRange(detail.startsOn, detail.endsOn) : "";
  const kicker = [headline !== template.title ? template.title : null, dates || null, t(`mode.${template.submissionMode}`)].filter(Boolean).join(" · ");
  const facts = [
    template.participantCount ? t("cardPeople", { count: template.participantCount }) : null,
    template.itemCount ? t("cardItems", { count: template.itemCount }) : null,
    template.metricCount ? t("cardMetrics", { count: template.metricCount }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className="flex min-w-0 flex-col">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{kicker}</p>
      <h2 className="mt-3 text-4xl font-light leading-[1.02] tracking-[-0.05em] sm:text-5xl">
        <button type="button" onClick={() => onOpen(template.id)} className="cursor-pointer text-left hover:underline hover:decoration-1 hover:underline-offset-4 focus-visible:outline-none">
          {headline}
        </button>
      </h2>
      {lede ? <p className="mt-4 line-clamp-4 max-w-2xl text-base leading-7 text-[var(--muted)]">{lede}</p> : null}

      {stats.length ? (
        <dl className={cx("mt-8 grid gap-x-6 gap-y-5", stats.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dd className={cx("font-medium tracking-[-0.04em] tabular-nums", stat.note ? "line-clamp-2 text-xl leading-tight" : "text-4xl")}>{stat.value}</dd>
              {stat.note ? <dd className="mt-0.5 text-sm tabular-nums text-[var(--main-strong)]">{stat.note}</dd> : null}
              <dt className="mt-1 text-xs leading-5 text-[var(--muted)]">{stat.label}</dt>
            </div>
          ))}
        </dl>
      ) : facts ? (
        <p className="mt-8 text-sm text-[var(--muted)]">{facts}</p>
      ) : null}

      {quote ? (
        <figure className="mt-6 border-l-2 border-[var(--main)] pl-4">
          <div className="line-clamp-4 overflow-hidden">
            <CommentText text={quote.text} className="text-lg font-light" />
          </div>
          {quote.itemTitle ? <figcaption className="mt-2 text-xs text-[var(--muted)]">{quote.itemTitle}</figcaption> : null}
        </figure>
      ) : null}

      <div className="mt-6">
        <button type="button" onClick={() => onOpen(template.id)} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-sm text-[var(--main-strong)] hover:underline hover:underline-offset-4">
          {t("seeResult")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

/** The gallery's front page: the two featured stories side by side, the same size (stacked on a phone). */
export function FrontPageStories({ featured, onOpen }: { featured: TemplateSummary[]; onOpen: (id: Id) => void }) {
  if (!featured.length) return null;
  return (
    <section className="border-t-2 border-[var(--ink)] pt-8">
      <div className="grid gap-10 lg:grid-cols-2">
        {featured.map((template, index) => (
          <div key={template.id} className={cx(index > 0 && "border-t border-[var(--line)] pt-10 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0")}>
            <Story template={template} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </section>
  );
}
