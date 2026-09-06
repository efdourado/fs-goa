"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { useGoaFormat } from "../format";
import { LanguageToggle } from "../LanguageToggle";
import { Brand, Button, inputClass, labelClass, StatusMessage } from "../ui";

type Mode = "login" | "register";

export function AuthScreen({
  initialMode,
  invitePending,
  onAuthenticated,
  onShowInvite,
  onShowTemplates,
}: {
  initialMode: Mode;
  invitePending: boolean;
  onAuthenticated: (mode: Mode, payload: Record<string, string>) => Promise<void>;
  onShowInvite?: () => void;
  onShowTemplates?: () => void;
}) {
  const t = useTranslations("auth");
  const f = useGoaFormat();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);

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

  const heading = t(`${mode}.heading`);
  const subheading = t(`${mode}.subheading`);

  return (
    <main className="relative grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <div className="absolute right-4 top-4 z-20 hidden lg:block"><LanguageToggle /></div>
      <section className="relative hidden overflow-hidden bg-[var(--spotlight)] p-12 text-[var(--spotlight-ink)] lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-light text-white/55">{t("heroKicker")}</p>
          <p className="text-6xl font-medium leading-[0.96] tracking-[-0.06em]">{t("heroTitleLine1")}<br />{t("heroTitleLine2")}</p>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/70">{t("heroBody")}</p>
        </div>
        <p className="text-xs text-white/45">{t("heroFootnote")}</p>
        <span className="absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <span className="absolute -bottom-32 right-24 h-80 w-80 rounded-full bg-[var(--main-2)] opacity-90" aria-hidden="true" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center justify-between gap-3 lg:hidden"><Brand /><LanguageToggle /></div>
          {invitePending ? (
            <button className="mb-5 w-full rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)] px-4 py-3 text-left text-sm text-[var(--main-strong)]" type="button" onClick={onShowInvite}>
              <strong>{t("invitePendingTitle")}</strong>{t("invitePendingBody")}
            </button>
          ) : null}
          <h1 className="mt-2 text-3xl font-light tracking-[-0.045em]">{heading}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{subheading}</p>
          <p className="mt-3 rounded-xl bg-[var(--wash)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">{t("reassure")}</p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>{t("register.nameLabel")}</span>
                <input className={inputClass} name="name" autoComplete="name" required maxLength={100} disabled={busy} />
              </label>
            ) : null}

            <label>
              <span className={labelClass}>{mode === "login" ? t("login.usernameLabel") : t("register.usernameLabel")}</span>
              <input className={inputClass} name="username" autoComplete="username" required minLength={3} maxLength={254} disabled={busy} spellCheck={false} />
              {mode === "register" ? <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">{t("register.usernameHint")}</span> : null}
            </label>

            {mode === "register" ? (
              <label>
                <span className={labelClass}>{t("register.emailLabel")}</span>
                <input className={inputClass} name="email" type="email" autoComplete="email" maxLength={254} disabled={busy} spellCheck={false} />
                <span className="mt-1 mb-3 block text-xs text-[var(--muted)]">{t("register.emailHint")}</span>
              </label>
            ) : null}

            <label>
              <span className={labelClass}>{t("passwordLabel")}</span>
              <input className={inputClass} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy} />
            </label>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>{t("register.passwordConfirmLabel")}</span>
                <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
              </label>
            ) : null}

            <StatusMessage error={error} />
            <Button type="submit" disabled={busy} className="w-full mt-6">
              {busy ? t("wait") : t(`${mode}.submit`)}
              {!busy ? <span aria-hidden="true">→</span> : null}
            </Button>
          </form>

          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {mode === "login" ? t("noAccount") : t("hasAccount")}
            <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => goTo(mode === "login" ? "register" : "login")}>
              {mode === "login" ? t("goRegister") : t("goLogin")}
            </button>
          </p>
          {onShowTemplates ? (
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              {t("browseFirst")}
              <button className="min-h-11 font-light underline-offset-4 hover:underline cursor-pointer" type="button" onClick={onShowTemplates}>{t("showTemplates")}</button>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
