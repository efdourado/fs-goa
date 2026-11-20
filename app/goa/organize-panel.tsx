"use client";

import { StateButton } from "./state-button";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type { CineRow } from "./cine-items";
import { FormDialog } from "./dialog";
import { organiseOptions, suggestedTraits, type OrganiseItem, type Trait, usableTraits } from "./organize-list";
import { editableProperties, type PropertyValues, valuesFromItem } from "./property-inputs";
import type { ChallengeItem, Id, LibraryProperty } from "./types";
import { CircleCheckIcon, cx } from "./ui";

/** What the organiser reads: each item's values, the properties on offer, and a title to show per key. */
export interface OrganiseInput {
  items: OrganiseItem[];
  traits: Trait[];
  titles: Record<string, string>;
}

type PropertyName = (property: LibraryProperty) => string;
type PropertiesByKind = ReadonlyMap<string, LibraryProperty[]>;

function organiseProperties(propertiesByKind: PropertiesByKind, name: PropertyName) {
  const traits = new Map<string, Trait>();
  const byKind = new Map([...propertiesByKind].map(([kind, properties]) => [kind, editableProperties(properties).map((property) => {
    const label = name(property);
    // Native fields with the same display name can be compared across libraries. Custom fields belong to one library.
    const key = JSON.stringify([property.storage === "native" ? null : kind, property.key, property.type, label]);
    traits.set(key, { key, label, kind: property.type === "number" || property.type === "date" ? "number" : "category", suggest: property.key !== "year" });
    return { property, key };
  })]));
  return {
    traits: [...traits.values()],
    values(kind: string, read: (properties: LibraryProperty[]) => PropertyValues): OrganiseItem["values"] {
      const columns = byKind.get(kind) ?? [];
      const raw = read(columns.map(({ property }) => property));
      return Object.fromEntries(columns.map(({ property, key }) => {
        const value = raw[property.key]?.trim();
        if (!value) return [key, null];
        if (property.type === "text" || property.type === "boolean") return [key, value];
        const number = property.type === "date" ? Date.parse(value) : Number(value);
        return [key, Number.isFinite(number) ? number : null];
      }));
    },
  };
}

/** The wizard's rows (a challenge being created). */
export function organiseFromRows(rows: CineRow[], properties: PropertiesByKind, defaultKind: string, name: PropertyName, rowValues: (row: CineRow, columns: LibraryProperty[]) => PropertyValues): OrganiseInput {
  const model = organiseProperties(properties, name);
  return {
    items: rows.map((row) => ({ key: row.key, values: model.values(row.libraryKind || defaultKind, (columns) => rowValues(row, columns)) })),
    traits: model.traits,
    titles: Object.fromEntries(rows.map((row) => [row.key, row.title])),
  };
}

/** A challenge's saved items; `pinned` ones (already logged) keep their place. */
export function organiseFromItems(challengeItems: ChallengeItem[], properties: PropertiesByKind, pinned: Set<Id>, name: PropertyName): OrganiseInput {
  const model = organiseProperties(properties, name);
  return {
    items: challengeItems.map((item) => {
      const catalog = item.catalogItem;
      return {
        key: item.id,
        pinned: pinned.has(item.id),
        values: catalog ? model.values(catalog.kind, (columns) => valuesFromItem(columns, catalog)) : {},
      };
    }),
    traits: model.traits,
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
  const active = useMemo(() => offered.filter((trait) => chosen.includes(trait.key)), [offered, chosen]);
  const options = useMemo(() => organiseOptions(input.items, active), [input.items, active]);
  const lastAttempt = options.length - 1;
  const result = options[Math.min(attempt, lastAttempt)];
  const canRetry = !busy && attempt < lastAttempt;
  const canApply = !busy && active.length > 0 && result.changed;
  const positionDigits = String(result.order.length).length;
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
      stickyActions
      submitDisabled={!canApply}
      submitLabel={t("apply")}
      onSubmit={() => { if (canApply) return onApply(result.order); }}
      footerStart={(
        <StateButton
          type="button"
          aria-label={t("another")}
          title={t("another")}
          className="grid size-9 flex-none cursor-pointer place-items-center rounded-full border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--wash)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={!canRetry}
          onClick={() => setAttempt((value) => Math.min(value + 1, lastAttempt))}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 1 2.64 6.36M3 5v7h7" />
          </svg>
        </StateButton>
      )}
    >
      <p className="text-sm leading-6 text-[var(--muted)]">{t("intro")}</p>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium">{t("spreadBy")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {offered.map((trait) => {
            const on = chosen.includes(trait.key);
            return (
              <StateButton
                key={trait.key}
                type="button"
                aria-pressed={on}
                onClick={() => { setAttempt(0); setChosen((current) => (on ? current.filter((key) => key !== trait.key) : [...current, trait.key])); }}
                className={cx("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm transition", on ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] hover:border-[var(--main-line)]")}
              >
                {on ? <CircleCheckIcon className="size-4 flex-none" /> : null}
                {trait.label}
              </StateButton>
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
          <ol className="mt-2 max-h-72 divide-y divide-[var(--line)] overflow-y-auto rounded-2xl border border-[var(--line)]">
            {result.order.map((key, index) => (
              <li key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 flex-none text-right text-xs tabular-nums text-[var(--muted)]">{String(index + 1).padStart(positionDigits, "0")}</span>
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
