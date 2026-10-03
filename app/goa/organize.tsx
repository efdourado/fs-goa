"use client";

import { useTranslations } from "next-intl";
import { type DragEvent, useRef, useState } from "react";

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
 * How a viewer organises their challenges — pin, colour, and a manual order — shared by Home and My space, so
 * a change made on one shows on the other. Edits show at once and are saved in the background; the list is
 * resynced whenever the bootstrap's challenges change underneath.
 *
 * The order is one list for all of the viewer's challenges: a page sends it whole, with only its own section
 * shuffled, so it never scrambles what the other page shows. `challenges` is therefore always the full list;
 * `split` picks out the sections this page draws.
 */
export function useChallengeOrganizer<K extends string>({ challenges, csrfToken, onChanged, keys, split, orderLocked = false }: {
  challenges: ChallengeSummary[];
  /** The viewer locked the app: no reordering at all — pin and colour still work. */
  orderLocked?: boolean;
  csrfToken: string;
  onChanged?: () => void;
  /** The page's sections, in the order they appear. */
  keys: readonly K[];
  /** Divides the challenges (already in the viewer's order) into those sections. */
  split: (ordered: ChallengeSummary[]) => Record<K, ChallengeSummary[]>;
}) {
  const t = useTranslations("dashboard");
  const [colorFilter, setColorFilter] = useState<ChallengeColorTag | null>(null);
  const [reorderRequested, setReorderMode] = useState(false);
  const reorderMode = reorderRequested && !orderLocked;
  const [error, setError] = useState<string | null>(null);

  const propKey = challenges.map((c) => `${c.id}:${c.pinned ? 1 : 0}:${c.colorTag ?? ""}:${c.sortIndex ?? ""}`).join("|");
  const [items, setItems] = useState(challenges);
  const [order, setOrder] = useState<Id[]>(() => challenges.map((c) => c.id));
  const [prevKey, setPrevKey] = useState(propKey);
  if (propKey !== prevKey) {
    setPrevKey(propKey);
    setItems(challenges);
    setOrder(challenges.map((c) => c.id));
  }
  const dragId = useRef<Id | null>(null);

  const byId = new Map(items.map((c) => [c.id, c]));
  const ordered = order.map((id) => byId.get(id)).filter((c): c is ChallengeSummary => Boolean(c));
  const shelves = split(ordered);
  const shelfOf = (id: Id): K | null => keys.find((key) => shelves[key].some((c) => c.id === id)) ?? null;

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

  async function persistOrder(nextOrder: Id[]) {
    setError(null);
    try {
      await apiRequest(API_PATHS.challengeOrder, { method: "PATCH", csrfToken, body: { ids: nextOrder } });
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message || t("prefError"));
    }
  }

  /** Slot one section's ids back into the global order, keeping every other id put. */
  function withShelfReordered(shelfKey: K, nextShelfIds: Id[]): Id[] {
    const shelfSet = new Set(shelves[shelfKey].map((c) => c.id));
    let cursor = 0;
    return order.map((id) => (shelfSet.has(id) ? nextShelfIds[cursor++] ?? id : id));
  }

  function move(id: Id, dir: -1 | 1) {
    const shelfKey = shelfOf(id);
    if (!shelfKey) return;
    const ids = shelves[shelfKey].map((c) => c.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const next = withShelfReordered(shelfKey, ids);
    setOrder(next);
    void persistOrder(next);
  }

  function dragOver(shelfKey: K, overId: Id) {
    const source = dragId.current;
    if (!source || source === overId) return;
    const ids = shelves[shelfKey].map((c) => c.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(withShelfReordered(shelfKey, ids));
  }

  /** Everything a challenge card needs to be pinned, coloured and moved within its section. */
  function cardProps(shelfKey: K, challenge: ChallengeSummary, onManage: (id: Id) => void) {
    // "Move up/down" only makes sense against the real section order — the list `move()` reorders — so the
    // ends are read from there, not from a colour-filtered view.
    const fullIds = shelves[shelfKey].map((c) => c.id);
    const at = fullIds.indexOf(challenge.id);
    return {
      canMoveUp: !orderLocked && at > 0,
      canMoveDown: !orderLocked && at > -1 && at < fullIds.length - 1,
      onTogglePin: (id: Id) => patchPref(id, { pinned: !byId.get(id)?.pinned }),
      onSetColor: (id: Id, tag: ChallengeColorTag | null) => patchPref(id, { colorTag: tag }),
      onMove: orderLocked ? undefined : move,
      onManage,
      reorderMode,
      dragHandlers: reorderMode
        ? {
            onDragStart: () => { dragId.current = challenge.id; },
            onDragOver: (event: DragEvent) => { event.preventDefault(); dragOver(shelfKey, challenge.id); },
            onDrop: () => { void persistOrder(order); },
            onDragEnd: () => { dragId.current = null; void persistOrder(order); },
          }
        : undefined,
    };
  }

  return { shelves, colorFilter, setColorFilter, reorderMode, setReorderMode, error, cardProps };
}

/** The colour filter and the Reorder switch above a page's challenges. */
/** View: two stacked rows, the layout of Home. */
function ViewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="4" rx="1.3" /><rect x="2.5" y="9" width="11" height="4" rx="1.3" />
    </svg>
  );
}

/** Reorder: an arrow up beside an arrow down. */
function ReorderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 13V3M3 5.5 5.5 3 8 5.5M10.5 3v10M8 10.5l2.5 2.5 2.5-2.5" />
    </svg>
  );
}

/** One of Home's two tools (View, Reorder): a quiet label with its icon, filled while it's on. */
export function HomeTool({ icon, label, on, onClick }: { icon: "view" | "reorder"; label: string; on: boolean; onClick: () => void }) {
  const Icon = icon === "view" ? ViewIcon : ReorderIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition",
        on ? "bg-[var(--main-soft)] text-[var(--main-strong)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export function OrganizeBar({ colorFilter, onColorFilter, reorderMode, onReorderMode, filteredCount, allowReorder = true, view }: {
  colorFilter: ChallengeColorTag | null;
  /** The View tool, sitting beside Reorder (absent when the app is locked). */
  view?: { open: boolean; onToggle: () => void };
  /** False when the viewer locked the app — the Reorder switch goes away. */
  allowReorder?: boolean;
  onColorFilter: (tag: ChallengeColorTag | null) => void;
  reorderMode: boolean;
  onReorderMode: (on: boolean) => void;
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
      ) : (
        <div className="flex items-center gap-1">
          {view ? <HomeTool icon="view" label={t("home.view")} on={view.open} onClick={view.onToggle} /> : null}
          {allowReorder ? <HomeTool icon="reorder" label={reorderMode ? t("filter.reorderDone") : t("filter.reorder")} on={reorderMode} onClick={() => onReorderMode(!reorderMode)} /> : null}
        </div>
      )}
    </div>
  );
}
