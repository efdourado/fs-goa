"use client";

import { StateButton } from "../state-button";

import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useMemo, useState } from "react";

import { firstName } from "../rating-scale";
import type { Id, Metric } from "../types";
import { PagedView } from "../paged-view";
import { Dialog } from "../dialog";
import { AvatarMark, FaceEmptyState, cx } from "../ui";
import { useAlmanacPages } from "./almanac";
import type { Story, StoryInput } from "./model";
import { DatedThread } from "./thread-dated";
import { RatedThread } from "./thread-rated";
import { initialThreadSelection, threadPersonStyle } from "./thread-people";

/** The numbers under "The thread": people, titles, ratings, time, comments (or days, check-ins, total). */
export function useStoryFigures(story: Story, input: StoryInput): Array<{ value: string; label: string }> {
  const t = useTranslations("story");
  const f = useFormatter();
  if (story.kind === "rated") {
    const solo = story.totals.people < 2;
    return [
      ...(solo ? [] : [{ value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) }]),
      { value: f.number(story.totals.items), label: t(`figures.${input.noun}`, { count: story.totals.items }) },
      { value: f.number(story.totals.ratings), label: t("figures.ratings", { count: story.totals.ratings }) },
      ...(story.totals.minutes ? [{ value: `${Math.round(story.totals.minutes / 60)} h`, label: t(solo ? "figures.togetherSolo" : "figures.together") }] : []),
      ...(story.totals.comments ? [{ value: f.number(story.totals.comments), label: t("figures.comments", { count: story.totals.comments }) }] : []),
    ];
  }
  if (story.kind === "dated") {
    return [
      ...(story.totals.people < 2 ? [] : [{ value: f.number(story.totals.people), label: t("figures.people", { count: story.totals.people }) }]),
      { value: f.number(story.totals.days), label: t("figures.days", { count: story.totals.days }) },
      { value: f.number(story.totals.checkins), label: t("figures.checkins", { count: story.totals.checkins }) },
      ...(story.totals.total !== null ? [{ value: f.number(story.totals.total), label: input.counter?.unit || input.counter?.label || "" }] : []),
    ];
  }
  return [];
}

export function storyHeadline(story: Story, input: StoryInput, t: ReturnType<typeof useTranslations>): string {
  if (story.kind === "rated" && story.duo) return t("mood.duo", { a: firstName(story.duo.a.name), b: firstName(story.duo.b.name) });
  if (story.kind === "rated") return t(`mood.${input.people.length > 1 ? story.mood : "solo"}`);
  if (story.kind === "dated") return story.lanes.length === 1 ? t("datedHeadlineSolo") : t("datedHeadline", { count: story.lanes.length });
  return "";
}

/**
 * The drawing: "The thread" as the heading (the challenge's own name is already right above it), the
 * numbers, a legend to follow one person, and everyone's line. `fit` squeezes it into its box instead of
 * scrolling — the downloadable page has no scrollbar.
 */
