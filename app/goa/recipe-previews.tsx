"use client";

import type { RecipeIconName } from "./recipe-icons";

function Stars({ filled }: { filled: number }) {
  return (
    <span className="tracking-[0.08em]">
      {[0, 1, 2, 3, 4].map((index) => <span key={index} className={index < filled ? "text-[var(--main)]" : "text-[var(--line)]"}>★</span>)}
    </span>
  );
}

const row = "flex items-center justify-between gap-2";
const chip = "grid h-5 min-w-5 place-items-center rounded-md border border-[var(--line)] bg-[var(--paper)] px-1 text-[11px] text-[var(--ink)]";

/**
 * A miniature of what a person logs in each starting point — a rating, a page count, a check-in — so the
 * choice can be made by looking instead of reading. Purely an illustration: names are proper nouns and the
 * rest is glyphs, so it reads the same in every language.
 */
export function RecipePreview({ recipe }: { recipe: RecipeIconName }) {
  return (
    <span aria-hidden="true" className="mt-3 block rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-2.5 py-2 text-xs text-[var(--muted)]">
      {recipe === "cinema" ? <span className={row}><span className="truncate">Aftersun</span><Stars filled={4} /></span> : null}
      {recipe === "bookshelf" ? <span className={row}><span className="truncate">Persepolis</span><Stars filled={5} /></span> : null}
      {recipe === "library" ? (
        <>
          <span className={row}><span className="truncate">Persepolis</span><span>p. 42</span></span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full w-2/5 rounded-full bg-[var(--main-2)]" /></span>
        </>
      ) : null}
      {recipe === "habit" ? (
        <span className={row}>
          <span className="flex gap-1">
            {[1, 1, 1, 0, 1, 1, 1].map((done, index) => <span key={index} className={done ? "h-2.5 w-2.5 rounded-full bg-[var(--main)]" : "h-2.5 w-2.5 rounded-full border border-[var(--line)]"} />)}
          </span>
          <span>6/7</span>
        </span>
      ) : null}
      {recipe === "tables" ? <span className={row}><span className="truncate">Trattoria</span><span className="text-[var(--ink)]">4 · 3 · 5</span></span> : null}
      {recipe === "custom" ? <span className="flex gap-1.5"><span className={chip}>Aa</span><span className={chip}>12</span><span className={chip}>✓</span></span> : null}
    </span>
  );
}
