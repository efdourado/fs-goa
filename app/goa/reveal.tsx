"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { copyText } from "./clipboard";
import { ConfirmDialog } from "./dialog";
import type { ChallengeDetail, ChallengeItem, Entry, EntryTypeView, Id } from "./types";
import { Button, cx } from "./ui";
import { entryRatingReader, itemIdForEntry, valuesAsRecord } from "./utils";

/** The rating type whose answers stay sealed until the group reveals them together, if the challenge has one. */
export function sealedRatingType(challenge: Pick<ChallengeDetail, "entryTypes">): EntryTypeView | null {
  return challenge.entryTypes.find((type) =>
    type.purpose === "rating" && type.answerScope !== "shared" && type.visibilityPolicy === "until_reveal") ?? null;
}

/** Still sealed: nobody has revealed it and the round is still running. */
export function isSealed(challenge: Pick<ChallengeDetail, "status">, item: Pick<ChallengeItem, "revealedAt">): boolean {
  return challenge.status !== "closed" && !item.revealedAt;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

interface Landed {
  id: Id;
  name: string;
  value: number;
  comment: string | null;
  self: boolean;
}

/**
 * The reveal for one item. Before: who has rated (never what), and the button. After: everyone's
 * rating drops onto the scale one by one, the verdict and the comments follow — built to be watched
 * together, or screen-recorded and sent to the group.
 */
export function RevealPanel({
  challenge,
  item,
  type,
  entries,
  userId,
  onReveal,
  onCreateInvite,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  type: EntryTypeView;
  entries: Entry[];
  userId: Id | undefined;
  onReveal?: (itemId: Id) => Promise<void>;
  /** Managers: a link into the group and this challenge, to share with whoever is missing. */
  onCreateInvite?: () => Promise<string>;
}) {
  const t = useTranslations("reveal");
  const participants = challenge.participants.filter((participant) => participant.userId);
  const answered = new Set(item.answeredUserIds ?? []);
  const sealed = isSealed(challenge, item);
  const iRated = Boolean(userId && answered.has(userId));
  const missing = participants.filter((participant) => !answered.has(participant.userId!));
  // After a reveal, someone who hasn't rated yet gets to rate unanchored first — unless they ask to see.
  const [peek, setPeek] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<"idle" | "busy" | "copied" | "shared" | "failed">("idle");

  // "We're revealing — yours is missing": the phone's share sheet where there is one, the clipboard otherwise.
  async function shareInvite() {
    if (!onCreateInvite) return;
    setInvite("busy");
    try {
      const url = await onCreateInvite();
      const text = t("inviteMessage", { title: item.title });
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ text, url });
          setInvite("shared");
          return;
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "AbortError") { setInvite("idle"); return; }
        }
      }
      await copyText(`${text} ${url}`);
      setInvite("copied");
    } catch {
      setInvite("failed");
    }
  }

  async function reveal() {
    if (!onReveal) return;
    setBusy(true);
    try {
      await onReveal(item.id);
    } finally {
      setBusy(false);
    }
  }

  if (!sealed && (iRated || peek || !challenge.isParticipant)) {
    return <RevealStage challenge={challenge} item={item} type={type} entries={entries} userId={userId} />;
  }

  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[var(--spotlight)] p-5 text-[var(--spotlight-ink)] sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xl font-light tracking-[-0.03em]">{sealed ? t("sealedTitle") : t("revealedTitle")}</h3>
        <span className="text-xs text-white/60">{t("countRated", { done: answered.size, total: participants.length })}</span>
      </div>
      <p className="mt-1 max-w-xl text-sm leading-6 text-white/65">{sealed ? t("sealedBody") : t("rateBeforeLooking")}</p>
      <ul className="mt-5 flex flex-wrap gap-2.5" aria-label={t("whoRated")}>
        {participants.map((participant) => {
          const done = answered.has(participant.userId!);
          return (
            <li key={participant.id} className="flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-3">
              <span className={cx(
                "grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold",
                done ? "reveal-sealed bg-[var(--spotlight-ink)] text-[var(--spotlight)]" : "border border-dashed border-white/30 text-white/45",
              )}>{done ? <LockGlyph /> : initials(participant.name)}</span>
              <span className={cx("text-xs", done ? "text-white/85" : "text-white/45")}>
                {participant.userId === userId ? t("you") : participant.name}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {sealed ? (
          iRated || !challenge.isParticipant ? (
            <Button
              className="min-h-12 bg-[var(--main-2)] px-6 text-base text-white"
              disabled={busy || !onReveal || answered.size === 0}
              onClick={() => (missing.length ? setConfirming(true) : void reveal())}
            >
              {busy ? t("revealing") : t("revealButton")}<span aria-hidden="true">→</span>
            </Button>
          ) : (
            <p className="text-sm text-white/80">{t("rateFirst")}</p>
          )
        ) : (
          <button type="button" className="cursor-pointer text-sm text-white/70 underline underline-offset-4 hover:text-white" onClick={() => setPeek(true)}>
            {t("showAnyway")}
          </button>
        )}
        {sealed && missing.some((participant) => participant.userId !== userId) ? (
          <span className="text-xs text-white/55">{t("stillMissing", { names: missing.map((participant) => participant.userId === userId ? t("you") : participant.name).join(", ") })}</span>
        ) : null}
      </div>
      {sealed && onCreateInvite ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/20 px-4 text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-50"
            disabled={invite === "busy"}
            onClick={() => void shareInvite()}
          >
            {participants.length < 2 ? t("inviteFirst") : t("inviteMore")}
          </button>
          <span className="text-xs text-white/55" role="status">
            {invite === "copied" ? t("inviteCopied") : invite === "shared" ? t("inviteShared") : invite === "failed" ? t("inviteFailed") : t("inviteHint")}
          </span>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={t("confirmTitle")}
          body={t("confirmBody", { names: missing.map((participant) => participant.name).join(", ") })}
          confirmLabel={t("confirmAction")}
          busyLabel={t("revealing")}
          onConfirm={async () => { await reveal(); setConfirming(false); }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </section>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" strokeLinecap="round" />
    </svg>
  );
}

/** Distance from the group, as a share of the scale: close is green, far is coral. */
function toneFor(distance: number): string {
  if (distance <= 0.15) return "var(--tag-green)";
  if (distance <= 0.3) return "var(--tag-amber)";
  return "var(--main-2)";
}

const DROP_MS = 520;

function RevealStage({
  challenge,
  item,
  type,
  entries,
  userId,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  type: EntryTypeView;
  entries: Entry[];
  userId: Id | undefined;
}) {
  const t = useTranslations("reveal");
  const nf = useFormatter();
  const [run, setRun] = useState(0);
  const ratingField = type.fields.find((field) => field.type === "rating");
  const commentField = type.fields.find((field) => field.type === "text");
  const min = ratingField?.config?.min ?? 0;
  const max = ratingField?.config?.max ?? 5;
  const range = Math.max(1, max - min);
  const readRating = useMemo(() => entryRatingReader(challenge), [challenge]);

  const landed: Landed[] = [];
  for (const entry of entries) {
    if (entry.entryTypeId !== type.id || itemIdForEntry(entry) !== item.id || !entry.userId) continue;
    const value = readRating(entry);
    if (value === null) continue;
    const raw = commentField?.id ? valuesAsRecord(entry.values)[commentField.id] : null;
    const comment = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    landed.push({ id: entry.userId, name: entry.participantName ?? "—", value, comment, self: entry.userId === userId });
  }

  const mean = landed.length ? landed.reduce((sum, person) => sum + person.value, 0) / landed.length : null;
  // Where the group actually sits: the median, so one outlier doesn't tint everyone else as far off.
  const sorted = landed.map((person) => person.value).sort((a, b) => a - b);
  const center = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0;
  const toneOf = (value: number) => toneFor(Math.abs(value - center) / range);
  // Avatars closer than their own width stack instead of overlapping — measured, so a phone stacks more.
  const scaleRef = useRef<HTMLDivElement>(null);
  const [scaleWidth, setScaleWidth] = useState(0);
  useEffect(() => {
    const node = scaleRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setScaleWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const spread = landed.length > 1 ? (Math.max(...landed.map((p) => p.value)) - Math.min(...landed.map((p) => p.value))) / range : 0;
  const verdict = landed.length < 2 ? "single" : spread === 0 ? "unanimous" : spread <= 0.2 ? "close" : spread <= 0.5 ? "split" : "apart";
  // The one furthest from everyone else, when there is a real gap to name.
  const loner = (() => {
    if (landed.length < 3 || spread < 0.4) return null;
    let best: { person: Landed; gap: number } | null = null;
    for (const person of landed) {
      const others = landed.filter((other) => other !== person);
      const othersMean = others.reduce((sum, other) => sum + other.value, 0) / others.length;
      const gap = Math.abs(person.value - othersMean);
      if (!best || gap > best.gap) best = { person, gap };
    }
    return best && best.gap / range >= 0.35 ? best.person : null;
  })();

  // Expectation vs reality, over the people whose expectation this viewer can see.
  const expectationType = challenge.entryTypes.find((candidate) => candidate.purpose === "expectation");
  const expectationField = expectationType?.fields.find((field) => field.type === "rating");
  const expectation = (() => {
    if (!expectationType || !expectationField?.id) return null;
    const pairs: Array<[number, number]> = [];
    for (const person of landed) {
      const entry = entries.find((candidate) => candidate.entryTypeId === expectationType.id && candidate.userId === person.id && itemIdForEntry(candidate) === item.id);
      const raw = entry ? Number(valuesAsRecord(entry.values)[expectationField.id!]) : NaN;
      if (Number.isFinite(raw)) pairs.push([raw, person.value]);
    }
    if (pairs.length < 1) return null;
    const avg = (index: 0 | 1) => pairs.reduce((sum, pair) => sum + pair[index], 0) / pairs.length;
    return { expected: avg(0), actual: avg(1) };
  })();

  // The closest land first; the outlier drops last.
  const order = [...landed].sort((a, b) => Math.abs(a.value - center) - Math.abs(b.value - center));
  const minGap = scaleWidth ? (44 / scaleWidth) * 100 : 8;
  const placed: Array<{ person: Landed; index: number; level: number; left: number; tone: string }> = [];
  for (const [index, person] of order.entries()) {
    const left = ((person.value - min) / range) * 100;
    let level = 0;
    while (placed.some((other) => other.level === level && Math.abs(other.left - left) < minGap)) level += 1;
    placed.push({ person, index, level, left, tone: toneOf(person.value) });
  }
  const tallest = Math.max(1, ...placed.map((spot) => spot.level + 1));
  const afterDrops = order.length * DROP_MS + 250;
  const ticks = Array.from({ length: Math.floor(range) + 1 }, (_, index) => min + index).filter((tick) => range <= 10 || tick % Math.ceil(range / 5) === 0);
  const fmt = (value: number) => nf.number(value, { maximumFractionDigits: 1 });
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

  return (
    <section key={run} className="relative overflow-hidden rounded-[24px] bg-[var(--spotlight)] p-5 text-[var(--spotlight-ink)] sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xl font-light tracking-[-0.03em]">{item.title}</h3>
        <button type="button" className="cursor-pointer text-xs text-white/60 underline-offset-4 hover:text-white hover:underline" onClick={() => setRun((value) => value + 1)}>
          ↺ {t("replay")}
        </button>
      </div>

      {/* The scale: each person drops onto their number, stacked when two agree exactly. */}
      <div ref={scaleRef} className="relative mx-4 mt-6 sm:mx-6" style={{ height: `${tallest * 46 + 40}px` }}>
        {mean !== null ? (
          <div className="reveal-fade absolute bottom-6 top-0 w-px -translate-x-1/2 border-l border-dashed border-white/35" style={{ left: `${((mean - min) / range) * 100}%`, ...delay(afterDrops) }}>
            <span className="absolute -top-1 left-1.5 whitespace-nowrap text-[10px] uppercase tracking-wider text-white/55">{t("average")} {fmt(mean)}</span>
          </div>
        ) : null}
        {placed.map(({ person, index, level, left, tone }) => (
          <div key={person.id} className="absolute bottom-6 -translate-x-1/2" style={{ left: `${left}%`, marginBottom: `${level * 46}px` }}>
            <div className="reveal-drop flex flex-col items-center" style={delay(index * DROP_MS)}>
              <span
                className={cx("grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white shadow-lg", person.self && "ring-2 ring-white ring-offset-2 ring-offset-[var(--spotlight)]")}
                style={{ background: tone }}
                title={`${person.name} · ${fmt(person.value)}`}
              >
                {initials(person.name)}
              </span>
              {level === 0 ? <span className="h-2 w-0.5" style={{ background: tone }} aria-hidden="true" /> : null}
            </div>
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-6 h-0.5 rounded-full bg-white/20" />
        {ticks.map((tick) => (
          <span key={tick} className="absolute bottom-0 -translate-x-1/2 text-[11px] tabular-nums text-white/45" style={{ left: `${((tick - min) / range) * 100}%` }}>{tick}</span>
        ))}
      </div>

      <div className="reveal-rise mt-6" style={delay(afterDrops + 150)}>
        <p className="text-3xl font-light leading-tight tracking-[-0.04em] sm:text-4xl">{t(`verdict.${verdict}`)}</p>
        <p className="mt-2 text-sm text-white/65">
          {[
            loner ? t("loner", { name: loner.self ? t("you") : loner.name, value: fmt(loner.value) }) : null,
            expectation ? t("expectation", { expected: fmt(expectation.expected), actual: fmt(expectation.actual) }) : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* Everyone's line, lowest to highest, with what they said. */}
      <ul className="mt-6 space-y-2.5">
        {[...landed].sort((a, b) => b.value - a.value).map((person, index) => (
          <li key={person.id} className="reveal-rise flex gap-3 rounded-2xl bg-white/[0.05] p-3" style={delay(afterDrops + 450 + index * 160)}>
            <span className="w-9 flex-none text-lg font-medium tabular-nums" style={{ color: toneOf(person.value) }}>{fmt(person.value)}</span>
            <div className="min-w-0 leading-snug">
              <span className="block text-xs text-white/55">{person.self ? t("you") : person.name}</span>
              {person.comment ? <p className="mt-0.5 whitespace-pre-line text-sm text-white/90">“{person.comment}”</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
