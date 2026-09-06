import type { AffinityBlock, PersonalRanking } from "./types";

/**
 * Pure render (no hooks) for the Wrapped's personal-rankings and affinity
 * sections — usable from the client Results tab and the server-rendered public
 * page alike. Labels come in as props so the caller controls i18n.
 */

interface RankingLabels {
  locale: string;
  title: string;
  entryCount: string;
  completion: string;
  average: string;
  median: string;
  range: string;
  consistency: string;
  topItems: string;
  bottomItems: string;
  surprise: string;
  disappointment: string;
  indication: string;
  none: string;
}

/** Number formatters bound to the reader's locale (pt-BR vs en-GB decimal marks). */
function makeFormatters(locale: string) {
  const fmt = (value: number | null, suffix = ""): string =>
    value === null ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}${suffix}`;
  const signed = (value: number | null): string =>
    value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  return { fmt, signed };
}

export function PersonalRankingsBlock({
  rankings,
  labels,
}: {
  rankings: PersonalRanking[];
  labels: RankingLabels;
}) {
  const { fmt, signed } = makeFormatters(labels.locale);
  if (!rankings.length) return null;
  return (
    <section>
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{labels.title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {rankings.map((person) => (
          <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={person.userId}>
            <strong className="block text-sm">{person.name}</strong>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-[var(--muted)]">{labels.entryCount}</dt>
              <dd className="text-right tabular-nums">{person.entryCount}</dd>
              <dt className="text-[var(--muted)]">{labels.completion}</dt>
              <dd className="text-right tabular-nums">{fmt(person.completionRate, "%")}</dd>
              <dt className="text-[var(--muted)]">{labels.average}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMean)}</dd>
              <dt className="text-[var(--muted)]">{labels.median}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMedian)}</dd>
              <dt className="text-[var(--muted)]">{labels.range}</dt>
              <dd className="text-right tabular-nums">{fmt(person.ratingsMin)}–{fmt(person.ratingsMax)}</dd>
              <dt className="text-[var(--muted)]">{labels.consistency}</dt>
              <dd className="text-right tabular-nums">{fmt(person.consistency)}</dd>
              {person.indicationPerformance !== null ? (
                <>
                  <dt className="text-[var(--muted)]">{labels.indication}</dt>
                  <dd className="text-right tabular-nums">{signed(person.indicationPerformance)}</dd>
                </>
              ) : null}
            </dl>
            {person.topItems.length ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{labels.topItems}:</span>{" "}
                {person.topItems.map((item) => `${item.title} (${fmt(item.value)})`).join(", ")}
              </p>
            ) : null}
            {person.bottomItems.length ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{labels.bottomItems}:</span>{" "}
                {person.bottomItems.map((item) => `${item.title} (${fmt(item.value)})`).join(", ")}
              </p>
            ) : null}
            {person.biggestSurprise ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{labels.surprise}:</span>{" "}
                {person.biggestSurprise.title} ({signed(person.biggestSurprise.delta)})
              </p>
            ) : null}
            {person.biggestDisappointment ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)]">{labels.disappointment}:</span>{" "}
                {person.biggestDisappointment.title} ({signed(person.biggestDisappointment.delta)})
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

interface AffinityLabels {
  locale: string;
  title: string;
  explanation: string;
  sample: (n: number) => string;
  composite: string;
  compositeNote: string;
  dimension: (key: string) => string;
  none: string;
}

export function AffinityBlockView({
  affinity,
  labels,
}: {
  affinity: AffinityBlock;
  labels: AffinityLabels;
}) {
  const { fmt } = makeFormatters(labels.locale);
  const scored = affinity.pairs.filter((pair) => pair.direct !== null);
  if (!scored.length) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{labels.title}</h3>
        <p className="text-xs text-[var(--muted)]">{labels.none}</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{labels.title}</h3>
      <p className="mb-3 text-xs leading-5 text-[var(--muted)]">{labels.explanation}</p>
      <ul className="space-y-2">
        {scored.map((pair) => (
          <li className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-sm" key={`${pair.a.userId}-${pair.b.userId}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{pair.a.name} · {pair.b.name}</span>
              <span className="flex-none tabular-nums">
                <strong>{fmt(pair.direct)}</strong>
                <span className="ml-2 text-[10px] font-light text-[var(--muted)]">{labels.sample(pair.sampleSize)}</span>
              </span>
            </div>
            {pair.composite !== null && pair.dimensions.length > 1 ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {labels.composite}: <strong className="text-[var(--ink)]">{fmt(pair.composite)}</strong>
                {" — "}
                {pair.dimensions
                  .map((dimension) => `${labels.dimension(dimension.key)} ${fmt(dimension.value)} (${Math.round(dimension.weight * 100)}%)`)
                  .join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {affinity.compositeAvailable ? null : (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{labels.compositeNote}</p>
      )}
    </section>
  );
}
