"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";

import { Dialog } from "../dialog";
import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import type { ChallengeSummary, User } from "../types";
import { BackButton, Button, Disclosure, Field, inputClass, PageHeading, StatusMessage, Toggle } from "../ui";

// Mirror of `PASSWORD_MIN_LENGTH` in lib/security — the server rejects shorter.
const PASSWORD_MIN_LENGTH = 10;

interface DeletionPreview {
  ownedGroups: Array<{ name: string; members: number; willTransfer: boolean }>;
  memberships: number;
  publishedChallenges: number;
}

export function AccountScreen({
  user,
  challenges,
  onBack,
  onSaveProfile,
  onChangePassword,
  onSetNameConsent,
  onOpenTrash,
  onDeactivate,
  onDeletePermanently,
}: {
  user: User;
  challenges: ChallengeSummary[];
  onBack: () => void;
  onSaveProfile: (payload: { name: string }) => Promise<void>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
  onSetNameConsent: (challengeId: string, consent: boolean) => Promise<void>;
  onOpenTrash: () => void;
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

  const consentChallenges = challenges.filter(
    (challenge) => challenge.isParticipant && challenge.scope !== "personal",
  );
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [consentState, setConsentState] = useState<Record<string, boolean>>({});
  const consentValue = (challenge: ChallengeSummary) =>
    consentState[challenge.id] ?? challenge.viewerNameConsent ?? false;

  async function toggleConsent(challenge: ChallengeSummary, next: boolean) {
    setConsentBusy(challenge.id);
    setConsentError(null);
    try {
      await onSetNameConsent(challenge.id, next);
      setConsentState((current) => ({ ...current, [challenge.id]: next }));
    } catch (cause) {
      setConsentError(f.error(cause));
    } finally {
      setConsentBusy(null);
    }
  }

  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    if (!showDelete) return;
    const controller = new AbortController();
    apiRequest<DeletionPreview>(API_PATHS.accountDeletionPreview, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setPreview(data); setPreviewError(null); } })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // Deletion must not proceed blind: if we can't show the consequences,
        // the confirm button stays disabled until this succeeds.
        setPreview(null);
        setPreviewError(f.error(cause));
      });
    return () => controller.abort();
  }, [showDelete, previewNonce, f]);

  // Always open on a blank slate — a stale preview from a previous open must
  // never gate (or worse, un-gate) the confirm button.
  function openDelete() {
    setPreview(null);
    setPreviewError(null);
    setDeletePassword("");
    setDeleteError(null);
    setShowDelete(true);
  }
  function closeDelete() {
    setShowDelete(false);
    setDeletePassword("");
  }
  function retryPreview() {
    setPreview(null);
    setPreviewError(null);
    setPreviewNonce((n) => n + 1);
  }

  async function deactivate() {
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
    if (!preview || deleteBusy || !deletePassword) return;
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

  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-24 sm:px-6 sm:py-10">
      <BackButton onClick={onBack} label={t("back")} className="mb-6" />
      <PageHeading title={t("title")} description={t("subtitle")} />

      {/* identity + editable name */}
      <form onSubmit={saveProfile} className="space-y-5">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-[var(--main-line)] text-lg font-black" aria-hidden="true">{initials}</span>
          <div className="min-w-0">
            <strong className="block truncate text-base font-semibold">{user.name}</strong>
            <span className="block truncate text-sm text-[var(--muted)]">
              @{user.username}{user.email ? ` · ${user.email}` : ""}
            </span>
          </div>
        </div>
        <Field label={t("nameLabel")}>
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={profileBusy} />
        </Field>
        <StatusMessage error={profileMsg.error} success={profileMsg.success} />
        <Button type="submit" className="w-full" disabled={profileBusy}>{profileBusy ? tc("saving") : t("saveProfile")}</Button>
      </form>

      <div className="mt-9 border-t border-[var(--line)]">
        <Disclosure summary={t("passwordTitle")}>
          <p className="mb-4 text-xs leading-5 text-[var(--muted)]">{t("passwordSubtitle")}</p>
          <form className="space-y-4" onSubmit={changePassword}>
            <Field label={t("currentPassword")}><input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required disabled={pwBusy} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("newPassword")}><input className={inputClass} name="newPassword" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} disabled={pwBusy} /></Field>
              <Field label={t("confirmNewPassword")}><input className={inputClass} name="confirmation" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} disabled={pwBusy} /></Field>
            </div>
            <StatusMessage error={pwMsg.error} success={pwMsg.success} />
            <Button type="submit" disabled={pwBusy}>{pwBusy ? t("changingPassword") : t("changePassword")}</Button>
          </form>
        </Disclosure>

        <section className="border-t border-[var(--line)] py-6">
          <h2 className="text-sm font-semibold">{t("nameConsentTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("nameConsentBody")}</p>
          <StatusMessage error={consentError} />
          {consentChallenges.length ? (
            <ul className="mt-4 space-y-2">
              {consentChallenges.map((challenge) => (
                <li className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3" key={challenge.id}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{challenge.title}</span>
                    <span className="text-xs text-[var(--muted)]">{t(`nameConsentStatus.${challenge.status}`)}</span>
                  </span>
                  <Toggle
                    checked={consentValue(challenge)}
                    disabled={consentBusy === challenge.id}
                    onChange={(next) => void toggleConsent(challenge, next)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("nameConsentEmpty")}</p>
          )}
        </section>

        <section className="flex flex-wrap items-start justify-between gap-3 border-t border-[var(--line)] py-6">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("trashTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("trashBody")}</p>
          </div>
          <Button variant="secondary" className="min-h-9" onClick={onOpenTrash}>{t("trashOpen")}</Button>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-[var(--danger-line)] bg-[var(--danger-soft)]/40 p-5">
        <h2 className="text-sm font-semibold text-[var(--danger-strong)]">{t("dangerTitle")}</h2>
        <div className="mt-3 divide-y divide-[var(--danger-line)]/60">
          <div className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium">{t("deactivateTitle")}</h3>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{t("deactivateBody")}</p>
            </div>
            <Button variant="secondary" className="min-h-9" disabled={deactivateBusy} onClick={() => { setDeleteError(null); setShowDeactivate(true); }}>
              {deactivateBusy ? tc("saving") : t("deactivate")}
            </Button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-[var(--danger-strong)]">{t("deletePermanentTitle")}</h3>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{t("deletePermanentBody")}</p>
            </div>
            <Button variant="danger" className="min-h-9" onClick={openDelete}>{t("deletePermanent")}</Button>
          </div>
        </div>

        {showDelete ? (
          <Dialog title={t("deleteDialogTitle")} busy={deleteBusy} onClose={closeDelete}>
            <div className="space-y-4">
              <p className="text-sm leading-6">{t("deletePermanentBody")}</p>
              {preview ? (
                <ul className="space-y-1 rounded-xl bg-[var(--wash)] p-4 text-sm text-[var(--muted)]">
                  {preview.ownedGroups.map((group) => (
                    <li key={group.name}>
                      {group.willTransfer ? t("consequenceTransfer", { name: group.name }) : t("consequencePurgeGroup", { name: group.name })}
                    </li>
                  ))}
                  <li>{t("consequencePersonal")}</li>
                  {preview.publishedChallenges > 0 ? <li>{t("consequencePublications", { count: preview.publishedChallenges })}</li> : null}
                  <li>{t("consequenceContributions")}</li>
                </ul>
              ) : previewError ? (
                <div className="space-y-2 text-sm">
                  <StatusMessage error={t("consequencesFailed")} />
                  <Button variant="secondary" onClick={retryPreview}>{tc("retry")}</Button>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]" role="status">{t("consequencesLoading")}</p>
              )}
              <Field label={t("deletePasswordLabel")}>
                <input className={inputClass} type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
              </Field>
              <StatusMessage error={deleteError} />
              <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4">
                <Button variant="secondary" onClick={closeDelete} disabled={deleteBusy}>{tc("cancel")}</Button>
                <Button variant="danger" disabled={deleteBusy || deletePassword.length === 0 || !preview} onClick={() => void deletePermanently()}>
                  {deleteBusy ? t("deleting") : t("deletePermanentConfirm")}
                </Button>
              </div>
            </div>
          </Dialog>
        ) : null}

        {showDeactivate ? (
          <Dialog title={t("deactivateTitle")} busy={deactivateBusy} onClose={() => setShowDeactivate(false)}>
            <p className="text-sm leading-6">{t("deactivateConfirm")}</p>
            <StatusMessage error={deleteError} />
            <div className="mt-6 flex justify-end gap-3 border-t border-[var(--line)] pt-4">
              <Button variant="secondary" disabled={deactivateBusy} onClick={() => setShowDeactivate(false)}>{tc("cancel")}</Button>
              <Button disabled={deactivateBusy} onClick={() => void deactivate()}>{deactivateBusy ? tc("saving") : t("deactivate")}</Button>
            </div>
          </Dialog>
        ) : null}
      </section>
    </main>
  );
}
