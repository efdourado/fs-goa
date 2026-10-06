"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { Dialog } from "../dialog";
import { firstName, initialsOf, personTone } from "../rating-scale";
import type { Metric } from "../types";
import { cx } from "../ui";
import { type AlmanacPage, useAlmanacPages } from "./almanac";
import { downloadNode, downloadZip, renderPng, slug } from "./download";
import type { Story, StoryInput } from "./model";
import { storyHeadline, ThreadPanel, useStoryFigures } from "./view";

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1000;
const PREVIEW = 0.2;

function Mark({ dark }: { dark?: boolean }) {
  return <span className={cx("grid h-7 w-7 place-items-center rounded-[50%_50%_50%_16%] text-[12px] font-black", dark ? "bg-[var(--spotlight-ink)] text-[var(--spotlight)]" : "bg-[var(--ink)] text-[var(--canvas)]")}>g</span>;
}

/**
 * One downloadable page: a portrait frame (4:5, the shape feeds and chats show whole) with the challenge's
 * name and the page number on top, the page's title and headline, its facts, and a quiet "goa" at the
 * foot. Animations are off (`story-still`) so the picture is the finished drawing.
 */
function PageFrame({ input, index, total, title, headline, dark, children }: {
  input: StoryInput; index: number; total: number; title?: string; headline?: string; dark?: boolean; children: ReactNode;
}) {
  return (
    <article
      className={cx("story-still story-page flex flex-col p-14", dark ? "bg-[var(--spotlight)] text-[var(--spotlight-ink)]" : "bg-[var(--canvas)] text-[var(--ink)]")}
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT }}
    >
      <header className={cx("flex items-center justify-between text-sm", dark ? "text-white/60" : "text-[var(--muted)]")}>
        <span className="flex items-center gap-2.5"><Mark dark={dark} />{input.title}</span>
        <span className="tabular-nums">{index + 1} / {total}</span>
      </header>
      {title ? (
        <div className="mt-14">
          <h1 className="text-6xl font-light leading-[1.02] tracking-[-0.05em]">{title}</h1>
          {headline ? <p className={cx("mt-4 text-2xl font-light leading-snug", dark ? "text-white/70" : "text-[var(--muted)]")}>{headline}</p> : null}
        </div>
      ) : null}
      <div className="@container mt-12 flex flex-1 flex-col">{children}</div>
      <footer className={cx("mt-12 text-xs", dark ? "text-white/45" : "text-[var(--muted)]")}>goa</footer>
    </article>
  );
}

interface Designed { id: string; title: string; contents: string; node: (index: number, total: number) => ReactNode }

