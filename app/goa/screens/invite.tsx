"use client";

import { useEffect, useState } from "react";

import { API_PATHS, apiRequest, errorMessage } from "../api";
import type { InvitePreview, User } from "../types";
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
  onAccepted: () => Promise<void>;
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
      await apiRequest(API_PATHS.invite(token), { method: "POST", body: {}, csrfToken });
      await onAccepted();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--coral)] text-2xl" aria-hidden="true">◎</span>
        {loading ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">Verificando convite…</p> : preview ? (
          <>
            <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">Convite para um grupo privado</p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em]">{preview.groupName}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{preview.invitedBy ? `${preview.invitedBy} convidou você para participar dos desafios deste grupo.` : "Ao aceitar, você poderá ver os desafios disponíveis para os membros."}</p>
            {preview.expiresAt ? <p className="mt-3 text-xs font-semibold text-[var(--muted)]">Válido até {formatDateTime(preview.expiresAt)}</p> : null}
            {preview.status && preview.status !== "valid" ? <div className="mt-5"><StatusMessage error={preview.status === "expired" ? "Este convite expirou." : preview.status === "revoked" ? "Este convite foi revogado." : preview.status === "exhausted" ? "Este convite já atingiu o limite de usos." : "Este convite já foi aceito."} /></div> : (
              <Button className="mt-7 w-full sm:w-auto" disabled={busy} onClick={() => void accept()}>{busy ? "Aceitando…" : user ? `Aceitar como ${user.name}` : "Entrar para aceitar"}</Button>
            )}
          </>
        ) : null}
        <div className="mt-5"><StatusMessage error={error} /></div>
        <button className="mt-6 min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar</button>
      </section>
    </main>
  );
}
