"use client";

import { cx } from "./ui";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Compact single-select on a subtle track: plain word labels and a pill that
 * slides to the active segment. Backs the per-visitor theme and language
 * switches; fills its container's width.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx("relative flex rounded-[11px] bg-[var(--wash)] p-1", className)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-[var(--paper)] transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(calc(${index} * 100%))`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            "relative z-10 flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium tracking-[0.02em] transition-colors",
            option.value === value ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
