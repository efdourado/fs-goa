"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { copyText } from "../clipboard";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import type { ChallengeDetail } from "../types";
import { Button, cx, StatusMessage } from "../ui";

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
    <div className="mt-6 flex items-center justify-between gap-5 rounded-2xl bg-[var(--wash)] p-5">
      <div><p className="text-base font-medium">{tx(published ? "publicOn" : "publicOff")}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{published ? t(challenge.resultsAnon ? "publishStateAnon" : "publishStateNamed") : tx("privateUntilPublished")}</p></div>
      <button type="button" role="switch" aria-checked={published} aria-label={tx("publicAccess")} disabled={busy || challenge.status !== "closed" || confirm !== null}
        onClick={() => setConfirm(published ? "unpublish" : "publish")}
        className={cx("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition disabled:opacity-40", published ? "bg-[var(--main-strong)]" : "bg-[var(--muted)]")}>
        <span className={cx("h-6 w-6 rounded-full bg-white shadow transition-transform", published ? "translate-x-6" : "translate-x-0")} />
      </button>
    </div>
    {challenge.status !== "closed" ? <p className="mt-3 text-sm text-[var(--muted)]">{t("publishNeedsClose")}</p> : null}
    {published ? <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy || !publicUrl || confirm !== null} onClick={async () => { try { await copyText(publicUrl!); setError(null); setSuccess(t("linkCopied")); } catch { setError(t("copyFailed")); } }}>{t("copyLink")}</Button>
      <button type="button" aria-label={t("rotateLink")} title={t("rotateLink")} disabled={busy || confirm !== null} onClick={() => setConfirm("rotate")} className="grid size-11 place-items-center rounded-xl border border-[var(--line)] hover:bg-[var(--wash)] disabled:opacity-40">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 7h-9M17 4l3 3-3 3M4 17h9M7 14l-3 3 3 3" /><path d="M5 10a7 7 0 0 1 12-5M19 14a7 7 0 0 1-12 5" /></svg>
      </button>
      <Button variant="ghost" disabled={busy || confirm !== null} onClick={() => setConfirm("publish")}>{tx("updatePublication")}</Button>
    </div> : null}
    <p className="mt-4 text-xs leading-6 text-[var(--muted)]">{tx("savedVersionOnly")}</p>
    {published && !publicUrl ? <p className="mt-2 text-xs text-[var(--muted)]">{t("linkNotStored")}</p> : null}
    {confirm ? <div className="mt-5 space-y-4 rounded-xl border border-[var(--line)] p-4">
      <p className="text-sm leading-6">{confirm === "rotate" ? t("rotateLinkConfirm") : confirm === "unpublish" ? t("unpublishConfirm") : t(challenge.resultsAnon ? "publishConfirmAnon" : "publishConfirmNoAnon")}</p>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>{tc("cancel")}</Button><Button variant={confirm === "publish" ? "primary" : "danger"} disabled={busy} onClick={() => void apply()}>{busy ? tc("saving") : t(confirm === "rotate" ? "rotateLink" : confirm === "unpublish" ? "unpublish" : published ? "republishShowcase" : "publishShowcase")}</Button></div>
    </div> : null}
    <StatusMessage error={error} success={success} />
    <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-4"><Button variant="secondary" onClick={onClose} disabled={busy}>{tc("close")}</Button></div>
  </Dialog>;
}
