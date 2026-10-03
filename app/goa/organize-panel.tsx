"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type { CineRow } from "./cine-items";
import { FormDialog } from "./dialog";
import { organiseList, suggestedTraits, type OrganiseItem, type Trait, usableTraits } from "./organize-list";
import type { CatalogRecommender, ChallengeItem, Id, LibraryProperty, Member } from "./types";
import { cx } from "./ui";

/** What the organiser reads: each item's values, the properties on offer, and a title to show per key. */
export interface OrganiseInput {
  items: OrganiseItem[];
  traits: Trait[];
  titles: Record<string, string>;
}

type Labels = (key: "runtime" | "pages" | "year" | "genre" | "author" | "recommender") => string;

const NATIVE: Array<{ key: "runtime" | "pages" | "year" | "genre" | "author" | "recommender"; kind: Trait["kind"]; fair?: boolean }> = [
  { key: "recommender", kind: "category", fair: true },
  { key: "runtime", kind: "number" },
  { key: "pages", kind: "number" },
  { key: "genre", kind: "category" },
  { key: "author", kind: "category" },
  { key: "year", kind: "number" },
];

/** A library's own properties (Attention 1–5, Director…) as organiser properties, by type. Dates aren't spread. */
function customTraits(properties: LibraryProperty[]): Trait[] {
  return properties
    .filter((property) => property.storage === "attribute" && !property.hidden && (property.type === "number" || property.type === "text" || property.type === "boolean"))
    .map((property) => ({ key: `attr:${property.key}`, label: property.label ?? property.key, kind: property.type === "number" ? "number" : "category" }));
}

const asNumber = (value: unknown) => (value === "" || value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null);

/** The wizard's rows (a challenge being created). */
export function organiseFromRows(rows: CineRow[], properties: LibraryProperty[], members: Member[], recommenders: CatalogRecommender[], label: Labels): OrganiseInput {
  const items = rows.map((row): OrganiseItem => ({
    key: row.key,
    values: {
      runtime: asNumber(row.runtimeMinutes),
      pages: asNumber(row.pages),
      year: asNumber(row.year),
      genre: row.mainGenre || null,
      author: row.author || null,
      recommender: row.recommender.kind === "member" ? members.find((member) => member.id === (row.recommender as { userId: Id }).userId)?.name ?? null
        : row.recommender.kind === "external" ? recommenders.find((person) => person.id === (row.recommender as { recommenderId: Id }).recommenderId)?.displayName ?? null
          : null,
      ...Object.fromEntries(customTraits(properties).map((trait) => {
        const raw = row.extra[trait.key.slice(5)];
        return [trait.key, trait.kind === "number" ? asNumber(raw) : raw === undefined || raw === "" ? null : String(raw)];
      })),
    },
  }));
  return {
    items,
    traits: [...NATIVE.map((native) => ({ key: native.key, label: label(native.key), kind: native.kind, fair: native.fair })), ...customTraits(properties)],
    titles: Object.fromEntries(rows.map((row) => [row.key, row.title])),
  };
}

/** A challenge's saved items; `pinned` ones (already logged) keep their place. */
export function organiseFromItems(challengeItems: ChallengeItem[], properties: LibraryProperty[], pinned: Set<Id>, label: Labels): OrganiseInput {
  const items = challengeItems.map((item): OrganiseItem => {
    const catalog = item.catalogItem;
    const attributes = new Map((catalog?.attributes ?? []).map((attribute) => [attribute.key, attribute.value]));
    return {
      key: item.id,
      pinned: pinned.has(item.id),
      values: {
        runtime: catalog?.runtimeMinutes ?? null,
        pages: catalog?.pageCount ?? null,
        year: catalog?.year ?? null,
        genre: catalog?.mainGenre ?? null,
        author: catalog?.author ?? null,
        recommender: item.recommendedBy?.name ?? null,
        ...Object.fromEntries(customTraits(properties).map((trait) => {
          const raw = attributes.get(trait.key.slice(5));
          return [trait.key, trait.kind === "number" ? asNumber(raw) : raw === undefined || raw === "" ? null : String(raw)];
        })),
      },
    };
  });
  return {
    items,
    traits: [...NATIVE.map((native) => ({ key: native.key, label: label(native.key), kind: native.kind, fair: native.fair })), ...customTraits(properties)],
    titles: Object.fromEntries(challengeItems.map((item) => [item.id, item.title])),
  };
}

