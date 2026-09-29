"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id, Metric } from "../types";
import { cx } from "../ui";
import { useAlmanacPages } from "./almanac";
import type { Story, StoryInput } from "./model";
import { DatedThread } from "./thread-dated";
import { RatedThread } from "./thread-rated";

/** The numbers under "The thread": people, titles, ratings, time, comments (or days, check-ins, total). */
export function useStoryFigures(story: Story, input: StoryInput): Array<{ value: string; label: string }> {
  const t = useTranslations("story");
  const f = useFormatter();
  if (story.kind === "rated") {
    return [
      { value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) },
      { value: f.number(story.totals.items), label: t(`figures.${input.noun}`, { count: story.totals.items }) },
      { value: f.number(story.totals.ratings), label: t("figures.ratings", { count: story.totals.ratings }) },
      ...(story.totals.minutes ? [{ value: `${Math.round(story.totals.minutes / 60)} h`, label: t("figures.together") }] : []),
      ...(story.totals.comments ? [{ value: f.number(story.totals.comments), label: t("figures.comments", { count: story.totals.comments }) }] : []),
    ];
  }
  if (story.kind === "dated") {
    return [
      { value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) },
      { value: f.number(story.totals.days), label: t("figures.days", { count: story.totals.days }) },
      { value: f.number(story.totals.checkins), label: t("figures.checkins", { count: story.totals.checkins }) },
      ...(story.totals.total !== null ? [{ value: f.number(story.totals.total), label: input.counter?.unit || input.counter?.label || "" }] : []),
    ];
  }
  return [];
}

export function storyHeadline(story: Story, input: StoryInput, t: ReturnType<typeof useTranslations>): string {
  if (story.kind === "rated") return t(`mood.${input.people.length > 1 ? story.mood : "solo"}`);
  if (story.kind === "dated") return t("datedHeadline", { count: story.lanes.length });
  return "";
}

/**
 * The drawing: "The thread" as the heading (the challenge's own name is already right above it), the
 * numbers, a legend to follow one person, and everyone's line. `fit` squeezes it into its box instead of
 * scrolling — the downloadable page has no scrollbar.
 */
export function ThreadPanel({ input, story, fit = false, interactive = true }: { input: StoryInput; story: Story; fit?: boolean; interactive?: boolean }) {
  const t = useTranslations("story");
  const figures = useStoryFigures(story, input);
  const [focus, setFocus] = useState<Id | null>(null);
  const [run, setRun] = useState(0);
  if (story.kind === "empty") return null;
  const ids = input.people.map((person) => person.id);
  const people = story.kind === "rated" ? story.threads.map((thread) => thread.person) : story.lanes.map((lane) => lane.person);
  return (
    <div className="overflow-hidden rounded-[28px] bg-[var(--spotlight)] text-[var(--spotlight-ink)]">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <div className="min-w-0">
          <h2 className="text-3xl font-light leading-[1.02] tracking-[-0.05em] sm:text-5xl">{t("title")}</h2>
          <p className="mt-2 text-sm text-white/65">{storyHeadline(story, input, t)}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col-reverse">
              <dt className="text-[11px] text-white/50">{figure.label}</dt>
              <dd className="text-2xl font-light tabular-nums tracking-[-0.03em]">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-3 sm:px-8">
        {people.map((person) => (
          <button
            key={person.id}
            type="button"
            disabled={!interactive}
            onClick={() => setFocus((current) => (current === person.id ? null : person.id))}
            aria-pressed={focus === person.id}
            className={cx("flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs transition", interactive && "cursor-pointer", focus === person.id ? "bg-white/20" : "bg-white/[0.06] hover:bg-white/10", focus !== null && focus !== person.id && "opacity-50")}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: personTone(ids, person.id) }}>{initialsOf(person.name)}</span>
            {firstName(person.name)}
          </button>
        ))}
        <span className="flex-1" />
        {interactive ? <button type="button" className="cursor-pointer text-xs text-white/60 hover:text-white" onClick={() => { setFocus(null); setRun((value) => value + 1); }}>↺ {t("redraw")}</button> : null}
      </div>

      <div className="px-2 pb-5 sm:px-5">
        {story.kind === "rated"
          ? <RatedThread story={story} input={input} focus={focus} run={run} fit={fit} />
          : <DatedThread story={story} input={input} focus={focus} run={run} fit={fit} />}
      </div>
      <p className="px-5 pb-5 text-[11px] text-white/45 sm:px-8">{story.kind === "rated" ? t("readRated") : t("readDated")}</p>
    </div>
  );
}

/**
 * "The thread" of a challenge on screen: the drawing, then the almanac as a few pages of plainly organised
 * facts — no cards, no per-block buttons. Downloading lives next to "Download PDF" (see `pages.tsx`).
 */
export function StoryView({ input, story, metrics = [] }: { input: StoryInput; story: Story; metrics?: Metric[] }) {
  const pages = useAlmanacPages(story, input, metrics);
  if (story.kind === "empty") return null;
  return (
    <section>
      <ThreadPanel input={input} story={story} />
      <div className="mt-4 space-y-4 px-1">
        {pages.map((page) => (
          <section key={page.id} className="border-t border-[var(--line)] pb-6 pt-8 first:border-t-0">
            <h3 className="text-2xl font-light tracking-[-0.03em]">{page.title}</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">{page.headline}</p>
            <div className="mt-6">{page.body}</div>
          </section>
        ))}
      </div>
    </section>
  );
}