/** Every page there is to download, cover first: the cover, the drawing, then the almanac's pages. */
function useDesignedPages(input: StoryInput, story: Story, metrics: Metric[]): Designed[] {
  const t = useTranslations("story");
  const figures = useStoryFigures(story, input);
  const almanac: AlmanacPage[] = useAlmanacPages(story, input, metrics, true);
  if (story.kind === "empty") return [];
  const ids = input.people.map((person) => person.id);
  const people = story.kind === "rated" ? story.threads.map((thread) => thread.person) : story.lanes.map((lane) => lane.person);
  return [
    {
      id: "cover",
      title: t("pages.cover.title"),
      contents: t("pages.cover.contents"),
      node: (index, total) => (
        <PageFrame input={input} index={index} total={total} dark>
          <div className="flex flex-1 flex-col justify-between">
            <div>
              <p className="text-2xl font-light text-white/60">{storyHeadline(story, input, t)}</p>
              <h1 className="mt-6 text-8xl font-light leading-[0.95] tracking-[-0.06em]">{input.title}</h1>
            </div>
            <div className="mt-20 space-y-12">
              <dl className="grid grid-cols-3 gap-8">
                {figures.map((figure) => (
                  <div key={figure.label} className="flex flex-col-reverse">
                    <dt className="text-sm text-white/55">{figure.label}</dt>
                    <dd className="text-5xl font-light tabular-nums tracking-[-0.04em]">{figure.value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="flex flex-wrap gap-3">
                {people.map((person) => (
                  <li key={person.id} className="flex items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-1 pr-3.5 text-base">
                    <span className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: personTone(ids, person.id) }}>{initialsOf(person.name)}</span>
                    {firstName(person.name)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </PageFrame>
      ),
    },
    {
      id: "thread",
      title: t("title"),
      contents: story.kind === "rated" ? t("pages.thread.contentsRated") : t("pages.thread.contentsDated"),
      node: (index, total) => (
        <PageFrame input={input} index={index} total={total}>
          <ThreadPanel input={input} story={story} fit interactive={false} />
        </PageFrame>
      ),
    },
    ...almanac.map((page) => ({
      id: page.id,
      title: page.title,
      contents: page.contents,
      node: (index: number, total: number) => (
        <PageFrame input={input} index={index} total={total} title={page.title} headline={page.headline}>{page.body}</PageFrame>
      ),
    })),
  ];
}

/**
 * "Download pages": sits next to "Download PDF". Opens the list of designed pages — each with a small
 * preview, what's on it, and its own download — plus one "download all".
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
        className={cx(
          "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm transition",
          tone === "hero" ? "border border-white/35 text-[var(--spotlight-ink)] hover:border-white/60 hover:bg-white/5" : "bg-[var(--ink)] font-medium text-[var(--canvas)] hover:opacity-90",
        )}
      >
        <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("button")}
      </button>
      {open ? <PagesDialog input={input} story={story} metrics={metrics} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PagesDialog({ input, story, metrics, onClose }: { input: StoryInput; story: Story; metrics: Metric[]; onClose: () => void }) {
  const t = useTranslations("story.download");
  const pages = useDesignedPages(input, story, metrics);
  const refs = useRef(new Map<string, HTMLElement | null>());
  const [busy, setBusy] = useState<string | null>(null);

  async function save(id: string, index: number) {
    const node = refs.current.get(id)?.firstElementChild as HTMLElement | null;
    if (!node) return;
    await downloadNode(node, `${input.title} (${index + 1} ${pages[index].title})`);
  }
  async function saveOne(id: string, index: number) {
    setBusy(id);
    try { await save(id, index); } finally { setBusy(null); }
  }
  async function saveAll() {
    setBusy("all");
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const [index, page] of pages.entries()) {
        const node = refs.current.get(page.id)?.firstElementChild as HTMLElement | null;
        if (!node) continue;
        const number = String(index + 1).padStart(2, "0");
        files.push({ name: `${number}-${slug(page.title)}.png`, blob: await renderPng(node) });
      }
      await downloadZip(files, input.title);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog title={t("title")} onClose={onClose} busy={busy !== null}>
      <p className="text-sm text-[var(--muted)]">{t("lede", { count: pages.length })}</p>
      <ol className="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {pages.map((page, index) => (
          <li key={page.id} className="flex items-center gap-4">
            {/* The real page, shrunk: what you see is what downloads. */}
            <div className="flex-none overflow-hidden rounded-md border border-[var(--line)]" style={{ width: PAGE_WIDTH * PREVIEW, height: PAGE_HEIGHT * PREVIEW }}>
              <div ref={(node) => { refs.current.set(page.id, node); }} style={{ transform: `scale(${PREVIEW})`, transformOrigin: "top left", width: PAGE_WIDTH }}>
                {page.node(index, pages.length)}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium"><span className="mr-1.5 tabular-nums text-[var(--muted)]">{index + 1}</span>{page.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{page.contents}</p>
              <button type="button" disabled={busy !== null} onClick={() => void saveOne(page.id, index)} className="mt-2 cursor-pointer text-xs font-medium text-[var(--main-strong)] disabled:opacity-50">
                {busy === page.id ? t("preparing") : t("one")}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <span className="text-xs text-[var(--muted)]">{t("format")}</span>
        <button type="button" disabled={busy !== null} onClick={() => void saveAll()} className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-[var(--main)] px-4 text-sm font-medium text-white disabled:opacity-55">
          {busy === "all" ? t("preparing") : t("all", { count: pages.length })}
        </button>
      </div>
    </Dialog>
  );
}
