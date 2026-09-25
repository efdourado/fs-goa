"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { cx } from "./ui";

/**
 * One horizontal "shelf" on the homepage — a heading with a count and a
 * sideways-scrolling rail of cards. Used for every dashboard section so the
 * whole page reads the same way (Spotify-style) on desktop and phone.
 */
/** The sideways rail's behaviour: a fade that only shows while there is more to scroll to, and the arrows' nudge. */
export function useShelfRail() {
  const railRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  function updateFade() {
    const rail = railRef.current;
    setShowFade(rail ? rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 4 : false);
  }

  // Re-check after every render (children can change) and on viewport resize.
  useEffect(updateFade);
  useEffect(() => {
    window.addEventListener("resize", updateFade);
    return () => window.removeEventListener("resize", updateFade);
  }, []);

  function nudge(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(280, rail.clientWidth * 0.8), behavior: "smooth" });
  }

  return { railRef, showFade, onScroll: updateFade, nudge };
}

/** The two round arrows that scroll a rail; hidden on phones, where a finger does it. */
export function RailArrows({ nudge }: { nudge: (direction: -1 | 1) => void }) {
  const button = "grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--ink)]";
  return (
    <div className="hidden gap-1.5 sm:flex">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(-1)} className={button}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(1)} className={button}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

/** A small dashed "+ new…" pill that sits in a shelf header, not in the rail. */
export function ShelfAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-3 text-xs text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
    >
      <span aria-hidden="true" className="text-sm leading-none">+</span>
      {label}
    </button>
  );
}

/** A rail of cards with the right-edge fade; takes what `useShelfRail` returns, spread. */
export function Rail({ railRef, showFade, onScroll, className, children }: Pick<ReturnType<typeof useShelfRail>, "railRef" | "showFade" | "onScroll"> & { className?: string; children: ReactNode }) {
  return (
    <div className="relative">
      <div
        ref={railRef}
        onScroll={onScroll}
        className={cx(
          "flex gap-4 overflow-x-auto overflow-y-visible pb-3 pt-1",
          "snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {children}
      </div>
      <div className={cx(
        "pointer-events-none absolute inset-y-0 right-0 hidden w-14 bg-gradient-to-r from-transparent to-[var(--canvas)] transition-opacity duration-200 sm:block",
        showFade ? "opacity-100" : "opacity-0",
      )} />
    </div>
  );
}

export function Shelf({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { railRef, showFade, onScroll, nudge } = useShelfRail();

  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-end justify-between gap-3 pr-1">
        <div className="flex shrink-0 items-baseline gap-2.5">
          <span className="whitespace-nowrap text-lg font-medium tracking-[-0.03em] sm:text-xl">{title}</span>
          {count != null ? <span className="text-xs font-medium text-[var(--muted)]">{count}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <RailArrows nudge={nudge} />
        </div>
      </div>
      <Rail railRef={railRef} showFade={showFade} onScroll={onScroll}>{children}</Rail>
    </section>
  );
}
