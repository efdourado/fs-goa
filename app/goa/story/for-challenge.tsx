"use client";

import { type ReactNode, useMemo } from "react";

import type { ChallengeDetail, Entry } from "../types";
import { dateKeyInSaoPaulo } from "../utils";
import { buildStory, type Story, storyFromChallenge, type StoryInput } from "./model";
import { StoryView } from "./view";

/** A challenge's thread, from what this viewer can see (a sealed rating never gets in). Built once per screen. */
export function useChallengeStory(challenge: ChallengeDetail, entries: Entry[]): { input: StoryInput; story: Story } {
  const input = useMemo(() => storyFromChallenge(challenge, entries, dateKeyInSaoPaulo(new Date())), [challenge, entries]);
  const story = useMemo(() => buildStory(input), [input]);
  return { input, story };
}

/** A template preview's thread: built on the server (names masked, no words), drawn here. Null when it has none. */
export function usePreviewStory(challenge: ChallengeDetail): { input: StoryInput; story: Story } | null {
  const input = challenge.publicStory ?? null;
  const story = useMemo(() => (input ? buildStory(input) : null), [input]);
  return input && story && story.kind !== "empty" ? { input, story } : null;
}

/** The Results tab: the thread and its almanac (the challenge's metrics included); `fallback` only when there's nothing to draw yet. */
export function ChallengeResults({ challenge, input, story, fallback }: { challenge: ChallengeDetail; input: StoryInput; story: Story; fallback: ReactNode }) {
  if (story.kind === "empty") return <>{fallback}</>;
  return <StoryView input={input} story={story} metrics={challenge.metrics ?? []} />;
}
