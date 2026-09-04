import type { Metric } from "./types";

/** Rankings past this length get folded behind a "show more" disclosure. */
const PREVIEW_ROWS = 8;

/**
 * Renders one metric — a scalar card or, when it carries a `series`, a ranked
 * list (position · label · value · sample size). Pure render with no hooks, so
 * both the client screens and the server-rendered public page can use it. A
 * long ranking folds past `PREVIEW_ROWS` behind a native `<details>` toggle —
 * no JavaScript needed, so it still works on the server-rendered public page.
 */
export function MetricBlock({
  metric,
  smallSampleLabel,
  hideThinLabel = false,
  showMoreLabel,
  showLessLabel,
}: {
  metric: Metric;
  /** Shown in place of the value for a row below its sample floor. */
  smallSampleLabel: string;
  /** Solo / two-person rounds: a thin row just shows its value (or —), no "small sample" wording. */
  hideThinLabel?: boolean;
  /** Toggle label for revealing the rest of a long ranking, given how many rows are hidden. */
  showMoreLabel: (hiddenCount: number) => string;
  /** Toggle label once the ranking is fully expanded. */
  showLessLabel: string;
}) {
  const series = metric.series;

  function row(entry: NonNullable<typeof series>[number], index: number) {
    const thin = entry.value === null;
    return (
      <li
        key={entry.key}
        className={`flex items-center justify-between gap-3 text-sm${thin ? " opacity-45" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
          <span className="truncate">{entry.label}</span>
        </span>
        <span className="flex-none tabular-nums">
          <strong>{thin ? (hideThinLabel ? entry.formattedValue ?? "—" : smallSampleLabel) : entry.formattedValue ?? entry.value}</strong>
          <span className="ml-2 text-[10px] font-light text-[var(--muted)]">n={entry.sampleSize}</span>
        </span>
      </li>
    );
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p>
      {series && series.length ? (
        <>
          <ol className="mt-3 space-y-1.5">{series.slice(0, PREVIEW_ROWS).map((entry, index) => row(entry, index))}</ol>
          {series.length > PREVIEW_ROWS ? (
            <details className="group mt-1.5">
              <summary className="cursor-pointer pt-1 text-xs font-light text-[var(--muted)] transition hover:text-[var(--ink)]">
                <span className="group-open:hidden">{showMoreLabel(series.length - PREVIEW_ROWS)}</span>
                <span className="hidden group-open:inline">{showLessLabel}</span>
              </summary>
              <ol className="mt-1.5 space-y-1.5">{series.slice(PREVIEW_ROWS).map((entry, index) => row(entry, index + PREVIEW_ROWS))}</ol>
            </details>
          ) : null}
        </>
      ) : (
        <strong className="mt-3 block text-4xl tracking-[-0.05em]">
          {metric.formattedValue ?? metric.value ?? "—"}
        </strong>
      )}
    </article>
  );
}
