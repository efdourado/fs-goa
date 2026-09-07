"use client";

import { useLocale, useTranslations } from "next-intl";

import type { AffinityBlock, PersonalRanking } from "./types";

/**
 * The Wrapped's personal-rankings and affinity sections. Client components —
 * they pull their own i18n from the `wrapped` namespace and format numbers in
 * the reader's locale (pt-BR vs en-GB decimal marks).
 */

const DIMENSION_KEY: Record<string, string> = {
  items: "dimItems",
  genre: "dimGenre",
  year_band: "dimYearBand",
  duration: "dimDuration",
};

function useNumberFormatters() {
  const locale = useLocale();
  const fmt = (value: number | null, suffix = ""): string =>
    value === null ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}${suffix}`;
  const signed = (value: number | null): string =>
    value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  return { fmt, signed };
}

function StatLine({ items }: { items: Array<[string, string]> }) {
  if (!items.length) return null;
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map(([label, value]) => (
        <span key={label}><span className="text-[var(--muted)]">{label}</span> <strong className="font-medium tabular-nums">{value}</strong></span>
      ))}
    </p>
  );
}

/** "Parasita 4,8 · Aftersun 4,5" — a labelled, dot-joined run of title/score pairs. */
function PickLine({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <p className="text-sm">
      <span className="text-[var(--muted)]">{label}</span>{" "}
      {items.join("  ·  ")}
    </p>
  );
}

export function PersonalRankingsBlock({ rankings }: { rankings: PersonalRanking[] }) {
  const t = useTranslations("wrapped");
  const locale = useLocale();
  const { fmt, signed } = useNumberFormatters();
  const lower = (s: string) => s.toLocaleLowerCase(locale);
  if (!rankings.length) return null;
  return (
    <section className="divide-y divide-[var(--line)]">
      {rankings.map((person) => {
        const stats: Array<[string, string]> = [];
        if (person.ratingsMean !== null) stats.push([lower(t("rankings.average")), fmt(person.ratingsMean)]);
        if (person.ratingsMedian !== null) stats.push([lower(t("rankings.median")), fmt(person.ratingsMedian)]);
        if (person.consistency !== null) stats.push([lower(t("rankings.consistency")), fmt(person.consistency)]);
        if (person.ratingsMin !== null && person.ratingsMax !== null) stats.push([lower(t("rankings.range")), `${fmt(person.ratingsMin)}–${fmt(person.ratingsMax)}`]);
        if (person.indicationPerformance !== null) stats.push([lower(t("rankings.indication")), signed(person.indicationPerformance)]);
        const moments: string[] = [];
        if (person.biggestSurprise) moments.push(`${lower(t("rankings.surprise"))}: ${person.biggestSurprise.title} (${signed(person.biggestSurprise.delta)})`);
        if (person.biggestDisappointment) moments.push(`${lower(t("rankings.disappointment"))}: ${person.biggestDisappointment.title} (${signed(person.biggestDisappointment.delta)})`);
        return (
          <details className="group py-4 first:pt-0" key={person.userId}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)] text-xs font-black">{lower(person.name.slice(0, 1))}</span>
                <div className="min-w-0 leading-tight">
                  <strong className="block text-sm">{person.name}</strong>
                  <span className="block text-xs text-[var(--muted)]">{t("records", { count: person.entryCount })}{person.completionRate !== null ? ` · ${fmt(person.completionRate, "%")} ${lower(t("rankings.completion"))}` : ""}</span>
                </div>
              </div>
              <span aria-hidden="true" className="shrink-0 text-xl text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4 space-y-2.5 pl-12">
              <StatLine items={stats} />
              <PickLine label={lower(t("rankings.topItems"))} items={person.topItems.map((item) => `${item.title} ${fmt(item.value)}`)} />
              <PickLine label={lower(t("rankings.bottomItems"))} items={person.bottomItems.map((item) => `${item.title} ${fmt(item.value)}`)} />
              {moments.map((line, index) => <p key={index} className="text-sm">{line}</p>)}
            </div>
          </details>
        );
      })}
    </section>
  );
}

export function AffinityBlockView({ affinity }: { affinity: AffinityBlock }) {
  const t = useTranslations("wrapped");
  const { fmt } = useNumberFormatters();
  const scored = affinity.pairs.filter((pair) => pair.direct !== null);
  if (!scored.length) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-medium text-[var(--muted)]">{t("affinity.title")}</h3>
        <p className="text-xs text-[var(--muted)]">{t("affinity.none")}</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-[var(--muted)]">{t("affinity.title")}</h3>
      <p className="mb-3 text-xs leading-5 text-[var(--muted)]">{t("affinity.explanation")}</p>
      <ul className="space-y-2">
        {scored.map((pair) => (
          <li className="border-b border-[var(--line)] py-4 text-sm" key={`${pair.a.userId}-${pair.b.userId}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{pair.a.name} • {pair.b.name}</span>
              <span className="flex-none tabular-nums">
                <strong>{fmt(pair.direct)}</strong>
                <span className="ml-2 text-[10px] font-light text-[var(--muted)]">{t("affinity.sample", { n: pair.sampleSize })}</span>
              </span>
            </div>
            {pair.composite !== null && pair.dimensions.length > 1 ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t("affinity.composite")}: <strong className="text-[var(--ink)]">{fmt(pair.composite)}</strong>
                {" — "}
                {pair.dimensions
                  .map((dimension) => `${t(`affinity.${DIMENSION_KEY[dimension.key] ?? "dimItems"}`)} ${fmt(dimension.value)} (${Math.round(dimension.weight * 100)}%)`)
                  .join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {affinity.compositeAvailable ? null : (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{t("affinity.compositeNote")}</p>
      )}
    </section>
  );
}
