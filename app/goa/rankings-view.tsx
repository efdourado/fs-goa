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

export function PersonalRankingsBlock({ rankings }: { rankings: PersonalRanking[] }) {
  const t = useTranslations("wrapped");
  const locale = useLocale();
  const { fmt, signed } = useNumberFormatters();
  const lower = (s: string) => s.toLocaleLowerCase(locale);
  if (!rankings.length) return null;
  return (
    <section className="divide-y divide-[var(--line)]">
      {rankings.map((person) => (
        <details className="group py-4 first:pt-0" key={person.userId}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)] text-xs font-black">{lower(person.name.slice(0, 1))}</span>
              <div className="min-w-0 leading-tight">
                <strong className="block text-sm">{person.name}</strong>
                <span className="block text-xs text-[var(--muted)]">{t("records", { count: person.entryCount })}{person.completionRate !== null ? ` · ${fmt(person.completionRate, "%")} ${lower(t("rankings.completion"))}` : ""}</span>
              </div>
            </div>
            <span aria-hidden="true" className="shrink-0 text-xl text-[var(--muted)] transition-transform duration-300 group-open:rotate-90">+</span>
          </summary>
          <div className="mt-5 grid gap-7 sm:grid-cols-2 sm:pl-16">
            <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {([
                ["average", person.ratingsMean], ["median", person.ratingsMedian], ["consistency", person.consistency],
              ] as const).filter(([, value]) => value !== null).map(([key, value]) => <div className="contents" key={key}><dt className="text-[var(--muted)]">{t(`rankings.${key}`)}</dt><dd className="text-right font-medium tabular-nums">{fmt(value)}</dd></div>)}
              {person.ratingsMin !== null && person.ratingsMax !== null ? <><dt className="text-[var(--muted)]">{t("rankings.range")}</dt><dd className="text-right tabular-nums">{fmt(person.ratingsMin)}–{fmt(person.ratingsMax)}</dd></> : null}
              {person.indicationPerformance !== null ? <><dt className="text-[var(--muted)]">{t("rankings.indication")}</dt><dd className="text-right tabular-nums">{signed(person.indicationPerformance)}</dd></> : null}
            </dl>
            <div className="space-y-5">
              {person.topItems.length ? <div><h4 className="text-xs font-medium text-[var(--muted)]">{t("rankings.topItems")}</h4><ol className="mt-2 space-y-2">{person.topItems.map((item, index) => <li key={index} className="flex justify-between gap-4 text-sm"><span>{item.title}</span><strong className="tabular-nums">{fmt(item.value)}</strong></li>)}</ol></div> : null}
              {person.bottomItems.length ? <div><h4 className="text-xs font-medium text-[var(--muted)]">{t("rankings.bottomItems")}</h4><ol className="mt-2 space-y-2">{person.bottomItems.map((item, index) => <li key={index} className="flex justify-between gap-4 text-sm"><span>{item.title}</span><span className="tabular-nums">{fmt(item.value)}</span></li>)}</ol></div> : null}
              {person.biggestSurprise ? <p className="text-sm"><span className="block text-xs text-[var(--muted)]">{t("rankings.surprise")}</span>{person.biggestSurprise.title} ({signed(person.biggestSurprise.delta)})</p> : null}
              {person.biggestDisappointment ? <p className="text-sm"><span className="block text-xs text-[var(--muted)]">{t("rankings.disappointment")}</span>{person.biggestDisappointment.title} ({signed(person.biggestDisappointment.delta)})</p> : null}
            </div>
          </div>
        </details>
      ))}
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
