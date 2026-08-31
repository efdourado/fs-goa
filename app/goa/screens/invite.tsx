"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import type { InviteAcceptance, InvitePreview, User } from "../types";
import { backLinkClass, Button, cardClass, cx, StatusMessage } from "../ui";

export function InviteScreen({
  token,
  user,
  onBack,
  onNeedAuth,
  onAccepted,
  csrfToken,
}: {
  token: string;
  user: User | null;
  onBack: () => void;
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

  const previewBody = preview
    ? preview.challengeId
      ? preview.invitedBy
        ? t("bodyChallengeWithInviter", { invitedBy: preview.invitedBy, groupName: preview.groupName })
        : t("bodyChallenge", { groupName: preview.groupName })
      : preview.invitedBy
        ? t("bodyGroupWithInviter", { invitedBy: preview.invitedBy })
        : t("bodyGroup")
    : "";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--main-2)] text-2xl" aria-hidden="true">◎</span>
        {loading ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">{t("verifying")}</p> : preview ? (
          <>
            <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">{preview.challengeId ? t("kickerChallenge") : t("kickerGroup")}</p>
            <h1 className="mt-2 text-3xl font-light tracking-[-0.04em]">{preview.challengeTitle ?? preview.groupName}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{previewBody}</p>
            {preview.expiresAt ? <p className="mt-3 text-xs font-semibold text-[var(--muted)]">{t("validUntil", { date: f.dateTime(preview.expiresAt) })}</p> : null}
            {preview.status === "accepted" ? <div className="mt-5 space-y-4"><StatusMessage success={t("alreadyAccepted")} /><Button onClick={() => void onAccepted({ ...preview, accepted: true, idempotent: true })}>{t("continue")}</Button></div> : preview.status && preview.status !== "valid" ? <div className="mt-5"><StatusMessage error={preview.status === "expired" ? t("expired") : preview.status === "revoked" ? t("revoked") : t("exhausted")} /></div> : (
              <Button className="mt-7 w-full sm:w-auto" disabled={busy} onClick={() => void accept()}>{busy ? t("accepting") : user ? t("acceptAs", { name: user.name }) : t("signInToAccept")}</Button>
            )}
          </>
        ) : null}
        <div className="mt-5"><StatusMessage error={error} /></div>
        <button className={cx(backLinkClass, "mt-6")} type="button" onClick={onBack}>{t("back")}</button>
      </section>
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
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--ok-soft)] text-2xl text-[var(--ok)]" aria-hidden="true">✓</span>
        <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">{t("acceptedKicker")}</p>
        <h1 className="mt-2 text-3xl font-light tracking-[-0.04em]">{t("acceptedTitle")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
          {challenge
            ? t.rich("acceptedBodyChallenge", { groupName: invitation.groupName, challengeTitle: invitation.challengeTitle ?? "", b: (chunks) => <strong>{chunks}</strong> })
            : t.rich("acceptedBodyGroup", { groupName: invitation.groupName, b: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <Button className="mt-7 w-full sm:w-auto" onClick={onContinue}>{challenge ? t("openChallenge") : t("openGroup")}</Button>
      </section>
    </main>
  );
}
