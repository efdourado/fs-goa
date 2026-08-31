"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { useGoaFormat } from "../format";
import type { User } from "../types";
import { backLinkClass, Button, cardClass, cx, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";

export function AccountScreen({
  user,
  onBack,
  onSaveProfile,
  onChangePassword,
}: {
  user: User;
  onBack: () => void;
  onSaveProfile: (payload: { name: string }) => Promise<void>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [name, setName] = useState(user.name);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ error?: string; success?: string }>({});

  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ error?: string; success?: string }>({});

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileMsg({});
    try {
      await onSaveProfile({ name: name.trim() });
      setProfileMsg({ success: t("profileSaved") });
    } catch (cause) {
      setProfileMsg({ error: f.error(cause) });
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmation") ?? "")) {
      setPwMsg({ error: t("passwordsDontMatch") });
      return;
    }
    setPwBusy(true);
    setPwMsg({});
    try {
      await onChangePassword({ currentPassword: String(form.get("currentPassword") ?? ""), newPassword });
      setPwMsg({ success: t("passwordChanged") });
      (event.target as HTMLFormElement).reset();
    } catch (cause) {
      setPwMsg({ error: f.error(cause) });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading title={t("title")} description={t("subtitle")} />

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("profileTitle")}</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
          <label className="sm:col-span-2"><span className={labelClass}>{t("nameLabel")}</span><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={profileBusy} /></label>
          <label><span className={labelClass}>{t("usernameLabel")}</span><input className={cx(inputClass, "opacity-60")} value={`@${user.username}`} readOnly disabled /></label>
          <label><span className={labelClass}>{t("emailLabel")}</span><input className={cx(inputClass, "opacity-60")} value={user.email ?? t("emailEmpty")} readOnly disabled /></label>
          <div className="sm:col-span-2"><StatusMessage error={profileMsg.error} success={profileMsg.success} /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={profileBusy}>{profileBusy ? tc("saving") : t("saveProfile")}</Button></div>
        </form>
      </section>

      <section className={cx(cardClass, "mt-6 p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("passwordTitle")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("passwordSubtitle")}</p>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
          <label className="sm:col-span-2"><span className={labelClass}>{t("currentPassword")}</span><input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required disabled={pwBusy} /></label>
          <label><span className={labelClass}>{t("newPassword")}</span><input className={inputClass} name="newPassword" type="password" autoComplete="new-password" required minLength={8} disabled={pwBusy} /></label>
          <label><span className={labelClass}>{t("confirmNewPassword")}</span><input className={inputClass} name="confirmation" type="password" autoComplete="new-password" required minLength={8} disabled={pwBusy} /></label>
          <div className="sm:col-span-2"><StatusMessage error={pwMsg.error} success={pwMsg.success} /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pwBusy}>{pwBusy ? t("changingPassword") : t("changePassword")}</Button></div>
        </form>
      </section>
    </main>
  );
}
