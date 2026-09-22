"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * A "..." menu. The panel is `position: fixed`, placed via JS from the trigger's
 * own rect and flipped above it when there isn't room below — plain `absolute`
 * got clipped whenever the trigger sat near the bottom of a scrollable dialog.
 */
export function ActionMenu({ label, iconOnly = false, children }: {
  label: string; iconOnly?: boolean; children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const r = summaryRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 288; // w-72
    const gap = 8;
    const edge = 16;
    const left = Math.min(Math.max(edge, r.right - width), window.innerWidth - width - edge);
    const below = window.innerHeight - r.bottom - gap - edge;
    if (below >= 160) setBox({ left, top: r.bottom + gap, maxHeight: below });
    else setBox({ left, bottom: window.innerHeight - r.top + gap, maxHeight: Math.max(160, r.top - gap - edge) });
  }, []);

  // The native `toggle` event fires for both a click on <summary> and a script
  // setting `.open` (ActionMenuItem's click handler does the latter), so this
  // is the one place that needs to know the open state.
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const onToggle = () => setOpen(details.open);
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const reflow = () => place();
    const close = () => { if (detailsRef.current) detailsRef.current.open = false; };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!detailsRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); summaryRef.current?.focus(); }
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, place]);

  return <details ref={detailsRef} className="relative shrink-0">
    <summary ref={summaryRef} aria-label={label} title={label} className={cx("flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] text-sm hover:bg-[var(--wash)] [&::-webkit-details-marker]:hidden", iconOnly ? "w-11" : "px-4")}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      {!iconOnly ? label : null}
    </summary>
    {open && box ? (
      <div
        ref={panelRef}
        style={{ left: box.left, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}
        className="fixed z-30 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-2 shadow-xl"
      >
        {children}
      </div>
    ) : null}
  </details>;
}

export function ActionMenuItem({ children, onClick, disabled, danger = false }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <button type="button" disabled={disabled} className={cx("flex min-h-11 w-full items-center rounded-xl px-3 py-3 text-left text-sm transition hover:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-45", danger ? "text-[var(--danger)]" : "text-[var(--ink)]")}
    onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } onClick(); }}>{children}</button>;
}
