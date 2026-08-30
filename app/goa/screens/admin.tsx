"use client";

import { type FormEvent, useMemo, useState } from "react";

import { errorMessage } from "../api";
import { cleanFields, FieldBuilder } from "../fields";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeSummary,
  Entry,
  GroupSummary,
  Id,
  Metric,
} from "../types";
import {
  Button,
  cardClass,
  ChallengeStatusBadge,
  cx,
  EmptyState,
  inputClass,
  labelClass,
  PageHeading,
  StatusMessage,
} from "../ui";
import { formatDate, formatDateTime, isChallengeScheduled, itemIdForEntry, itemStatusLabel, valuesAsRecord } from "../utils";
import { DynamicEntryForm, ResultView } from "./participant-challenge";

export interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
}

function AdminOverview({
  challenge,
  entries,
  onSave,
  onTransition,
  onDuplicate,
  duplicateTargets,
  onDelete,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(challenge.title);
  const [description, setDescription] = useState(challenge.description ?? "");
  const [ruleSections, setRuleSections] = useState(() => visibleRuleSections(challenge.ruleSections, challenge.rules));
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const [duplicateTitle, setDuplicateTitle] = useState(challenge.title);
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [duplicateTargetGroupId, setDuplicateTargetGroupId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const expected = challenge.items.length * challenge.participants.length;
  const missing = Math.max(0, expected - entries.length);
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn);

  async function run(label: string, action: () => Promise<void>, successText: string) {
    setBusy(label);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successText);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[{ label: "Participantes", value: challenge.participants.length }, { label: "Checkpoints", value: challenge.items.length }, { label: "Registros", value: entries.length }, { label: "Pendências", value: missing }].map((stat) => <article className={cx(cardClass, "p-5")} key={stat.label}><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{stat.label}</p><strong className="mt-2 block text-4xl tracking-[-0.05em]">{stat.value}</strong></article>)}
      </div>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">Informações básicas</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Registros históricos nunca dependem da posição visual destes campos.</p>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run("save", () => onSave({ title: title.trim(), description: description.trim(), ruleSections: ruleSections.map((rule) => ({ title: rule.title.trim(), description: rule.description.trim(), ...(rule.topics?.length ? { topics: rule.topics.map((topic) => ({ title: topic.title.trim(), description: topic.description.trim() })) } : {}) })), startsOn, endsOn }), "Informações atualizadas."); }}>
          <label className="sm:col-span-2"><span className={labelClass}>Título</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} disabled={challenge.status === "closed"} /></label>
          <label><span className={labelClass}>Início</span><input className={inputClass} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} disabled={challenge.status !== "draft"} /></label>
          <label><span className={labelClass}>Término</span><input className={inputClass} type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} disabled={challenge.status !== "draft"} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={challenge.status === "closed"} /></label>
          <div className="sm:col-span-2"><div className="mb-3"><span className={labelClass}>Regras com título</span><p className="text-xs leading-5 text-[var(--muted)]">Cada regra ganha destaque próprio para ninguém precisar procurar o combinado.</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} disabled={challenge.status === "closed"} /></div>
          {challenge.status !== "closed" ? <div className="sm:col-span-2"><Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Salvando…" : "Salvar informações"}</Button></div> : null}
        </form>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">Estado do desafio</h2>
        <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-[var(--wash)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} /><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? "Somente administradores veem este rascunho. Confira campos, checkpoints e participantes antes de ativar." : scheduled ? `O desafio já está ativado, mas está agendado para ${formatDate(challenge.startsOn, { day: "2-digit", month: "long", year: "numeric" })}. Os registros serão liberados quando os checkpoints começarem.` : challenge.status === "active" ? "Participantes podem enviar e editar seus registros. Encerrar bloqueia os dados de origem." : "Registros e estrutura estão congelados; a curadoria da vitrine ainda pode ser atualizada."}</p></div>
          {challenge.status === "draft" ? <Button disabled={Boolean(busy)} onClick={() => { if (window.confirm("Ativar este desafio? Participantes selecionados poderão registrar.")) void run("transition", () => onTransition("active"), "Desafio ativado."); }}>Ativar desafio</Button> : null}
          {challenge.status === "active" ? <Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Encerrar o desafio? Os registros serão bloqueados e esta ação não poderá ser desfeita no MVP.")) void run("transition", () => onTransition("closed"), "Desafio encerrado."); }}>Encerrar desafio</Button> : null}
        </div>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">Reutilizar em outro grupo</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Cria um rascunho estrutural em outro grupo com regras, campos, métricas e checkpoints. Participantes, registros, resultados e convites nunca são copiados. Revise as datas antes de ativar.</p>
        {duplicateTargets.length ? <form className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (!duplicateTargetGroupId) { setError("Escolha um grupo de destino disponível."); return; } void run("duplicate", () => onDuplicate({ title: duplicateTitle.trim(), targetGroupId: duplicateTargetGroupId }), "Modelo reutilizado como rascunho."); }}>
          <label><span className={labelClass}>Título no novo grupo</span><input className={inputClass} value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.target.value)} required maxLength={160} /></label>
          <label><span className={labelClass}>Grupo de destino</span><select className={inputClass} value={duplicateTargetGroupId} onChange={(event) => setDuplicateTargetGroupId(event.target.value)} required><option value="">Selecione outro grupo</option>{duplicateTargets.map((target) => { const full = target.challengeCount >= target.challengeLimit; return <option value={target.id} disabled={full} key={target.id}>{target.name} · {target.challengeCount}/{target.challengeLimit}{full ? " (limite atingido)" : ""}</option>; })}</select></label>
          <div className="flex items-end"><Button type="submit" variant="secondary" disabled={busy === "duplicate" || !duplicateTargetGroupId || !availableTargets.length}>{busy === "duplicate" ? "Criando…" : "Usar neste grupo"}</Button></div>
        </form> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-5"><strong className="text-sm">Nenhum outro grupo disponível</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Crie outro grupo ou torne-se responsável/admin de um grupo para reutilizar este modelo.</p></div>}
      </section>

      {onDelete ? (
        <section className={cx(cardClass, "p-5 sm:p-7")}>
          <h2 className="text-xl font-light">Apagar desafio</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Move o desafio e seus registros para a lixeira. Some do app, mas continua recuperável até você limpar a lixeira na administração.</p>
          <div className="mt-4"><Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Mover "${challenge.title}" para a lixeira?`)) void run("delete", onDelete, "Desafio movido para a lixeira."); }}>Apagar desafio</Button></div>
        </section>
      ) : null}
      <StatusMessage error={error} success={success} />
    </div>
  );
}

function AdminParticipants({
  challenge,
  group,
  onSave,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  onSave: (participantIds: Id[]) => Promise<void>;
}) {
  const initial = challenge.participants.map((participant) => participant.userId ?? participant.id);
  const [selected, setSelected] = useState<Id[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title="Participantes" description="Membros do grupo podem conhecer o desafio; somente os selecionados enviam registros." />
      {group?.members?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{group.members.map((member) => { const checked = selected.includes(member.id); return <label className={cx("flex min-h-16 items-center gap-3 rounded-xl border bg-[var(--paper)] px-4", checked ? "border-[var(--main-line)]" : "border-[var(--line)]")} key={member.id}><input type="checkbox" aria-label={`Selecionar ${member.name}`} checked={checked} disabled={challenge.status === "closed" || busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username} · {member.role}</small></span></label>; })}</div>
      ) : <EmptyState title="Lista de membros indisponível" description="O bootstrap precisa incluir os membros do grupo para que a seleção seja editada aqui." />}
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      {challenge.status !== "closed" && group?.members?.length ? <Button className="mt-5" disabled={busy} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(selected).then(() => setSuccess("Participantes atualizados.")).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false)); }}>{busy ? "Salvando…" : "Salvar participantes"}</Button> : null}
    </section>
  );
}

function AdminFields({
  challenge,
  onSave,
}: {
  challenge: ChallengeDetail;
  onSave: (fields: ChallengeField[]) => Promise<void>;
}) {
  const [fields, setFields] = useState(challenge.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title="Campos do registro" description={challenge.status === "draft" ? "Tipos e ordem podem ser ajustados antes da ativação." : "Campos persistidos mantêm seu identificador; remoções são tratadas como arquivamento pelo servidor."} />
      <FieldBuilder fields={fields} onChange={setFields} lockPersistedTypes={challenge.status !== "draft"} />
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      <Button className="mt-5" disabled={busy || challenge.status !== "draft"} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(cleanFields(fields)).then(() => setSuccess("Campos salvos.")).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false)); }}>{busy ? "Salvando…" : "Salvar campos"}</Button>
    </section>
  );
}

function AdminItems({
  challenge,
  onAdd,
  onUpdate,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
}) {
  const [itemsText, setItemsText] = useState("");
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  function startEditing(item: ChallengeItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditError(null);
    setEditSuccess(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, itemId: Id) {
    event.preventDefault();
    setEditBusy(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      await onUpdate(itemId, { title: editTitle.trim(), description: editDescription.trim() });
      setEditingId(null);
      setEditSuccess(challenge.submissionMode === "daily" ? "Checkpoint atualizado." : "Item atualizado.");
    } catch (cause) {
      setEditError(errorMessage(cause));
    } finally {
      setEditBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const titles = itemsText.split("\n").map((item) => item.trim()).filter(Boolean);
    if (challenge.submissionMode !== "daily" && !titles.length) { setError("Adicione pelo menos um item."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd(challenge.submissionMode === "daily"
        ? { generate: { frequency: "daily", startsOn, endsOn } }
        : { items: titles.map((title, index) => ({ title, position: challenge.items.length + index })) });
      setItemsText("");
      setSuccess(challenge.submissionMode === "daily" ? "Checkpoints diários gerados." : "Itens adicionados.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Itens e checkpoints" description="Edite títulos e descrições sem trocar os identificadores usados nos registros. Depois do encerramento, o histórico fica bloqueado." />
        {editSuccess ? <div className="mb-3"><StatusMessage success={editSuccess} /></div> : null}
        {challenge.items.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {[...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((item, index) => (
              <li className="py-4" key={item.id}>
                {editingId === item.id ? (
                  <form className="grid gap-3" onSubmit={(event) => void submitEdit(event, item.id)}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <strong className="text-sm">Editar {challenge.submissionMode === "daily" ? "checkpoint" : "item"}</strong>
                    </div>
                    <label><span className={labelClass}>Título</span><input className={inputClass} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} /></label>
                    <label><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} placeholder="Contexto opcional" /></label>
                    <StatusMessage error={editError} />
                    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={editBusy}>{editBusy ? "Salvando…" : "Salvar"}</Button><Button variant="ghost" disabled={editBusy} onClick={() => { setEditingId(null); setEditError(null); }}>Cancelar</Button></div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <span className="min-w-0"><strong className="block text-sm">{item.title}</strong>{item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}<small className="mt-1 block text-[var(--muted)]">{item.date ? formatDate(item.date) : item.opensAt || item.dueAt ? `${formatDate(item.opensAt)} — ${formatDate(item.dueAt)}` : "sem janela definida"}</small></span>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-2"><span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light uppercase text-[var(--muted)]">{itemStatusLabel(item.status)}</span>{challenge.status !== "closed" ? <Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" onClick={() => startEditing(item)}>Editar</Button> : null}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : <EmptyState title="Nenhum checkpoint" description="Adicione itens ou gere checkpoints diários antes de ativar o desafio." />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-light">{challenge.submissionMode === "daily" ? "Gerar dias" : "Adicionar itens"}</h2>
        {challenge.status !== "draft" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">Novos itens e datas ficam bloqueados depois da ativação. Títulos e descrições ainda podem ser corrigidos até o encerramento.</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          {challenge.submissionMode === "daily" ? <><p className="text-xs leading-5 text-[var(--muted)]">A geração usa exatamente as datas definidas nas informações básicas.</p><label><span className={labelClass}>Primeiro dia</span><input className={inputClass} type="date" value={startsOn} readOnly required /></label><label><span className={labelClass}>Último dia</span><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></label></> : <label><span className={labelClass}>Um título por linha</span><textarea className={inputClass} rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={"Item 1\nItem 2"} /></label>}
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy || challenge.status !== "draft"}>{busy ? "Salvando…" : challenge.submissionMode === "daily" ? "Gerar checkpoints" : "Adicionar"}</Button>
        </form>}
      </aside>
    </div>
  );
}

function AdminReview({
  challenge,
  entries,
  onPatch,
  onExport,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = entries.filter((entry) => {
    const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
    const haystack = `${entry.participantName ?? ""} ${entry.participantUsername ?? ""} ${item?.title ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!lateOnly || entry.isLate);
  });
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedItem = challenge.items.find((item) => item.id === (selected ? itemIdForEntry(selected) : null)) ?? null;
  const expected = challenge.items.length * challenge.participants.length;

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Revisão dos registros" description={`${entries.length} enviados · ${Math.max(0, expected - entries.length)} pendentes · ${entries.filter((entry) => entry.isLate).length} após o prazo`} action={<Button variant="secondary" disabled={exporting} onClick={() => { setExporting(true); setError(null); onExport().catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setExporting(false)); }}>{exporting ? "Preparando…" : "Exportar CSV"}</Button>} />
        <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label><span className="sr-only">Buscar registros</span><input className={inputClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa ou checkpoint" /></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm font-semibold"><input type="checkbox" checked={lateOnly} onChange={(event) => setLateOnly(event.target.checked)} />Somente atrasados</label>
        </div>
        <StatusMessage error={error} />
        {filtered.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => {
              const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
              const values = valuesAsRecord(entry.values);
              return (
                <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3"><div><strong className="block">{entry.participantName ?? entry.participantUsername ?? "Participante"}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{item?.title ?? "Registro livre"} · {formatDateTime(entry.submittedAt ?? entry.updatedAt)}</span></div>{entry.isLate ? <span className="rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-light uppercase text-[var(--warn)]">atrasado</span> : null}</div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">{challenge.fields.slice(0, 4).map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 truncate text-sm font-semibold">{typeof values[field.id] === "boolean" ? values[field.id] ? "Sim" : "Não" : String(values[field.id])}</dd></div> : null)}</dl>
                  <Button className="mt-4 w-full" variant="secondary" onClick={() => { setSelectedId(entry.id); setReason(""); }}>Inspecionar e corrigir</Button>
                </article>
              );
            })}
          </div>
        ) : <EmptyState title="Nenhum registro encontrado" description={entries.length ? "Ajuste os filtros para ver outros registros." : "Os envios dos participantes aparecerão aqui."} />}
      </section>

      {selected ? (
        <section className={cx(cardClass, "p-5 sm:p-7")} aria-labelledby="correction-title">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">Correção administrativa</p><h2 id="correction-title" className="mt-1 text-xl font-light">{selected.participantName ?? "Participante"} · {selectedItem?.title ?? "Registro"}</h2></div><Button variant="ghost" onClick={() => setSelectedId(null)}>Fechar</Button></div>
          <label className="mb-5 block"><span className={labelClass}>Motivo da alteração <span className="text-[var(--main-2)]">*</span></span><textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explique por que o registro está sendo corrigido. Isto ficará na auditoria." maxLength={500} disabled={challenge.status === "closed"} /></label>
          <DynamicEntryForm key={`${selected.id}-${selected.updatedAt ?? ""}`} fields={challenge.fields} item={selectedItem} entry={selected} canEdit={challenge.status !== "closed"} unavailableMessage={challenge.status === "closed" ? "Este desafio foi encerrado. O registro está disponível somente para leitura." : null} onSave={async (values) => { if (!reason.trim()) throw new Error("Informe o motivo da correção administrativa."); await onPatch(selected.id, values, reason.trim()); setReason(""); }} />
        </section>
      ) : null}
    </div>
  );
}

