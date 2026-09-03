import type { Metric } from "./types";

/**
 * Renders one metric — a scalar card or, when it carries a `series`, a ranked
 * list (position · label · value · sample size). Pure render with no hooks, so
 * both the client screens and the server-rendered public page can use it.
 */
export function MetricBlock({
  metric,
  smallSampleLabel,
  hideThinLabel = false,
}: {
  metric: Metric;
  /** Shown in place of the value for a row below its sample floor. */
  smallSampleLabel: string;
  /** Solo / two-person rounds: a thin row just shows its value (or —), no "small sample" wording. */
  hideThinLabel?: boolean;
}) {
  const series = metric.series;
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p>
      {series && series.length ? (
        <ol className="mt-3 space-y-1.5">
          {series.map((row, index) => {
            const thin = row.value === null;
            return (
              <li
                key={row.key}
                className={`flex items-center justify-between gap-3 text-sm${thin ? " opacity-45" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="flex-none tabular-nums">
                  <strong>{thin ? (hideThinLabel ? row.formattedValue ?? "—" : smallSampleLabel) : row.formattedValue ?? row.value}</strong>
                  <span className="ml-2 text-[10px] font-light text-[var(--muted)]">n={row.sampleSize}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <strong className="mt-3 block text-4xl tracking-[-0.05em]">
          {metric.formattedValue ?? metric.value ?? "—"}
        </strong>
      )}
    </article>
  );
}
