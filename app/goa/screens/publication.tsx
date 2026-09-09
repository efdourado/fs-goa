"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { copyText } from "../clipboard";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import type { ChallengeDetail } from "../types";
import { Button, StatusMessage, Toggle } from "../ui";

export function PublicationDialog({ challenge, onPublish, onUnpublish, onClose }: {
  challenge: ChallengeDetail;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null } | undefined>;
  onUnpublish: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("managementUX");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "rotate" | "unpublish" | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const published = Boolean(challenge.result?.publishedAt);
  const token = challenge.result?.shareToken;
  const publicUrl = newUrl ?? (token && typeof window !== "undefined" ? `${window.location.origin}/results/${encodeURIComponent(token)}` : null);
  async function apply() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      if (confirm === "unpublish") { await onUnpublish(); setNewUrl(null); setSuccess(t("showcaseUnpublished")); }
      else { const result = await onPublish(confirm === "rotate" ? { rotateLink: true } : {}); setNewUrl(result?.url ?? null); setSuccess(t(confirm === "rotate" ? "linkRotated" : "showcasePublished")); }
      setConfirm(null);
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }
  return <Dialog title={tx("publication")} onClose={onClose} busy={busy}>
    <p className="text-sm leading-6 text-[var(--muted)]">{tx("publicationBody")}</p>

    <div className="mt-5">
      <Toggle
        checked={published}
        disabled={busy || challenge.status !== "closed" || confirm !== null}
        onChange={() => setConfirm(published ? "unpublish" : "publish")}
        label={tx(published ? "publicOn" : "publicOff")}
        hint={published ? t(challenge.resultsAnon ? "publishStateAnon" : "publishStateNamed") : tx("privateUntilPublished")}
      />
    </div>
    {challenge.status !== "closed" ? <p className="mt-2 text-xs text-[var(--muted)]">{t("publishNeedsClose")}</p> : null}

    {published ? (
      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3">
          <span className="min-w-0 flex-1 truncate py-2.5 text-xs text-[var(--muted)]">{publicUrl ?? t("linkNotStored")}</span>
          <button type="button" aria-label={t("copyLink")} title={t("copyLink")} disabled={busy || !publicUrl || confirm !== null}
            onClick={async () => { try { await copyText(publicUrl!); setError(null); setSuccess(t("linkCopied")); } catch { setError(t("copyFailed")); } }}
            className="grid size-8 flex-none place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11V3.5h7.5" /></svg>
          </button>
          <button type="button" aria-label={t("rotateLink")} title={t("rotateLink")} disabled={busy || confirm !== null} onClick={() => setConfirm("rotate")}
            className="grid size-8 flex-none place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7h-9M17 4l3 3-3 3M4 17h9M7 14l-3 3 3 3" /></svg>
          </button>
        </div>
        <button type="button" disabled={busy || confirm !== null} onClick={() => setConfirm("publish")} className="text-xs font-light text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline disabled:opacity-40">
          {tx("updatePublication")}
        </button>
      </div>
    ) : null}
    <p className="mt-4 text-xs leading-6 text-[var(--muted)]">{tx("savedVersionOnly")}</p>

    {confirm ? (
      <div className="mt-5 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--wash)] p-4">
        <p className="text-sm leading-6">{confirm === "rotate" ? t("rotateLinkConfirm") : confirm === "unpublish" ? t("unpublishConfirm") : t(challenge.resultsAnon ? "publishConfirmAnon" : "publishConfirmNoAnon")}</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>{tc("cancel")}</Button><Button variant={confirm === "publish" ? "primary" : "danger"} disabled={busy} onClick={() => void apply()}>{busy ? tc("saving") : t(confirm === "rotate" ? "rotateLink" : confirm === "unpublish" ? "unpublish" : published ? "republishShowcase" : "publishShowcase")}</Button></div>
      </div>
    ) : null}
    <StatusMessage error={error} success={success} />
    <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-4"><Button variant="secondary" onClick={onClose} disabled={busy}>{tc("close")}</Button></div>
  </Dialog>;
}
