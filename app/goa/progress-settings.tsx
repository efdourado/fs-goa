"use client";

import { useTranslations } from "next-intl";
import { performancePlans, type ComparisonRule, type ProgressTracking } from "../../lib/progress-tracking";
import type { ChallengeDetail, Entry } from "./types";
import { storyFromChallenge, buildStory } from "./story/model";
import { BoxSection, Disclosure, Field, inputClass, Select, Toggle } from "./ui";

export function ProgressSettings({ challenge, entries, value, onChange, showPerformance = true, showCheckins = true, performanceBare = false }: {
  showPerformance?: boolean; showCheckins?: boolean; performanceBare?: boolean;
  challenge: ChallengeDetail; entries: Entry[]; value: ProgressTracking; onChange: (value: ProgressTracking) => void;
}) {
  const t = useTranslations("progressTracking");
  const sources = challenge.entryTypes.filter((type) => type.answerScope !== "shared" && type.purpose !== "rating" && type.purpose !== "expectation"
    && (type.parentTypeId || type.submissionMode === "daily" || type.purpose === "checkin" || type.purpose === "progress"));
  const fields = sources.flatMap((type) => type.fields.filter((field) => field.type === "number" && field.id));
  const dated = challenge.entryTypes.some((type) => type.purpose === "checkin" || type.submissionMode === "daily");
  if (!fields.length && !dated) return null;
  const performance: NonNullable<ProgressTracking["performance"]> = value.performance ?? { mode: "separate" as const, fieldIds: [] };
  const selectedIds = performance.mode === "separate" && !performance.fieldIds.length ? fields.filter((field) => field.id !== performance.seriesFieldId).map((field) => field.id!) : performance.fieldIds;
  const goal = value.consistency;
  const plans = performancePlans(fields, performance);
  // Record progress itself does not depend on today's date; the last entry is enough for this preview.
  const today = entries.map((entry) => entry.occurredOn ?? entry.submittedAt?.slice(0, 10) ?? "").sort().at(-1) || challenge.startsOn || "2000-01-01";
  const preview = buildStory(storyFromChallenge({ ...challenge, trackingSettings: value }, entries, today));
  const samples = preview?.kind === "dated" ? preview.records : [];
  function setRule(id: string, patch: Partial<ComparisonRule>) {
    onChange({ ...value, performance: { ...performance, rules: { ...performance.rules, [id]: { direction: "higher", ...performance.rules?.[id], ...patch } } } });
  }
  const performanceControls = <div className="space-y-3">
        <Field label={t("performance")}>
          <Select ariaLabel={t("performance")} value={performance.mode} onChange={(mode) => onChange({ ...value, performance: { ...performance, mode, fieldIds: [] } })} options={[{ value: "product", label: t("product") }, { value: "separate", label: t("separate") }]} />
        </Field>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm">{t(performance.mode === "product" ? "properties" : "trackedProperties")}</legend>{fields.filter((field) => field.id !== performance.seriesFieldId).map((field) => {
          const id = field.id!;
          const rule = performance.rules?.[id];
          const source = sources.find((type) => type.fields.some((candidate) => candidate.id === id));
          return <div key={id} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(id)} disabled={performance.mode === "separate" && selectedIds.length === 1 && selectedIds.includes(id)} onChange={(event) => onChange({ ...value, performance: { ...performance, fieldIds: event.target.checked ? [...selectedIds, id] : selectedIds.filter((candidate) => candidate !== id) } })} />{field.label}</label>
            {selectedIds.includes(id) ? <>
              <Field label={t("direction", { field: field.label })}><Select ariaLabel={t("direction", { field: field.label })} value={rule?.direction ?? "higher"} onChange={(direction) => setRule(id, { direction })} options={(["higher", "lower", "descriptive", "target"] as const).map((direction) => ({ value: direction, label: t(`directions.${direction}`) }))} /></Field>
              {rule?.direction === "target" ? <Field label={t("targetValue")}><input type="number" step="any" required className={inputClass} value={rule.target ?? ""} onChange={(event) => setRule(id, { target: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field> : null}
              <Field label={t("compareAt")}><Select ariaLabel={t("compareAtField", { field: field.label })} value={rule?.contextFieldId ?? ""} onChange={(contextFieldId) => setRule(id, { contextFieldId: contextFieldId || undefined })} options={[{ value: "", label: t("anyContext") }, ...(source?.fields ?? []).filter((other) => other.type === "number" && other.id && other.id !== id && other.id !== performance.seriesFieldId).map((other) => ({ value: other.id!, label: other.label }))]} /></Field>
            </> : null}
          </div>;
        })}</fieldset>
        <Disclosure summary={t("seriesField")}><Field label={t("seriesField")}><Select ariaLabel={t("seriesField")} value={performance.seriesFieldId ?? ""} onChange={(seriesFieldId) => {
          const rules = Object.fromEntries(Object.entries(performance.rules ?? {}).filter(([id]) => id !== seriesFieldId).map(([id, rule]) => [id, { ...rule, contextFieldId: rule.contextFieldId === seriesFieldId ? undefined : rule.contextFieldId }]));
          onChange({ ...value, performance: { ...performance, rules, seriesFieldId: seriesFieldId || undefined, fieldIds: selectedIds.filter((id) => id !== seriesFieldId) } });
        }} options={[{ value: "", label: t("noSeries") }, ...fields.map((field) => ({ value: field.id!, label: field.label }))]} /></Field>
        <p className="text-xs text-[var(--muted)]">{t("seriesHelp")}</p></Disclosure>
        <Field label={t("aggregation")}>
          <Select ariaLabel={t("aggregation")} value={performance.sessionAggregation ?? "best"} onChange={(sessionAggregation) => onChange({ ...value, performance: { ...performance, sessionAggregation } })} options={[{ value: "best", label: t("bestRecord") }, { value: "sum", label: t("sumRecords") }]} />
        </Field>
        <p className="text-xs text-[var(--muted)]">{t("performanceHelp")}</p>
        <p className="text-sm">{plans.map((plan) => plan.fields.map((field) => field.label).join(" × ")).join(" · ")}</p>
        <ul className="space-y-1 text-xs text-[var(--muted)]">{samples.map((sample, index) => <li key={index}>{t("preview", { title: sample.item.title, first: sample.first, latest: sample.series.at(-1)! })} · {sample.label}{sample.seriesLabel ? ` · ${sample.seriesLabel} ${sample.seriesValue}` : ""}{sample.context ? ` · ${sample.context.label} ${sample.context.value} ${sample.context.unit}` : ""}</li>)}</ul>
      </div>;
  return <>
      {showPerformance && fields.length ? performanceBare ? performanceControls : <BoxSection title={t("performanceTitle")}>{performanceControls}</BoxSection> : null}
      {showCheckins && dated ? <BoxSection title={t("checkinsTitle")}><div className="space-y-3">
        <Toggle bare checked={Boolean(goal)} onChange={(enabled) => onChange({ ...value, consistency: enabled ? { target: 4, periodDays: 7, count: "sessions" } : null })} label={t("consistency")} />
        {goal ? <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("target")}><input className={inputClass} type="number" min={1} max={goal.count === "days" ? goal.periodDays : 1000} required value={goal.target} onChange={(event) => onChange({ ...value, consistency: { ...goal, target: Number(event.target.value) } })} /></Field>
            <Field label={t("periodDays")}><input className={inputClass} type="number" min={1} max={366} required value={goal.periodDays} onChange={(event) => onChange({ ...value, consistency: { ...goal, periodDays: Number(event.target.value) } })} /></Field>
          </div>
          <Field label={t("count")}><Select ariaLabel={t("count")} value={goal.count} onChange={(count) => onChange({ ...value, consistency: { ...goal, count } })} options={[{ value: "sessions", label: t("sessions") }, { value: "days", label: t("days") }]} /></Field>
          <p className="text-xs text-[var(--muted)]">{t("consistencyHelp")}</p>
        </> : <p className="text-xs text-[var(--muted)]">{t("noGoal")}</p>}
      </div></BoxSection> : null}
  </>;
}
