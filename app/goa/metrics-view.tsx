"use client";

import { useTranslations } from "next-intl";
import { metricMinimum } from "./metric-editor";
import type { Metric, MetricSeriesEntry } from "./types";

const PREVIEW_ROWS = 8;

export function MetricBlock({ metric, hideThinLabel = false }: { metric: Metric; hideThinLabel?: boolean }) {
  const t = useTranslations("wrapped");
  const series = metric.series;
  const minimum = metricMinimum(metric);
  const ranked = series?.filter((entry) => entry.value !== null) ?? [];
  const pending = series?.filter((entry) => entry.value === null) ?? [];
  const chronological = metric.groupBy === "checkpoint";
  const sampleLabel = (count: number) => t(metric.operation === "surprise" ? "pairedRecords" : "records", { count });
  const unavailable = (entry: MetricSeriesEntry) => entry.sampleSize === 0 ? t("noRecordsYet")
    : entry.sampleSize < minimum ? `${hideThinLabel ? "" : `${t("smallSample")} · `}${t("sampleProgress", { count: entry.sampleSize, minimum })}` : t("unavailableValue");
  const rankOf = (entry: MetricSeriesEntry) => ranked.findIndex((candidate) => candidate.value === entry.value) + 1;
  const row = (entry: MetricSeriesEntry, index: number) => (
    <li key={entry.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-[var(--line)] py-4 last:border-0">
      <div className="flex min-w-0 items-start gap-4">
        {!chronological ? <span aria-hidden="true" className={`w-7 shrink-0 pt-0.5 text-lg tabular-nums ${index === 0 && entry.value !== null ? "font-medium text-[var(--main-strong)]" : "text-[var(--muted)]"}`}>{entry.value === null ? "—" : String(rankOf(entry)).padStart(2, "0")}</span> : null}
        <div className="min-w-0"><span className="block break-words text-base font-medium leading-6">{entry.label}{entry.year ? ` (${entry.year})` : ""}</span><span className="mt-1 block text-xs text-[var(--muted)]">{sampleLabel(entry.sampleSize)}</span></div>
      </div>
      <div className="max-w-28 text-right sm:max-w-48">
        {entry.value !== null ? <strong className="text-2xl font-medium tracking-tight tabular-nums">{entry.formattedValue ?? entry.value}</strong> : <span className="text-xs leading-5 text-[var(--muted)]">{unavailable(entry)}</span>}
      </div>
      {entry.value !== null && entry.rawFormattedValue && entry.rawFormattedValue !== entry.formattedValue ? <span className="col-span-2 text-right text-xs leading-5 text-[var(--muted)]">{t("unadjusted", { value: entry.rawFormattedValue })}</span> : null}
    </li>
  );
  // Rows that can't be calculated yet stay in the list, below the ranked ones —
  // they show what's still needed instead of hiding behind a disclosure.
  const visibleRows = chronological ? series ?? [] : [...ranked, ...pending];
  return (
    <article className="min-w-0 py-2">
      <h3 className="text-base font-medium tracking-tight">{metric.label}</h3>
      {series?.length ? <>
        {visibleRows.length ? <ol className="mt-2">{visibleRows.slice(0, PREVIEW_ROWS).map(row)}</ol> : <p className="mt-3 text-sm text-[var(--muted)]">{t("rankingPending")}</p>}
        {visibleRows.length > PREVIEW_ROWS ? <details className="mt-3"><summary className="cursor-pointer py-2 text-sm text-[var(--main-strong)]">{t("showMore", { count: visibleRows.length - PREVIEW_ROWS })}</summary><ol start={PREVIEW_ROWS + 1}>{visibleRows.slice(PREVIEW_ROWS).map((entry, index) => row(entry, index + PREVIEW_ROWS))}</ol></details> : null}
      </> : <strong className="mt-3 block text-5xl font-medium tracking-[-0.05em] tabular-nums">{metric.formattedValue ?? metric.value ?? "—"}</strong>}
    </article>
  );
}
