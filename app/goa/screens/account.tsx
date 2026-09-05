"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import type { User } from "../types";
import { backLinkClass, Button, cardClass, cx, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";

interface DeletionPreview {
  ownedGroups: Array<{ name: string; members: number; willTransfer: boolean }>;
  memberships: number;
  publishedChallenges: number;
}

export function AccountScreen({
  user,
  onBack,
  onSaveProfile,
  onChangePassword,
  onDeactivate,
  onDeletePermanently,
}: {
  user: User;
  onBack: () => void;
  onSaveProfile: (payload: { name: string }) => Promise<void>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
  onDeactivate: () => Promise<void>;
  onDeletePermanently: (password: string) => Promise<void>;
}) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [name, setName] = useState(user.name);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ error?: string; success?: string }>({});

  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ error?: string; success?: string }>({});

  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [preview, setPreview] = useState<DeletionPreview | null>(null);

  useEffect(() => {
    if (!showDelete) return;
    const controller = new AbortController();
    apiRequest<DeletionPreview>(API_PATHS.accountDeletionPreview, { signal: controller.signal })
      .then(setPreview)
      .catch(() => undefined);
    return () => controller.abort();
  }, [showDelete]);

  async function deactivate() {
    if (!window.confirm(t("deactivateConfirm"))) return;
    setDeactivateBusy(true);
    setDeleteError(null);
    try {
      await onDeactivate();
    } catch (cause) {
      setDeleteError(f.error(cause));
      setDeactivateBusy(false);
    }
  }

  async function deletePermanently() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDeletePermanently(deletePassword);
    } catch (cause) {
      setDeleteError(f.error(cause));
      setDeleteBusy(false);
    }
  }

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

      <section className={cx(cardClass, "mt-6 border-[var(--danger-line)] p-5 sm:p-7")}>
        <h2 className="text-xl font-light text-[var(--danger)]">{t("dangerTitle")}</h2>

        <div className="mt-4">
          <h3 className="text-sm font-normal">{t("deactivateTitle")}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("deactivateBody")}</p>
          <Button variant="secondary" className="mt-3" disabled={deactivateBusy} onClick={() => void deactivate()}>
            {deactivateBusy ? tc("saving") : t("deactivate")}
          </Button>
        </div>

        <hr className="my-5 border-[var(--line)]" />

        <div>
          <h3 className="text-sm font-normal text-[var(--danger)]">{t("deletePermanentTitle")}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("deletePermanentBody")}</p>
          {!showDelete ? (
            <Button variant="danger" className="mt-3" onClick={() => setShowDelete(true)}>{t("deletePermanent")}</Button>
          ) : (
            <div className="mt-3 space-y-3">
              {preview ? (
                <ul className="space-y-1 text-sm text-[var(--muted)]">
                  {preview.ownedGroups.map((group) => (
                    <li key={group.name}>
                      {group.willTransfer ? t("consequenceTransfer", { name: group.name }) : t("consequencePurgeGroup", { name: group.name })}
                    </li>
                  ))}
                  <li>{t("consequencePersonal")}</li>
                  {preview.publishedChallenges > 0 ? <li>{t("consequencePublications", { count: preview.publishedChallenges })}</li> : null}
                </ul>
              ) : null}
              <label className="block">
                <span className={labelClass}>{t("deletePasswordLabel")}</span>
                <input className={inputClass} type="password" autoComplete="current-password" value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)} aria-label={t("deletePasswordLabel")} />
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { setShowDelete(false); setDeletePassword(""); }} disabled={deleteBusy}>{tc("cancel")}</Button>
                <Button variant="danger" disabled={deleteBusy || deletePassword.length === 0} onClick={() => void deletePermanently()}>
                  {deleteBusy ? t("deleting") : t("deletePermanentConfirm")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4"><StatusMessage error={deleteError} /></div>
      </section>
    </main>
  );
}
