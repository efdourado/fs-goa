"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "../api";
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
      setProfileMsg({ success: "Perfil atualizado." });
    } catch (cause) {
      setProfileMsg({ error: errorMessage(cause) });
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmation") ?? "")) {
      setPwMsg({ error: "As senhas não coincidem." });
      return;
    }
    setPwBusy(true);
    setPwMsg({});
    try {
      await onChangePassword({ currentPassword: String(form.get("currentPassword") ?? ""), newPassword });
      setPwMsg({ success: "Senha alterada. As outras sessões foram encerradas." });
      (event.target as HTMLFormElement).reset();
    } catch (cause) {
      setPwMsg({ error: errorMessage(cause) });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>← Voltar ao início</button>
      <PageHeading title="Seu perfil" description="Por enquanto só o nome de exibição é editável." />

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">Perfil</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
          <label className="sm:col-span-2"><span className={labelClass}>Nome</span><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={profileBusy} /></label>
          <label><span className={labelClass}>Nome de usuário</span><input className={cx(inputClass, "opacity-60")} value={`@${user.username}`} readOnly disabled /></label>
          <label><span className={labelClass}>E-mail</span><input className={cx(inputClass, "opacity-60")} value={user.email ?? "não informado"} readOnly disabled /></label>
          <div className="sm:col-span-2"><StatusMessage error={profileMsg.error} success={profileMsg.success} /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={profileBusy}>{profileBusy ? "Salvando…" : "Salvar perfil"}</Button></div>
        </form>
      </section>

      <section className={cx(cardClass, "mt-6 p-5 sm:p-7")}>
        <h2 className="text-xl font-light">Senha</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Trocar a senha encerra suas outras sessões.</p>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
          <label className="sm:col-span-2"><span className={labelClass}>Senha atual</span><input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required disabled={pwBusy} /></label>
          <label><span className={labelClass}>Nova senha</span><input className={inputClass} name="newPassword" type="password" autoComplete="new-password" required minLength={8} disabled={pwBusy} /></label>
          <label><span className={labelClass}>Confirme a nova senha</span><input className={inputClass} name="confirmation" type="password" autoComplete="new-password" required minLength={8} disabled={pwBusy} /></label>
          <div className="sm:col-span-2"><StatusMessage error={pwMsg.error} success={pwMsg.success} /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pwBusy}>{pwBusy ? "Alterando…" : "Alterar senha"}</Button></div>
        </form>
      </section>
    </main>
  );
}
