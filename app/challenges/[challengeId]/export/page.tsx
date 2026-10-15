import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";

import { sessionFromToken } from "@/lib/auth";
import { getChallengeDetail } from "@/lib/goa/challenges/detail";
import { listEntries } from "@/lib/goa/challenges/entries";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import { ExportDocument } from "@/app/goa/export/export-document";
import { exportDisplay, exportFontClass } from "@/app/goa/export/fonts";
import "@/app/goa/export/export.css";
import type { ChallengeDetail, Entry } from "@/app/goa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Metadata and the page both need it — one round of queries per request.
const load = cache(async (challengeId: string): Promise<{ challenge: ChallengeDetail; entries: Entry[]; userId: string }> => {
  const session = await sessionFromToken((await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || session.user.deactivated) redirect(`/challenges/${encodeURIComponent(challengeId)}`);
  try {
    const [challenge, entries] = await Promise.all([
      getChallengeDetail(session, challengeId),
      listEntries(session, challengeId),
    ]);
    return {
      challenge: challenge as unknown as ChallengeDetail,
      entries: JSON.parse(JSON.stringify(entries)) as Entry[],
      userId: session.user.id,
    };
  } catch {
    notFound();
  }
});

export async function generateMetadata({ params }: { params: Promise<{ challengeId: string }> }): Promise<Metadata> {
  const { challengeId } = await params;
  const { challenge } = await load(challengeId);
  const t = await getTranslations("exportDoc");
  // Chrome names the saved PDF after the page title. The whole log of a challenge — never indexed.
  return { title: t("fileTitle", { title: challenge.title }), robots: { index: false, follow: false } };
}

export default async function ChallengeExportPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  const { challenge, entries, userId } = await load(challengeId);
  return (
    <ExportDocument
      challenge={JSON.parse(JSON.stringify(challenge)) as ChallengeDetail}
      entries={entries}
      userId={userId}
      fontClassName={exportFontClass}
      displayFont={exportDisplay.style.fontFamily}
    />
  );
}
