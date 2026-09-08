"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

export function ActionMenu({ label, iconOnly = false, children }: {
  label: string; iconOnly?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={ref} className="relative shrink-0">
    <summary aria-label={label} title={label} className={cx("flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] text-sm hover:bg-[var(--wash)] [&::-webkit-details-marker]:hidden", iconOnly ? "w-11" : "px-4")}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      {!iconOnly ? label : null}
    </summary>
    <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-2 shadow-xl">
      {children}
    </div>
  </details>;
}

export function ActionMenuItem({ children, onClick, disabled, danger = false }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <button type="button" disabled={disabled} className={cx("flex min-h-11 w-full items-center rounded-xl px-3 py-3 text-left text-sm transition hover:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-45", danger ? "text-[var(--danger)]" : "text-[var(--ink)]")}
    onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } onClick(); }}>{children}</button>;
}
