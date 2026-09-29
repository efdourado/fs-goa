"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Id } from "../types";
import { cx } from "../ui";
import { DatedAlmanac, RatedAlmanac } from "./almanac";
import { downloadNode } from "./download";
import type { Story, StoryInput } from "./model";
import { DatedThread } from "./thread-dated";
import { RatedThread } from "./thread-rated";

/**
 * "The thread" of a challenge: the drawing on top (everyone's line through it), the almanac underneath
 * (every fact the data can back), and a poster download of the whole thing. It is a page you look at and
 * scroll, not a slideshow — the same view in the app's Results tab and in the public demo.
 */
export function StoryView({ input, story, label, footer }: { input: StoryInput; story: Story; label?: string; footer?: ReactNode }) {
  const t = useTranslations("story");
  const f = useFormatter();
  const posterRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Id | null>(null);
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  if (story.kind === "empty") return null;
  const ids = input.people.map((person) => person.id);
  const people = story.kind === "rated" ? story.threads.map((thread) => thread.person) : story.lanes.map((lane) => lane.person);

  const figures: Array<{ value: string; label: string }> = story.kind === "rated"
    ? [
        { value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) },
        { value: f.number(story.totals.items), label: t(`figures.${input.noun}`, { count: story.totals.items }) },
        { value: f.number(story.totals.ratings), label: t("figures.ratings", { count: story.totals.ratings }) },
        ...(story.totals.minutes ? [{ value: `${Math.round(story.totals.minutes / 60)} h`, label: t("figures.together") }] : []),
        ...(story.totals.comments ? [{ value: f.number(story.totals.comments), label: t("figures.comments", { count: story.totals.comments }) }] : []),
      ]
    : [
        { value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) },
        { value: f.number(story.totals.days), label: t("figures.days", { count: story.totals.days }) },
        { value: f.number(story.totals.checkins), label: t("figures.checkins", { count: story.totals.checkins }) },
        ...(story.totals.total !== null ? [{ value: f.number(story.totals.total), label: input.counter?.unit || input.counter?.label || "" }] : []),
      ];
  const headline = story.kind === "rated" ? t(`mood.${input.people.length > 1 ? story.mood : "solo"}`) : t("datedHeadline", { count: story.lanes.length });

  return (
    <section className="space-y-4">
      <div ref={posterRef} className="space-y-4 rounded-[30px] bg-[var(--canvas)] p-0">
        {/* The drawing. */}
        <div className="overflow-hidden rounded-[28px] bg-[var(--spotlight)] text-[var(--spotlight-ink)]">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--main-2)]">{label ? `${label} · ` : ""}{t("eyebrow")}</p>
              <h2 className="mt-2 text-3xl font-light leading-[1.02] tracking-[-0.05em] sm:text-5xl">{input.title}</h2>
              <p className="mt-2 text-sm text-white/65">{headline}</p>
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {figures.map((figure) => (
                <div key={figure.label}>
                  <dt className="sr-only">{figure.label}</dt>
                  <dd className="text-2xl font-light tabular-nums tracking-[-0.03em]">{figure.value}</dd>
                  <dd className="text-[11px] text-white/50">{figure.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Legend: tap a name to follow one line. */}
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-3 sm:px-8" data-story-skip-legend="">
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setFocus((current) => (current === person.id ? null : person.id))}
                aria-pressed={focus === person.id}
                className={cx("flex cursor-pointer items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs transition", focus === person.id ? "bg-white/20" : "bg-white/[0.06] hover:bg-white/10", focus !== null && focus !== person.id && "opacity-50")}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: personTone(ids, person.id) }}>{initialsOf(person.name)}</span>
                {firstName(person.name)}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" data-story-skip="" className="cursor-pointer text-xs text-white/60 hover:text-white" onClick={() => { setFocus(null); setRun((value) => value + 1); }}>↺ {t("redraw")}</button>
          </div>

          <div className="px-2 pb-5 sm:px-5">
            {story.kind === "rated"
              ? <RatedThread story={story} input={input} focus={focus} run={run} />
              : <DatedThread story={story} input={input} focus={focus} run={run} />}
          </div>
          <p className="px-5 pb-5 text-[11px] text-white/45 sm:px-8">{story.kind === "rated" ? t("readRated") : t("readDated")}</p>
        </div>

        {/* The almanac. */}
        <div className="flex items-baseline justify-between gap-3 px-1 pt-4">
          <h3 className="text-xl font-medium tracking-[-0.03em]">{t("almanac")}</h3>
          <span className="text-xs text-[var(--muted)]">{t("almanacNote")}</span>
        </div>
        {story.kind === "rated" ? <RatedAlmanac story={story} input={input} /> : <DatedAlmanac story={story} input={input} />}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { if (!posterRef.current) return; setBusy(true); try { await downloadNode(posterRef.current, `${input.title} — goa`); } finally { setBusy(false); } }}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-[var(--ink)] px-5 text-sm font-medium text-[var(--canvas)] transition hover:opacity-90 disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {busy ? t("downloading") : t("downloadPoster")}
        </button>
        <span className="text-xs text-[var(--muted)]">{t("downloadHint")}</span>
        {footer}
      </div>
    </section>
  );
}
