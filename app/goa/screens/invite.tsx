"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import type { InviteAcceptance, InvitePreview, User } from "../types";
import { BackButton, Brand, Button, cx, StatusMessage } from "../ui";

/** The one thing to do on these pages: a green pill that lifts a little on hover. */
const acceptButton = "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-[var(--main)] px-10 text-[15px] font-medium text-white shadow-[0_10px_28px_-12px_var(--main)] transition hover:-translate-y-px hover:shadow-[0_14px_32px_-12px_var(--main)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0";

export function InviteScreen({
  token,
  user,
  onBack,
  backLabel,
  onNeedAuth,
  onAccepted,
  csrfToken,
}: {
  token: string;
  user: User | null;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onNeedAuth: () => void;
  onAccepted: (invitation: InviteAcceptance) => Promise<void>;
  csrfToken: string;
}) {
  const t = useTranslations("invite");
  const f = useGoaFormat();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<InvitePreview | { invite: InvitePreview }>(API_PATHS.invite(token), { signal: controller.signal })
      .then((response) => setPreview("invite" in response ? response.invite : response))
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(f.error(cause)); })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function accept() {
    if (!user) { onNeedAuth(); return; }
    setBusy(true);
    setError(null);
    try {
      const invitation = await apiRequest<InviteAcceptance>(API_PATHS.invite(token), {
        method: "POST",
        body: {},
        csrfToken,
      });
      await onAccepted(invitation);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  const strong = (chunks: ReactNode) => <strong className="font-semibold text-[var(--ink)]">{chunks}</strong>;
  const lead = preview
    ? preview.invitedBy
      ? t.rich(preview.challengeId ? "leadChallengeWithInviter" : "leadGroupWithInviter", { invitedBy: preview.invitedBy, b: strong })
      : t(preview.challengeId ? "leadChallenge" : "leadGroup")
    : null;

  // Minimal on purpose: no card, no icon. The logo, who invited you, the group's name in the middle, and Accept.
  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
      {loading ? <p className="text-sm text-[var(--muted)]" role="status">{t("verifying")}</p> : preview ? (
        <>
          <Brand />
          <p className="mt-10 text-base leading-7 text-[var(--muted)]">{lead}</p>
          <h1 className="mt-3 text-balance text-4xl font-light leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-5xl">{preview.challengeTitle ?? preview.groupName}</h1>
          {preview.challengeId ? <p className="mt-2 text-sm text-[var(--muted)]">{t("inGroup", { groupName: preview.groupName })}</p> : null}
          {preview.status === "accepted" ? (
            <div className="mt-10 space-y-4"><StatusMessage success={t("alreadyAccepted")} /><Button className="min-h-12 rounded-full px-10" onClick={() => void onAccepted({ ...preview, accepted: true, idempotent: true })}>{t("continue")}</Button></div>
          ) : preview.status && preview.status !== "valid" ? (
            <div className="mt-10"><StatusMessage error={preview.status === "expired" ? t("expired") : preview.status === "revoked" ? t("revoked") : t("exhausted")} /></div>
          ) : (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button type="button" className={acceptButton} disabled={busy} onClick={() => void accept()}>
                {busy ? t("accepting") : user ? t("accept") : t("signInToAccept")}
              </button>
              {user ? <p className="text-xs text-[var(--muted)]">{t.rich("joiningAs", { name: user.name, b: strong })}</p> : null}
              {preview.expiresAt ? <p className="text-xs text-[var(--muted)]">{t("validUntil", { date: f.dateTime(preview.expiresAt) })}</p> : null}
            </div>
          )}
        </>
      ) : null}
      <div className="mt-5"><StatusMessage error={error} /></div>
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mt-8" />
    </main>
  );
}

export function InviteAcceptedScreen({
  invitation,
  onContinue,
}: {
  invitation: InviteAcceptance;
  onContinue: () => void;
}) {
  const t = useTranslations("invite");
  const challenge = invitation.challengeId && invitation.challengeTitle;
  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
      <h1 className="text-sm font-medium text-[var(--muted)]">{t("acceptedTitle")}</h1>
      <p className="mt-6 text-balance text-base leading-7 text-[var(--muted)]">
        {challenge
          ? t.rich("acceptedBodyChallenge", { groupName: invitation.groupName, challengeTitle: invitation.challengeTitle ?? "", b: (chunks) => <strong className="font-semibold text-[var(--ink)]">{chunks}</strong> })
          : t.rich("acceptedBodyGroup", { groupName: invitation.groupName, b: (chunks) => <strong className="font-semibold text-[var(--ink)]">{chunks}</strong> })}
      </p>
      <button type="button" className={cx(acceptButton, "mt-10")} onClick={onContinue}>{challenge ? t("openChallenge") : t("openGroup")}</button>
    </main>
  );
}
