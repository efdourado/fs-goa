"use client";

import { StateButton } from "../state-button";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Dialog } from "../dialog";
import type { Metric } from "../types";
import { cx } from "../ui";
import { type AlmanacPage, useAlmanacPages } from "./almanac";
import { downloadBlob, loadPngRenderer, renderPng, slug } from "./download";
import type { Story, StoryInput } from "./model";
import { storyHeadline, ThreadPanel, useStoryFigures } from "./view";

// A story's shape: 9:16, saved at twice the size (1080 × 1920, what Instagram and WhatsApp stories take).
const PAGE_WIDTH = 540;
const PAGE_HEIGHT = 960;

/** How far a page may shrink to fit, and how far a short one may grow to fill the story instead of leaving it empty. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.3;
/** Two layouts this close in scale read the same; the one with more full-width cards wins. */
const SCALE_TIE = 0.04;
/** Side by side, each card keeps at least this much room (layout px): a narrower one reads as a sliver. */
const MIN_PAIRED_COLUMN = 240;
const GRID_GAP = 16;
/** Past this many cards the layouts multiply (a Fibonacci count); the page is simply stacked. */
const MAX_TILED_CARDS = 8;

/**
 * Every way to lay a page's cards out in a two-column grid with no lone half: each card either spans the row or
 * pairs with its neighbour. `true` marks a full-width card. A `wide` card always spans.
 */
function cardTilings(wide: boolean[]): boolean[][] {
  const out: boolean[][] = [];
  const walk = (index: number, row: boolean[]) => {
    if (index >= wide.length) { out.push(row); return; }
    walk(index + 1, [...row, true]);
    if (index + 1 < wide.length && !wide[index] && !wide[index + 1]) walk(index + 2, [...row, false, false]);
  };
  walk(0, []);
  return out;
}

/**
 * A story is one screen that can't scroll. The page is tried in every card layout (all stacked, or some cards side by
 * side), each at the largest scale that fits; the biggest wins, more full-width cards breaking a near tie. A page with
 * little on it grows (up to `MAX_SCALE`) rather than leaving the story half empty. It's laid out narrower or wider by
 * the same factor, so it keeps its shape.
 */
function FitBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const outer = box.current, content = inner.current;
    if (!outer || !content) return;
    // The search resizes the content itself, which wakes the observer; only a real change (fonts, data) refits.
    let settled = { room: -1, height: -1 };
    const fit = () => {
      const room = outer.clientHeight;
      if (room === settled.room && content.scrollHeight === settled.height) return;
      const heightAt = (value: number) => { content.style.width = `${100 / value}%`; return content.scrollHeight * value; };
      const bestScale = (ceiling: number) => {
        if (heightAt(ceiling) <= room) return ceiling;
        let low = MIN_SCALE, high = ceiling;
        for (let step = 0; step < 8; step += 1) {
          const mid = (low + high) / 2;
          if (heightAt(mid) <= room) low = mid; else high = mid;
        }
        return low;
      };
      // The page's card grid (`Grid` in the almanac), laid out here instead of by its width.
      const grid = content.querySelector<HTMLElement>("[data-story-grid]");
      const cards = grid ? [...grid.children].filter((node): node is HTMLElement => node instanceof HTMLElement) : [];
      const apply = (tiling: boolean[]) => {
        if (!grid) return;
        grid.style.gridTemplateColumns = tiling.every(Boolean) ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";
        cards.forEach((card, index) => { card.style.gridColumn = tiling[index] ? "1 / -1" : "auto"; });
      };
      const tilings = cards.length > 1 && cards.length <= MAX_TILED_CARDS
        ? cardTilings(cards.map((card) => card.matches("[data-story-wide]") || Boolean(card.querySelector(":scope > [data-story-wide]"))))
        : [cards.map(() => true)];
      let chosen = { tiling: tilings[0], scale: 0, full: -1 };
      for (const tiling of tilings) {
        // Paired cards cap the scale: past it, laid out narrower, each column would drop under its minimum.
        const ceiling = tiling.every(Boolean) ? MAX_SCALE : Math.max(MIN_SCALE, Math.min(MAX_SCALE, outer.clientWidth / (MIN_PAIRED_COLUMN * 2 + GRID_GAP)));
        const full = tiling.filter(Boolean).length;
        // A layout that can't beat the one in hand, even at its ceiling, isn't worth measuring.
        if (ceiling <= chosen.scale + SCALE_TIE && full <= chosen.full) continue;
        apply(tiling);
        const value = bestScale(ceiling);
        const better = value > chosen.scale + SCALE_TIE || (value >= chosen.scale - SCALE_TIE && full > chosen.full);
        if (better) chosen = { tiling, scale: value, full };
      }
      apply(chosen.tiling);
      // Every page starts right under its name; a short one grows (up to MAX_SCALE) rather than floating.
      heightAt(chosen.scale);
      settled = { room, height: content.scrollHeight };
      setScale(chosen.scale);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="relative mt-5 min-h-0 flex-1 overflow-hidden">
      <div ref={inner} className="@container absolute left-0 top-0 flex flex-col" style={{ width: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * One story: the challenge's name and its numbers on top of every page (so each one stands alone wherever it's
 * posted), then the page's one thing, highlighted, and a quiet page number and "goa" at the foot. Fixed 9:16, with
 * animations off (`story-still`) so the picture is the finished drawing.
 */
function StoryFrame({ input, figures, index, eyebrow, headline, children }: {
  input: StoryInput; figures: Array<{ value: string; label: string }>; index: number;
  eyebrow?: string; headline?: string; children: ReactNode;
}) {
  return (
    <article className="story-still story-page flex flex-col overflow-hidden bg-[var(--canvas)] px-9 pb-7 pt-9 text-left text-[var(--ink)]" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}>
      <header className="border-b border-[var(--line)] pb-5">
        <h1 className="line-clamp-2 text-[38px] font-light leading-[1.02] tracking-[-0.05em]">{input.title}</h1>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col-reverse">
              <dt className="text-[11px] text-[var(--muted)]">{figure.label}</dt>
              <dd className="text-[24px] font-light tabular-nums leading-tight tracking-[-0.03em]">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <section className="mt-6 flex min-h-0 flex-1 flex-col">
        {/* The page's name as its tab says it on screen: sentence case, not a shouted label. */}
        {eyebrow ? <p className="text-[15px] font-medium text-[var(--muted)]">{eyebrow}</p> : null}
        {headline ? <p className="mt-1.5 text-[21px] font-light leading-snug tracking-[-0.02em]">{headline}</p> : null}
        <FitBox>{children}</FitBox>
      </section>
      <footer className="mt-5 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span className="tabular-nums">{index + 1}</span>
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={24} height={24} className="size-6 object-contain" />
          goa
        </span>
      </footer>
    </article>
  );
}

interface Designed { id: string; title: string; node: (index: number) => ReactNode }

/**
 * Every story there is to download: the thread first, then the almanac's pages as they are (the rankings with
 * the podium and its charts, then whatever else its data fills: the pair, the comments, the metrics…).
 */
function useDesignedPages(input: StoryInput, story: Story, metrics: Metric[]): Designed[] {
  const t = useTranslations("story");
  const figures = useStoryFigures(story, input);
  const almanac: AlmanacPage[] = useAlmanacPages(story, input, metrics, true);
  if (story.kind === "empty" && !almanac.length) return [];
  const frame = (eyebrow: string | undefined, headline: string | undefined, body: ReactNode) => function renderStory(index: number) {
    return <StoryFrame input={input} figures={figures} index={index} eyebrow={eyebrow} headline={headline}>{body}</StoryFrame>;
  };
  return [
    ...(story.kind !== "empty" && !input.resultPresentation?.hiddenPages.includes("thread") ? [{ id: "thread", title: t("title"), node: frame(t("title"), storyHeadline(story, input, t), <ThreadPanel input={input} story={story} fit interactive={false} bare />) }] : []),
    // No line that says again what's right under it: the first card's big number, or the page's own name.
    ...almanac.map((page) => ({ id: page.id, title: page.title, node: frame(page.title, page.echoed || page.headline === page.title ? undefined : page.headline, page.body) })),
  ];
}

export function DownloadPagesButton({ input, story, metrics = [], tone = "hero", compactOnMobile = false }: {
  input: StoryInput; story: Story; metrics?: Metric[]; tone?: "hero" | "plain"; compactOnMobile?: boolean;
}) {
  const t = useTranslations("story.download");
  const [open, setOpen] = useState(false);
  if (story.kind === "empty" && !metrics.length) return null;
  const warmRenderer = () => { void loadPngRenderer().catch(() => undefined); };
  return (
    <>
      <StateButton
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={warmRenderer}
        onFocus={warmRenderer}
        aria-label={t("button")}
        title={t("button")}
        className={cx(
          "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-sm transition",
          compactOnMobile ? "w-11 shrink-0 sm:w-auto sm:px-4" : "px-4",
          tone === "hero" ? "border border-white/35 text-[var(--spotlight-ink)] hover:border-white/60 hover:bg-white/5" : "bg-[var(--ink)] font-medium text-[var(--canvas)] hover:opacity-90",
        )}
      >
        <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M3 16.5h14M5 13V9m5 4V4m5 9V7" strokeLinecap="round" />
        </svg>
        <span className={compactOnMobile ? "hidden sm:inline" : undefined}>{t("button")}</span>
      </StateButton>
      {open ? <PagesDialog input={input} story={story} metrics={metrics} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PagesDialog({ input, story, metrics, onClose }: { input: StoryInput; story: Story; metrics: Metric[]; onClose: () => void }) {
  const t = useTranslations("story.download");
  const ts = useTranslations("story");
  const pages = useDesignedPages(input, story, metrics);
  const stage = useRef<HTMLDivElement>(null);
  const previews = useRef(new Map<string, HTMLDivElement>());
  const inProgress = useRef(new WeakMap<HTMLElement, Promise<Blob | null>>());
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const [step, setStep] = useState(0);
  const [scale, setScale] = useState(0);
  const [ready, setReady] = useState<Map<string, Blob | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [canShare] = useState(() => {
    if (typeof File !== "function" || typeof navigator.share !== "function") return false;
    const probe = new File([new Blob()], "a.png", { type: "image/png" });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  });

  const index = Math.min(step, pages.length - 1);
  const current = pages[index];
  const currentId = current?.id;
  const hasPages = currentId !== undefined;
  const blob = currentId === undefined ? undefined : ready.get(currentId);
  const next = pages[index + 1];
  const upcoming = blob && next && !ready.has(next.id) ? next : undefined;
  const prepareId = blob === undefined ? currentId : upcoming?.id;
  const preparingAhead = prepareId !== currentId;

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const fit = () => setScale(Math.min(node.clientWidth / PAGE_WIDTH, node.clientHeight / PAGE_HEIGHT));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasPages]);

  // Prepare the visible PNG first, then use the time spent viewing it to prepare the next one.
  useEffect(() => {
    if (prepareId === undefined) return;
    const node = previews.current.get(prepareId)?.firstElementChild;
    if (!(node instanceof HTMLElement)) return;
    const renders = inProgress.current;
    let cancelled = false;
    const prepare = () => {
      let render = renders.get(node);
      if (!render) {
        render = renderPng(node).catch(() => null);
        renders.set(node, render);
        void render.then(() => renders.delete(node));
      }
      void render.then((result) => {
        if (!cancelled) setReady((previous) => new Map(previous).set(prepareId, result));
      });
    };
    const delay = preparingAhead ? window.setTimeout(prepare, 120) : undefined;
    if (!preparingAhead) prepare();
    return () => {
      cancelled = true;
      window.clearTimeout(delay);
    };
  }, [prepareId, preparingAhead]);

  function goTo(position: number) {
    if (busy || position === index || position < 0 || position >= pages.length) return;
    setStep(position);
    setSaveError(false);
  }

  async function save() {
    if (busy || !current || blob === undefined) return;
    setSaveError(false);
    if (blob === null) {
      setReady((previous) => {
        const next = new Map(previous);
        next.delete(current.id);
        return next;
      });
      return;
    }

    setBusy(true);
    try {
      const name = `${String(index + 1).padStart(2, "0")}-${slug(`${input.title} ${current.title}`)}.png`;
      const files = canShare ? [new File([blob], name, { type: "image/png" })] : [];
      if (canShare && navigator.canShare?.({ files })) {
        await navigator.share({ files });
      } else {
        downloadBlob(blob, name);
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  const saveLabel = blob === undefined ? t("preparing") : blob === null ? t("retry") : t(canShare ? "shareOne" : "one");
  const imageWidth = PAGE_WIDTH * scale;
  const columnWidth = imageWidth || "calc(100% - 1rem)";

  return (
    <Dialog title={t("title")} onClose={onClose} busy={busy} storyWidth={columnWidth}>
      {current ? (
        <>
          {pages.length > 1 ? (
            <nav className="mx-auto flex shrink-0 gap-1.5" style={{ width: columnWidth }} aria-label={t("steps")}>
              {pages.map((page, position) => (
                <StateButton
                  key={page.id}
                  type="button"
                  aria-label={t("goTo", { index: position + 1, title: page.title })}
                  aria-current={position === index ? "step" : undefined}
                  disabled={busy}
                  onClick={() => goTo(position)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    const next = direction < 0 ? event.currentTarget.previousElementSibling : event.currentTarget.nextElementSibling;
                    if (next instanceof HTMLButtonElement) {
                      next.focus();
                      goTo(position + direction);
                    }
                  }}
                  className="group min-h-7 min-w-0 flex-1 cursor-pointer rounded focus-visible:outline-2"
                >
                  <span className={cx("block h-1 w-full rounded-full transition group-hover:bg-[var(--main)]", position === index ? "bg-[var(--main)]" : position < index ? "bg-[var(--main-line)]" : "bg-[var(--line)]")} />
                </StateButton>
              ))}
            </nav>
          ) : null}
          <p className="sr-only" aria-live="polite">{current.title}</p>
          <div
            ref={stage}
            className={cx("relative mx-2 flex min-h-0 flex-1 items-center justify-center", pages.length === 1 && "mt-2")}
          >
            <div
              className="relative touch-pan-y overflow-hidden rounded-xl bg-[var(--canvas)] ring-1 ring-[var(--line)]"
              style={{ width: imageWidth, height: PAGE_HEIGHT * scale }}
              onPointerDown={(event) => {
                if (event.isPrimary && event.button === 0) gesture.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                const start = gesture.current;
                gesture.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (event.pointerType === "touch" && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
                  goTo(index + (dx < 0 ? 1 : -1));
                } else if (Math.hypot(dx, dy) <= 10) {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) return;
                  goTo(index + (event.clientX < bounds.left + bounds.width / 2 ? -1 : 1));
                }
              }}
              onPointerLeave={(event) => { if (event.pointerType !== "touch") gesture.current = null; }}
              onPointerCancel={() => { gesture.current = null; }}
            >
              {[current, ...(upcoming ? [upcoming] : [])].map((page, offset) => (
                <div
                  key={page.id}
                  inert
                  ref={(node) => { if (node) previews.current.set(page.id, node); else previews.current.delete(page.id); }}
                  className={cx("absolute top-0 origin-top-left", offset ? "left-full" : "left-0")}
                  style={{ width: PAGE_WIDTH, transform: `scale(${scale})` }}
                >
                  {page.node(index + offset)}
                </div>
              ))}
            </div>
          </div>
          <footer className="mx-auto shrink-0 pt-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]" style={{ width: columnWidth }}>
            <StateButton
              type="button"
              disabled={busy || blob === undefined}
              onClick={() => void save()}
              className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-[var(--ink)] px-4 py-1.5 text-sm font-medium whitespace-nowrap text-[var(--canvas)] transition hover:opacity-90 disabled:cursor-default disabled:opacity-45"
            >
              <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M10 3v10m-4-4 4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {saveLabel}
            </StateButton>
            {saveError ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{t("saveError")}</p> : null}
          </footer>
        </>
      ) : <p className="p-4 text-sm text-[var(--muted)]">{ts("noVisiblePages")}</p>}
    </Dialog>
  );
}
