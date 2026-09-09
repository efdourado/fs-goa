"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A panel that slides up from the bottom edge — the phone-friendly stand-in for
 * a header dropdown. Backdrop tap and Escape close it; focus moves inside on
 * open and returns to the opener on close.
 */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  // The backdrop closes on a tap that lands on itself; Escape is handled above,
  // so the keyboard path is covered.
  /* eslint-disable jsx-a11y/no-static-element-interactions */
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="safe-area-bottom max-h-[85dvh] overflow-y-auto rounded-t-[26px] border-t border-[var(--line)] bg-[var(--paper)] px-5 pb-8 pt-2 shadow-[var(--elevate-2)]"
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
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  /* eslint-enable jsx-a11y/no-static-element-interactions */
}