/** `bare` leaves out the heading and the numbers, for a page that already shows them above the drawing. */
export function ThreadPanel({ input, story, fit = false, interactive = true, bare = false }: { input: StoryInput; story: Story; fit?: boolean; interactive?: boolean; bare?: boolean }) {
  const t = useTranslations("story");
  const figures = useStoryFigures(story, input);
  const [focus, setFocus] = useState<Id | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selection, setSelection] = useState<Id[]>();
  const people = useMemo(() => {
    if (story.kind === "rated") return story.threads.filter((thread) => thread.values.some((value) => value !== null)).map((thread) => thread.person);
    if (story.kind === "dated") return story.lanes.map((lane) => lane.person);
    return [];
  }, [story]);
  const initial = useMemo(() => story.kind === "empty" ? [] : initialThreadSelection(story, people.map((person) => person.id)), [story, people]);
  if (story.kind === "empty") return null;

  const ids = input.people.map((person) => person.id);
  const selected = (selection ?? initial).filter((id) => people.some((person) => person.id === id));
  const visible = selected.length ? new Set(selected) : undefined;
  const shown = visible ? people.filter((person) => visible.has(person.id)) : people;
  // More than two people: two faces and "+N", never a name per line (a story image draws the same, minus the picker).
  const compact = people.length > 2;
  const compactPicker = interactive && compact;
  const faces = shown.slice(0, 2);
  const facesCluster = (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {faces.map((person, index) => (
        <span key={person.id} className={cx("grid size-7 place-items-center rounded-full border-2 border-[var(--spotlight)] p-px", index > 0 && "-ml-2")} style={{ background: threadPersonStyle(ids, person.id).tone }}><AvatarMark /></span>
      ))}
      <span className="-ml-2 grid size-7 place-items-center rounded-full border-2 border-[var(--spotlight)] bg-[var(--spotlight-ink)] text-[10px] font-semibold tabular-nums text-[var(--spotlight)]">+{people.length - faces.length}</span>
    </span>
  );
  const facesLabel = visible ? t("threadPeople.showing", { shown: shown.length, total: people.length }) : t("threadPeople.title");

  function togglePerson(id: Id) {
    const current = visible ? selected : people.map((person) => person.id);
    const next = current.includes(id) ? current.filter((personId) => personId !== id) : [...current, id];
    if (!next.length) return;
    setSelection(next.length === people.length ? [] : next);
  }

  return (
    // On screen the thread is a dark panel. In a story image it is drawn straight on the page: the panel's colours
    // become the page's, and the faces, notes and chart share the page's left edge.
    <div className={cx("overflow-hidden bg-[var(--spotlight)] text-[var(--spotlight-ink)]", !fit && "rounded-[28px]")} style={(fit ? { "--spotlight": "var(--canvas)", "--spotlight-ink": "var(--ink)", "--thread-ink": "var(--ink)" } : { "--thread-ink": "white" }) as Record<string, string> as CSSProperties}>
      {bare ? <div className="pt-3" /> : <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <div className="min-w-0">
          <h2 className="text-3xl font-light leading-[1.02] tracking-[-0.05em] sm:text-5xl">{t("title")}</h2>
          <p className="mt-2 text-sm text-[var(--thread-ink)]/65">{storyHeadline(story, input, t)}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col-reverse">
              <dt className="text-[11px] text-[var(--thread-ink)]/50">{figure.label}</dt>
              <dd className="text-2xl font-light tabular-nums tracking-[-0.03em]">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </div>}

      <div className={cx("pb-3", fit ? "pt-0" : "px-5 pt-3 sm:px-8")}>
        {compactPicker ? (
          <StateButton
            type="button"
            aria-label={t("threadPeople.title")}
            aria-haspopup="dialog"
            onClick={() => setPickerOpen(true)}
            className="inline-flex min-h-9 cursor-pointer items-center gap-2.5 rounded-full pr-2 text-xs text-[var(--thread-ink)]/65 transition hover:bg-[var(--thread-ink)]/5 hover:text-[var(--thread-ink)]"
          >
            {facesCluster}
            <span>{facesLabel}</span>
          </StateButton>
        ) : compact ? (
          <p className="inline-flex min-h-9 items-center gap-2.5 text-xs text-[var(--thread-ink)]/65">{facesCluster}<span>{facesLabel}</span></p>
        ) : shown.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            {shown.map((person) => {
              return (
                <StateButton
                  key={person.id}
                  type="button"
                  title={person.name}
                  aria-label={person.name}
                  disabled={!interactive}
                  onClick={() => setFocus((current) => (current === person.id ? null : person.id))}
                  aria-pressed={focus === person.id}
                  className={cx(
                    "flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs transition",
                    interactive && "cursor-pointer focus-visible:-outline-offset-2",
                    focus === person.id ? "bg-[var(--thread-ink)]/20" : "bg-[var(--thread-ink)]/[0.06] hover:bg-[var(--thread-ink)]/10",
                    focus !== null && focus !== person.id && "opacity-50",
                  )}
                >
                  <span className="grid size-6 flex-none place-items-center rounded-full p-[2px]" style={{ background: threadPersonStyle(ids, person.id).tone }}><AvatarMark /></span>
                  <span className="truncate">{firstName(person.name)}</span>
                </StateButton>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className={fit ? undefined : "px-2 pb-5 sm:px-5"}>
        {story.kind === "rated"
          ? <RatedThread story={story} input={input} focus={compactPicker ? null : focus} visible={visible} fit={fit} />
          : <DatedThread story={story} input={input} focus={compactPicker ? null : focus} visible={visible} fit={fit} />}
      </div>
      {compactPicker && pickerOpen ? (
        <Dialog title={t("threadPeople.title")} onClose={() => setPickerOpen(false)}>
          <p className="mb-3 text-sm text-[var(--muted)]">{t("threadPeople.hint")}</p>
          <div className="grid max-h-[45dvh] gap-1 overflow-y-auto [scrollbar-width:none]">
            {people.map((person) => {
              const checked = !visible || visible.has(person.id);
              const lastSelected = checked && shown.length === 1;
              const style = threadPersonStyle(ids, person.id);
              return (
                <label key={person.id} className={cx("flex min-h-10 items-center gap-2.5 py-1 text-sm", !lastSelected && "cursor-pointer")}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full p-[2px]" style={{ background: style.tone }}><AvatarMark /></span>
                  <span className="min-w-0 flex-1 break-words">{person.name}</span>
                  <input
                    type="checkbox"
                    className="transition-[background-color,border-color,opacity] duration-200 focus-visible:-outline-offset-2"
                    checked={checked}
                    disabled={lastSelected}
                    onChange={() => togglePerson(person.id)}
                  />
                </label>
              );
            })}
          </div>
        </Dialog>
      ) : null}
      {story.kind === "dated" ? <p className={cx("text-[11px] text-[var(--thread-ink)]/45", !fit && "px-5 pb-5 sm:px-8")}>{story.lanes.length === 1 ? t("readSolo") : t(`readDated${story.rhythm === "week" ? "Week" : ""}`)}</p> : null}
    </div>
  );
}

/**
 * "The thread" of a challenge on screen: the drawing, then the almanac's pages in the paginator (named
 * tabs, previous/next) — one theme at a time instead of one long scroll. Downloading lives next to "Download PDF" (see `pages.tsx`).
 */
export function StoryView({ input, story, metrics = [] }: { input: StoryInput; story: Story; metrics?: Metric[] }) {
  const pages = useAlmanacPages(story, input, metrics);
  const t = useTranslations("story");
  const showThread = story.kind !== "empty" && !input.resultPresentation?.hiddenPages.includes("thread");
  if (!showThread && !pages.length) return <FaceEmptyState title={t("noVisiblePages")} />;
  return (
    <section>
      {showThread ? <ThreadPanel input={input} story={story} /> : null}
      {/* Everything after the drawing is a page of the paginator — one theme at a time, named tabs on top. */}
      <div className="mt-8 px-1">
        <PagedView
          centered
          pages={pages.map((page) => ({
            id: `story-${page.id}`,
            title: page.title,
            body: (
              <div>
                {/* The section's one-line read, centred like a newspaper standfirst. */}
                {page.ownHeadline ? null : <p className="mx-auto max-w-2xl text-balance text-center text-xl font-light leading-snug tracking-[-0.02em] text-[var(--ink)]/85 sm:text-2xl">{page.headline}</p>}
                <div className={cx("@container", !page.ownHeadline && "mt-7")}>{page.body}</div>
              </div>
            ),
          }))}
        />
      </div>
    </section>
  );
}
