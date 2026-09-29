"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useMemo, useState } from "react";

import { firstName, initialsOf, landedAfter, personTone, RatingScale } from "../rating-scale";
import { SettingsMenu } from "../SettingsMenu";
import { dateKeyInSaoPaulo } from "../utils";
import { TitleChip } from "./almanac";
import { DEMO_REVEAL_ITEM, demoFilmInput, demoReadingInput } from "./demo-data";
import { buildStory } from "./model";
import { StoryView } from "./view";

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * The public demo (`/demo`): two invented groups, clearly labelled, that anyone can try without an
 * account. First a movie club — tap Reveal, watch five sealed ratings land, then read the whole season as
 * one drawing and its almanac. Then a reading habit — a month of four friends' days. It ends by pointing at
 * doing the same with your own group.
 */
export function DemoExperience() {
  const t = useTranslations("demo");
  const tr = useTranslations("reveal");
  const nf = useFormatter();
  const today = useMemo(() => dateKeyInSaoPaulo(new Date()), []);
  const films = useMemo(() => demoFilmInput(t("clubName"), (key) => t(`comments.${key}`), today), [t, today]);
  const reading = useMemo(() => demoReadingInput(t("readingName"), (key) => t(`notes.${key}`), today, t("pagesLabel")), [t, today]);
  const filmStory = useMemo(() => buildStory(films), [films]);
  const readingStory = useMemo(() => buildStory(reading), [reading]);
  const [revealed, setRevealed] = useState(false);
  const [run, setRun] = useState(0);
  const ids = films.people.map((person) => person.id);
  const film = films.items.find((item) => item.id === DEMO_REVEAL_ITEM)!;
  const ratings = films.ratings.filter((rating) => rating.itemId === DEMO_REVEAL_ITEM);
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const nameOf = (id: string) => films.people.find((person) => person.id === id)?.name ?? "";
  const afterDrops = landedAfter(ratings.length);

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
        <div className="mb-10 flex items-center justify-between gap-3">
          <Link className="inline-flex min-h-11 items-center gap-2 font-light" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-[var(--canvas)]">g</span>
            goa
          </Link>
          <SettingsMenu />
        </div>

        <div className="max-w-3xl">
          <span className="inline-flex rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">{t("badge")}</span>
          <h1 className="mt-4 text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">{t("body")}</p>
        </div>

        {/* 1 — one sealed film, revealed by the visitor. */}
        <p className="mt-12 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--main)]">{t("step1")}</p>
        <section key={run} className="mt-3 max-w-3xl overflow-hidden rounded-[28px] bg-[var(--spotlight)] p-5 text-[var(--spotlight-ink)] sm:p-8">
          <div className="flex items-center gap-4">
            <TitleChip title={film.title} year={film.year} className="w-14 flex-none" />
            <h2 className="text-2xl font-light tracking-[-0.03em]">{film.title}</h2>
          </div>
          {!revealed ? (
            <>
              <ul className="mt-6 flex flex-wrap gap-2.5">
                {films.people.map((person) => (
                  <li key={person.id} className="flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-3 text-xs text-white/85">
                    <span className="reveal-sealed grid h-8 w-8 place-items-center rounded-full bg-[var(--spotlight-ink)] text-[var(--spotlight)]">
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" strokeLinecap="round" /></svg>
                    </span>
                    {person.name}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-white/60">{t("sealed")}</p>
              <button type="button" className="mt-5 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-[var(--main-2)] px-6 text-base font-medium text-white shadow-lg transition hover:opacity-90" onClick={() => setRevealed(true)}>
                {tr("revealButton")} →
              </button>
            </>
          ) : (
            <>
              <div className="mt-8">
                <RatingScale
                  people={ratings.map((rating) => ({ id: rating.personId, name: nameOf(rating.personId), value: rating.value, tone: personTone(ids, rating.personId) }))}
                  min={0}
                  max={5}
                  average={ratings.reduce((sum, rating) => sum + rating.value, 0) / ratings.length}
                  averageLabel={tr("average")}
                />
              </div>
              <p className="reveal-rise mt-6 text-3xl font-light leading-tight tracking-[-0.04em] sm:text-4xl" style={delay(afterDrops + 150)}>{tr("verdict.apart")}</p>
              <ul className="mt-5 space-y-2.5">
                {ratings.filter((rating) => rating.comment).map((rating, index) => (
                  <li key={rating.personId} className="reveal-rise flex gap-3 rounded-2xl bg-white/[0.05] p-3" style={delay(afterDrops + 500 + index * 200)}>
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: personTone(ids, rating.personId) }}>{initialsOf(nameOf(rating.personId))}</span>
                    <div className="min-w-0 leading-snug">
                      <span className="block text-xs text-white/55">{firstName(nameOf(rating.personId))} · {fmt(rating.value)}</span>
                      <p className="mt-0.5 text-sm text-white/90">“{rating.comment}”</p>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className="reveal-rise mt-5 cursor-pointer text-xs text-white/60 hover:text-white" style={delay(afterDrops + 900)} onClick={() => setRun((value) => value + 1)}>↺ {tr("replay")}</button>
            </>
          )}
        </section>

        {/* 2 — the whole season, drawn. */}
        <p className="mt-16 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--main)]">{t("step2")}</p>
        <p className="mb-4 mt-2 max-w-2xl text-lg font-light leading-snug">{t("step2Body")}</p>
        <StoryView input={films} story={filmStory} label={t("label")} />

        {/* 3 — the same idea for a habit. */}
        <p className="mt-16 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--main)]">{t("step3")}</p>
        <p className="mb-4 mt-2 max-w-2xl text-lg font-light leading-snug">{t("step3Body")}</p>
        <StoryView input={reading} story={readingStory} label={t("label")} />

        <section className="mt-16 border-t border-[var(--line)] pt-8">
          <h2 className="text-2xl font-medium tracking-[-0.04em]">{t("ctaTitle")}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{t("ctaBody")}</p>
          <a href="/start" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[var(--main)] px-5 text-sm font-medium text-white">{t("cta")} →</a>
        </section>
      </div>
    </main>
  );
}
