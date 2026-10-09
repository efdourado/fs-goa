"use client";

import { cx, InModal } from "./ui";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that slides up from the bottom edge — the phone-friendly stand-in for
 * a header dropdown. Backdrop tap and Escape close it; focus moves inside on
 * open and returns to the opener on close. Rendered through a portal on
 * `document.body` so a `backdrop-filter` on the header (which would otherwise
 * become the containing block for `position: fixed`) can't trap or clip it.
 */
export function BottomSheet({
  title,
  onClose,
  children,
  tall = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Nearly the whole screen on a phone — for work done inside it (logging a workout), not a short menu. */
  tall?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The latest onClose, without making the effect below run again: a caller's handler is often a new function on
  // every render, and re-running would pull focus back to the first button (closing a phone's keyboard mid-typing).
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  // Once, on open: focus moves in, Escape closes, the page behind stops scrolling.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  if (typeof document === "undefined") return null;

  // The backdrop closes on a tap that lands on itself; Escape is handled above,
  // so the keyboard path is covered.
  /* eslint-disable jsx-a11y/no-static-element-interactions */
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/45 sm:items-center sm:justify-center sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "safe-area-bottom overflow-y-auto rounded-t-[26px] border-t border-[var(--line)] bg-[var(--paper)] px-5 pb-8 pt-2 shadow-[var(--elevate-2)]",
          // From `sm:` up it's a card in the middle of the screen rather than a panel from the edge.
          "sm:w-full sm:max-w-2xl sm:rounded-[26px] sm:border",
          tall ? "max-h-[92dvh] min-h-[70dvh] sm:min-h-0" : "max-h-[85dvh]",
        )}
      >
        <div className="mx-auto mb-3 mt-1.5 h-1.5 w-10 rounded-full bg-[var(--wash-strong)]" aria-hidden="true" />
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-medium tracking-[-0.02em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={title}
            className="grid h-9 w-9 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"
          >
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M6.75 10h6.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <InModal.Provider value>{children}</InModal.Provider>
      </div>
    </div>,
    document.body,
  );
  /* eslint-enable jsx-a11y/no-static-element-interactions */
}
