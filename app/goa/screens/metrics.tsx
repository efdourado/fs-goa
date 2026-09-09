"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, FormDialog } from "../dialog";
import { MetricBlock } from "../metrics-view";
import { metricFields, metricGroupings, metricNeedsField, metricOperations } from "../metric-editor";
import { useGoaFormat } from "../format";
import type { ChallengeDetail, Id, Metric } from "../types";
import { Button, Disclosure, EmptyState, Field, inputClass, PageHeading, StatusMessage, Toggle } from "../ui";

type Props = {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (metricId: Id, payload: Record<string, unknown>) => Promise<void>;
  onDelete: (metricId: Id) => Promise<void>;
};

export function AdminMetrics({ challenge, onAdd, onUpdate, onDelete }: Props) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [editing, setEditing] = useState<Metric | "new" | null>(null);
  const [removing, setRemoving] = useState<Metric | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const closed = challenge.status === "closed";
  return (
    <section className="mx-auto max-w-5xl">
      <PageHeading title={t("metricsTitle")} description={t("metricsSubtitle")} action={!closed ? <Button onClick={() => { setEditing("new"); setSuccess(null); }}>{t("addMetric")}</Button> : undefined} />
      <StatusMessage success={success} />
      {closed ? <p className="mb-6 text-sm text-[var(--muted)]">{t("metricsClosedNote")}</p> : null}
      {challenge.metrics.length ? <div className="divide-y divide-[var(--line)]">{challenge.metrics.map((metric) => (
        <div key={metric.id} className="py-6 first:pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>{[metric.visibleDuring ? t("metricDuring") : null, metric.visibleInResults ? t("metricInResults") : null].filter(Boolean).join(" · ") || t("metricHidden")}</span>
            {!closed ? <div className="flex gap-3"><Button variant="secondary" onClick={() => { setEditing(metric); setSuccess(null); }}>{t("edit")}</Button><button type="button" className="min-h-11 px-2 text-[var(--danger)]" onClick={() => { setRemoving(metric); setError(null); }}>{t("remove")}</button></div> : null}
          </div>
          <MetricBlock metric={metric} />
        </div>
      ))}</div> : <EmptyState title={t("noMetricsTitle")} description={t("noMetricsBody")} />}
      {editing ? <MetricEditor key={editing === "new" ? "new" : editing.id} challenge={challenge} metric={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSave={async (payload) => {
        if (editing === "new") await onAdd(payload); else await onUpdate(editing.id, payload);
        setSuccess(t(editing === "new" ? "metricAdded" : "metricUpdated")); setEditing(null);
      }} /> : null}
      {removing ? <Dialog title={t("remove")} busy={busy} onClose={() => setRemoving(null)}>
        <p className="text-sm leading-6">{t("deleteMetricConfirm", { label: removing.label })}</p>
        <StatusMessage error={error} />
        <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>{tc("cancel")}</Button><Button variant="danger" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await onDelete(removing.id); setRemoving(null); } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
        }}>{busy ? t("removing") : t("remove")}</Button></div>
      </Dialog> : null}
    </section>
  );
}

