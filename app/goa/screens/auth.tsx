"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "../api";
import { Brand, Button, inputClass, labelClass, StatusMessage } from "../ui";

export function AuthScreen({
  initialMode,
  invitePending,
  onAuthenticated,
  onShowInvite,
}: {
  initialMode: "login" | "register";
  invitePending: boolean;
  onAuthenticated: (mode: "login" | "register", payload: Record<string, string>) => Promise<void>;
  onShowInvite?: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (mode === "register" && password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAuthenticated(mode, {
        name: String(form.get("name") ?? ""),
        username: String(form.get("username") ?? ""),
        password,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-[var(--ink)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-[#aaa9a0]">Desafios privados, histórias duradouras</p>
          <h1 className="text-6xl font-semibold leading-[0.96] tracking-[-0.06em]">Você registra.<br />O Goa organiza.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#c8c9c2]">Crie desafios com seu grupo, acompanhe o que importa e transforme o resultado em uma memória bonita.</p>
        </div>
        <p className="text-xs text-[#8f918b]">Privado por padrão · sem planilhas frágeis</p>
        <span className="absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <span className="absolute -bottom-32 right-24 h-80 w-80 rounded-full bg-[var(--coral)] opacity-90" aria-hidden="true" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><Brand /></div>
          {invitePending ? (
            <button className="mb-5 w-full rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left text-sm text-violet-900" type="button" onClick={onShowInvite}>
              <strong>Você tem um convite pendente.</strong> Entre ou crie sua conta para aceitar.
            </button>
          ) : null}
          <h2 className="mt-2 text-3xl font-bold tracking-[-0.045em]">{mode === "login" ? "Entre no Goa" : "Crie sua conta"}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{mode === "login" ? "Use seu nome de usuário e senha." : "Só pedimos o essencial. E-mail não é obrigatório."}</p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>Seu nome</span>
                <input className={inputClass} name="name" autoComplete="name" required maxLength={100} disabled={busy} />
              </label>
            ) : null}
            <label>
              <span className={labelClass}>Usuário</span>
              <input className={inputClass} name="username" autoComplete="username" required minLength={3} maxLength={40} disabled={busy} spellCheck={false} />
              {mode === "register" ? <span className="mt-1 block text-xs text-[var(--muted)] mb-3">Use letras, números, ponto, hífen ou sublinhado.</span> : null}
            </label>
            <label>
              <span className={labelClass}>Senha</span>
              <input className={inputClass} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy} />
            </label>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>Confirme a senha</span>
                <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
              </label>
            ) : null}
            <StatusMessage error={error} />
            <Button type="submit" disabled={busy} className="w-full mt-6">
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
              {!busy ? <span aria-hidden="true">→</span> : null}
            </Button>
          </form>
          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {mode === "login" ? "Sem conta?" : "Já tem uma conta?"}{" "}
            <button className="min-h-11 font-bold underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "Cadastre-se" : "Entrar"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
