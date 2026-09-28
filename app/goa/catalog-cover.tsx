"use client";

import type { CSSProperties, ReactNode } from "react";

import { cx } from "./ui";

export const COVER_TONES = ["green", "blue", "violet", "coral", "amber", "rose"] as const;
export type CoverTone = (typeof COVER_TONES)[number];

/** One of the six tag colours per title, stable — the same title always gets the same cover. */
export function coverToneOf(title: string): CoverTone {
  let hash = 5381;
  for (const char of title.trim().toLowerCase()) hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0;
  return COVER_TONES[hash % COVER_TONES.length];
}

/** The cover's three colours, mixed from the theme's own tokens so light and dark both hold. */
function coverColors(tone: CoverTone): CSSProperties {
  const color = `var(--tag-${tone})`;
  return {
    "--cover-bg": `color-mix(in srgb, ${color} 20%, var(--paper))`,
    "--cover-deco": `color-mix(in srgb, ${color} 34%, var(--paper))`,
    "--cover-ink": `color-mix(in srgb, ${color} 38%, var(--ink))`,
  } as CSSProperties;
}

/** A 0–5 average as a ring with the number inside; a dashed empty ring when nothing is rated yet. */
export function ScoreRing({ value, size, label, strokeWidth = 2.6, className, textClassName, caption }: {
  value: number | null | undefined;
  size: number;
  label: string;
  strokeWidth?: number;
  className?: string;
  /** The number's own type — size, weight and tracking. */
  textClassName?: string;
  /** A small line under the number, inside the ring. */
  caption?: string;
}) {
  const rated = value !== null && value !== undefined;
  const percent = rated ? Math.max(0, Math.min(100, (value / 5) * 100)) : 0;
  return (
    <span role="img" aria-label={label} className={cx("relative inline-grid flex-none place-items-center rounded-full", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--wash-strong)" strokeWidth={strokeWidth} strokeDasharray={rated ? undefined : "2 3"} />
        {rated ? <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--main)" strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${percent} 100`} /> : null}
      </svg>
      <span className="relative flex flex-col items-center tabular-nums">
        <span className={textClassName ?? "text-[13px] font-medium"}>{rated ? value.toFixed(1) : "—"}</span>
        {caption ? <span className="mt-1 text-xs text-[var(--muted)]">{caption}</span> : null}
      </span>
    </span>
  );
}

/** The cover reduced to a colour chip with its ring — for rows, where the title is written beside it. */
export function CoverSwatch({ title, className }: { title: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-[var(--cover-bg)]", className)} style={coverColors(coverToneOf(title))}>
      <span className="absolute -bottom-3 -right-3 h-8 w-8 rounded-full border-[6px] border-[var(--cover-deco)]" />
    </span>
  );
}

const SIZES = {
  sm: { clamp: "line-clamp-4 pr-5", pad: "p-[15px]", year: "text-[10px]", title: "text-[21px]", ring: "-right-[46px] -bottom-[46px] h-[148px] w-[148px] border-[19px]", badge: 40, badgeText: "text-[12px] font-medium", badgeInset: "bottom-2.5 right-2.5" },
  md: { clamp: "line-clamp-4 pr-5", pad: "p-4 sm:p-[18px]", year: "text-[10px] sm:text-[11px]", title: "text-[21px] sm:text-[25px]", ring: "-right-[54px] -bottom-[54px] h-[176px] w-[176px] border-[22px]", badge: 46, badgeText: "text-[13px] font-medium", badgeInset: "bottom-3 right-3" },
  xl: { clamp: "line-clamp-5", pad: "p-7", year: "text-[13px]", title: "text-[54px]", ring: "-right-[90px] -bottom-[90px] h-[300px] w-[300px] border-[38px]", badge: 0, badgeText: "", badgeInset: "" },
} as const;

/**
 * A typographic cover for a catalogue item — there are no images, so the title itself is the artwork:
 * a soft tint from the tag palette, the year in mono, the title set large, one quiet ring, and (on the
 * smaller sizes) the group rating in the corner.
 */
export function ItemCover({ title, year, avg, ratingLabel, showBadge = true, size, className, children }: {
  title: string;
  /** Whatever the library chose for the top slot — a year, a short attribute value, or blank. */
  year?: string | number | null;
  avg?: number | null;
  ratingLabel?: string;
  /** The library's own choice to turn off the rating ring — distinct from "no rating yet", which still shows the ring. */
  showBadge?: boolean;
  size: keyof typeof SIZES;
  className?: string;
  /** Laid over the cover — a selection mark, say. */
  children?: ReactNode;
}) {
  const spec = SIZES[size];
  return (
    <span
      className={cx("relative flex aspect-[3/4] w-full flex-col overflow-hidden bg-[var(--cover-bg)] text-[var(--cover-ink)]", size === "xl" ? "justify-between rounded-[28px] shadow-[var(--elevate-2)]" : "gap-2.5 rounded-[20px] shadow-[var(--elevate-1)]", spec.pad, className)}
      style={coverColors(coverToneOf(title))}
    >
      <span aria-hidden="true" className={cx("absolute rounded-full border-[var(--cover-deco)]", spec.ring)} />
      <span aria-hidden="true" className="absolute right-3.5 top-3.5 h-2.5 w-2.5 rounded-full bg-[var(--cover-deco)]" />
      <span className={cx("relative truncate tracking-[0.08em]", spec.year)} style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>{year ?? "\u00a0"}</span>
      <span className={cx("relative break-words font-light leading-[1.05] tracking-[-0.04em]", spec.clamp, spec.title)}>{title}</span>
      {spec.badge && showBadge ? (
        <span className={cx("absolute", spec.badgeInset)}>
          <ScoreRing value={avg} size={spec.badge} label={ratingLabel ?? ""} className="bg-[var(--paper)] shadow-[0_2px_8px_rgba(32,36,31,0.14)]" textClassName={spec.badgeText} />
        </span>
      ) : null}
      {children}
    </span>
  );
}
