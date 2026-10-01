"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useGoaFormat } from "./format";
import { challengeShowcaseBlocks } from "./showcase-view";
import type { ChallengeDetail, Id, TemplateSummary } from "./types";
import { buildStory, type Story, type StoryInput } from "./story/model";
import { firstName, personTone } from "./rating-scale";
import { storyHeadline, useStoryFigures } from "./story/view";
import { coverColors, coverToneOf } from "./catalog-cover";
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
 * One featured template as a newspaper story: kicker, headline, the one-line read of how it went, then a
 * picture made of its results — the podium of its top three (films, books, places) or everyone's
 * consistency (habits) — one standout line, and its numbers on a quiet panel. Built from the same
 * public-safe story the preview shows (names masked, no words), so nothing private reaches the front page.
 */
function Story({ template, onOpen }: { template: TemplateSummary; onOpen: (id: Id) => void }) {
  const t = useTranslations("templates");
  const ts = useTranslations("story");
  const nf = useFormatter();
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
  const drawn = input && story && story.kind !== "empty" ? { input, story } : null;

  if (!detail && !failed) return <StorySkeleton />;

  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const dates = detail ? f.dateRange(detail.startsOn, detail.endsOn) : "";
  const kicker = [dates || null, t(`mode.${template.submissionMode}`)].filter(Boolean).join(" · ");
  // The one line worth reading out loud.
  const standout = !drawn ? null
    : drawn.story.kind === "rated"
      ? drawn.story.duo
        ? ts("duo.mix.line", { total: drawn.story.duo.met.length + drawn.story.duo.aBrought.length + drawn.story.duo.bBrought.length + drawn.story.duo.between, things: ts(`noun.${drawn.input.noun}`, { count: drawn.story.duo.met.length + drawn.story.duo.aBrought.length + drawn.story.duo.bBrought.length + drawn.story.duo.between }), met: drawn.story.duo.met.length, a: firstName(drawn.story.duo.a.name), aCount: drawn.story.duo.aBrought.length, b: firstName(drawn.story.duo.b.name), bCount: drawn.story.duo.bBrought.length })
        : drawn.story.commonGround[0]
          ? ts("common.title", { a: firstName(drawn.story.commonGround[0].a.name), b: firstName(drawn.story.commonGround[0].b.name), genre: drawn.story.commonGround[0].genre })
          : drawn.story.surprises[0] ? ts("surprises.title", { title: drawn.story.surprises[0].item.title }) : null
      : drawn.story.kind === "dated"
        ? (() => { const best = [...drawn.story.lanes].sort((x, y) => (y.longest?.length ?? 0) - (x.longest?.length ?? 0))[0]; return best?.longest ? ts("streaks.title", { name: firstName(best.person.name), count: best.longest.length }) : null; })()
        : null;
  const ids = drawn ? drawn.input.people.map((person) => person.id) : [];

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
        {drawn ? storyHeadline(drawn.story, drawn.input, ts) : template.summary}
      </p>

      {/* The picture: the podium of a rated challenge, everyone's consistency for a habit. */}
      {drawn?.story.kind === "rated" && drawn.story.ranking.length >= 2 ? (
        <ol className="mt-7 grid grid-cols-3 items-end gap-4">
          {[drawn.story.ranking[1], drawn.story.ranking[0], drawn.story.ranking[2]].map((score, index) => score ? (
            <li key={score.item.id} className={cx("flex min-w-0 flex-col items-center text-center", index === 1 ? "" : "pt-6")}>
              <span className="relative w-full" style={{ maxWidth: index === 1 ? "8rem" : "6.5rem" }}>
                <PodiumCover title={score.item.title} year={score.item.year} />
                <span className="absolute -left-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--ink)] text-xs font-medium text-[var(--canvas)]">{index === 1 ? 1 : index === 0 ? 2 : 3}</span>
              </span>
              <span className="mt-2 text-2xl font-light tabular-nums tracking-[-0.03em]">{fmt(score.average)}</span>
            </li>
          ) : <li key={index} />)}
        </ol>
      ) : drawn?.story.kind === "dated" ? (
        <ul className="mt-7 flex flex-wrap gap-5">
          {[...drawn.story.lanes].sort((x, y) => (y.consistency ?? 0) - (x.consistency ?? 0)).slice(0, 5).map((lane) => (
            <li key={lane.person.id} className="flex flex-col items-center gap-1.5">
              <span className="relative grid h-16 w-16 place-items-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--wash-strong)" strokeWidth="2.8" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={personTone(ids, lane.person.id)} strokeWidth="2.8" strokeDasharray={`${lane.consistency ?? 0} 100`} strokeLinecap="round" />
                </svg>
                <span className="text-sm font-medium tabular-nums">{lane.consistency ?? 0}%</span>
              </span>
              <span className="max-w-[5rem] truncate text-xs text-[var(--muted)]">{firstName(lane.person.name)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {standout ? (
        <p className="mt-6 border-l-2 border-[var(--main)] pl-4 text-lg font-light leading-snug">{standout}</p>
      ) : null}

      {drawn ? <StoryFigures story={drawn.story} input={drawn.input} /> : (
        // Still running (or nothing to draw yet): the template's own shape, on the same quiet panel.
        <dl className="mt-7 grid grid-cols-3 gap-x-6 gap-y-4 rounded-2xl bg-[var(--wash)] p-5">
          {[
            { value: template.participantCount, label: t("factPeople", { count: template.participantCount }) },
            { value: template.itemCount, label: t("factItems", { count: template.itemCount }) },
            { value: template.fieldCount, label: t("factFields", { count: template.fieldCount }) },
          ].filter((row) => row.value).map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-xs text-[var(--muted)]">{row.label}</dt>
              <dd className="text-3xl font-light tabular-nums tracking-[-0.04em]">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto pt-8">
        <button type="button" onClick={() => onOpen(template.id)} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--main-line)] px-4 text-sm text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] focus-visible:outline-none">
          {t("seeResult")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

/** A podium cover: the catalogue's tinted tile, its title sized to the tile so a phone never breaks a word. */
function PodiumCover({ title, year }: { title: string; year?: number | null }) {
  return (
    <span className="relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-[18px] bg-[var(--cover-bg)] p-2.5 text-[var(--cover-ink)] shadow-[var(--elevate-card)] sm:p-3.5" style={coverColors(coverToneOf(title))}>
      <span aria-hidden="true" className="absolute -bottom-10 -right-10 h-28 w-28 rounded-full border-[16px] border-[var(--cover-deco)]" />
      <span className="relative text-[9px] tracking-[0.08em] sm:text-[10px]" style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year ?? "\u00a0"}</span>
      <span className="relative mt-1.5 line-clamp-4 hyphens-auto text-[13px] font-light leading-[1.08] tracking-[-0.02em] [overflow-wrap:anywhere] sm:mt-2 sm:text-[19px] sm:[overflow-wrap:normal]" lang="en">{title}</span>
    </span>
  );
}

/** The story's numbers on the quiet panel the front page always used. */
function StoryFigures({ story, input }: { story: Story; input: StoryInput }) {
  const figures = useStoryFigures(story, input).slice(0, 4);
  return (
    <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-[var(--wash)] p-5 sm:grid-cols-4">
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
