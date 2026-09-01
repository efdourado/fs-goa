import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { publicResults } from "@/lib/goa-challenges";
import { type Formatter, makeGoaFormat, type Translator } from "@/app/goa/format";
import { MetricBlock } from "@/app/goa/metrics-view";
import { SettingsMenu } from "@/app/goa/SettingsMenu";
import type { Metric } from "@/app/goa/types";

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
  const result = challenge.result as {
    headline?: string | null;
    summary?: string | null;
    metrics?: Metric[];
    comments?: PublicComment[];
    publishedAt?: string | null;
  };

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-8 text-[var(--ink)] sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-3">
          <Link className="inline-flex min-h-11 items-center gap-2 font-light" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-[var(--canvas)]">g</span>
            goa
          </Link>
          <SettingsMenu />
        </div>
        <section className="overflow-hidden rounded-[30px] bg-[var(--spotlight)] px-6 py-12 text-[var(--spotlight-ink)] sm:px-12 sm:py-16">
          <p className="text-xs font-light uppercase tracking-[0.16em] text-white/50">
            {f.dateRange(challenge.startsOn, challenge.endsOn)}
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-none tracking-[-0.055em] sm:text-7xl">
            {result.headline || challenge.title}
          </h1>
          {result.summary ? <p className="mt-7 max-w-2xl text-base leading-7 text-white/65">{result.summary}</p> : null}
          <div className="mt-8 flex flex-wrap gap-2">
            {challenge.participants.map((participant) => (
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs" key={participant}>{participant}</span>
            ))}
          </div>
        </section>
        {result.metrics?.length ? (
          <div className="mt-6 space-y-4" aria-label={t("numbersAria")}>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.metrics.filter((metric) => !metric.series?.length).map((metric) => (
                <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />
              ))}
            </section>
            {result.metrics.filter((metric) => metric.series?.length).map((metric) => (
              <MetricBlock key={metric.id} metric={metric} smallSampleLabel={tm("smallSample")} />
            ))}
          </div>
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
