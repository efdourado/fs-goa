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

/**
 * One person's taste at a glance: a rating spectrum — where their scores land on
 * the scale, the min–max range, a soft band for how consistent they are (mean ±
 * σ), the median tick and the mean dot — then their picks and stand-out moments.
 */
function PersonProfile({ person }: { person: PersonalRanking }) {
  const t = useTranslations("wrapped");
  const { fmt, signed } = useNumberFormatters();
  const min = person.ratingsMin;
  const max = person.ratingsMax;
  const mean = person.ratingsMean;
  const median = person.ratingsMedian;
  const domainMax = Math.max(5, max ?? 5);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / domainMax) * 100))}%`;
  const bandLo = mean !== null && person.consistency !== null ? Math.max(min ?? 0, mean - person.consistency) : null;
  const bandHi = mean !== null && person.consistency !== null ? Math.min(max ?? domainMax, mean + person.consistency) : null;
  return (
    <div className="space-y-5">
      {mean !== null && min !== null && max !== null ? (
        <div>
          <div className="relative mt-1 h-9">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line)]" />
            {/* min–max range */}
            <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--wash-strong)]" style={{ left: pct(min), right: `calc(100% - ${pct(max)})` }} />
            {/* consistency band around the mean */}
            {bandLo !== null && bandHi !== null ? <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--main-soft)]" style={{ left: pct(bandLo), right: `calc(100% - ${pct(bandHi)})` }} /> : null}
            {/* median tick */}
            {median !== null ? <div className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--muted)]" style={{ left: pct(median) }} /> : null}
            {/* mean dot */}
            <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--main-strong)] ring-2 ring-[var(--paper)]" style={{ left: pct(mean) }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--muted)] tabular-nums">
            <span>{fmt(min)}</span>
            <span className="text-[var(--ink)]">{t("rankings.average").toLocaleLowerCase()} <strong>{fmt(mean)}</strong>{median !== null ? ` · ${t("rankings.median").toLocaleLowerCase()} ${fmt(median)}` : ""}</span>
            <span>{fmt(max)}</span>
          </div>
        </div>
      ) : <p className="text-sm text-[var(--muted)]">{mean !== null ? fmt(mean) : "—"}</p>}
      <div className="flex flex-wrap gap-2 text-xs">
        {person.consistency !== null ? <span className="rounded-full bg-[var(--wash)] px-2.5 py-1">σ {fmt(person.consistency)}</span> : null}
        {person.indicationPerformance !== null ? <span className="rounded-full bg-[var(--wash)] px-2.5 py-1">{t("rankings.indication").toLocaleLowerCase()} {signed(person.indicationPerformance)}</span> : null}
      </div>
      {person.topItems.length || person.bottomItems.length ? (
        <p className="text-sm">
          {person.topItems.length ? <span className="text-[var(--main-strong)]">↑ {person.topItems.map((i) => `${i.title} ${fmt(i.value)}`).join("  ·  ")}</span> : null}
          {person.topItems.length && person.bottomItems.length ? <br /> : null}
          {person.bottomItems.length ? <span className="text-[var(--muted)]">↓ {person.bottomItems.map((i) => `${i.title} ${fmt(i.value)}`).join("  ·  ")}</span> : null}
        </p>
      ) : null}
      {person.biggestSurprise || person.biggestDisappointment ? (
        <p className="text-xs text-[var(--muted)]">
          {person.biggestSurprise ? `${t("rankings.surprise").toLocaleLowerCase()}: ${person.biggestSurprise.title} (${signed(person.biggestSurprise.delta)})` : ""}
          {person.biggestSurprise && person.biggestDisappointment ? "   ·   " : ""}
          {person.biggestDisappointment ? `${t("rankings.disappointment").toLocaleLowerCase()}: ${person.biggestDisappointment.title} (${signed(person.biggestDisappointment.delta)})` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function PersonalRankingsBlock({ rankings }: { rankings: PersonalRanking[] }) {
  const t = useTranslations("wrapped");
  const locale = useLocale();
  const { fmt } = useNumberFormatters();
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
          <div className="mt-5 sm:pl-12">
            <PersonProfile person={person} />
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
