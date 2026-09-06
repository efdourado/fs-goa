import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { publicResults } from "@/lib/goa-challenges";
import { type Formatter, makeGoaFormat, type Translator } from "@/app/goa/format";
import { LanguageToggle } from "@/app/goa/LanguageToggle";
import { defaultShowcaseBlocks, ShowcaseView } from "@/app/goa/showcase-view";
import type { AffinityBlock, Metric, PersonalRanking, WrappedBlock } from "@/app/goa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A published showcase is a private link — never in a search index (V1 §12).
export const metadata = { robots: { index: false, follow: false } };

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
  const result = challenge.result as unknown as {
    headline?: string | null;
    summary?: string | null;
    metrics?: Metric[];
    comments?: PublicComment[];
    personalRankings?: PersonalRanking[];
    affinity?: AffinityBlock | null;
    blocks?: WrappedBlock[];
    totalEntries?: number;
  };

  const blocks: WrappedBlock[] = result.blocks?.length
    ? result.blocks
    : defaultShowcaseBlocks({
        metrics: result.metrics,
        personalRankings: result.personalRankings,
        affinity: result.affinity,
        comments: result.comments,
      });

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
        <ShowcaseView
          variant="dark"
          dateRange={f.dateRange(challenge.startsOn, challenge.endsOn)}
          headline={result.headline || challenge.title}
          summary={result.summary}
          participantNames={challenge.participants}
          totalEntries={result.totalEntries ?? null}
          blocks={blocks}
        />
        <p className="mt-10 text-center text-xs text-[var(--muted)]">{t("footer")}</p>
      </div>
    </main>
  );
}
