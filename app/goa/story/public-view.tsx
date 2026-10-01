"use client";

import { useMemo } from "react";

import { buildStory, type StoryInput } from "./model";
import { DownloadPagesButton } from "./pages";
import { StoryView } from "./view";

/**
 * The thread on a public page (a published results link): the challenge's name and dates on top with its
 * pages to download, then the drawing and the almanac. The input was built on the server with names
 * masked and no private words (lib/goa/challenges/public-story.ts).
 */
export function PublicStory({ input, title, dates, description }: { input: StoryInput; title: string; dates: string; description?: string | null }) {
  const story = useMemo(() => buildStory(input), [input]);
  if (story.kind === "empty") return null;
  return (
    <>
      {/* Centred like a cover: when it ran, what it was called, what it was about — then its pages. */}
      <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center">
        {dates ? <p className="text-sm text-[var(--muted)]">{dates}</p> : null}
        <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">{title}</h1>
        {description ? <p className="mt-4 max-w-xl text-balance text-base leading-7 text-[var(--muted)]">{description}</p> : null}
        <div className="mt-6"><DownloadPagesButton input={input} story={story} tone="plain" /></div>
      </div>
      <StoryView input={input} story={story} />
    </>
  );
}
