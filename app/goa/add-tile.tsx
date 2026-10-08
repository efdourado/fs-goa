"use client";

import { shelfCardWidth } from "./shelf";
import { cx } from "./ui";

/**
 * The dashed card at the end of a row of challenges — the catalogue's add-tile look, split in two equal halves:
 * "＋ New challenge" and "start by chat", each a full-height button so both are easy to hit on a phone. `fluid`
 * fills a grid cell; otherwise it takes a card's width on a shelf.
 */
export function NewChallengeTile({ label, chatLabel, onCreate, onChat, fluid = false }: {
  label: string;
  chatLabel: string;
  onCreate: () => void;
  onChat: () => void;
  fluid?: boolean;
}) {
  const half = "flex min-h-[8.5rem] sm:min-h-[11rem] cursor-pointer flex-col items-center justify-center gap-2.5 px-3 text-center text-[13px] text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--main)]/25";
  const circle = "grid h-10 w-10 place-items-center rounded-full bg-[var(--main-soft)]";
  return (
    <div className={cx(
      "grid grid-cols-2 divide-x divide-dashed divide-[var(--main-line)] overflow-hidden rounded-[20px] border border-dashed border-[var(--main-line)]",
      fluid ? "w-full" : shelfCardWidth,
    )}>
      <button type="button" onClick={onCreate} className={half}>
        <span aria-hidden="true" className={cx(circle, "text-lg")}>＋</span>
        {label}
      </button>
      <button type="button" onClick={onChat} className={half}>
        <span aria-hidden="true" className={circle}>
          <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M10 3.5c3.9 0 7 2.6 7 5.9s-3.1 5.9-7 5.9c-.8 0-1.6-.1-2.3-.3L4 16.5l1-3.1c-1.2-1.1-2-2.5-2-4.1 0-3.3 3.1-5.8 7-5.8Z" />
          </svg>
        </span>
        {chatLabel}
      </button>
    </div>
  );
}
