"use client";

import { useMemo, useState } from "react";

import { errorMessage } from "../api";
import { cleanFields, FieldBuilder, presetFields } from "../fields";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeRule, GroupSummary, Id, Template } from "../types";
import { backLinkClass, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";
import { formatDate } from "../utils";

export function CreateChallengeScreen({
  group,
  onBack,
  onCreate,
}: {
  group: GroupSummary;
  onBack: () => void;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<Template | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSections, setRuleSections] = useState<ChallengeRule[]>([]);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [fields, setFields] = useState<ChallengeField[]>([]);
  const [itemsText, setItemsText] = useState("");
  const [participantIds, setParticipantIds] = useState<Id[]>(group.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => itemsText.split("\n").map((item) => item.trim()).filter(Boolean), [itemsText]);

  function chooseTemplate(next: Template) {
    setTemplate(next);
    setFields(presetFields(next));
    setTitle(next === "cine" ? "Cine — nova edição" : "90 dias de leitura");
    setItemsText("");
  }

  function nextStep() {
    setError(null);
    if (step === 1 && (!template || !title.trim() || !startsOn || !endsOn)) {
      setError("Escolha um modelo e preencha título e datas.");
      return;
    }
    if (step === 1 && ruleSections.some((rule) =>
      !rule.title.trim() || !rule.description.trim()
      || (rule.topics ?? []).some((topic) => !topic.title.trim() || !topic.description.trim())
    )) {
      setError("Preencha o título e a descrição de cada regra e tópico, ou remova os vazios.");
      return;
    }
    if (step === 2 && !fields.length) {
      setError("Adicione pelo menos um campo.");
      return;
    }
    if (step === 3 && template === "cine" && !items.length) {
      setError("Adicione ao menos um item para o desafio de filmes.");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        template,
        title: title.trim(),
        description: description.trim(),
        ruleSections: ruleSections.map((rule) => ({
          title: rule.title.trim(),
          description: rule.description.trim(),
          ...(rule.topics?.length
            ? { topics: rule.topics.map((topic) => ({ title: topic.title.trim(), description: topic.description.trim() })) }
            : {}),
        })),
        startsOn,
        endsOn,
        submissionMode: template === "reading" ? "daily" : "item",
        fields: cleanFields(fields),
        items: items.map((item, position) => ({ title: item, position })),
        generateDaily: template === "reading",
        participantIds,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const stepLabels = ["Base", "Campos", "Checkpoints", "Pessoas"];
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>← Voltar para {group.name}</button>
      <PageHeading title="Monte a próxima experiência" description="Comece com um preset e ajuste somente o que seu grupo precisa." />
      <nav className="mb-6 grid grid-cols-4 gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label="Etapas de criação">
        {stepLabels.map((label, index) => <button className={cx("min-h-11 rounded-xl px-2 text-xs font-light sm:text-sm", step === index + 1 ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : index + 1 < step ? "text-[var(--ink)]" : "text-[var(--muted)]")} type="button" onClick={() => index + 1 < step && setStep(index + 1)} disabled={index + 1 > step} key={label}><span className="hidden sm:inline">{index + 1}. </span>{label}</button>)}
      </nav>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        {step === 1 ? (
          <div>
            <h2 className="text-xl font-light">Escolha um ponto de partida</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["cine", "reading"] as const).map((value) => (
                <button className={cx("rounded-2xl border p-5 text-left transition", template === value ? "border-[var(--main)] bg-[var(--main-soft)] ring-2 ring-[var(--main)]/25" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]")} type="button" aria-pressed={template === value} onClick={() => chooseTemplate(value)} key={value}>
                  <span className="text-2xl" aria-hidden="true">{value === "cine" ? "◉" : "▤"}</span>
                  <strong className="mt-3 block text-lg">{value === "cine" ? "Cine" : "Leitura"}</strong>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{value === "cine" ? "Uma lista de títulos, nota e comentário por item." : "Check-in diário com páginas, livro e conclusão."}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className={labelClass}>Título</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required /></label>
              <label><span className={labelClass}>Início</span><input className={inputClass} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
              <label><span className={labelClass}>Término</span><input className={inputClass} type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Descrição <small className="font-light text-[var(--muted)]">opcional</small></span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
              <div className="sm:col-span-2"><div className="mb-3"><span className={labelClass}>Regras com título <small className="font-light text-[var(--muted)]">opcional</small></span><p className="text-xs leading-5 text-[var(--muted)]">Dê destaque a cada acordo importante do desafio.</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} /></div>
            </div>
          </div>
        ) : null}

        {step === 2 ? <div><h2 className="text-xl font-light">O que cada pessoa registra?</h2><p className="mb-5 mt-1 text-sm text-[var(--muted)]">O identificador de cada campo permanece estável mesmo se o rótulo mudar.</p><FieldBuilder fields={fields} onChange={setFields} /></div> : null}

        {step === 3 ? (
          <div>
            <h2 className="text-xl font-light">Defina os checkpoints</h2>
            {template === "cine" ? (
              <><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Cole um título por linha. Cada item vira uma oportunidade de registro para cada participante.</p><label className="mt-5 block"><span className={labelClass}>Lista de itens</span><textarea className={inputClass} rows={12} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={"Primeiro título\nSegundo título\nTerceiro título"} /></label><p className="mt-2 text-xs font-semibold text-[var(--muted)]">{items.length} {items.length === 1 ? "item" : "itens"}</p></>
            ) : (
              <div className="mt-5 rounded-2xl border border-[var(--ok-line)] bg-[var(--ok-soft)] p-5"><strong className="text-[var(--ok)]">Check-ins diários</strong><p className="mt-2 text-sm leading-6 text-[var(--ok)]">O servidor criará um checkpoint por dia entre {formatDate(startsOn)} e {formatDate(endsOn)}. Datas e limites são validados novamente no servidor.</p></div>
            )}
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <h2 className="text-xl font-light">Quem vai participar?</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Somente membros selecionados poderão enviar registros. Administradores continuam com acesso à revisão.</p>
            {group.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Participantes</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4" key={member.id}><input type="checkbox" aria-label={`Selecionar ${member.name}`} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title="Membros ainda não carregados" description="Você pode salvar o desafio como rascunho e adicionar participantes na área administrativa." />}
            <div className="mt-6 rounded-2xl bg-[var(--wash)] p-5 text-sm leading-6"><strong className="block text-base">Resumo do rascunho</strong><span className="mt-2 block text-[var(--muted)]">{fields.length} campos · {template === "reading" ? "checkpoints diários" : `${items.length} itens`} · {participantIds.length} participantes</span><p className="mt-2 text-[var(--muted)]">O desafio será criado como rascunho. Revise tudo na administração antes de ativar.</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={() => step === 1 ? onBack() : setStep((current) => current - 1)}>{step === 1 ? "Cancelar" : "← Voltar"}</Button>
          {step < 4 ? <Button onClick={nextStep}>Continuar →</Button> : <Button disabled={busy} onClick={() => void submit()}>{busy ? "Criando rascunho…" : "Criar rascunho"}</Button>}
        </div>
      </section>
    </main>
  );
}
