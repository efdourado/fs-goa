"use client";

import { useTranslations } from "next-intl";

import type { Metric } from "./types";

/** Rankings past this length get folded behind a "show more" disclosure. */
const PREVIEW_ROWS = 8;

/**
 * Renders one metric — a scalar card or, when it carries a `series`, a ranked
 * list (position · label · value · sample size). A long ranking folds past
 * `PREVIEW_ROWS` behind a native `<details>` toggle — no JavaScript needed, so it
 * still works before hydration.
 */
export function MetricBlock({
  metric,
  hideThinLabel = false,
}: {
  metric: Metric;
  /** Solo / two-person rounds: a thin row just shows its value (or —), no "small sample" wording. */
  hideThinLabel?: boolean;
}) {
  const t = useTranslations("wrapped");
  const series = metric.series;

  function row(entry: NonNullable<typeof series>[number], index: number) {
    const thin = entry.value === null;
    const showsRaw = !thin && entry.rawFormattedValue && entry.rawFormattedValue !== entry.formattedValue;
    return (
      <li key={entry.key} className={`flex items-center justify-between gap-3 text-sm${thin ? " opacity-45" : ""}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
          <span className="truncate">{entry.label}{entry.year ? ` (${entry.year})` : ""}</span>
        </span>
        <span className="flex-none tabular-nums">
          <strong>{thin ? (hideThinLabel ? entry.formattedValue ?? "—" : t("smallSample")) : entry.formattedValue ?? entry.value}</strong>
          {showsRaw ? <span className="ml-1.5 text-[10px] font-light text-[var(--muted)]">({entry.rawFormattedValue})</span> : null}
          <span className="ml-2 text-[10px] font-light text-[var(--muted)]">n={entry.sampleSize}</span>
        </span>
      </li>
    );
  }

  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <p className="text-sm font-medium text-[var(--muted)]">{metric.label}</p>
      {series && series.length ? (
        <>
          <ol className="mt-3 space-y-1.5">{series.slice(0, PREVIEW_ROWS).map((entry, index) => row(entry, index))}</ol>
          {series.length > PREVIEW_ROWS ? (
            <details className="group mt-1.5">
              <summary className="cursor-pointer pt-1 text-xs font-light text-[var(--muted)] transition hover:text-[var(--ink)]">
                <span className="group-open:hidden">{t("showMore", { count: series.length - PREVIEW_ROWS })}</span>
                <span className="hidden group-open:inline">{t("showLess")}</span>
              </summary>
              <ol className="mt-1.5 space-y-1.5">{series.slice(PREVIEW_ROWS).map((entry, index) => row(entry, index + PREVIEW_ROWS))}</ol>
            </details>
          ) : null}
        </>
      ) : (
        <strong className="mt-3 block text-4xl tracking-[-0.05em]">{metric.formattedValue ?? metric.value ?? "—"}</strong>
      )}
      {metric.explanation || metric.sample ? (
        <p className="mt-auto pt-3 text-[11px] leading-5 text-[var(--muted)]">
          {[metric.explanation, metric.sample].filter(Boolean).join(" ")}
        </p>
      ) : null}
    </article>
  );
}
