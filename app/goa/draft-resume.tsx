"use client";

import { useTranslations } from "next-intl";

import { cx } from "./ui";

/** The title cut back to whole words so the phone bar's line fits ("Os melhores bares do centro da cidade" → "Os melhores bares"). */
function shortTitle(title: string, max = 22): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 8 ? cut.slice(0, space) : cut).trimEnd();
}

/** "Carry on": an arrow pointing right inside a circle. */
const ContinueIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="10" cy="10" r="7.5" /><path d="M6.75 10h6.5M10.5 7.25 13.25 10l-2.75 2.75" />
  </svg>
);

/**
 * The way back into a challenge left half-made: a round button at the bottom right on a computer, with a tiny
 * "Draft" under it; on a phone, a full-width bar above the dock that says what it continues, with a circled minus
 * to throw the draft away and the arrow at its end.
 */
export function DraftResume({ title, aboveDock, onOpen, onDiscard }: {
  title: string;
  /** A dock sits at the phone's bottom edge here, so the bar goes above it. */
  aboveDock: boolean;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("createChallenge");
  const label = t("resumeDraft", { title });
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        title={label}
        className="group fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-[max(1.5rem,env(safe-area-inset-right))] z-[80] hidden cursor-pointer flex-col items-center gap-1 focus-visible:outline-none sm:flex"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-2)] transition group-hover:-translate-y-0.5 group-focus-visible:ring-4 group-focus-visible:ring-[var(--main)]/30">
          <ContinueIcon className="h-6 w-6" />
        </span>
        <span aria-hidden="true" className="text-[10px] font-medium text-[var(--muted)]">{t("draftLabel")}</span>
      </button>
      <div
        className={cx(
          "fixed inset-x-3 z-[80] flex items-center gap-1 rounded-full bg-[var(--main)] p-1.5 text-white shadow-[var(--elevate-2)] sm:hidden",
          aboveDock ? "bottom-[calc(env(safe-area-inset-bottom)+5.25rem)]" : "bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]",
        )}
      >
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t("discardDraft")}
          title={t("discardDraft")}
          className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full text-white/55 transition hover:bg-white/15 hover:text-white"
        >
          {/* The circled minus every close and discard wears, the arrow's size, quieter. */}
          <svg viewBox="0 0 20 20" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M6.75 10h6.5" /></svg>
        </button>
        <button type="button" onClick={onOpen} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-full pr-2 text-left text-sm font-medium">
          {/* Always ends in "…"; a long title keeps its first whole words ("Continuar “Os melhores bares”…"). */}
          <span className="min-w-0 flex-1 truncate">
            {t("resumeDraft", { title: shortTitle(title) })}
          </span>
          <ContinueIcon className="h-[22px] w-[22px] flex-none" />
        </button>
      </div>
    </>
  );
}
