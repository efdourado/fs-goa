"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "../api";
import type { ChallengeSummary, GroupSummary, Id, Limits, User } from "../types";
import { Button, cardClass, challengeStatusTone, ChallengeStatusBadge, cx, EmptyState, inputClass, labelClass, linkClass, PageHeading, StatusMessage } from "../ui";
import { canManage, formatDate, isChallengeScheduled } from "../utils";

export function DashboardScreen({
  user,
  groups,
  challenges,
  limits,
  onOpenGroup,
  onOpenChallenge,
  onOpenAdmin,
  onCreateGroup,
}: {
  user: User;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  limits: Limits;
  onOpenGroup: (id: Id) => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateGroup: (name: string) => Promise<void>;
}) {
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");
  const ownedGroups = groups.filter((group) => group.role === "owner").length;
  const atGroupLimit = ownedGroups >= limits.groupsPerOwner;

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(name);
      setShowGroupForm(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={`Olá, ${user.name.split(" ")[0]}.`} description="Veja o que pede sua atenção hoje ou comece uma nova experiência com seu grupo." action={atGroupLimit ? <span className="text-sm text-[var(--muted)]">Você atingiu o limite de {limits.groupsPerOwner} grupos</span> : <button type="button" className={cx(linkClass, "text-sm")} onClick={() => setShowGroupForm((open) => !open)}>{showGroupForm ? "Fechar" : `Crie um grupo (limite ${limits.groupsPerOwner})`}</button>} />

      {showGroupForm ? (
        <form className={cx(cardClass, "mb-7 grid gap-4 p-5 sm:grid-cols-[1fr_auto]")} onSubmit={createGroup}>
          <label>
            <span className={labelClass}>Nome do grupo</span>
            <input className={inputClass} name="name" placeholder="Ex.: Clube do Sofá" required maxLength={100} disabled={busy} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Criando…" : "Criar"}</Button>
            <Button variant="ghost" onClick={() => setShowGroupForm(false)}>Cancelar</Button>
          </div>
          <div className="sm:col-span-2"><StatusMessage error={error} /></div>
        </form>
      ) : null}

      <section aria-labelledby="active-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="active-title" className="text-xl font-bold tracking-[-0.03em]">Ativos e agendados</h2>
          <span className="text-xs font-semibold text-[var(--muted)]">{active.length} {active.length === 1 ? "desafio" : "desafios"}</span>
        </div>
        {active.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((challenge) => {
              const tone = challengeStatusTone(challenge.status, challenge.startsOn);
              const total = challenge.totalCount ?? 0;
              const done = challenge.completedCount ?? 0;
              return (
                <article className={cx("flex flex-col overflow-hidden rounded-[20px] border bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]", tone.border)} key={challenge.id}>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} /><span className="text-xs text-[var(--muted)]">{isChallengeScheduled(challenge.status, challenge.startsOn) ? `começa em ${formatDate(challenge.startsOn)}` : challenge.endsOn ? `até ${formatDate(challenge.endsOn)}` : "sem prazo"}</span></div>
                    <h3 className="mt-5 text-2xl font-bold tracking-[-0.04em]">{challenge.title}</h3>
                    {challenge.description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}
                    {total > 0 ? (
                      <div className="mt-5">
                        <div className="mb-2 flex justify-between text-xs text-[var(--muted)]"><span>{done} de {total}</span><span>{Math.round((done / total) * 100)}%</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--wash-strong)]"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => onOpenChallenge(challenge.id)} className={cx("w-full px-5 py-3.5 text-sm font-bold text-white transition hover:opacity-90 cursor-pointer", tone.solid)}>Abrir desafio</button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nada pendente por aqui" description="Quando um desafio estiver ativo ou agendado, ele aparecerá aqui com a data do próximo registro." />
        )}
      </section>

      <section className="mt-10" aria-labelledby="groups-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="groups-title" className="text-xl font-bold tracking-[-0.03em]">Seus grupos</h2>
          <span className="text-xs font-semibold text-[var(--muted)]">{groups.length} {groups.length === 1 ? "grupo" : "grupos"}</span>
        </div>
        {groups.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <button className={cx(cardClass, "flex min-h-24 items-center justify-between gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--main-line)]")} type="button" onClick={() => onOpenGroup(group.id)} key={group.id}>
                <span><strong className="block text-base">{group.name}</strong><small className="mt-1 block text-[var(--muted)]">{group.memberCount ?? group.members?.length ?? 0} pessoas · {group.role === "owner" ? "responsável" : group.role === "admin" ? "admin" : "participante"}</small></span>
                <span className="text-lg text-[var(--main-strong)]" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        ) : <EmptyState title="Crie seu primeiro grupo" description="Um grupo reúne pessoas e continua existindo entre diferentes edições de desafios." action={<Button onClick={() => setShowGroupForm(true)}>Criar grupo</Button>} />}
      </section>

      {other.length ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold tracking-[-0.03em]">Rascunhos e memórias</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((challenge) => (
              <button className={cx(cardClass, "flex items-center justify-between gap-3 p-4 text-left hover:border-[var(--main-line)]")} type="button" onClick={() => challenge.status === "draft" && canManage(challenge.viewerRole) ? onOpenAdmin(challenge.id) : onOpenChallenge(challenge.id)} key={challenge.id}>
                <span className="flex items-center gap-2"><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} /><strong>{challenge.title}</strong></span><span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
