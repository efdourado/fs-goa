"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "../dialog";
import { MetricBlock } from "../metrics-view";
import { metricFields, metricGroupings, metricNeedsField, metricOperations } from "../metric-editor";
import { useGoaFormat } from "../format";
import type { ChallengeDetail, Id, Metric } from "../types";
import { Button, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";

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
  const [discard, setDiscard] = useState(false);
  const needsField = metricNeedsField(operation);
  const selectedField = fields.find((field) => field.id === fieldId);
  const options = metricGroupings(challenge, operation);
  // Existing configurations stay editable without silently changing their grouping.
  const groups = options.includes(groupBy) ? options : [groupBy, ...options];
  const dirty = label !== (metric?.label ?? "") || operation !== (metric?.operation ?? (fields.length ? "average" : "count")) || fieldId !== (metric?.fieldId ?? (fields.length === 1 ? fields[0].id! : "")) || groupBy !== (metric?.groupBy ?? "none") || minSample !== String(metric?.minSample ?? 1) || cumulative !== (metric?.cumulative ?? false) || visibleDuring !== (metric?.visibleDuring ?? true) || visibleInResults !== (metric?.visibleInResults ?? true);
  const close = () => { if (dirty) setDiscard(true); else onCancel(); };
  const validSource = !needsField || Boolean(selectedField);
  const [calculationOpen, setCalculationOpen] = useState(!metric || !validSource);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validSource) { setError(t("errPickField")); return; }
    setBusy(true); setError(null);
    try {
      await onSave({ label: label.trim(), operation, fieldId: needsField ? fieldId : null, groupBy,
        minSample: Number(minSample) || 1, cumulative: groupBy === "checkpoint" && cumulative,
        ...(metric?.bayesPriorWeight != null ? { bayesPriorWeight: metric.bayesPriorWeight } : {}), visibleDuring, visibleInResults });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }
  return <Dialog title={metric ? t("editMetric") : t("addMetric")} busy={busy} onClose={close}>
    {discard ? <div role="alert" className="mb-5 space-y-3 rounded-xl bg-[var(--wash)] p-4"><p className="text-sm">{t("unsavedMetric")}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => setDiscard(false)}>{t("keepEditing")}</Button><Button variant="danger" disabled={busy} onClick={onCancel}>{t("discardChanges")}</Button></div></div> : null}
    <form onSubmit={submit} className="space-y-6">
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <label className="block"><span className={labelClass}>{t("metricNameLabel")}</span><input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} placeholder={t("metricNamePlaceholder")} /></label>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("metricWhere")}</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={visibleDuring} onChange={(e) => setVisibleDuring(e.target.checked)} />{t("metricVisibleDuring")}</label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={visibleInResults} onChange={(e) => setVisibleInResults(e.target.checked)} />{t("metricVisibleResults")}</label>
        </fieldset>
        <details open={calculationOpen} onToggle={(e) => setCalculationOpen(e.currentTarget.open)} className="border-t border-[var(--line)] pt-4">
          <summary className="cursor-pointer text-sm font-medium">{t("metricCalculation")}<span className="mt-1 block text-xs font-normal text-[var(--muted)]">{[tm(`operationName.${operation}`), selectedField?.label, tm(`groupBy.${groupBy}`)].filter(Boolean).join(" · ")}</span></summary>
          <div className="mt-5 space-y-4">
            <label className="block"><span className={labelClass}>{t("metricOperationLabel")}</span><select className={inputClass} value={operation} onChange={(e) => {
              const next = e.target.value as Metric["operation"]; setOperation(next);
              const nextGroups = metricGroupings(challenge, next); if (!nextGroups.includes(groupBy)) setGroupBy("none");
              if (!selectedField && fields.length === 1) setFieldId(fields[0].id!);
            }}>{metricOperations.filter((op) => op === operation || ((!metricNeedsField(op) || fields.length > 0) && (op !== "surprise" || challenge.entryTypes.some((type) => type.purpose === "expectation")))).map((op) => <option value={op} key={op}>{tm(`operationName.${op}`)}</option>)}</select></label>
            {needsField ? <label className="block"><span className={labelClass}>{t("metricFieldLabel")}</span><select className={inputClass} value={fieldId} onChange={(e) => setFieldId(e.target.value)} required>
              <option value="">{t("metricFieldPlaceholder")}</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.label}{field.source ? ` · ${field.source}` : ""}</option>)}
            </select>{!fields.length ? <small className="mt-2 block text-[var(--danger)]">{t("metricNoFields")}</small> : null}</label> : null}
            {groups.length > 1 ? <label className="block"><span className={labelClass}>{t("metricGroupByLabel")}</span><select className={inputClass} value={groupBy} onChange={(e) => setGroupBy(e.target.value as NonNullable<Metric["groupBy"]>)}>{groups.map((group) => <option key={group} value={group}>{tm(`groupBy.${group}`)}</option>)}</select></label> : null}
            {groupBy === "checkpoint" ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} />{t("metricCumulativeLabel")}</label> : null}
            {needsField ? <details className="border-t border-[var(--line)] pt-4"><summary className="cursor-pointer text-sm">{t("metricAdvanced")}</summary><label className="mt-4 block"><span className={labelClass}>{t("metricMinSampleLabel")}</span><input className={inputClass} type="number" min={1} step={1} value={minSample} onChange={(e) => setMinSample(e.target.value)} required /><small className="mt-2 block leading-5 text-[var(--muted)]">{t("metricMinSampleHint")}</small></label></details> : null}
          </div>
        </details>
      </fieldset>
      <StatusMessage error={error} />
      <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4"><Button variant="secondary" disabled={busy} onClick={close}>{tc("cancel")}</Button><Button type="submit" disabled={busy || !validSource}>{busy ? tc("saving") : metric ? tc("saveChanges") : t("addMetric")}</Button></div>
    </form>
  </Dialog>;
}
