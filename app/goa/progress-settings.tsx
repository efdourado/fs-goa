"use client";

import { useTranslations } from "next-intl";
import { performancePlans, type ProgressTracking } from "../../lib/progress-tracking";
import type { ChallengeDetail, Entry } from "./types";
import { storyFromChallenge, buildStory } from "./story/model";
import { BoxSection, Field, inputClass, Select, Toggle } from "./ui";

export function ProgressSettings({ challenge, entries, value, onChange, showPerformance = true, showCheckins = true, performanceBare = false }: {
  showPerformance?: boolean; showCheckins?: boolean; performanceBare?: boolean;
  challenge: ChallengeDetail; entries: Entry[]; value: ProgressTracking; onChange: (value: ProgressTracking) => void;
}) {
  const t = useTranslations("progressTracking");
  const record = challenge.entryTypes.find((type) => type.parentTypeId);
  const fields = record?.fields.filter((field) => field.type === "number" && field.id) ?? [];
  const dated = challenge.entryTypes.some((type) => type.purpose === "checkin" || type.submissionMode === "daily");
  if (!record && !dated) return null;
  const performance: NonNullable<ProgressTracking["performance"]> = value.performance ?? { mode: "separate" as const, fieldIds: [] };
  const selectedIds = performance.mode === "separate" && !performance.fieldIds.length ? fields.map((field) => field.id!) : performance.fieldIds;
  const goal = value.consistency;
  const plans = performancePlans(fields, performance);
  // Record progress itself does not depend on today's date; the last entry is enough for this preview.
  const today = entries.map((entry) => entry.occurredOn ?? entry.submittedAt?.slice(0, 10) ?? "").sort().at(-1) || challenge.startsOn || "2000-01-01";
  const preview = buildStory(storyFromChallenge({ ...challenge, trackingSettings: value }, entries, today));
  const sample = preview?.kind === "dated" ? preview.records[0] : null;
  const performanceControls = <div className="space-y-3">
        <Field label={t("performance")}>
          <Select ariaLabel={t("performance")} value={performance.mode} onChange={(mode) => onChange({ ...value, performance: { mode, fieldIds: [], sessionAggregation: performance.sessionAggregation ?? "best" } })} options={[{ value: "product", label: t("product") }, { value: "separate", label: t("separate") }]} />
        </Field>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm">{t(performance.mode === "product" ? "properties" : "trackedProperties")}</legend>{fields.map((field) => <label key={field.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(field.id!)} disabled={performance.mode === "separate" && selectedIds.length === 1 && selectedIds.includes(field.id!)} onChange={(event) => onChange({ ...value, performance: { ...performance, fieldIds: event.target.checked ? [...selectedIds, field.id!] : selectedIds.filter((id) => id !== field.id) } })} />{field.label}</label>)}</fieldset>
        <Field label={t("aggregation")}>
          <Select ariaLabel={t("aggregation")} value={performance.sessionAggregation ?? "best"} onChange={(sessionAggregation) => onChange({ ...value, performance: { ...performance, sessionAggregation } })} options={[{ value: "best", label: t("bestRecord") }, { value: "sum", label: t("sumRecords") }]} />
        </Field>
        <p className="text-xs text-[var(--muted)]">{t("performanceHelp")}</p>
        <p className="text-sm">{plans.map((plan) => plan.fields.map((field) => field.label).join(" × ")).join(" · ")}</p>
        {sample ? <p className="text-xs text-[var(--muted)]">{t("preview", { title: sample.item.title, first: sample.first, best: sample.best })}</p> : null}
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
