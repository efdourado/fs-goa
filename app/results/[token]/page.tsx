import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { publicResults } from "@/lib/goa-challenges";
import { type Formatter, makeGoaFormat, type Translator } from "@/app/goa/format";
import { MetricBlock } from "@/app/goa/metrics-view";
import { AffinityBlockView, PersonalRankingsBlock } from "@/app/goa/rankings-view";
import { affinityLabels, rankingLabels } from "@/app/goa/rankings-labels";
import { metricHasData, metricTheme, participantsSentence } from "@/app/goa/utils";
import { LanguageToggle } from "@/app/goa/LanguageToggle";
import type { AffinityBlock, Metric, PersonalRanking } from "@/app/goa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicComment = { id: string; text: string; itemTitle?: string | null };

export default async function SharedResultsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payload: Awaited<ReturnType<typeof publicResults>>;
  try {
    payload = await publicResults(token);
  } catch {
    notFound();
  }
  const t = await getTranslations("publicResults");
  const tRoot = await getTranslations();
  const formatter = await getFormatter();
  const f = makeGoaFormat(tRoot as unknown as Translator, formatter as unknown as Formatter);

  const challenge = payload.challenge;
  const tm = await getTranslations("metrics");
  const tw = await getTranslations("wrapped");
  const result = challenge.result as unknown as {
    headline?: string | null;
    summary?: string | null;
    metrics?: Metric[];
    comments?: PublicComment[];
    personalRankings?: PersonalRanking[];
    affinity?: AffinityBlock | null;
    publishedAt?: string | null;
  };
  const personalRankings = result.personalRankings ?? [];
  const affinity = result.affinity ?? null;

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-8 text-[var(--ink)] sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-3">
          <Link className="inline-flex min-h-11 items-center gap-2 font-light" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-[var(--canvas)]">g</span>
            goa
          </Link>
          <LanguageToggle />
        </div>
        <section className="overflow-hidden rounded-[30px] bg-[var(--spotlight)] px-6 py-12 text-[var(--spotlight-ink)] sm:px-12 sm:py-16">
          <p className="text-xs font-light uppercase tracking-[0.16em] text-white/50">
            {f.dateRange(challenge.startsOn, challenge.endsOn)}
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-medium leading-none tracking-[-0.055em] sm:text-7xl">
            {result.headline || challenge.title}
          </h1>
          {result.summary ? <p className="mt-7 max-w-2xl text-base leading-7 text-white/65">{result.summary}</p> : null}
          {challenge.participants.length ? (
            <p className="mt-7 max-w-2xl text-sm leading-6 text-white/65">
              {t("participantsSentence", { names: participantsSentence(challenge.participants, (count) => t("andMore", { count })) })}
            </p>
          ) : null}
        </section>
        {(() => {
          const metrics = (result.metrics ?? []).filter(metricHasData);
          const scalarMetrics = metrics.filter((metric) => !metric.series?.length);
          const seriesMetrics = metrics.filter((metric) => metric.series?.length);
          const themedSeries = (["ranking", "people", "debate"] as const)
            .map((theme) => ({ theme, items: seriesMetrics.filter((metric) => metricTheme(metric) === theme) }))
            .filter((group) => group.items.length);
          return metrics.length ? (
            <div className="mt-6 space-y-6" aria-label={t("numbersAria")}>
              {scalarMetrics.length ? (
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {scalarMetrics.map((metric) => (
                    <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} showMoreLabel={(count) => tm("showMore", { count })} showLessLabel={tm("showLess")} />
                  ))}
                </section>
              ) : null}
              {themedSeries.map(({ theme, items }) => (
                <section key={theme} className="space-y-3">
                  {themedSeries.length > 1 ? <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">{t(`theme.${theme}`)}</h3> : null}
                  <div className="space-y-3">
                    {items.map((metric) => (
                      <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} showMoreLabel={(count) => tm("showMore", { count })} showLessLabel={tm("showLess")} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null;
        })()}
        {personalRankings.length > 1 ? (
          <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 sm:p-8">
            <PersonalRankingsBlock rankings={personalRankings} labels={rankingLabels((key, values) => tw(key, values))} />
          </section>
        ) : null}
        {affinity && affinity.pairs.length ? (
          <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 sm:p-8">
            <AffinityBlockView affinity={affinity} labels={affinityLabels((key, values) => tw(key, values))} />
          </section>
        ) : null}
        {result.comments?.length ? (
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            {result.comments.map((comment) => (
              <blockquote className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6" key={comment.id}>
                <p className="text-lg leading-8">“{comment.text}”</p>
                {comment.itemTitle ? <footer className="mt-4 text-sm font-light text-[var(--muted)]">{comment.itemTitle}</footer> : null}
              </blockquote>
            ))}
          </section>
        ) : null}
        <p className="mt-8 text-center text-xs text-[var(--muted)]">{t("footer")}</p>
      </div>
    </main>
  );
}
