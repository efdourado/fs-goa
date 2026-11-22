"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { ChallengeSummary, Id } from "./types";

/**
 * How a viewer organises their challenges on Home: a pin. It shows at once and is saved in the background; the
 * list is resynced whenever the bootstrap's challenges change underneath. `split` picks out the shelves the page draws.
 */
export function useChallengeOrganizer<K extends string>({ challenges, csrfToken, onChanged, split }: {
  challenges: ChallengeSummary[];
  csrfToken: string;
  onChanged?: () => void;
  split: (challenges: ChallengeSummary[]) => Record<K, ChallengeSummary[]>;
}) {
  const t = useTranslations("dashboard");
  const [error, setError] = useState<string | null>(null);

  const propKey = challenges.map((c) => `${c.id}:${c.pinned ? 1 : 0}`).join("|");
  const [items, setItems] = useState(challenges);
  const [prevKey, setPrevKey] = useState(propKey);
  if (propKey !== prevKey) {
    setPrevKey(propKey);
    setItems(challenges);
  }
  const byId = new Map(items.map((c) => [c.id, c]));
  const shelves = split(items);

  async function patchPref(id: Id, patch: { pinned: boolean }) {
    const snapshot = items;
    setItems((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setError(null);
    try {
      await apiRequest(API_PATHS.challengePrefs(id), { method: "PATCH", csrfToken, body: patch });
      onChanged?.();
    } catch (cause) {
      setItems(snapshot);
      setError((cause as Error).message || t("prefError"));
    }
  }

  /** What a challenge card needs to be pinned. */
  const cardProps = { onTogglePin: (id: Id) => patchPref(id, { pinned: !byId.get(id)?.pinned }) };

  return { shelves, error, cardProps };
}
