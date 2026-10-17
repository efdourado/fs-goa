"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ChallengeRule, RuleTopic } from "./types";
import { AddRow, Button, ChevronIcon, CircleMinusIcon, cx, inputClass, labelClass, rowIconClass, StartLine } from "./ui";

const MAX_RULES = 20;
const MAX_TOPICS_PER_RULE = 12;

export function visibleRuleSections(
  sections?: ChallengeRule[] | null,
  legacyRules?: string | null,
  legacyTitle = "Regras do desafio",
): ChallengeRule[] {
  if (Array.isArray(sections) && sections.length) return sections;
  if (legacyRules?.trim()) {
    return [{ title: legacyTitle, description: legacyRules.trim() }];
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
  const t = useTranslations("rules");
  // The one rule open for editing (the others stay folded to a line).
  const [open, setOpen] = useState<number | null>(null);

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

  function updateTopic(ruleIndex: number, topicIndex: number, patch: Partial<RuleTopic>) {
    const topics = (value[ruleIndex].topics ?? []).map((topic, position) =>
      position === topicIndex ? { ...topic, ...patch } : topic,
    );
    update(ruleIndex, { topics });
  }

  function addTopic(ruleIndex: number) {
    update(ruleIndex, { topics: [...(value[ruleIndex].topics ?? []), { title: "", description: "" }] });
  }

  function removeTopic(ruleIndex: number, topicIndex: number) {
    update(ruleIndex, { topics: (value[ruleIndex].topics ?? []).filter((_, position) => position !== topicIndex) });
  }

  function addRule() {
    onChange([...value, { title: "", description: "" }]);
    setOpen(value.length);
  }

  function removeRule(index: number) {
    onChange(value.filter((_, position) => position !== index));
    setOpen((current) => current === null || current === index ? null : current > index ? current - 1 : current);
  }

  // Empty: the same dotted line Etapas starts with.
  if (!value.length) return disabled ? null : <StartLine label={t("ruleWord")} ariaLabel={t("addRule")} onClick={addRule} />;

  // A folding list, like Etapas: one row per rule (number, title, a line of it), opened one at a time to edit;
  // order and removal sit on the row. A rule missing its title or text says so while folded, since Save needs both.
  return (
    <div>
      <ol>
        {value.map((rule, index) => {
          const topics = rule.topics ?? [];
          const isOpen = open === index;
          const incomplete = !rule.title.trim() || !rule.description.trim()
            || topics.some((topic) => !topic.title.trim() || !topic.description.trim());
          const line = incomplete ? t("incomplete") : [rule.description.split("\n")[0], topics.length ? t("topicsCount", { count: topics.length }) : ""].filter(Boolean).join(" · ");
          return (
            <li className="border-t border-[var(--line)] first:border-t-0" key={index}>
              <div className="flex items-center gap-1">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : index)} className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3.5 py-2.5 text-left">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--ink)] text-[13px] font-medium tabular-nums">{index + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-medium">{rule.title.trim() || t("ruleN", { n: index + 1 })}</span>
                    <span className={cx("truncate text-xs", incomplete ? "text-[var(--danger)]" : "text-[var(--muted)]")}>{line}</span>
                  </span>
                </button>
                <button type="button" className={rowIconClass} disabled={disabled || index === 0} onClick={() => { move(index, -1); if (isOpen) setOpen(index - 1); }} aria-label={t("moveUp")} title={t("moveUp")}><ChevronIcon dir="up" /></button>
                <button type="button" className={rowIconClass} disabled={disabled || index === value.length - 1} onClick={() => { move(index, 1); if (isOpen) setOpen(index + 1); }} aria-label={t("moveDown")} title={t("moveDown")}><ChevronIcon dir="down" /></button>
                <button type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} disabled={disabled} onClick={() => removeRule(index)} aria-label={t("remove")} title={t("remove")}><CircleMinusIcon className="h-[18px] w-[18px]" /></button>
              </div>
              {isOpen ? (
                <div className="space-y-3 pb-5 pl-[46px]">
                  <label className="block"><span className={labelClass}>{t("titleLabel")}</span><input className={inputClass} value={rule.title} onChange={(event) => update(index, { title: event.target.value })} placeholder={t("titlePlaceholder")} maxLength={160} disabled={disabled} /></label>
                  <label className="block"><span className={labelClass}>{t("descriptionLabel")}</span><textarea className={inputClass} rows={3} value={rule.description} onChange={(event) => update(index, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} maxLength={10000} disabled={disabled} /></label>
                  {topics.length ? (
                    <div className="space-y-3 rounded-l-md border-l-2 border-[color-mix(in_srgb,var(--muted)_45%,var(--line))] pl-4">
                      {topics.map((topic, topicIndex) => (
                        <div key={topicIndex}>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <strong className="text-xs text-[var(--muted)]">{t("topicN", { n: `${index + 1}.${topicIndex + 1}` })}</strong>
                            <button type="button" className={rowIconClass} disabled={disabled} aria-label={t("remove")} title={t("remove")} onClick={() => removeTopic(index, topicIndex)}><CircleMinusIcon className="h-[18px] w-[18px]" /></button>
                          </div>
                          <label className="block"><span className={labelClass}>{t("topicTitleLabel")}</span><input className={inputClass} value={topic.title} onChange={(event) => updateTopic(index, topicIndex, { title: event.target.value })} placeholder={t("topicTitlePlaceholder")} maxLength={160} disabled={disabled} /></label>
                          <label className="mt-2 block"><span className={labelClass}>{t("topicDescriptionLabel")}</span><textarea className={inputClass} rows={2} value={topic.description} onChange={(event) => updateTopic(index, topicIndex, { description: event.target.value })} placeholder={t("topicDescriptionPlaceholder")} maxLength={10000} disabled={disabled} /></label>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!disabled && topics.length < MAX_TOPICS_PER_RULE ? (
                    <Button className="min-h-9 w-full px-3 py-1 text-xs" variant="secondary" onClick={() => addTopic(index)}><span aria-hidden="true">+</span>{t("addTopic", { n: `${index + 1}.${topics.length + 1}` })}</Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!disabled && value.length < MAX_RULES ? <AddRow label={t("ruleWord")} ariaLabel={t("addRule")} onClick={addRule} /> : null}
    </div>
  );
}

export function RuleSectionsView({ rules, bare = false }: { rules: ChallengeRule[]; bare?: boolean }) {
  const t = useTranslations("rules");
  if (!rules.length) return null;
  return (
    <section className={bare ? undefined : "mt-5 overflow-hidden rounded-[24px]"} aria-labelledby={bare ? undefined : "challenge-rules-title"}>
      {bare ? null : <h2 className="mt-2 text-2xl font-light tracking-[-0.035em]" id="challenge-rules-title">{t("viewTitle")}</h2>}
      <div className={cx("grid gap-3", !bare && "mt-5", rules.length > 1 && "md:grid-cols-2")}>
        {rules.map((rule, index) => (
          <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5" key={`${rule.title}-${index}`}>
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--ink)] text-xs font-black text-[var(--paper)]" aria-hidden="true">{index + 1}</span>
              <div className="min-w-0">
                <h3 className="text-lg font-light tracking-[-0.02em]">{rule.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{rule.description}</p>
                {rule.topics?.length ? (
                  <div className="mt-4 space-y-3 rounded-l-md border-l-2 border-[color-mix(in_srgb,var(--muted)_45%,var(--line))] pl-4">
                    {rule.topics.map((topic, topicIndex) => (
                      <div key={`${topic.title}-${topicIndex}`}>
                        <h4 className="text-sm font-light text-[var(--ink)]">
                          <span className="text-[var(--muted)]">{index + 1}.{topicIndex + 1}</span> {topic.title}
                        </h4>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{topic.description}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
