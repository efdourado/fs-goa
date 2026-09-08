"use client";

/**
 * A dashed "+" tile that fills the same grid column as the surrounding cards
 * and stretches to the height of its row, with a minimum height on its own.
 */
export function AddTile({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid min-h-14 w-full cursor-pointer select-none place-items-center rounded-2xl border border-dashed border-[var(--line)] text-2xl font-light leading-none text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--line)] disabled:hover:text-[var(--muted)]"
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}
