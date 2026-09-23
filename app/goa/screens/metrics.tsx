"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, FormDialog } from "../dialog";
import { MetricBlock } from "../metrics-view";
import { canRankItems, defaultRankingFieldIds, metricFields, metricGroupings, metricNeedsField, metricOperations, rankingScores } from "../metric-editor";
import { useGoaFormat } from "../format";
import { Segmented } from "../Segmented";
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
  const [editing, setEditing] = useState<Metric | "new" | "ranking" | null>(null);
  const [removing, setRemoving] = useState<Metric | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const closed = challenge.status === "closed";
  const canRank = canRankItems(challenge);
  return (
    <section className="mx-auto max-w-5xl">
      <PageHeading
        title={t("metricsTitle")}
        description={t("metricsSubtitle")}
        action={!closed ? (
          <div className="flex flex-wrap gap-2">
            {canRank ? <Button variant="secondary" onClick={() => { setEditing("ranking"); setSuccess(null); }}>{t("addRanking")}</Button> : null}
            <Button onClick={() => { setEditing("new"); setSuccess(null); }}>{t("addMetric")}</Button>
          </div>
        ) : undefined}
      />
      <StatusMessage success={success} />
      {closed ? <p className="mb-6 text-sm text-[var(--muted)]">{t("metricsClosedNote")}</p> : null}
      {challenge.metrics.length ? <div className="divide-y divide-[var(--line)]">{challenge.metrics.map((metric) => (
        <div key={metric.id} className="py-6 first:pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>{[metric.visibleDuring ? t("metricDuring") : null, metric.visibleInResults ? t("metricInResults") : null].filter(Boolean).join(" · ") || t("metricHidden")}</span>
            {!closed ? <div className="flex gap-3"><Button variant="secondary" onClick={() => { setEditing(metric); setSuccess(null); }}>{t("edit")}</Button><button type="button" className="min-h-11 px-2 text-[var(--danger)]" onClick={() => { setRemoving(metric); setError(null); }}>{t("remove")}</button></div> : null}
          </div>
          <MetricBlock metric={metric} showExplanation />
        </div>
      ))}</div> : <EmptyState title={t("noMetricsTitle")} />}
      {editing ? <MetricEditor key={typeof editing === "string" ? editing : editing.id} challenge={challenge} ranking={editing === "ranking"} metric={typeof editing === "string" ? undefined : editing} onCancel={() => setEditing(null)} onSave={async (payload) => {
        if (typeof editing === "string") await onAdd(payload); else await onUpdate(editing.id, payload);
        setSuccess(t(editing === "ranking" ? "rankingAdded" : editing === "new" ? "metricAdded" : "metricUpdated")); setEditing(null);
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

export function MetricEditor({ challenge, metric, ranking = false, onCancel, onSave }: {
  challenge: ChallengeDetail; metric?: Metric;
  /** A new ranking of items: grouping locked to "by item", the rating fields already ticked, a score to choose. */
  ranking?: boolean;
  onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tm = useTranslations("metrics");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const fields = metricFields(challenge);
  const isRanking = ranking && !metric;
  // What an untouched editor starts as — the baseline "unsaved changes" is measured against.
  const [seed] = useState(() => {
    const ratingIds = isRanking ? defaultRankingFieldIds(fields) : [];
    const combineSeed = metric ? (metric.fieldIds?.length ?? 0) >= 2 : ratingIds.length >= 2;
    return {
      label: metric?.label ?? (isRanking ? t("rankingDefaultName") : ""),
      operation: metric?.operation ?? (isRanking || fields.length ? "average" : "count") as Metric["operation"],
      fieldId: metric?.fieldId ?? (ratingIds.length === 1 ? ratingIds[0] : fields.length === 1 ? fields[0].id! : ""),
      combine: combineSeed,
      fieldIds: metric?.fieldIds ?? (combineSeed ? ratingIds : []),
      combineOp: metric?.combineOp ?? "average" as "sum" | "average",
      groupBy: metric?.groupBy ?? (isRanking ? "item" : "none"),
    };
  });
  const [label, setLabel] = useState(seed.label);
  const [operation, setOperation] = useState<Metric["operation"]>(seed.operation);
  const [fieldId, setFieldId] = useState(seed.fieldId);
  // Two or more fields folded into one number per registro (a combined ranking) instead of reading just one.
  const [combine, setCombine] = useState(seed.combine);
  const [fieldIds, setFieldIds] = useState<string[]>(seed.fieldIds);
  const [combineOp, setCombineOp] = useState<"sum" | "average">(seed.combineOp);
  const [groupBy, setGroupBy] = useState(seed.groupBy);
  const [minSample, setMinSample] = useState(String(metric?.minSample ?? 1));
  const [cumulative, setCumulative] = useState(metric?.cumulative ?? false);
  const [visibleDuring, setVisibleDuring] = useState(metric?.visibleDuring ?? true);
  const [visibleInResults, setVisibleInResults] = useState(metric?.visibleInResults ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsField = metricNeedsField(operation);
  const selectedField = fields.find((field) => field.id === fieldId);
  const combinedFields = fields.filter((field) => fieldIds.includes(field.id!));
  const options = metricGroupings(challenge, operation);
  // Existing configurations stay editable without silently changing their grouping.
  const groups = options.includes(groupBy) ? options : [groupBy, ...options];
  function toggleField(id: Id, on: boolean) {
    setFieldIds((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
  }
  const dirty = label !== seed.label || operation !== seed.operation
    || combine !== seed.combine
    || (combine
      ? JSON.stringify([...fieldIds].sort()) !== JSON.stringify([...seed.fieldIds].sort()) || combineOp !== seed.combineOp
      : fieldId !== seed.fieldId)
    || groupBy !== seed.groupBy || minSample !== String(metric?.minSample ?? 1) || cumulative !== (metric?.cumulative ?? false)
    || visibleDuring !== (metric?.visibleDuring ?? true) || visibleInResults !== (metric?.visibleInResults ?? true);
  const validSource = !needsField || (combine ? fieldIds.length >= 2 : Boolean(selectedField));
  const [calculationOpen] = useState(!metric || !validSource);
  async function submit() {
    if (!validSource) { setError(combine ? t("metricPickTwoFields") : t("errPickField")); return; }
    setBusy(true); setError(null);
    try {
      await onSave({
        label: label.trim(), operation,
        fieldId: needsField && !combine ? fieldId : null,
        fieldIds: needsField && combine ? fieldIds : undefined,
        combineOp: needsField && combine ? combineOp : undefined,
        groupBy,
        minSample: Number(minSample) || 1, cumulative: groupBy === "checkpoint" && cumulative,
        ...(metric?.bayesPriorWeight != null ? { bayesPriorWeight: metric.bayesPriorWeight } : {}), visibleDuring, visibleInResults });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }
  return (
    <FormDialog
      title={metric ? t("editMetric") : isRanking ? t("addRanking") : t("addMetric")}
      dirty={dirty}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={metric ? tc("saveChanges") : isRanking ? t("addRanking") : t("addMetric")}
      submitDisabled={!validSource}
    >
      {isRanking ? <p className="text-sm leading-6 text-[var(--muted)]">{t("rankingHint")}</p> : null}
      <Field label={t("metricNameLabel")}>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} placeholder={t("metricNamePlaceholder")} />
      </Field>
      <fieldset className="space-y-2.5">
        <legend className="mb-2 text-[13px] font-medium">{t("metricWhere")}</legend>
        <Toggle checked={visibleDuring} onChange={setVisibleDuring} label={t("metricVisibleDuring")} />
        <Toggle checked={visibleInResults} onChange={setVisibleInResults} label={t("metricVisibleResults")} />
      </fieldset>
      <Disclosure
        summary={t("metricCalculation")}
        defaultOpen={calculationOpen}
        preview={[
          tm(`operationName.${operation}`),
          combine ? t("metricCombinedPreview", { count: combinedFields.length }) : selectedField?.label,
          tm(`groupBy.${groupBy}`),
        ].filter(Boolean).join(" · ")}
      >
        <div className="space-y-4 pt-2">
          {isRanking ? (
            <Field label={t("rankingScoreLabel")} hint={t("rankingScoreHint")}>
              <Segmented<Metric["operation"]>
                ariaLabel={t("rankingScoreLabel")}
                value={operation}
                onChange={setOperation}
                options={rankingScores.map((score) => ({ value: score, label: tm(`operationName.${score}`) }))}
              />
            </Field>
          ) : (
          <Field label={t("metricOperationLabel")}>
            <select className={inputClass} value={operation} onChange={(e) => {
              const next = e.target.value as Metric["operation"]; setOperation(next);
              const nextGroups = metricGroupings(challenge, next); if (!nextGroups.includes(groupBy)) setGroupBy("none");
              if (!selectedField && fields.length === 1) setFieldId(fields[0].id!);
            }}>{metricOperations.filter((op) => op === operation || ((!metricNeedsField(op) || fields.length > 0) && (op !== "surprise" || challenge.entryTypes.some((type) => type.purpose === "expectation")))).map((op) => <option value={op} key={op}>{tm(`operationName.${op}`)}</option>)}</select>
          </Field>
          )}
          {needsField && fields.length >= 2 ? (
            <Toggle
              checked={combine}
              onChange={(next) => {
                setCombine(next);
                // Carry the one field already picked across, either direction, so switching modes never loses it.
                if (next) setFieldIds((current) => (current.length ? current : fieldId ? [fieldId] : []));
                else if (fieldIds.length) setFieldId(fieldIds[0]);
              }}
              label={t("metricCombineLabel")}
              hint={t("metricCombineHint")}
            />
          ) : null}
          {needsField && combine ? (
            <Field label={t("metricFieldsLabel")} hint={t("metricFieldsHint")} error={fieldIds.length < 2 ? t("metricPickTwoFields") : null}>
              <div className="space-y-1.5 rounded-xl border border-[var(--line)] p-2.5">
                {fields.map((field) => (
                  <label key={field.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-[var(--wash)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-none accent-[var(--main)]"
                      checked={fieldIds.includes(field.id!)}
                      onChange={(e) => toggleField(field.id!, e.target.checked)}
                    />
                    <span className="min-w-0 truncate">{field.label}{field.source ? ` · ${field.source}` : ""}</span>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          {needsField && combine && fieldIds.length >= 2 ? (
            <Field label={t("metricCombineOpLabel")} hint={t("metricCombineOpHint")}>
              <Segmented<"sum" | "average">
                ariaLabel={t("metricCombineOpLabel")}
                value={combineOp}
                onChange={setCombineOp}
                options={[
                  { value: "average", label: tm("combineOp.average") },
                  { value: "sum", label: tm("combineOp.sum") },
                ]}
              />
            </Field>
          ) : null}
          {needsField && !combine ? (
            <Field label={t("metricFieldLabel")} error={!fields.length ? t("metricNoFields") : null}>
              <select className={inputClass} value={fieldId} onChange={(e) => setFieldId(e.target.value)} required>
                <option value="">{t("metricFieldPlaceholder")}</option>
                {fields.map((field) => <option key={field.id} value={field.id}>{field.label}{field.source ? ` · ${field.source}` : ""}</option>)}
              </select>
            </Field>
          ) : null}
          {groups.length > 1 && !isRanking ? (
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
