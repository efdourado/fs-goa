"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cx } from "./ui";

/** One plain row in a `KebabMenu` panel. */
export const menuRowClass = "flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-[var(--wash)]";

/**
 * The small "⋮" on a card and the panel it opens. A card clips its own overflow
 * (rounded corners, a scrolling row of cards), so the panel is a fixed-position
 * portal on `document.body`, anchored to the trigger and capped to the room
 * around it — it scrolls when the options don't all fit. The trigger fades in
 * on hover when an ancestor carries `group`.
 */
export function KebabMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const close = () => setOpen(false);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 240;
    const gap = 12;
    const left = Math.min(Math.max(gap, r.right - width), window.innerWidth - width - gap);
    const below = window.innerHeight - r.bottom - gap;
    if (below >= 240) {
      setBox({ left, top: r.bottom + 4, maxHeight: below });
    } else {
      setBox({ left, bottom: window.innerHeight - r.top + 4, maxHeight: r.top - gap });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const reflow = () => place();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, place]);

  return (
    <span className="flex-none">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "grid h-7 w-7 cursor-pointer place-items-center rounded-full transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100",
          open ? "bg-[var(--wash)] text-[var(--ink)] opacity-100" : "text-[var(--muted)] opacity-60",
        )}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg>
      </button>
      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              style={{ left: box.left, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}
              className="fixed z-[70] w-60 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-1.5 text-sm shadow-[var(--elevate-2)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
