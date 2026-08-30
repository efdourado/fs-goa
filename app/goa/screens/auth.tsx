"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "../api";
import { Brand, Button, inputClass, labelClass, StatusMessage } from "../ui";

type Mode = "login" | "register" | "forgot";

export function AuthScreen({
  initialMode,
  invitePending,
  onAuthenticated,
  onForgot,
  onShowInvite,
  onShowTemplates,
}: {
  initialMode: "login" | "register";
  invitePending: boolean;
  onAuthenticated: (mode: "login" | "register", payload: Record<string, string>) => Promise<void>;
  onForgot: (email: string) => Promise<void>;
  onShowInvite?: () => void;
  onShowTemplates?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  function goTo(next: Mode) {
    setMode(next);
    setError(null);
    setForgotSent(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);

    if (mode === "forgot") {
      setBusy(true);
      try {
        await onForgot(String(form.get("email") ?? "").trim());
        setForgotSent(true);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }

    const password = String(form.get("password") ?? "");
    if (mode === "register" && password !== String(form.get("passwordConfirmation") ?? "")) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      await onAuthenticated(mode, {
        name: String(form.get("name") ?? ""),
        username: String(form.get("username") ?? ""),
        email: String(form.get("email") ?? "").trim(),
        password,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "login" ? "Entre no Goa" : mode === "register" ? "Crie sua conta" : "Redefinir senha";
  const subheading =
    mode === "login" ? "Use seu usuário ou e-mail e a senha."
    : mode === "register" ? "Só pedimos o essencial. O e-mail ajuda a recuperar o acesso."
    : "Informe o e-mail da sua conta. O administrador vai te enviar um link para criar uma nova senha.";

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-[var(--ink)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-light uppercase tracking-[0.18em] text-white/55">Desafios privados, histórias duradouras</p>
          <h1 className="text-6xl font-semibold leading-[0.96] tracking-[-0.06em]">Você registra.<br />O Goa organiza.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/70">Crie desafios com seu grupo, acompanhe o que importa e transforme o resultado em uma memória bonita.</p>
        </div>
        <p className="text-xs text-white/45">Privado por padrão · sem planilhas frágeis</p>
        <span className="absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <span className="absolute -bottom-32 right-24 h-80 w-80 rounded-full bg-[var(--main-2)] opacity-90" aria-hidden="true" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><Brand /></div>
          {invitePending ? (
            <button className="mb-5 w-full rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)] px-4 py-3 text-left text-sm text-[var(--main-strong)]" type="button" onClick={onShowInvite}>
              <strong>Você tem um convite pendente.</strong> Entre ou crie sua conta; o aceite será concluído automaticamente.
            </button>
          ) : null}
          <h2 className="mt-2 text-3xl font-light tracking-[-0.045em]">{heading}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{subheading}</p>

          {mode === "forgot" && forgotSent ? (
            <div className="mt-6 space-y-4">
              <StatusMessage success="Pedido registrado. Se houver uma conta com esse e-mail, o administrador vai te enviar um link para redefinir a senha." />
              <Button className="w-full" onClick={() => goTo("login")}>Voltar para o login</Button>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              {mode === "register" ? (
                <label>
                  <span className={labelClass}>Seu nome</span>
                  <input className={inputClass} name="name" autoComplete="name" required maxLength={100} disabled={busy} />
                </label>
              ) : null}

              {mode !== "forgot" ? (
                <label>
                  <span className={labelClass}>{mode === "login" ? "Usuário ou e-mail" : "Usuário"}</span>
                  <input className={inputClass} name="username" autoComplete="username" required minLength={3} maxLength={254} disabled={busy} spellCheck={false} />
                  {mode === "register" ? <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">Letras, números, ponto, hífen ou sublinhado.</span> : null}
                </label>
              ) : null}

              {mode !== "login" ? (
                <label>
                  <span className={labelClass}>E-mail{mode === "register" ? " (opcional)" : ""}</span>
                  <input className={inputClass} name="email" type="email" autoComplete="email" required={mode === "forgot"} maxLength={254} disabled={busy} spellCheck={false} />
                  {mode === "register" ? <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">Recomendado — é como você recupera o acesso se esquecer a senha.</span> : null}
                </label>
              ) : null}

              {mode !== "forgot" ? (
                <label>
                  <span className={labelClass}>Senha</span>
                  <input className={inputClass} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy} />
                </label>
              ) : null}
              {mode === "register" ? (
                <label>
                  <span className={labelClass}>Confirme a senha</span>
                  <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
                </label>
              ) : null}

              {mode === "login" ? (
                <button className="text-xs font-light text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline" type="button" onClick={() => goTo("forgot")}>
                  Esqueci a senha
                </button>
              ) : null}

              <StatusMessage error={error} />
              <Button type="submit" disabled={busy} className="w-full mt-6">
                {busy ? "Aguarde…" : mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : "Enviar pedido"}
                {!busy ? <span aria-hidden="true">→</span> : null}
              </Button>
            </form>
          )}

          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {mode === "forgot" ? (
              <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => goTo("login")}>Voltar</button>
            ) : (
              <>
                {mode === "login" ? "Sem conta? " : "Já tem uma conta? "}
                <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => goTo(mode === "login" ? "register" : "login")}>
                  {mode === "login" ? "Cadastre-se" : "Entrar"}
                </button>
              </>
            )}
          </p>
          {onShowTemplates ? (
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={onShowTemplates}>Ver modelos prontos</button>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
