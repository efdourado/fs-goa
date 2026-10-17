"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { copyText } from "../clipboard";
import { useGoaFormat } from "../format";
import type { ChallengeDetail } from "../types";
import { LinkPill, StatusMessage, Toggle } from "../ui";
import { isLivingList } from "../utils";

/**
 * Settings' public page: its title and one line, the switch beside them, and, once it's on, its link drawn like the
 * group's invite ticket (copy on the left, a new link on the right). Every change applies at once: no confirm step.
 */
export function PublicationPanel({ challenge, onPublish, onUnpublish }: {
  challenge: ChallengeDetail;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null } | undefined>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("managementUX");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const published = Boolean(challenge.result?.publishedAt);
  // A list has no round to close — it can be published any time, live.
  // A personal list publishes while it runs, with or without an end date; anything else once it has closed.
  const canPublish = challenge.status === "closed" || challenge.kind === "list" || isLivingList(challenge);
  const token = challenge.result?.shareToken;
  const publicUrl = newUrl ?? (token && typeof window !== "undefined" ? `${window.location.origin}/results/${encodeURIComponent(token)}` : null);

  async function run(action: "publish" | "unpublish" | "rotate") {
    setBusy(true);
    setError(null);
    try {
      if (action === "unpublish") { await onUnpublish(); setNewUrl(null); }
      else { const result = await onPublish(action === "rotate" ? { rotateLink: true } : {}); setNewUrl(result?.url ?? null); }
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await copyText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setError(t("copyFailed")); }
  }

  return (
    <section className="rounded-[20px] border border-[var(--line)] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium tracking-tight">{tx("menuPublicTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{tx("menuPublicHint")}</p>
        </div>
        <Toggle className="mt-1 flex-none" checked={published} disabled={busy || !canPublish} onChange={(on) => void run(on ? "publish" : "unpublish")} ariaLabel={tx("menuPublicTitle")} />
      </div>
      {!canPublish ? <p className="mt-2 text-xs text-[var(--muted)]">{t("publishNeedsClose")}</p> : null}
      {published ? (
        <div className="mt-4">
          <LinkPill url={publicUrl} placeholder={t("linkNotStored")} copied={copied} busy={busy} onCopy={() => void copy()} onRenew={() => void run("rotate")}
            copyLabel={t("copyLink")} copiedLabel={t("linkCopied")} renewLabel={t("rotateLink")} urlLabel={tx("menuPublicTitle")} />
        </div>
      ) : null}
      {/* Off deletes the link for good (on again makes a new one), and so does a new link: say it before it happens. */}
      {published ? <p className="mt-2 pl-3 text-xs text-[var(--muted)]">{tx("publicLinkWarning")}</p> : null}
      <StatusMessage error={error} />
    </section>
  );
}
