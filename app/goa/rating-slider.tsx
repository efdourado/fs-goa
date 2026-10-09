"use client";

import { useFormatter } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import { cx } from "./ui";

/**
 * A rating on a phone: one track across the whole width instead of a row of pills that scrolls sideways.
 * Drag along it or tap anywhere; it snaps to the scale's steps and the number above follows. A touch only
 * starts picking once it moves sideways, so scrolling the form past a rating never sets one by accident.
 */
export function RatingSlider({
  choices,
  value,
  disabled,
  label,
  clearLabel,
  onPick,
}: {
  /** Every value the scale allows, lowest first (0, 0.5 … 5). */
  choices: number[];
  value: number | null;
  disabled: boolean;
  label: string;
  clearLabel: string;
  onPick: (rating: number | null) => void;
}) {
  const nf = useFormatter();
  const rail = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const last = choices.length - 1;
  const index = value === null ? -1 : choices.indexOf(value);
  const fraction = index <= 0 || last <= 0 ? 0 : index / last;
  const fmt = (rating: number) => nf.number(rating, { maximumFractionDigits: 2 });

  function pick(next: number) {
    if (next === value) return;
    // A faint tick under the finger on each step, where the phone can do it.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(4);
    onPick(next);
  }
  function pickAt(clientX: number) {
    const box = rail.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const at = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    pick(choices[Math.round(at * last)]);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: event.pointerType === "mouse" };
    if (event.pointerType === "mouse") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      pickAt(event.clientX);
    }
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.moved) {
      const dx = Math.abs(event.clientX - current.x);
      if (dx < 6 || dx < Math.abs(event.clientY - current.y)) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    pickAt(event.clientX);
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    // A tap that never slid: it lands where it touched.
    if (current && current.id === event.pointerId && !current.moved) pickAt(event.clientX);
    gesture.current = null;
    setDragging(false);
  }
  function onPointerCancel() {
    // The browser took the touch for a scroll.
    gesture.current = null;
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const from = index < 0 ? 0 : index;
    const moves: Record<string, number> = {
      ArrowRight: from + 1, ArrowUp: from + 1, ArrowLeft: from - 1, ArrowDown: from - 1,
      PageUp: from + 2, PageDown: from - 2, Home: 0, End: last,
    };
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      onPick(null);
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    pick(choices[Math.min(last, Math.max(0, index < 0 && event.key.startsWith("Arrow") ? 0 : moves[event.key]))]);
  }

  const integers = choices.map((rating, position) => ({ rating, position })).filter(({ rating }) => Number.isInteger(rating));
  const ease = dragging ? "" : "transition-[left,width] duration-200 ease-out";
  return (
    <div className={cx(disabled && "opacity-60")}>
      <div className="flex items-end justify-between gap-3">
        <p className="tabular-nums" aria-hidden="true">
          <span className={cx("text-[40px] font-light leading-none tracking-[-0.05em]", value === null && "text-[var(--muted)]")}>{value === null ? "?" : fmt(value)}</span>
          <span className="ml-1.5 text-sm text-[var(--muted)]">/ {fmt(choices[last] ?? 5)}</span>
        </p>
        {value !== null && !disabled ? (
          <button type="button" onClick={() => onPick(null)} className="min-h-9 cursor-pointer px-1 text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline">{clearLabel}</button>
        ) : null}
      </div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={choices[0]}
        aria-valuemax={choices[last]}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? undefined : fmt(value)}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        className={cx(
          "relative mt-2 h-12 touch-pan-y select-none rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        {/* Inset by half a thumb so the ends of the scale sit inside the track, not past its edges. */}
        <div ref={rail} className="absolute inset-x-3.5 inset-y-0">
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--wash-strong)]" />
          {value !== null ? (
            <span aria-hidden="true" className={cx("absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--main)]", ease)} style={{ width: `${fraction * 100}%` }} />
          ) : null}
          {choices.map((rating, position) => (
            <span
              key={rating}
              aria-hidden="true"
              className={cx(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                Number.isInteger(rating) ? "h-2 w-2" : "h-1 w-1",
                position < index ? "bg-white/90" : "bg-[var(--muted)]/40",
              )}
              style={{ left: `${last ? (position / last) * 100 : 0}%` }}
            />
          ))}
          {value !== null ? (
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)] shadow-[0_2px_10px_rgba(32,36,31,0.22)] ring-[3px] ring-[var(--main)] transition-[scale] duration-150",
                dragging && "scale-125",
                ease,
              )}
              style={{ left: `${fraction * 100}%` }}
            />
          ) : null}
        </div>
      </div>
      <div className="relative mx-3.5 h-4" aria-hidden="true">
        {integers.map(({ rating, position }) => (
          <span
            key={rating}
            className={cx("absolute top-0 -translate-x-1/2 text-[11px] tabular-nums", rating === value ? "font-medium text-[var(--main-strong)]" : "text-[var(--muted)]")}
            style={{ left: `${last ? (position / last) * 100 : 0}%` }}
          >
            {fmt(rating)}
          </span>
        ))}
      </div>
    </div>
  );
}
