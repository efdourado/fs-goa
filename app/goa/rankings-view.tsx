"use client";

import type { ReactNode } from "react";
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

/** Wraps one profile-layout candidate with a label so the reviewer can tell them apart. */
function VariantSlot({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <div className="border-t border-dashed border-[var(--line)] pt-4 first:border-0 first:pt-0">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--main-strong)]">{tag}</p>
      {children}
    </div>
  );
}

/** OPTION 0 — the current layout: a stats grid beside a column of favourites / lowest / moments. */
function ProfileCurrent({ person }: { person: PersonalRanking }) {
  const t = useTranslations("wrapped");
  const { fmt, signed } = useNumberFormatters();
  return (
    <div className="grid gap-7 sm:grid-cols-2">
      <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {([["average", person.ratingsMean], ["median", person.ratingsMedian], ["consistency", person.consistency]] as const)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => <div className="contents" key={key}><dt className="text-[var(--muted)]">{t(`rankings.${key}`)}</dt><dd className="text-right font-medium tabular-nums">{fmt(value)}</dd></div>)}
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
  );
}

/** OPTION 1 — a rating spectrum: where this person's scores sit on the scale, with a consistency band. */
function ProfileSpectrum({ person }: { person: PersonalRanking }) {
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

/** OPTION 2 — a small dashboard of big-number tiles, then two compact pick rows. */
function ProfileTiles({ person }: { person: PersonalRanking }) {
  const t = useTranslations("wrapped");
  const { fmt, signed } = useNumberFormatters();
  const tiles: Array<{ label: string; value: string }> = [];
  if (person.ratingsMean !== null) tiles.push({ label: t("rankings.average"), value: fmt(person.ratingsMean) });
  if (person.ratingsMedian !== null) tiles.push({ label: t("rankings.median"), value: fmt(person.ratingsMedian) });
  if (person.consistency !== null) tiles.push({ label: t("rankings.consistency"), value: fmt(person.consistency) });
  if (person.ratingsMin !== null && person.ratingsMax !== null) tiles.push({ label: t("rankings.range"), value: `${fmt(person.ratingsMin)}–${fmt(person.ratingsMax)}` });
  if (person.indicationPerformance !== null) tiles.push({ label: t("rankings.indication"), value: signed(person.indicationPerformance) });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-[var(--line)] px-3 py-2.5">
            <p className="text-xl font-medium tracking-tight tabular-nums">{tile.value}</p>
            <p className="mt-0.5 text-[11px] leading-tight text-[var(--muted)]">{tile.label}</p>
          </div>
        ))}
      </div>
      {person.topItems.length ? <p className="text-sm"><span className="text-[var(--muted)]">{t("rankings.topItems").toLocaleLowerCase()}</span>  {person.topItems.map((i) => `${i.title} ${fmt(i.value)}`).join("  ·  ")}</p> : null}
      {person.bottomItems.length ? <p className="text-sm"><span className="text-[var(--muted)]">{t("rankings.bottomItems").toLocaleLowerCase()}</span>  {person.bottomItems.map((i) => `${i.title} ${fmt(i.value)}`).join("  ·  ")}</p> : null}
      {person.biggestSurprise ? <p className="text-sm"><span className="text-[var(--muted)]">{t("rankings.surprise").toLocaleLowerCase()}</span>  {person.biggestSurprise.title} ({signed(person.biggestSurprise.delta)})</p> : null}
      {person.biggestDisappointment ? <p className="text-sm"><span className="text-[var(--muted)]">{t("rankings.disappointment").toLocaleLowerCase()}</span>  {person.biggestDisappointment.title} ({signed(person.biggestDisappointment.delta)})</p> : null}
    </div>
  );
}

/** OPTION 3 — pure prose, no grids: the profile read as a sentence, key numbers in bold. */
function ProfileProse({ person }: { person: PersonalRanking }) {
  const t = useTranslations("wrapped");
  const { fmt, signed } = useNumberFormatters();
  const b = (s: string) => <strong className="font-medium tabular-nums">{s}</strong>;
  return (
    <div className="space-y-2 text-sm leading-6">
      <p>
        {person.ratingsMean !== null ? <>{t("rankings.average").toLocaleLowerCase()} {b(fmt(person.ratingsMean))}</> : null}
        {person.ratingsMedian !== null ? <> ({t("rankings.median").toLocaleLowerCase()} {b(fmt(person.ratingsMedian))})</> : null}
        {person.ratingsMin !== null && person.ratingsMax !== null ? <>, {t("rankings.range").toLocaleLowerCase()} {b(`${fmt(person.ratingsMin)}–${fmt(person.ratingsMax)}`)}</> : null}
        {person.consistency !== null ? <> — σ {b(fmt(person.consistency))}</> : null}
        {person.indicationPerformance !== null ? <> · {t("rankings.indication").toLocaleLowerCase()} {b(signed(person.indicationPerformance))}</> : null}
      </p>
      {person.topItems.length ? <p className="text-[var(--muted)]">{t("rankings.topItems").toLocaleLowerCase()}: <span className="text-[var(--ink)]">{person.topItems.map((i) => `${i.title} (${fmt(i.value)})`).join(", ")}</span></p> : null}
      {person.bottomItems.length ? <p className="text-[var(--muted)]">{t("rankings.bottomItems").toLocaleLowerCase()}: <span className="text-[var(--ink)]">{person.bottomItems.map((i) => `${i.title} (${fmt(i.value)})`).join(", ")}</span></p> : null}
      {person.biggestSurprise ? <p className="text-[var(--muted)]">{t("rankings.surprise").toLocaleLowerCase()}: <span className="text-[var(--ink)]">{person.biggestSurprise.title} ({signed(person.biggestSurprise.delta)})</span></p> : null}
      {person.biggestDisappointment ? <p className="text-[var(--muted)]">{t("rankings.disappointment").toLocaleLowerCase()}: <span className="text-[var(--ink)]">{person.biggestDisappointment.title} ({signed(person.biggestDisappointment.delta)})</span></p> : null}
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
          <div className="mt-5 space-y-6 sm:pl-12">
            <VariantSlot tag="atual"><ProfileCurrent person={person} /></VariantSlot>
            <VariantSlot tag="opção 1 · espectro"><ProfileSpectrum person={person} /></VariantSlot>
            <VariantSlot tag="opção 2 · painel"><ProfileTiles person={person} /></VariantSlot>
            <VariantSlot tag="opção 3 · texto"><ProfileProse person={person} /></VariantSlot>
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