function AdminMetrics({
  challenge,
  onAdd,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [operation, setOperation] = useState<Metric["operation"]>("average");
  const [fieldId, setFieldId] = useState("");
  const [groupBy, setGroupBy] = useState<Metric["groupBy"]>("none");
  const [visibleDuring, setVisibleDuring] = useState(true);
  const [visibleInResults, setVisibleInResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const needsNumericField = ["sum", "average", "min", "max"].includes(operation);
  const selectableFields = challenge.fields.filter((field) => !needsNumericField || field.type === "number" || field.type === "rating");
  const needsField = operation !== "count" && operation !== "completion_rate";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsField && !fieldId) { setError("Escolha um campo compatível."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd({ label: label.trim(), operation, fieldId: needsField ? fieldId : null, groupBy, visibleDuring, visibleInResults });
      setLabel("");
      setSuccess("Métrica adicionada e recalculada sem alterar os registros.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <PageHeading title="Métricas" description="Operações conhecidas referenciam IDs estáveis de campos, nunca sua posição na tela." />
        {challenge.metrics.length ? <div className="grid gap-3 sm:grid-cols-2">{challenge.metrics.map((metric) => <article className={cx(cardClass, "p-5")} key={metric.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{metric.operation.replace("_", " ")}</p><h3 className="mt-1 font-light">{metric.label}</h3></div><strong className="text-2xl tracking-[-0.04em]">{metric.formattedValue ?? metric.value ?? "—"}</strong></div><div className="mt-4 flex flex-wrap gap-2 text-[10px] font-light uppercase text-[var(--muted)]">{metric.visibleDuring ? <span className="rounded-full bg-[var(--ok-soft)] px-2 py-1">durante</span> : null}{metric.visibleInResults ? <span className="rounded-full bg-[var(--main-soft)] px-2 py-1">resultado</span> : null}{metric.groupBy && metric.groupBy !== "none" ? <span className="rounded-full bg-[var(--wash)] px-2 py-1">por {metric.groupBy}</span> : null}</div></article>)}</div> : <EmptyState title="Nenhuma métrica configurada" description="Comece com contagem, média ou taxa de conclusão. Fórmulas arbitrárias ficam fora do MVP." />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-light">Adicionar métrica</h2>
        {challenge.status === "closed" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">As métricas foram congeladas no encerramento para preservar o resultado histórico.</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          <label><span className={labelClass}>Nome</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Média do grupo" required maxLength={100} /></label>
          <label><span className={labelClass}>Operação</span><select className={inputClass} value={operation} onChange={(event) => { const next = event.target.value as Metric["operation"]; setOperation(next); setFieldId(""); }}><option value="sum">Soma</option><option value="average">Média</option><option value="count">Contagem</option><option value="min">Mínimo</option><option value="max">Máximo</option><option value="completion_rate">Taxa de conclusão</option></select></label>
          {needsField ? <label><span className={labelClass}>Campo</span><select className={inputClass} value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">Selecione</option>{selectableFields.filter((field) => field.id).map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label> : null}
          <label><span className={labelClass}>Agrupar</span><select className={inputClass} value={groupBy} onChange={(event) => setGroupBy(event.target.value as Metric["groupBy"])}><option value="none">Sem agrupamento</option><option value="participant">Por participante</option><option value="item">Por item/checkpoint</option></select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleDuring} onChange={(event) => setVisibleDuring(event.target.checked)} />Mostrar durante o desafio</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleInResults} onChange={(event) => setVisibleInResults(event.target.checked)} />Disponível na vitrine final</label>
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Calculando…" : "Adicionar métrica"}</Button>
        </form>}
      </aside>
    </div>
  );
}

interface CuratedCommentCandidate {
  key: string;
  entryId: Id;
  fieldId: Id;
  authorName: string;
  itemTitle: string;
  text: string;
}

function AdminResults({
  challenge,
  entries,
  onSave,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [headline, setHeadline] = useState(challenge.result?.headline ?? challenge.title);
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const textFields = challenge.fields.filter((field) => field.id && field.type === "text");
  const candidates = useMemo(() => {
    const result: CuratedCommentCandidate[] = [];
    for (const entry of entries) {
      const values = valuesAsRecord(entry.values);
      for (const field of textFields) {
        if (!field.id || typeof values[field.id] !== "string" || !String(values[field.id]).trim()) continue;
        const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
        result.push({ key: `${entry.id}:${field.id}`, entryId: entry.id, fieldId: field.id, authorName: entry.participantName ?? "Participante", itemTitle: item?.title ?? "Registro", text: String(values[field.id]).trim() });
      }
    }
    return result;
  }, [challenge.items, entries, textFields]);

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
      });
      setSuccess("Vitrine salva.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Curadoria da vitrine" description="Os cálculos são automáticos; você escolhe o que ajuda a contar a história." />
        <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className={labelClass}>Manchete</span><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={180} /></label><label className="sm:col-span-2"><span className={labelClass}>Resumo</span><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></label></div>
        <fieldset className="mt-6"><legend className="text-base font-light">Métricas em destaque</legend>{challenge.metrics.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{challenge.metrics.map((metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={`Destacar métrica ${metric.label}`} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? "sem valor"}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">Crie métricas antes de selecioná-las.</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">Comentários selecionados</legend>{candidates.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{candidates.map((candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={`Selecionar comentário de ${candidate.authorName}`} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">Nenhum campo de texto preenchido está disponível para curadoria.</p>}</fieldset>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <Button className="mt-5" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar vitrine"}</Button>
      </section>
      {challenge.result || challenge.status === "closed" ? <section><PageHeading title="Como o grupo verá" description="Prévia da vitrine com a curadoria atual." /><ResultView challenge={challenge} /></section> : <EmptyState title="Prévia disponível após salvar" description="Você pode preparar a curadoria durante o desafio e publicar o resultado ao encerrá-lo." />}
    </div>
  );
}

export function AdminScreen({
  challenge,
  entries,
  group,
  tab,
  onTab,
  onBack,
  onViewParticipant,
  onSaveBasics,
  onTransition,
  onDuplicate,
  duplicateTargets,
  onDelete,
  onSaveParticipants,
  onSaveFields,
  onAddItems,
  onUpdateItem,
  onPatchEntry,
  onExport,
  onAddMetric,
  onSaveResult,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  onViewParticipant: () => void;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (fields: ChallengeField[]) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: "overview", label: "Geral" },
    { id: "participants", label: "Pessoas" },
    { id: "fields", label: "Campos" },
    { id: "items", label: "Checkpoints" },
    { id: "review", label: "Revisão" },
    { id: "metrics", label: "Métricas" },
    { id: "results", label: "Vitrine" },
  ];
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className="min-h-11 text-sm font-light text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← {group?.name ?? "Início"}</button><Button variant="secondary" onClick={onViewParticipant}>Ver como participante</Button></div>
      <PageHeading title={challenge.title} description="Configure, revise e apresente — controles administrativos continuam validados no servidor." action={<ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} />} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label="Áreas administrativas">{tabs.map((item) => <button className={cx("min-h-11 flex-none rounded-xl px-4 text-sm font-light", tab === item.id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{item.label}</button>)}</nav>
      {tab === "overview" ? <AdminOverview challenge={challenge} entries={entries} onSave={onSaveBasics} onTransition={onTransition} onDuplicate={onDuplicate} duplicateTargets={duplicateTargets} onDelete={onDelete} /> : null}
      {tab === "participants" ? <AdminParticipants key={`${challenge.id}:${challenge.participants.map((participant) => participant.userId ?? participant.id).join(",")}`} challenge={challenge} group={group} onSave={onSaveParticipants} /> : null}
      {tab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.fields.map((field) => field.id ?? field.key).join(",")}`} challenge={challenge} onSave={onSaveFields} /> : null}
      {tab === "items" ? <AdminItems challenge={challenge} onAdd={onAddItems} onUpdate={onUpdateItem} /> : null}
      {tab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onExport={onExport} /> : null}
      {tab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} /> : null}
      {tab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} /> : null}
    </main>
  );
}
