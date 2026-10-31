"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { MAX_CHALLENGE_RULES } from "../../lib/goa/domain/rule-limits";
import type { ChallengeRule, RuleTopic } from "./types";
import { AddRow, Button, ChevronIcon, CircleMinusIcon, cx, inputClass, labelClass, rowIconClass, StartLine } from "./ui";

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
    if (disabled || value.length >= MAX_CHALLENGE_RULES) return;
    onChange([...value, { title: "", description: "" }]);
    setOpen(value.length);
  }

  function removeRule(index: number) {
    onChange(value.filter((_, position) => position !== index));
    setOpen((current) => current === null || current === index ? null : current > index ? current - 1 : current);
  }

  // Empty: the same dotted line Etapas starts with.
  if (!value.length) return disabled ? null : <div><StartLine label={t("ruleWord")} ariaLabel={t("addRule")} onClick={addRule} /><p className="mt-2 text-xs text-[var(--muted)]">{t("limit", { count: 0, max: MAX_CHALLENGE_RULES })}</p></div>;

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
                            <button type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} disabled={disabled} aria-label={t("remove")} title={t("remove")} onClick={() => removeTopic(index, topicIndex)}><CircleMinusIcon className="h-[18px] w-[18px]" /></button>
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
      <p className="mt-3 text-xs text-[var(--muted)]" aria-live="polite">{t("limit", { count: value.length, max: Math.max(MAX_CHALLENGE_RULES, value.length) })}</p>
      {!disabled && value.length < MAX_CHALLENGE_RULES ? <AddRow label={t("ruleWord")} ariaLabel={t("addRule")} onClick={addRule} /> : null}
    </div>
  );
}

export function RuleSectionsView({ rules, bare = false, onCover = false }: { rules: ChallengeRule[]; bare?: boolean; onCover?: boolean }) {
  const t = useTranslations("rules");
  if (!rules.length) return null;
  return (
    <section className={bare ? undefined : "mt-5 overflow-hidden rounded-[24px]"} aria-labelledby={bare ? undefined : "challenge-rules-title"}>
      {bare ? null : <h2 className="mt-2 text-2xl font-light tracking-[-0.035em]" id="challenge-rules-title">{t("viewTitle")}</h2>}
      <div className={cx("grid grid-cols-1 gap-3", !bare && "mt-5")}>
        {rules.map((rule, index) => (
          <article className={cx("min-w-0 rounded-2xl border p-5", onCover ? "border-white/15 bg-white/5" : "border-[var(--line)] bg-[var(--paper)]")} key={`${rule.title}-${index}`}>
            <div className="flex items-start gap-3">
              <span className={cx("grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-black", onCover ? "bg-white/15 text-white" : "bg-[var(--ink)] text-[var(--paper)]")} aria-hidden="true">{index + 1}</span>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <h3 className="text-lg font-light tracking-[-0.02em]">{rule.title}</h3>
                <p className={cx("mt-2 whitespace-pre-wrap text-sm leading-6", onCover ? "text-white/70" : "text-[var(--muted)]")}>{rule.description}</p>
                {rule.topics?.length ? (
                  <div className="mt-4 space-y-3 rounded-l-md border-l-2 border-[color-mix(in_srgb,var(--muted)_45%,var(--line))] pl-4">
                    {rule.topics.map((topic, topicIndex) => (
                      <div key={`${topic.title}-${topicIndex}`}>
                        <h4 className={cx("text-sm font-light", onCover ? "text-white" : "text-[var(--ink)]")}>
                          <span className={onCover ? "text-white/55" : "text-[var(--muted)]"}>{index + 1}.{topicIndex + 1}</span> {topic.title}
                        </h4>
                        <p className={cx("mt-1 whitespace-pre-wrap text-sm leading-6", onCover ? "text-white/70" : "text-[var(--muted)]")}>{topic.description}</p>
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

/** Clamp elastic scrolling on iOS and fade each edge as its remaining content runs out. */
export function rulesScrollShadows({ scrollTop, scrollHeight, clientHeight }: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  const end = Math.max(0, scrollHeight - clientHeight);
  const top = Math.max(0, Math.min(end, scrollTop));
  const fade = (distance: number) => distance <= 1 ? 0 : Math.min(1, distance / 24);
  return { above: fade(top), below: fade(end - top) };
}

function ScrollableRules({ rules }: { rules: ChallengeRule[] }) {
  const t = useTranslations("rules");
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [shadows, setShadows] = useState({ above: 0, below: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const update = () => {
      const next = rulesScrollShadows(viewport);
      setShadows((current) => current.above === next.above && current.below === next.below ? current : next);
    };
    const details = viewport.closest("details");
    viewport.addEventListener("scroll", update, { passive: true });
    details?.addEventListener("toggle", update);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    observer?.observe(content);
    update();
    return () => {
      viewport.removeEventListener("scroll", update);
      details?.removeEventListener("toggle", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);

  return <div className="relative isolate min-w-0">
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus lets keyboard users scroll the bounded rules panel. */}
    <div ref={viewportRef} role="region" aria-label={t("legacyTitle")} tabIndex={0} className="min-w-0 max-h-[min(20rem,50dvh)] overflow-x-hidden overflow-y-auto overscroll-contain bg-[var(--spotlight)] px-6 pb-6 pt-3 sm:px-9 sm:pb-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
      <div ref={contentRef}><RuleSectionsView rules={rules} bare onCover /></div>
    </div>
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8" style={{ opacity: shadows.above, background: "linear-gradient(to bottom, var(--spotlight), transparent)" }} />
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8" style={{ opacity: shadows.below, background: "linear-gradient(to top, var(--spotlight), transparent)" }} />
  </div>;
}

/** The upper curve is always visible; expanding reveals its matching lower half. */
export function ChallengeCoverRules({ rules }: { rules: ChallengeRule[] }) {
  const t = useTranslations("rules");
  return <div className="challenge-ticket-bottom min-w-0 w-full">
    {rules.length ? <details className="challenge-cover-rules block min-w-0 w-full open:overflow-hidden open:rounded-b-[28px]">
      <summary aria-label={t("coverLabel", { count: rules.length })} className="block cursor-pointer list-none text-white/75 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden">
        <span className="challenge-ticket-waist flex h-12 w-full items-center justify-center bg-[var(--spotlight)]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </span>
      </summary>
      <div className="challenge-ticket-waist challenge-ticket-waist-lower bg-[var(--spotlight)]" aria-hidden="true" />
      <ScrollableRules rules={rules} />
      <div className="h-5 bg-[var(--spotlight)]" aria-hidden="true" />
    </details> : <div className="challenge-ticket-waist h-12 bg-[var(--spotlight)]" aria-hidden="true" />}
  </div>;
}
