"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "../api";
import type { ChallengeSummary, GroupSummary, Id } from "../types";
import { Button, cardClass, ChallengeStatusBadge, cx, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";
import { canManage, formatDate } from "../utils";

export function GroupScreen({
  group,
  challenges,
  onBack,
  onCreateChallenge,
  onOpenChallenge,
  onOpenAdmin,
  onCreateInvite,
  onUpdateGroup,
  onDeleteGroup,
  challengeLimit,
}: {
  group: GroupSummary;
  challenges: ChallengeSummary[];
  challengeLimit: number;
  onBack: () => void;
  onCreateChallenge: () => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number }) => Promise<{ token?: string; url?: string }>;
  onUpdateGroup: (payload: { name: string; description: string }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(group.description ?? "");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);

  function toggleGroupEdit() {
    if (!showGroupEdit) {
      setGroupName(group.name);
      setGroupDescription(group.description ?? "");
      setGroupError(null);
      setGroupSuccess(null);
    }
    setShowGroupEdit(!showGroupEdit);
  }

  async function updateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGroupBusy(true);
    setGroupError(null);
    setGroupSuccess(null);
    try {
      await onUpdateGroup({ name: groupName.trim(), description: groupDescription.trim() });
      setGroupSuccess("Grupo atualizado.");
    } catch (cause) {
      setGroupError(errorMessage(cause));
    } finally {
      setGroupBusy(false);
    }
  }

  async function deleteGroup() {
    if (!onDeleteGroup) return;
    if (!window.confirm(`Mover "${group.name}" para a lixeira? Os desafios e registros somem do app, mas ficam recuperáveis até você limpar a lixeira na administração.`)) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      await onDeleteGroup();
    } catch (cause) {
      setGroupError(errorMessage(cause));
      setGroupBusy(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateInvite({
        expiresInDays: Number(form.get("expiresInDays") ?? 7),
        maxUses: Number(form.get("maxUses") ?? 1),
      });
      const token = created.token ?? "";
      setInviteUrl(created.url ?? (token ? `${window.location.origin}/?invite=${encodeURIComponent(token)}` : ""));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className="mb-6 min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar ao início</button>
      <PageHeading title={group.name} description={`${group.description ? `${group.description} · ` : ""}${group.memberCount ?? group.members?.length ?? 0} pessoas · você é ${group.role === "owner" ? "responsável" : group.role === "admin" ? "admin" : "participante"}`} action={canManage(group.role) ? <div className="flex flex-col items-end gap-1"><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={toggleGroupEdit}>{showGroupEdit ? "Fechar edição" : "Editar grupo"}</Button><Button variant="secondary" onClick={() => setShowInvite(!showInvite)}>Convidar</Button><Button disabled={challenges.length >= challengeLimit} onClick={onCreateChallenge}>+ Novo desafio</Button></div><span className="text-xs text-[var(--muted)]">{challenges.length}/{challengeLimit} desafios{challenges.length >= challengeLimit ? " · limite atingido" : ""}</span></div> : undefined} />

      {showGroupEdit ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="group-edit-title">
          <h2 id="group-edit-title" className="text-lg font-bold">Editar grupo</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">O nome atualizado aparece para todas as pessoas do grupo.</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={updateGroup}>
            <label className="sm:col-span-2"><span className={labelClass}>Nome</span><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={120} /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} maxLength={1000} placeholder="O que reúne este grupo?" /></label>
            <div className="sm:col-span-2"><StatusMessage error={groupError} success={groupSuccess} /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={groupBusy}>{groupBusy ? "Salvando…" : "Salvar grupo"}</Button><Button variant="ghost" disabled={groupBusy} onClick={toggleGroupEdit}>Cancelar</Button></div>
          </form>
          {onDeleteGroup ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Button variant="danger" disabled={groupBusy} onClick={() => void deleteGroup()}>Apagar grupo</Button>
              <p className="mt-2 text-xs text-[var(--muted)]">Vai para a lixeira. Recuperável até você limpar a lixeira na administração.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {showInvite ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="invite-create-title">
          <h2 id="invite-create-title" className="text-lg font-bold">Criar convite seguro</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">O link expira e pode ter uso limitado. Gere um novo quando precisar.</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]" onSubmit={createInvite}>
            <label><span className={labelClass}>Expira em</span><select className={inputClass} name="expiresInDays" defaultValue="7"><option value="1">1 dia</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label>
            <label><span className={labelClass}>Quantidade de usos</span><input className={inputClass} name="maxUses" type="number" min={1} max={100} defaultValue={1} /></label>
            <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? "Gerando…" : "Gerar link"}</Button></div>
          </form>
          <div className="mt-4"><StatusMessage error={error} /></div>
          {inviteUrl ? (
            <div className="mt-4 flex flex-col gap-2 rounded-xl bg-[var(--main-soft)] p-3 sm:flex-row sm:items-center">
              <input className={cx(inputClass, "font-mono text-xs")} value={inviteUrl} readOnly aria-label="Link do convite" />
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copiar</Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-7 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 text-xl font-bold tracking-[-0.03em]">Desafios do grupo</h2>
          {challenges.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {challenges.map((challenge) => (
                <article className={cx(cardClass, "p-5")} key={challenge.id}>
                  <div className="flex items-center gap-2"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} /><h3 className="text-xl font-bold">{challenge.title}</h3></div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{challenge.startsOn || challenge.endsOn ? `${formatDate(challenge.startsOn)} — ${formatDate(challenge.endsOn)}` : "Datas ainda não definidas"}</p>
                  <div className="mt-5 flex gap-2"><Button onClick={() => onOpenChallenge(challenge.id)} className="flex-1">Abrir</Button>{canManage(group.role) ? <Button variant="secondary" onClick={() => onOpenAdmin(challenge.id)}>Admin</Button> : null}</div>
                </article>
              ))}
            </div>
          ) : <EmptyState title="Este grupo ainda não tem desafios" description={canManage(group.role) ? "Escolha um preset e configure a primeira edição." : "Quando um administrador criar um desafio, ele aparecerá aqui."} action={canManage(group.role) ? <Button onClick={onCreateChallenge}>Criar desafio</Button> : undefined} />}
        </section>
        <aside className={cx(cardClass, "h-fit p-5")}>
          <h2 className="text-lg font-bold">Pessoas</h2>
          {group.members?.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {group.members.map((member) => <li className="flex items-center justify-between gap-3 py-3" key={member.id}><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span><span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-bold uppercase">{member.role}</span></li>)}
            </ul>
          ) : <p className="mt-3 text-sm leading-6 text-[var(--muted)]">A lista de membros aparecerá quando o bootstrap a disponibilizar.</p>}
        </aside>
      </div>
    </main>
  );
}
