"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { useGoaFormat } from "../format";
import { SettingsMenu } from "../SettingsMenu";
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
  const t = useTranslations("auth");
  const f = useGoaFormat();
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
        setError(f.error(cause));
      } finally {
        setBusy(false);
      }
      return;
    }

    const password = String(form.get("password") ?? "");
    if (mode === "register" && password !== String(form.get("passwordConfirmation") ?? "")) {
      setError(t("passwordsDontMatch"));
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
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  const section = mode === "forgot" ? "forgot" : mode;
  const heading = t(`${section}.heading`);
  const subheading = t(`${section}.subheading`);

  return (
    <main className="relative grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <div className="absolute right-4 top-4 z-20 hidden lg:block"><SettingsMenu /></div>
      <section className="relative hidden overflow-hidden bg-[var(--spotlight)] p-12 text-[var(--spotlight-ink)] lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-light uppercase tracking-[0.18em] text-white/55">{t("heroKicker")}</p>
          <h1 className="text-6xl font-semibold leading-[0.96] tracking-[-0.06em]">{t("heroTitleLine1")}<br />{t("heroTitleLine2")}</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/70">{t("heroBody")}</p>
        </div>
        <p className="text-xs text-white/45">{t("heroFootnote")}</p>
        <span className="absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <span className="absolute -bottom-32 right-24 h-80 w-80 rounded-full bg-[var(--main-2)] opacity-90" aria-hidden="true" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center justify-between gap-3 lg:hidden"><Brand /><SettingsMenu /></div>
          {invitePending ? (
            <button className="mb-5 w-full rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)] px-4 py-3 text-left text-sm text-[var(--main-strong)]" type="button" onClick={onShowInvite}>
              <strong>{t("invitePendingTitle")}</strong>{t("invitePendingBody")}
            </button>
          ) : null}
          <h2 className="mt-2 text-3xl font-light tracking-[-0.045em]">{heading}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{subheading}</p>

          {mode === "forgot" && forgotSent ? (
            <div className="mt-6 space-y-4">
              <StatusMessage success={t("forgot.sent")} />
              <Button className="w-full" onClick={() => goTo("login")}>{t("forgot.backToLogin")}</Button>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              {mode === "register" ? (
                <label>
                  <span className={labelClass}>{t("register.nameLabel")}</span>
                  <input className={inputClass} name="name" autoComplete="name" required maxLength={100} disabled={busy} />
                </label>
              ) : null}

              {mode !== "forgot" ? (
                <label>
                  <span className={labelClass}>{mode === "login" ? t("login.usernameLabel") : t("register.usernameLabel")}</span>
                  <input className={inputClass} name="username" autoComplete="username" required minLength={3} maxLength={254} disabled={busy} spellCheck={false} />
                  {mode === "register" ? <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">{t("register.usernameHint")}</span> : null}
                </label>
              ) : null}

              {mode !== "login" ? (
                <label>
                  <span className={labelClass}>{mode === "register" ? t("register.emailLabel") : t("forgot.emailLabel")}</span>
                  <input className={inputClass} name="email" type="email" autoComplete="email" required={mode === "forgot"} maxLength={254} disabled={busy} spellCheck={false} />
                  {mode === "register" ? <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">{t("register.emailHint")}</span> : null}
                </label>
              ) : null}

              {mode !== "forgot" ? (
                <label>
                  <span className={labelClass}>{t("passwordLabel")}</span>
                  <input className={inputClass} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy} />
                </label>
              ) : null}
              {mode === "register" ? (
                <label>
                  <span className={labelClass}>{t("register.passwordConfirmLabel")}</span>
                  <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
                </label>
              ) : null}

              {mode === "login" ? (
                <button className="text-xs font-light text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline" type="button" onClick={() => goTo("forgot")}>
                  {t("forgot.link")}
                </button>
              ) : null}

              <StatusMessage error={error} />
              <Button type="submit" disabled={busy} className="w-full mt-6">
                {busy ? t("wait") : t(`${section}.submit`)}
                {!busy ? <span aria-hidden="true">→</span> : null}
              </Button>
            </form>
          )}

          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {mode === "forgot" ? (
              <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => goTo("login")}>{t("back")}</button>
            ) : (
              <>
                {mode === "login" ? t("noAccount") : t("hasAccount")}
                <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => goTo(mode === "login" ? "register" : "login")}>
                  {mode === "login" ? t("goRegister") : t("goLogin")}
                </button>
              </>
            )}
          </p>
          {onShowTemplates ? (
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={onShowTemplates}>{t("showTemplates")}</button>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
