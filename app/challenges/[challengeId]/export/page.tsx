import type { Metadata } from "next";
import { Lato, Poppins } from "next/font/google";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";

import { sessionFromToken } from "@/lib/auth";
import { getChallengeDetail } from "@/lib/goa/challenges/detail";
import { listEntries } from "@/lib/goa/challenges/entries";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import { ExportDocument } from "@/app/goa/export/export-document";
import "@/app/goa/export/export.css";
import type { ChallengeDetail, Entry } from "@/app/goa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const display = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"], variable: "--xd-font-display" });
const text = Lato({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--xd-font-text" });

/** A CSS string literal that can't close the string, the rule or the <style> tag it's written into. */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ").replace(/[\r\n]+/g, " ")}"`;
}

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
  const t = await getTranslations("exportDoc");
  const footer = cssString(t("footer", { title: challenge.title }));
  const pageCss = `
@page { size: A4; margin: 18mm 0 20mm; background: #faf8f3;
  @bottom-center { content: ${footer} counter(page); font-family: ${display.style.fontFamily}; font-size: 7.5pt; letter-spacing: 0.04em; color: #a8a498; }
}
@page :first { @bottom-center { content: none; } }`;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />
      <ExportDocument
        challenge={JSON.parse(JSON.stringify(challenge)) as ChallengeDetail}
        entries={entries}
        userId={userId}
        fontClassName={`${display.variable} ${text.variable}`}
      />
    </>
  );
}
