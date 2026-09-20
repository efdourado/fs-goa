"use client";

import { cx } from "./ui";

/**
 * The dashed "＋ label" tile — a soft circle with a plus above the action's name. The caller sets its width and
 * aspect ratio, to match a cover.
 */
export function AddCardTile({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[20px] border border-dashed border-[var(--main-line)] text-[var(--main-strong)] transition hover:bg-[var(--main-soft)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
        className,
      )}
    >
      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-[var(--main-soft)] text-lg">＋</span>
      <span className="text-[13px]">{label}</span>
    </button>
  );
}