/** Whether the Organise button is worth showing: three items or more, and something to spread them by. */
export function canOrganise(input: OrganiseInput): boolean {
  return input.items.filter((item) => !item.pinned).length >= 3 && usableTraits(input.items, input.traits).length > 0;
}

/**
 * "Organise for the group": pick which properties to spread, see the new order and why, try another, apply.
 * Nothing changes until Apply.
 */
export function OrganiseDialog({ input, onApply, onClose, busy = false }: {
  input: OrganiseInput;
  onApply: (order: string[]) => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("organise");
  const offered = useMemo(() => usableTraits(input.items, input.traits), [input]);
  const [chosen, setChosen] = useState<string[]>(() => suggestedTraits(input.items, input.traits));
  const [attempt, setAttempt] = useState(0);
  const active = offered.filter((trait) => chosen.includes(trait.key));
  const result = useMemo(() => organiseList(input.items, active, attempt), [input.items, active, attempt]);
  const pinned = new Set(input.items.filter((item) => item.pinned).map((item) => item.key));

  const reason = (row: (typeof result.report)[number]) => {
    if (row.kind === "number") return row.clashes ? t("numberClashes", { label: row.label, count: row.clashes }) : t("numberSpread", { label: row.label });
    if (!row.clashes && row.values && input.traits.find((trait) => trait.key === row.key)?.fair) {
      return t("takeTurns", { names: row.values.slice(0, 3).join(", "), more: Math.max(0, row.values.length - 3) });
    }
    return row.clashes ? t("categoryClashes", { label: row.label, value: row.crowded ?? "", count: row.clashes }) : t("categorySpread", { label: row.label });
  };

  return (
    <FormDialog
      title={t("title")}
      dirty={false}
      busy={busy}
      onCancel={onClose}
      submitDisabled={!active.length || !result.changed}
      submitLabel={t("apply")}
      onSubmit={() => onApply(result.order)}
    >
      <p className="text-sm leading-6 text-[var(--muted)]">{t("intro")}</p>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium">{t("spreadBy")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {offered.map((trait) => {
            const on = chosen.includes(trait.key);
            return (
              <button
                key={trait.key}
                type="button"
                aria-pressed={on}
                onClick={() => { setAttempt(0); setChosen((current) => (on ? current.filter((key) => key !== trait.key) : [...current, trait.key])); }}
                className={cx("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm transition", on ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] hover:border-[var(--main-line)]")}
              >
                {on ? <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                {trait.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {active.length ? (
        <>
          <ul className="mt-5 space-y-1.5 text-sm">
            {!result.changed ? <li className="text-[var(--muted)]">{t("alreadyGood")}</li> : result.report.map((row) => (
              <li key={row.key} className="flex gap-2">
                <span aria-hidden="true" className={cx("mt-[9px] h-1.5 w-1.5 flex-none rounded-full", row.clashes ? "bg-[var(--muted)]" : "bg-[var(--main)]")} />
                {reason(row)}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[13px] font-medium">{t("preview")}</p>
            <button type="button" className="cursor-pointer text-xs text-[var(--main-strong)] hover:underline" onClick={() => setAttempt((value) => value + 1)}>{t("another")}</button>
          </div>
          <ol className="mt-2 max-h-72 divide-y divide-[var(--line)] overflow-y-auto rounded-2xl border border-[var(--line)]">
            {result.order.map((key, index) => (
              <li key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 flex-none text-right text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{input.titles[key]}</span>
                {pinned.has(key) ? <span className="flex-none text-[11px] text-[var(--muted)]">{t("stays")}</span> : null}
              </li>
            ))}
          </ol>
        </>
      ) : <p className="mt-4 text-sm text-[var(--muted)]">{t("pickOne")}</p>}
    </FormDialog>
  );
}
