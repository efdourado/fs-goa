import { notFound } from "next/navigation";
import Link from "next/link";
import { publicResults } from "@/lib/goa-challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicMetric = {
  id: string;
  label: string;
  formattedValue?: string | null;
  value?: string | number | null;
};

type PublicComment = { id: string; text: string; itemTitle?: string | null };

export default async function SharedResultsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payload: Awaited<ReturnType<typeof publicResults>>;
  try {
    payload = await publicResults(token);
  } catch {
    notFound();
  }
  const challenge = payload.challenge;
  const result = challenge.result as {
    headline?: string | null;
    summary?: string | null;
    metrics?: PublicMetric[];
    comments?: PublicComment[];
    publishedAt?: string | null;
  };

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-8 text-[var(--ink)] sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <Link className="mb-7 inline-flex min-h-11 items-center gap-2 font-bold" href="/">
          <span className="grid h-9 w-9 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-white">g</span>
          goa
        </Link>
        <section className="overflow-hidden rounded-[30px] bg-[var(--ink)] px-6 py-12 text-white sm:px-12 sm:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">
            {challenge.startsOn} — {challenge.endsOn}
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
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Resultados em números">
            {result.metrics.map((metric) => (
              <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6" key={metric.id}>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p>
                <strong className="mt-3 block text-4xl tracking-[-0.05em]">{metric.formattedValue ?? metric.value ?? "—"}</strong>
              </article>
            ))}
          </section>
        ) : null}
        {result.comments?.length ? (
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            {result.comments.map((comment) => (
              <blockquote className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6" key={comment.id}>
                <p className="text-lg leading-8">“{comment.text}”</p>
                {comment.itemTitle ? <footer className="mt-4 text-sm font-bold text-[var(--muted)]">{comment.itemTitle}</footer> : null}
              </blockquote>
            ))}
          </section>
        ) : null}
        <p className="mt-8 text-center text-xs text-[var(--muted)]">Memória publicada pelo grupo no Goa.</p>
      </div>
    </main>
  );
}