export function MetricEditor({ challenge, metric, onCancel, onSave }: {
  challenge: ChallengeDetail; metric?: Metric; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tm = useTranslations("metrics");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const fields = metricFields(challenge);
  const [label, setLabel] = useState(metric?.label ?? "");
  const [operation, setOperation] = useState<Metric["operation"]>(metric?.operation ?? (fields.length ? "average" : "count"));
  const [fieldId, setFieldId] = useState(metric?.fieldId ?? (fields.length === 1 ? fields[0].id! : ""));
  const [groupBy, setGroupBy] = useState(metric?.groupBy ?? "none");
  const [minSample, setMinSample] = useState(String(metric?.minSample ?? 1));
  const [cumulative, setCumulative] = useState(metric?.cumulative ?? false);
  const [visibleDuring, setVisibleDuring] = useState(metric?.visibleDuring ?? true);
  const [visibleInResults, setVisibleInResults] = useState(metric?.visibleInResults ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsField = metricNeedsField(operation);
  const selectedField = fields.find((field) => field.id === fieldId);
  const options = metricGroupings(challenge, operation);
  // Existing configurations stay editable without silently changing their grouping.
  const groups = options.includes(groupBy) ? options : [groupBy, ...options];
  const dirty = label !== (metric?.label ?? "") || operation !== (metric?.operation ?? (fields.length ? "average" : "count")) || fieldId !== (metric?.fieldId ?? (fields.length === 1 ? fields[0].id! : "")) || groupBy !== (metric?.groupBy ?? "none") || minSample !== String(metric?.minSample ?? 1) || cumulative !== (metric?.cumulative ?? false) || visibleDuring !== (metric?.visibleDuring ?? true) || visibleInResults !== (metric?.visibleInResults ?? true);
  const validSource = !needsField || Boolean(selectedField);
  const [calculationOpen] = useState(!metric || !validSource);
  async function submit() {
    if (!validSource) { setError(t("errPickField")); return; }
    setBusy(true); setError(null);
    try {
      await onSave({ label: label.trim(), operation, fieldId: needsField ? fieldId : null, groupBy,
        minSample: Number(minSample) || 1, cumulative: groupBy === "checkpoint" && cumulative,
        ...(metric?.bayesPriorWeight != null ? { bayesPriorWeight: metric.bayesPriorWeight } : {}), visibleDuring, visibleInResults });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }
  return (
    <FormDialog
      title={metric ? t("editMetric") : t("addMetric")}
      dirty={dirty}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={metric ? tc("saveChanges") : t("addMetric")}
      submitDisabled={!validSource}
    >
      <Field label={t("metricNameLabel")}>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} placeholder={t("metricNamePlaceholder")} />
      </Field>
      <fieldset className="space-y-2.5">
        <legend className="mb-2 text-[13px] font-medium">{t("metricWhere")}</legend>
        <Toggle checked={visibleDuring} onChange={setVisibleDuring} label={t("metricVisibleDuring")} />
        <Toggle checked={visibleInResults} onChange={setVisibleInResults} label={t("metricVisibleResults")} />
      </fieldset>
      <Disclosure summary={t("metricCalculation")} defaultOpen={calculationOpen} preview={[tm(`operationName.${operation}`), selectedField?.label, tm(`groupBy.${groupBy}`)].filter(Boolean).join(" · ")}>
        <div className="space-y-4 pt-2">
          <Field label={t("metricOperationLabel")}>
            <select className={inputClass} value={operation} onChange={(e) => {
              const next = e.target.value as Metric["operation"]; setOperation(next);
              const nextGroups = metricGroupings(challenge, next); if (!nextGroups.includes(groupBy)) setGroupBy("none");
              if (!selectedField && fields.length === 1) setFieldId(fields[0].id!);
            }}>{metricOperations.filter((op) => op === operation || ((!metricNeedsField(op) || fields.length > 0) && (op !== "surprise" || challenge.entryTypes.some((type) => type.purpose === "expectation")))).map((op) => <option value={op} key={op}>{tm(`operationName.${op}`)}</option>)}</select>
          </Field>
          {needsField ? (
            <Field label={t("metricFieldLabel")} error={!fields.length ? t("metricNoFields") : null}>
              <select className={inputClass} value={fieldId} onChange={(e) => setFieldId(e.target.value)} required>
                <option value="">{t("metricFieldPlaceholder")}</option>
                {fields.map((field) => <option key={field.id} value={field.id}>{field.label}{field.source ? ` · ${field.source}` : ""}</option>)}
              </select>
            </Field>
          ) : null}
          {groups.length > 1 ? (
            <Field label={t("metricGroupByLabel")}>
              <select className={inputClass} value={groupBy} onChange={(e) => setGroupBy(e.target.value as NonNullable<Metric["groupBy"]>)}>{groups.map((group) => <option key={group} value={group}>{tm(`groupBy.${group}`)}</option>)}</select>
            </Field>
          ) : null}
          {groupBy === "checkpoint" ? <Toggle checked={cumulative} onChange={setCumulative} label={t("metricCumulativeLabel")} /> : null}
          {needsField ? (
            <Disclosure summary={t("metricAdvanced")}>
              <Field label={t("metricMinSampleLabel")} hint={t("metricMinSampleHint")} className="pt-2">
                <input className={inputClass} type="number" min={1} step={1} value={minSample} onChange={(e) => setMinSample(e.target.value)} required />
              </Field>
            </Disclosure>
          ) : null}
        </div>
      </Disclosure>
    </FormDialog>
  );
}
