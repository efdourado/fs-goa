"use client";

import { type FormEvent, useState } from "react";

import { API_PATHS, apiRequest, errorMessage } from "../api";
import { backLinkClass, Brand, Button, cardClass, cx, inputClass, labelClass, StatusMessage } from "../ui";

export function ResetPasswordScreen({
  token,
  onDone,
  onCancel,
}: {
  token: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmation") ?? "")) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(API_PATHS.auth.reset, { method: "POST", body: { token, password } });
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 sm:p-8")}>
        <Brand />
        <h1 className="mt-6 text-2xl font-light tracking-[-0.04em]">Criar uma nova senha</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Escolha uma senha nova. Suas outras sessões serão encerradas por segurança.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label>
            <span className={labelClass}>Nova senha</span>
            <input className={inputClass} name="password" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
          </label>
          <label>
            <span className={labelClass}>Confirme a nova senha</span>
            <input className={inputClass} name="confirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
          </label>
          <StatusMessage error={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : "Salvar e entrar"}</Button>
        </form>
        <button className={cx(backLinkClass, "mt-5")} type="button" onClick={onCancel}>← Voltar ao login</button>
      </section>
    </main>
  );
}
