"use client";

import type { ChallengeRule } from "./types";
import { Button, cx, inputClass, labelClass } from "./ui";

const MAX_RULES = 20;

export function visibleRuleSections(
  sections?: ChallengeRule[] | null,
  legacyRules?: string | null,
): ChallengeRule[] {
  if (Array.isArray(sections) && sections.length) return sections;
  if (legacyRules?.trim()) {
    return [{ title: "Regras do desafio", description: legacyRules.trim() }];
  }
  return [];
}

export function RuleSectionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ChallengeRule[];
  onChange: (rules: ChallengeRule[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<ChallengeRule>) {
    onChange(value.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {value.map((rule, index) => (
        <article className="rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)]/55 p-4" key={index}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <strong className="text-sm">Regra {index + 1}</strong>
            <div className="flex flex-wrap justify-end gap-1">
              <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={disabled || index === 0} onClick={() => move(index, -1)}><span aria-hidden="true">↑</span><span className="sr-only">Mover regra para cima</span></Button>
              <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)}><span aria-hidden="true">↓</span><span className="sr-only">Mover regra para baixo</span></Button>
              <Button className="min-h-9 px-3 py-1 text-xs" variant="danger" disabled={disabled} onClick={() => onChange(value.filter((_, position) => position !== index))}>Remover</Button>
            </div>
          </div>
          <label><span className={labelClass}>Título</span><input className={inputClass} value={rule.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="Ex.: Meta diária" required maxLength={160} disabled={disabled} /></label>
          <label className="mt-3 block"><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={rule.description} onChange={(event) => update(index, { description: event.target.value })} placeholder="Explique esta regra com clareza." required maxLength={10000} disabled={disabled} /></label>
        </article>
      ))}
      {!disabled && value.length < MAX_RULES ? <Button variant="secondary" onClick={() => onChange([...value, { title: "", description: "" }])}><span aria-hidden="true">+</span>Adicionar regra</Button> : null}
      {!value.length ? <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">Nenhuma regra adicionada. Elas são opcionais, mas cada regra pode ter seu próprio título.</p> : null}
    </div>
  );
}

export function RuleSectionsView({ rules }: { rules: ChallengeRule[] }) {
  if (!rules.length) return null;
  return (
    <section className="mt-5 overflow-hidden rounded-[24px] border border-[var(--main-line)] bg-[var(--main-soft)] px-5 py-6 sm:px-7 sm:py-7" aria-labelledby="challenge-rules-title">
      <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--main-strong)]">Antes de começar</p>
      <h2 className="mt-2 text-2xl font-bold tracking-[-0.035em]" id="challenge-rules-title">Regras do desafio</h2>
      <div className={cx("mt-5 grid gap-3", rules.length > 1 && "md:grid-cols-2")}>
        {rules.map((rule, index) => (
          <article className="rounded-2xl border border-[var(--main-line)]/70 bg-[var(--paper)] p-5" key={`${rule.title}-${index}`}>
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--main)] text-xs font-black text-white" aria-hidden="true">{index + 1}</span>
              <div>
                <h3 className="text-lg font-bold tracking-[-0.02em]">{rule.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{rule.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
