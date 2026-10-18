"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Dialog } from "../dialog";
import type { Metric } from "../types";
import { cx } from "../ui";
import { type AlmanacPage, useAlmanacPages } from "./almanac";
import { downloadBlob, downloadZip, renderPng, slug } from "./download";
import type { Story, StoryInput } from "./model";
import { storyHeadline, ThreadPanel, useStoryFigures } from "./view";

// A story's shape: 9:16, saved at twice the size (1080 × 1920, what Instagram and WhatsApp stories take).
const PAGE_WIDTH = 540;
const PAGE_HEIGHT = 960;
const GRID_GAP = 16;

function Mark() {
  return <span className="grid h-6 w-6 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-[11px] font-black text-[var(--canvas)]">g</span>;
}

/**
 * A story is one screen: when a page holds more than fits, the whole of it shrinks until it does (a story can't
 * scroll, and cutting it off would hide the end). It's laid out wider by the same factor, so it keeps its shape.
 */
function FitBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const outer = box.current, content = inner.current;
    if (!outer || !content) return;
    // Laid out wider, a page also gets shorter (cards go side by side, lines hold more words), so the scale is
    // found by trying: the largest one, down to half, at which the page laid out at that width fits.
    const fit = () => {
      const room = outer.clientHeight;
      const heightAt = (value: number) => { content.style.width = `${100 / value}%`; return content.scrollHeight * value; };
      let found = 1;
      if (heightAt(1) > room) {
        let low = 0.5, high = 1;
        for (let step = 0; step < 9; step += 1) {
          const mid = (low + high) / 2;
          if (heightAt(mid) <= room) low = mid; else high = mid;
        }
        found = low;
      }
      content.style.width = `${100 / found}%`;
      setScale(found);
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
    <article className="story-still story-page flex flex-col overflow-hidden bg-[var(--canvas)] px-9 pb-7 pt-9 text-[var(--ink)]" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}>
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
        {eyebrow ? <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">{eyebrow}</p> : null}
        {headline ? <p className="mt-1.5 text-[21px] font-light leading-snug tracking-[-0.02em]">{headline}</p> : null}
        <FitBox>{children}</FitBox>
      </section>
      <footer className="mt-5 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span className="tabular-nums">{index + 1}</span>
        <span className="flex items-center gap-2"><Mark />goa</span>
      </footer>
    </article>
  );
}

interface Designed { id: string; title: string; node: (index: number, total: number) => ReactNode }

/**
 * Every story there is to download: the thread first, then the almanac's pages as they are (the rankings with
 * the podium and its charts, then whatever else its data fills: the pair, the comments, the metrics…).
 */
function useDesignedPages(input: StoryInput, story: Story, metrics: Metric[]): Designed[] {
  const t = useTranslations("story");
  const figures = useStoryFigures(story, input);
  const almanac: AlmanacPage[] = useAlmanacPages(story, input, metrics, true);
  if (story.kind === "empty") return [];
  const frame = (eyebrow: string | undefined, headline: string | undefined, body: ReactNode) => function renderStory(index: number) {
    return <StoryFrame input={input} figures={figures} index={index} eyebrow={eyebrow} headline={headline}>{body}</StoryFrame>;
  };
  return [
    { id: "thread", title: t("title"), node: frame(t("title"), storyHeadline(story, input, t), <ThreadPanel input={input} story={story} fit interactive={false} bare />) },
    ...almanac.map((page) => ({ id: page.id, title: page.title, node: frame(page.title, page.headline, page.body) })),
  ];
}

/**
 * "Download pages": sits next to "Download PDF". Opens the list of designed pages — each with a small
 * preview two to a row and its own download — plus one "download all" as a zip.
 */
