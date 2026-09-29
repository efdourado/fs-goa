"use client";

import { useMemo } from "react";

import type { ChallengeDetail, Entry } from "../types";
import { dateKeyInSaoPaulo } from "../utils";
import { buildStory, storyFromChallenge } from "./model";
import { StoryView } from "./view";

/** The Results tab's thread: built from what this viewer can see (a sealed rating never gets in). */
export function ChallengeStory({ challenge, entries }: { challenge: ChallengeDetail; entries: Entry[] }) {
  const input = useMemo(() => storyFromChallenge(challenge, entries, dateKeyInSaoPaulo(new Date())), [challenge, entries]);
  const story = useMemo(() => buildStory(input), [input]);
  if (story.kind === "empty") return null;
  return <div className="mb-10"><StoryView input={input} story={story} /></div>;
}
