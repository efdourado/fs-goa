"use client";

import { type ReactNode, useRef } from "react";

import { cx } from "./ui";

/**
 * One horizontal "shelf" on the homepage — a heading with a count and a
 * sideways-scrolling rail of cards. Used for every dashboard section so the
 * whole page reads the same way (Spotify-style) on desktop and phone.
 */
export function Shelf({
  title,
  count,
  onTitleClick,
  actions,
  children,
}: {
  title: string;
  count?: number;
  onTitleClick?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  function nudge(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(280, rail.clientWidth * 0.8), behavior: "smooth" });
  }

  const heading = (
    <span className="text-lg font-medium tracking-[-0.03em] sm:text-xl">{title}</span>
  );

  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-end justify-between gap-3 pr-1">
        <div className="flex items-baseline gap-2.5">
          {onTitleClick ? (
            <button type="button" onClick={onTitleClick} className="cursor-pointer underline-offset-4 hover:underline">
              {heading}
            </button>
          ) : heading}
          {count != null ? <span className="text-xs font-medium text-[var(--muted)]">{count}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <div className="hidden gap-1.5 sm:flex">
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(-1)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--ink)]">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(1)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--ink)]">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="relative">
        <div
          ref={railRef}
          className={cx(
            "flex gap-4 overflow-x-auto overflow-y-visible pb-3 pt-1",
            "snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {children}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-14 bg-gradient-to-r from-transparent to-[var(--canvas)] sm:block" />
      </div>
    </section>
  );
}