export function DownloadPagesButton({ input, story, metrics = [], tone = "hero" }: { input: StoryInput; story: Story; metrics?: Metric[]; tone?: "hero" | "plain" }) {
  const t = useTranslations("story.download");
  const [open, setOpen] = useState(false);
  if (story.kind === "empty") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("button")}
        title={t("button")}
        className={cx(
          "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-sm transition",
          // In the challenge card a phone shows it as a round icon beside the PDF one; elsewhere it keeps its label.
          tone === "hero" ? "w-11 border border-white/35 text-[var(--spotlight-ink)] hover:border-white/60 hover:bg-white/5 sm:w-auto sm:px-4" : "bg-[var(--ink)] px-4 font-medium text-[var(--canvas)] hover:opacity-90",
        )}
      >
        <svg viewBox="0 0 20 20" className={cx("flex-none", tone === "hero" ? "size-[18px] sm:size-4" : "size-4")} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={tone === "hero" ? "hidden sm:inline" : undefined}>{t("button")}</span>
      </button>
      {open ? <PagesDialog input={input} story={story} metrics={metrics} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The images to share, picked like a library's items: tap a story to select it (an ink check marks it). The
 * one button at the foot saves what's picked: one image as a PNG, several as a .zip on a computer. On a phone
 * that can share files (iPhone, Android) it opens the share sheet instead, so the images go straight to Photos
 * or to a story, no zip to unpack. Each picked image is drawn as soon as it's picked, so the share still counts
 * as the tap that asked for it.
 */
function PagesDialog({ input, story, metrics, onClose }: { input: StoryInput; story: Story; metrics: Metric[]; onClose: () => void }) {
  const t = useTranslations("story.download");
  const pages = useDesignedPages(input, story, metrics);
  const refs = useRef(new Map<string, HTMLElement | null>());
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState<Map<string, Blob>>(new Map());
  const [busy, setBusy] = useState(false);
  // The dialog only ever opens in a browser, so asking right away is safe.
  const [canShare] = useState(() => {
    const probe = typeof File === "function" ? new File([new Blob()], "a.png", { type: "image/png" }) : null;
    return Boolean(probe && typeof navigator !== "undefined" && navigator.canShare?.({ files: [probe] }));
  });
  // Three stories to a row on a wide dialog, two on a phone, each the real page shrunk.
  const grid = useRef<HTMLOListElement>(null);
  const [scale, setScale] = useState(0.2);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const columns = entry.contentRect.width >= 560 ? 3 : 2;
      setColumns(columns);
      setScale((entry.contentRect.width - GRID_GAP * (columns - 1)) / columns / PAGE_WIDTH);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fileName = (id: string) => {
    const index = pages.findIndex((page) => page.id === id);
    return `${String(index + 1).padStart(2, "0")}-${slug(`${input.title} ${pages[index]?.title ?? ""}`)}.png`;
  };
  // Draw each picked page once, in the background, so saving or sharing is instant.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const id of selected) {
        if (ready.has(id)) continue;
        const node = refs.current.get(id)?.firstElementChild as HTMLElement | null;
        if (!node) continue;
        const blob = await renderPng(node);
        if (cancelled) return;
        setReady((current) => new Map(current).set(id, blob));
      }
    })();
    return () => { cancelled = true; };
  }, [selected, ready]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((one) => one !== id) : [...current, id]);
  const allPicked = selected.length === pages.length;
  const pending = selected.some((id) => !ready.has(id));
  const ordered = pages.filter((page) => selected.includes(page.id)).map((page) => page.id);

  async function save() {
    if (!ordered.length || pending) return;
    setBusy(true);
    try {
      const files = ordered.map((id) => ({ name: fileName(id), blob: ready.get(id)! }));
      if (canShare) {
        try {
          await navigator.share({ files: files.map((file) => new File([file.blob], file.name, { type: "image/png" })) });
        } catch (cause) {
          if (!(cause instanceof DOMException && cause.name === "AbortError")) throw cause;
        }
      } else if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name);
      } else {
        await downloadZip(files, input.title);
      }
    } finally {
      setBusy(false);
    }
  }

  const label = !ordered.length ? t("pickSome")
    : pending ? t("preparing")
    : canShare ? t("share", { count: ordered.length })
    : ordered.length === 1 ? t("one") : t("all", { count: ordered.length });

  return (
    <Dialog title={t("title")} onClose={onClose} busy={busy} wide>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">{t("lede", { count: pages.length })}</p>
        <button type="button" onClick={() => setSelected(allPicked ? [] : pages.map((page) => page.id))} className="cursor-pointer text-sm text-[var(--ink)] underline-offset-4 hover:underline">
          {allPicked ? t("clear") : t("selectAll", { count: pages.length })}
        </button>
      </div>
      <ol ref={grid} className="mt-5 grid" style={{ gap: GRID_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {pages.map((page, index) => {
          const picked = selected.includes(page.id);
          return (
            <li key={page.id}>
              <div
                className={cx("relative overflow-hidden rounded-md border transition", picked ? "border-[var(--ink)] ring-2 ring-[var(--ink)]" : "border-[var(--line)]")}
                style={{ aspectRatio: `${PAGE_WIDTH} / ${PAGE_HEIGHT}` }}
              >
                {/* The real page, shrunk: what you see is what you save. `inert`: its own controls stay out of reach. */}
                <div inert ref={(node) => { refs.current.set(page.id, node); }} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: PAGE_WIDTH }}>
                  {page.node(index, pages.length)}
                </div>
                {/* One toggle over the whole preview (a button can't hold the page's own buttons). */}
                <button type="button" aria-pressed={picked} aria-label={page.title} onClick={() => toggle(page.id)} className="absolute inset-0 cursor-pointer transition hover:bg-[var(--ink)]/[0.04] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--main)]/30">
                  <span aria-hidden="true" className={cx("absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border transition", picked ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--canvas)]" : "border-[var(--line)] bg-[var(--paper)]/90 text-transparent")}>
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.4 2.9 2.9 6.1-6.6" /></svg>
                  </span>
                </button>
              </div>
              <p className="mt-2 truncate text-sm font-medium"><span className="mr-1.5 tabular-nums text-[var(--muted)]">{index + 1}</span>{page.title}</p>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--paper)] px-6 py-4">
        <span className="text-xs text-[var(--muted)]">{t(canShare ? "formatShare" : "format")}</span>
        <button type="button" disabled={busy || !ordered.length || pending} onClick={() => void save()} className="inline-flex min-h-10 cursor-pointer items-center rounded-full bg-[var(--ink)] px-5 text-sm font-medium text-[var(--canvas)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">
          {label}
        </button>
      </div>
    </Dialog>
  );
}
