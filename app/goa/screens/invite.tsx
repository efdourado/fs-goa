"use client";

import { useEffect, useState } from "react";

import { API_PATHS, apiRequest, errorMessage } from "../api";
import type { InviteAcceptance, InvitePreview, User } from "../types";
import { Button, cardClass, cx, StatusMessage } from "../ui";
import { formatDateTime } from "../utils";

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
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<InvitePreview | { invite: InvitePreview }>(API_PATHS.invite(token), { signal: controller.signal })
      .then((response) => setPreview("invite" in response ? response.invite : response))
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause)); })
      .finally(() => setLoading(false));
    return () => controller.abort();
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
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--main-2)] text-2xl" aria-hidden="true">◎</span>
        {loading ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">Verificando convite…</p> : preview ? (
          <>
            <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">{preview.challengeId ? "Convite para participar de um desafio" : "Convite para um grupo privado"}</p>
            <h1 className="mt-2 text-3xl font-light tracking-[-0.04em]">{preview.challengeTitle ?? preview.groupName}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{preview.challengeId ? `${preview.invitedBy ? `${preview.invitedBy} convidou você. ` : ""}Ao aceitar, você entra em ${preview.groupName} e passa a participar deste desafio.` : preview.invitedBy ? `${preview.invitedBy} convidou você para participar dos desafios deste grupo.` : "Ao aceitar, você poderá ver os desafios disponíveis para os membros."}</p>
            {preview.expiresAt ? <p className="mt-3 text-xs font-semibold text-[var(--muted)]">Válido até {formatDateTime(preview.expiresAt)}</p> : null}
            {preview.status === "accepted" ? <div className="mt-5 space-y-4"><StatusMessage success="Você já aceitou este convite." /><Button onClick={() => void onAccepted({ ...preview, accepted: true, idempotent: true })}>Continuar</Button></div> : preview.status && preview.status !== "valid" ? <div className="mt-5"><StatusMessage error={preview.status === "expired" ? "Este convite expirou." : preview.status === "revoked" ? "Este convite foi revogado." : "Este convite já atingiu o limite de usos."} /></div> : (
              <Button className="mt-7 w-full sm:w-auto" disabled={busy} onClick={() => void accept()}>{busy ? "Aceitando…" : user ? `Aceitar como ${user.name}` : "Entrar para aceitar"}</Button>
            )}
          </>
        ) : null}
        <div className="mt-5"><StatusMessage error={error} /></div>
        <button className="mt-6 min-h-11 text-sm font-light text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar</button>
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
  const challenge = invitation.challengeId && invitation.challengeTitle;
  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--ok-soft)] text-2xl text-[var(--ok)]" aria-hidden="true">✓</span>
        <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">Login feito · convite aceito</p>
        <h1 className="mt-2 text-3xl font-light tracking-[-0.04em]">Tudo certo.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
          {challenge
            ? <>Você entrou no grupo <strong>{invitation.groupName}</strong> e agora participa do desafio <strong>{invitation.challengeTitle}</strong>.</>
            : <>Você agora participa do grupo <strong>{invitation.groupName}</strong>.</>}
        </p>
        <Button className="mt-7 w-full sm:w-auto" onClick={onContinue}>{challenge ? "Abrir desafio" : "Abrir grupo"}</Button>
      </section>
    </main>
  );
}
