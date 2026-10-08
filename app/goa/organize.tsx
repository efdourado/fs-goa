"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { CHALLENGE_COLOR_TAGS, type ChallengeColorTag, type ChallengeSummary, type Id } from "./types";
import { CircleMinusIcon, cx } from "./ui";

export function applyColorFilter(
  challenges: ChallengeSummary[],
  tag: ChallengeColorTag | null,
): ChallengeSummary[] {
  return tag ? challenges.filter((challenge) => challenge.colorTag === tag) : challenges;
}

/**
 * How a viewer organises their challenges on Home — a pin and a colour. Edits show at once and are saved in the
 * background; the list is resynced whenever the bootstrap's challenges change underneath. `split` picks out the
 * shelves the page draws.
 */
export function useChallengeOrganizer<K extends string>({ challenges, csrfToken, onChanged, split }: {
  challenges: ChallengeSummary[];
  csrfToken: string;
  onChanged?: () => void;
  split: (challenges: ChallengeSummary[]) => Record<K, ChallengeSummary[]>;
}) {
  const t = useTranslations("dashboard");
  const [colorFilter, setColorFilter] = useState<ChallengeColorTag | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propKey = challenges.map((c) => `${c.id}:${c.pinned ? 1 : 0}:${c.colorTag ?? ""}`).join("|");
  const [items, setItems] = useState(challenges);
  const [prevKey, setPrevKey] = useState(propKey);
  if (propKey !== prevKey) {
    setPrevKey(propKey);
    setItems(challenges);
  }
  const byId = new Map(items.map((c) => [c.id, c]));
  const shelves = split(items);

  async function patchPref(id: Id, patch: { pinned?: boolean; colorTag?: ChallengeColorTag | null }) {
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

  /** Everything a challenge card needs to be pinned and coloured. */
  function cardProps(onManage: (id: Id) => void) {
    return {
      onTogglePin: (id: Id) => patchPref(id, { pinned: !byId.get(id)?.pinned }),
      onSetColor: (id: Id, tag: ChallengeColorTag | null) => patchPref(id, { colorTag: tag }),
      onManage,
    };
  }

  return { shelves, colorFilter, setColorFilter, error, cardProps };
}

/** The colour filter above Home's challenges. */
export function OrganizeBar({ colorFilter, onColorFilter, filteredCount }: {
  colorFilter: ChallengeColorTag | null;
  onColorFilter: (tag: ChallengeColorTag | null) => void;
  /** How many challenges the current colour leaves showing. */
  filteredCount: number;
}) {
  const t = useTranslations("dashboard");
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-4">
      {/* No "All": tapping the chosen colour again clears the filter. */}
      {CHALLENGE_COLOR_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onColorFilter(colorFilter === tag ? null : tag)}
          aria-label={t(`color.${tag}`)}
          aria-pressed={colorFilter === tag}
          className={cx(
            "grid h-9 w-9 place-items-center rounded-full border transition",
            colorFilter === tag ? "border-[var(--main)] bg-[var(--main-soft)]" : "border-[var(--line)] hover:border-[var(--main-line)]",
          )}
        >
          <span className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-[var(--edge)]" style={{ backgroundColor: `var(--tag-${tag})` }} />
        </button>
      ))}
      <span className="flex-1" />
      {colorFilter ? (
        <button type="button" onClick={() => onColorFilter(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]">
          <CircleMinusIcon className="h-4 w-4" />
          {t("filter.context", { count: filteredCount })}
        </button>
      ) : null}
    </div>
  );
}
