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
  const { fmt, signed } = useNumberFormatters();
  if (!rankings.length) return null;
  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-[var(--muted)]">{t("rankings.title")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {rankings.map((person) => (
          <article className="rounded-2xl border border-[var(--line)] bg-[var(--wash)] p-4" key={person.userId}>
            <strong className="block text-sm">{person.name}</strong>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-[var(--muted)]">{t("rankings.entryCount")}</dt>
              <dd className="text-right tabular-nums">{person.entryCount}</dd>
              <dt className="text-[var(--muted)]">{t("rankings.completion")}</dt>
              <dd className="text-right tabular-nums">{fmt(person.completionRate, "%")}</dd>
              <dt className="text-[var(--muted)]">{t("rankings.average")}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMean)}</dd>
              <dt className="text-[var(--muted)]">{t("rankings.median")}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMedian)}</dd>
              <dt className="text-[var(--muted)]">{t("rankings.range")}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMin)}–{fmt(person.ratingsMax)}</dd>
              <dt className="text-[var(--muted)]">{t("rankings.consistency")}</dt>
              <dd className="text-right tabular-nums">{fmt(person.consistency)}</dd>
              {person.indicationPerformance !== null ? (
                <>
                  <dt className="text-[var(--muted)]">{t("rankings.indication")}</dt>
                  <dd className="text-right tabular-nums">{signed(person.indicationPerformance)}</dd>
                </>
              ) : null}
            </dl>
            {person.topItems.length ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{t("rankings.topItems")}:</span>{" "}
                {person.topItems.map((item) => `${item.title} (${fmt(item.value)})`).join(", ")}
              </p>
            ) : null}
            {person.bottomItems.length ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{t("rankings.bottomItems")}:</span>{" "}
                {person.bottomItems.map((item) => `${item.title} (${fmt(item.value)})`).join(", ")}
              </p>
            ) : null}
            {person.biggestSurprise ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{t("rankings.surprise")}:</span>{" "}
                {person.biggestSurprise.title} ({signed(person.biggestSurprise.delta)})
              </p>
            ) : null}
            {person.biggestDisappointment ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{t("rankings.disappointment")}:</span>{" "}
                {person.biggestDisappointment.title} ({signed(person.biggestDisappointment.delta)})
              </p>
            ) : null}
          </article>
        ))}
      </div>
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
          <li className="rounded-xl border border-[var(--line)] bg-[var(--wash)] p-3 text-sm" key={`${pair.a.userId}-${pair.b.userId}`}>
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
