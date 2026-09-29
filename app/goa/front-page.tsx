"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useGoaFormat } from "./format";
import { challengeShowcaseBlocks } from "./showcase-view";
import type { ChallengeDetail, Id, TemplateSummary } from "./types";
import { buildStory, type Story, type StoryInput } from "./story/model";
import { DatedThread } from "./story/thread-dated";
import { RatedThread } from "./story/thread-rated";
import { storyHeadline, useStoryFigures } from "./story/view";
import { CirclePinIcon, cx } from "./ui";
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

/** A featured story's frame: a large paper card that lifts on hover, like the gallery's smaller cards. */
const storyCardClass =
  "relative flex min-w-0 flex-col rounded-[28px] border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 hover:shadow-[var(--elevate-card)] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25 sm:p-9";

function StorySkeleton() {
  return (
    <div aria-busy="true" className={cx(storyCardClass, "space-y-4")}>
      <span className="block h-3 w-32 animate-pulse rounded bg-[var(--wash-strong)]" />
      <span className="block h-24 animate-pulse rounded-xl bg-[var(--wash)]" />
      <span className="block h-4 w-3/4 animate-pulse rounded bg-[var(--wash)]" />
      <span className="block h-28 animate-pulse rounded-2xl bg-[var(--wash)]" />
    </div>
  );
}

/**
 * One featured template, told the new way: its name, the one-line read of how it went, a small drawing of
 * the whole thing (everyone's line, or everyone's days) and its key numbers — from the same public-safe
 * thread its preview shows (names masked, no words). Falls back to plain facts when there's nothing to draw.
 */
function Story({ template, onOpen }: { template: TemplateSummary; onOpen: (id: Id) => void }) {
  const t = useTranslations("templates");
  const ts = useTranslations("story");
  const f = useGoaFormat();
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

  const input = detail?.publicStory ?? null;
  const story = useMemo(() => (input ? buildStory(input) : null), [input]);
  const drawable = input && story && story.kind !== "empty" ? { input, story } : null;

  if (!detail && !failed) return <StorySkeleton />;

  const dates = detail ? f.dateRange(detail.startsOn, detail.endsOn) : "";
  const kicker = [dates || null, t(`mode.${template.submissionMode}`)].filter(Boolean).join(" · ");
  const facts = [
    template.participantCount ? t("cardPeople", { count: template.participantCount }) : null,
    template.itemCount ? t("cardItems", { count: template.itemCount }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className={storyCardClass}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--main-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--main-strong)]">
          {/* The same filled disc Home uses for a pinned challenge — a featured one is pinned to the front page. */}
          <CirclePinIcon filled className="h-3.5 w-3.5" />
          {t("storyBadge")}
        </span>
        {kicker ? <p className="min-w-0 text-xs text-[var(--muted)]">{kicker}</p> : null}
      </div>
      <h2 className="mt-3 min-w-0 text-4xl font-light leading-[1.1] tracking-[-0.05em] sm:text-5xl">
        <button type="button" onClick={() => onOpen(template.id)} title={template.title} className="line-clamp-2 w-full cursor-pointer break-words text-left hover:underline hover:decoration-1 hover:underline-offset-4 focus-visible:outline-none">
          {template.title}
        </button>
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
        {drawable ? storyHeadline(drawable.story, drawable.input, ts) : template.summary}
      </p>

      {drawable ? (
        <>
          <div className="mt-6 overflow-hidden rounded-[22px] bg-[var(--spotlight)] px-2 pb-3 pt-4 text-[var(--spotlight-ink)]">
            {drawable.story.kind === "rated"
              ? <RatedThread story={drawable.story} input={drawable.input} focus={null} run={0} fit />
              : drawable.story.kind === "dated" ? <DatedThread story={drawable.story} input={drawable.input} focus={null} run={0} fit /> : null}
          </div>
          <StoryFigures story={drawable.story} input={drawable.input} />
        </>
      ) : facts ? (
        <p className="mt-8 text-sm text-[var(--muted)]">{facts}</p>
      ) : null}

      <div className="mt-auto pt-8">
        <button type="button" onClick={() => onOpen(template.id)} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--main-line)] px-4 text-sm text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] focus-visible:outline-none">
          {t("seeResult")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

function StoryFigures({ story, input }: { story: Story; input: StoryInput }) {
  const figures = useStoryFigures(story, input).slice(0, 4);
  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {figures.map((figure) => (
        <div key={figure.label} className="flex min-w-0 flex-col-reverse">
          <dt className="truncate text-xs text-[var(--muted)]">{figure.label}</dt>
          <dd className="text-3xl font-light tabular-nums tracking-[-0.04em]">{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The gallery's front page: the two featured stories side by side, the same size (stacked on a phone). */
export function FrontPageStories({ featured, onOpen }: { featured: TemplateSummary[]; onOpen: (id: Id) => void }) {
  if (!featured.length) return null;
  return (
    <section className="grid gap-5 lg:grid-cols-2">
      {featured.map((template) => <Story key={template.id} template={template} onOpen={onOpen} />)}
    </section>
  );
}
