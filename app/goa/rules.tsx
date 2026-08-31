"use client";

import { useTranslations } from "next-intl";

import type { ChallengeRule, RuleTopic } from "./types";
import { Button, cx, inputClass, labelClass } from "./ui";

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

  return (
    <div className="space-y-3">
      {value.map((rule, index) => {
        const topics = rule.topics ?? [];
        return (
          <article className="rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)]/55 p-4" key={index}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <strong className="text-sm">{t("ruleN", { n: index + 1 })}</strong>
              <div className="flex flex-wrap justify-end gap-1">
                <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={disabled || index === 0} onClick={() => move(index, -1)}><span aria-hidden="true">↑</span><span className="sr-only">{t("moveUp")}</span></Button>
                <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)}><span aria-hidden="true">↓</span><span className="sr-only">{t("moveDown")}</span></Button>
                <Button className="min-h-9 px-3 py-1 text-xs" variant="danger" disabled={disabled} onClick={() => onChange(value.filter((_, position) => position !== index))}>{t("remove")}</Button>
              </div>
            </div>
            <label><span className={labelClass}>{t("titleLabel")}</span><input className={inputClass} value={rule.title} onChange={(event) => update(index, { title: event.target.value })} placeholder={t("titlePlaceholder")} required maxLength={160} disabled={disabled} /></label>
            <label className="mt-3 block"><span className={labelClass}>{t("descriptionLabel")}</span><textarea className={inputClass} rows={3} value={rule.description} onChange={(event) => update(index, { description: event.target.value })} placeholder={t("descriptionPlaceholder")} required maxLength={10000} disabled={disabled} /></label>

            {topics.length ? (
              <div className="mt-4 space-y-3 border-l-2 border-[var(--main-line)] pl-4">
                {topics.map((topic, topicIndex) => (
                  <div key={topicIndex}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <strong className="text-xs text-[var(--muted)]">{t("topicN", { n: `${index + 1}.${topicIndex + 1}` })}</strong>
                      <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={disabled} onClick={() => removeTopic(index, topicIndex)}>{t("remove")}</Button>
                    </div>
                    <label><span className={labelClass}>{t("topicTitleLabel")}</span><input className={inputClass} value={topic.title} onChange={(event) => updateTopic(index, topicIndex, { title: event.target.value })} placeholder={t("topicTitlePlaceholder")} required maxLength={160} disabled={disabled} /></label>
                    <label className="mt-2 block"><span className={labelClass}>{t("topicDescriptionLabel")}</span><textarea className={inputClass} rows={2} value={topic.description} onChange={(event) => updateTopic(index, topicIndex, { description: event.target.value })} placeholder={t("topicDescriptionPlaceholder")} required maxLength={10000} disabled={disabled} /></label>
                  </div>
                ))}
              </div>
            ) : null}
            {!disabled && topics.length < MAX_TOPICS_PER_RULE ? (
              <Button className="mt-3 min-h-9 px-3 py-1 text-xs" variant="secondary" onClick={() => addTopic(index)}><span aria-hidden="true">+</span>{t("addTopic", { n: `${index + 1}.${topics.length + 1}` })}</Button>
            ) : null}
          </article>
        );
      })}
      {!disabled && value.length < MAX_RULES ? <Button variant="secondary" onClick={() => onChange([...value, { title: "", description: "" }])}><span aria-hidden="true">+</span>{t("addRule")}</Button> : null}
      {!value.length ? <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">{t("empty")}</p> : null}
    </div>
  );
}

export function RuleSectionsView({ rules }: { rules: ChallengeRule[] }) {
  const t = useTranslations("rules");
  if (!rules.length) return null;
  return (
    <section className="mt-5 overflow-hidden rounded-[24px]" aria-labelledby="challenge-rules-title">
      <h2 className="mt-2 text-2xl font-light tracking-[-0.035em]" id="challenge-rules-title">{t("viewTitle")}</h2>
      <div className={cx("mt-5 grid gap-3", rules.length > 1 && "md:grid-cols-2")}>
        {rules.map((rule, index) => (
          <article className="rounded-2xl border border-[var(--main-line)]/70 bg-[var(--paper)] p-5" key={`${rule.title}-${index}`}>
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--main)] text-xs font-black text-white" aria-hidden="true">{index + 1}</span>
              <div className="min-w-0">
                <h3 className="text-lg font-light tracking-[-0.02em]">{rule.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{rule.description}</p>
                {rule.topics?.length ? (
                  <div className="mt-4 space-y-3 border-l-2 border-[var(--main-line)] pl-4">
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
