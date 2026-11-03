"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { parseProgressTracking } from "../../lib/progress-tracking";
import { arrangeResultPages, DATED_RESULT_PAGES, RATED_RESULT_PAGES } from "../../lib/result-presentation";
import { Dialog, FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { metricFields, metricGroupings, metricNeedsField, metricOperations, metricUpdatePayload } from "./metric-editor";
import { MetricBlock } from "./metrics-view";
import { ProgressSettings } from "./progress-settings";
import { useAlmanacPages } from "./story/almanac";
import { useChallengeStory } from "./story/for-challenge";
import { ThreadPanel } from "./story/view";
import type { ChallengeDetail, ChallengeSummary, Entry, Id, Metric } from "./types";
import { AddRow, Button, ChevronIcon, Disclosure, Field, inputClass, PageHeading, Select, SlidersIcon, StatusMessage, Toggle } from "./ui";

const rowIcon = "grid h-8 w-8 flex-none cursor-pointer place-items-center text-[var(--muted)] transition hover:text-[var(--ink-strong)] disabled:cursor-default disabled:opacity-25";

export function AdminMetrics({ challenge, entries, onSaveSettings, onSaveMetric, onDeleteMetric }: {
  challenge: ChallengeDetail; entries: Entry[];
  onSaveSettings: (payload: Partial<ChallengeSummary>) => Promise<unknown>;
  onSaveMetric: (id: Id | null, payload: Record<string, unknown>) => Promise<void>;
  onDeleteMetric: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("metricsManage");
  const ta = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const tm = useTranslations("metrics");
  const f = useGoaFormat();
  const [settings, setSettings] = useState(challenge.trackingSettings ?? {});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const metrics = (challenge.metrics ?? []).map((metric) => ({ ...metric, visibleInResults: visibility[metric.id] ?? metric.visibleInResults }));
  const [editing, setEditing] = useState<Metric | "new" | null>(null);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { input, story } = useChallengeStory({ ...challenge, trackingSettings: settings }, entries);
  const pages = useAlmanacPages(story, input, metrics, true, true);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const rated = story.kind === "rated" || (story.kind === "empty" && challenge.entryTypes.some((type) => type.purpose === "rating"));
  const automatic = (rated ? RATED_RESULT_PAGES : DATED_RESULT_PAGES)
    .filter((id) => id !== "records" || challenge.entryTypes.some((type) => type.parentTypeId))
    .filter((id) => !["duo", "brought"].includes(id) || input.people.length === 2)
    .filter((id) => id !== "solo" || input.people.length === 1)
    .filter((id) => id !== "people" || input.people.length > 2);
  const allAutomatic = [...new Set([...automatic, ...pages.filter((page) => !page.id.startsWith("metric-")).map((page) => page.id)])];
  const definitions = [
    ...allAutomatic.map((id) => ({ id, title: byId.get(id)?.title ?? t(`pages.${id}.title`), metric: undefined as Metric | undefined })),
    ...metrics.map((metric) => ({ id: `metric-${metric.id}`, title: metric.label, metric })),
  ];
  // Hidden rows stay in Manage so they can be restored in the same place.
  const rows = arrangeResultPages(definitions, settings.results ? { ...settings.results, hiddenPages: [] } : undefined);
  const hidden = settings.results?.hiddenPages ?? [];
  const closed = challenge.status === "closed";
  const dirty = JSON.stringify(settings) !== JSON.stringify(challenge.trackingSettings ?? {}) || Object.entries(visibility).some(([id, visible]) => visible !== (challenge.metrics?.find((metric) => metric.id === id)?.visibleInResults !== false));
  const opened = preview === "thread" ? null : byId.get(preview ?? "");
  const previewMetric = challenge.metrics?.find((metric) => `metric-${metric.id}` === preview);

  function show(id: string, visible: boolean) {
    setSettings({ ...settings, results: { pageOrder: settings.results?.pageOrder ?? [], hiddenPages: visible ? hidden.filter((key) => key !== id) : [...hidden, id] } });
  }
  function move(index: number, delta: number) {
    const next = rows.map((row) => row.id);
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setSettings({ ...settings, results: { hiddenPages: hidden, pageOrder: next } });
  }
  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const normalized = parseProgressTracking(settings);
      await onSaveSettings({ trackingSettings: normalized });
      setSettings(normalized);
      for (const metric of metrics) {
        if (Object.hasOwn(visibility, metric.id) && visibility[metric.id] !== (challenge.metrics?.find((row) => row.id === metric.id)?.visibleInResults !== false)) {
          await onSaveMetric(metric.id, metricUpdatePayload(metric));
        }
      }
      setVisibility({});
      setSuccess(ta("changesSaved"));
    }
    catch (cause) { setError(f.error(cause)); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-2xl">
    <PageHeading title={ta("tabs.results")} />
    <StatusMessage error={error} success={success} />
    {closed ? <p className="mb-5 text-sm leading-6 text-[var(--muted)]">{ta("metricsClosedNote")}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <section className="rounded-[20px] border border-[var(--line)] p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-3 border-b border-[var(--line)] pb-4">
            <Toggle bare disabled={closed} checked={!hidden.includes("thread")} onChange={(value) => show("thread", value)} ariaLabel={t("showPage", { title: t("thread") })} />
            <button type="button" onClick={() => setPreview("thread")} className="min-w-0 flex-1 cursor-pointer text-left"><strong className="block text-sm font-medium">{t("thread")}</strong><span className="text-xs text-[var(--muted)]">{t("threadHint")}</span></button>
          </div>
          <ol className="divide-y divide-[var(--line)]">
            {rows.map((row, index) => {
              const ready = byId.has(row.id);
              const eligible = !row.metric || row.metric.visibleInResults !== false;
              const included = !hidden.includes(row.id) && eligible;
              return <li key={row.id} className="flex items-center gap-2 py-3">
                <Toggle bare disabled={closed} checked={included} onChange={(visible) => {
                  if (row.metric) setVisibility({ ...visibility, [row.metric.id]: visible });
                  show(row.id, visible);
                }} ariaLabel={t("showPage", { title: row.title })} />
                <button type="button" onClick={() => setPreview(row.id)} className="min-w-0 flex-1 cursor-pointer px-1 text-left">
                  <strong className="block break-words text-sm font-medium">{row.title}</strong>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{row.metric ? `${tm(`operationName.${row.metric.operation}`)} · ${tm(`groupBy.${row.metric.groupBy ?? "none"}`)}` : t("automatic")}{!included ? ` · ${t("hidden")}` : !ready ? ` · ${t("pending")}` : ""}</span>
                </button>
                <span className="flex flex-none">
                  <button type="button" className={rowIcon} aria-label={t("moveUp", { title: row.title })} disabled={closed || !index} onClick={() => move(index, -1)}><ChevronIcon dir="up" /></button>
                  <button type="button" className={rowIcon} aria-label={t("moveDown", { title: row.title })} disabled={closed || index === rows.length - 1} onClick={() => move(index, 1)}><ChevronIcon dir="down" /></button>
                  {row.id === "records" ? <button type="button" disabled={closed} className={rowIcon} aria-label={t("edit", { title: row.title })} onClick={() => setPerformanceOpen(true)}><SlidersIcon className="h-4 w-4" /></button> : null}
                  {row.metric ? <button type="button" disabled={closed} className={rowIcon} aria-label={t("edit", { title: row.title })} onClick={() => setEditing(row.metric!)}><SlidersIcon className="h-4 w-4" /></button> : null}
                </span>
              </li>;
            })}
          </ol>
          {!closed ? <AddRow label={ta("addMetric")} ariaLabel={ta("addMetric")} onClick={() => setEditing("new")} /> : null}
        </section>
        <fieldset disabled={closed} className="min-w-0 space-y-4"><ProgressSettings challenge={challenge} entries={entries} value={settings} onChange={setSettings} showPerformance={false} /></fieldset>
        <Button type="submit" className="w-full" disabled={closed || !dirty || busy}>{busy ? tc("saving") : tc("save")}</Button>
      </fieldset>
    </form>
    {preview ? <Dialog title={preview === "thread" ? t("thread") : rows.find((row) => row.id === preview)?.title ?? t("preview")} wide onClose={() => setPreview(null)}>
      <p className="mb-5 text-sm leading-6 text-[var(--muted)]">{previewMetric ? t("metricExplanation", { operation: tm(`operationName.${previewMetric.operation}`), group: tm(`groupBy.${previewMetric.groupBy ?? "none"}`) }) : t(`pages.${preview === "thread" ? "thread" : preview}.description`)}</p>
      {previewMetric?.entryTypeId ? <p className="mb-2 text-sm text-[var(--muted)]">{t("source")}: {challenge.entryTypes.find((type) => type.id === previewMetric.entryTypeId)?.name}</p> : null}
      {previewMetric?.countDays ? <p className="mb-2 text-xs text-[var(--muted)]">{t("countDays")}</p> : null}
      {previewMetric?.itemTitle ? <p className="mb-2 text-xs text-[var(--muted)]">{t("item")}: {previewMetric.itemTitle}</p> : null}
      {previewMetric?.cumulative ? <p className="mb-2 text-xs text-[var(--muted)]">{t("cumulative")}</p> : null}
      {previewMetric && metricNeedsField(previewMetric.operation) ? <p className="mb-4 text-sm text-[var(--muted)]">{metricFields(challenge).filter((field) => (previewMetric.fieldIds ?? [previewMetric.fieldId]).includes(field.id)).map((field) => `${field.source}: ${field.label}`).join(" · ")}</p> : null}
      {previewMetric && metricNeedsField(previewMetric.operation) ? <p className="mb-4 text-xs leading-5 text-[var(--muted)]">{t("missingValues")}</p> : null}
      {preview === "thread" && story.kind !== "empty" ? <ThreadPanel input={input} story={story} /> : previewMetric ? <MetricBlock metric={previewMetric} showExplanation /> : opened ? opened.body : <p className="text-sm text-[var(--muted)]">{t("pendingHelp")}</p>}
    </Dialog> : null}
    {performanceOpen ? <PerformanceDialog challenge={challenge} entries={entries} onCancel={() => setPerformanceOpen(false)} onSave={async (performance) => {
      await onSaveSettings({ trackingSettings: { ...challenge.trackingSettings, performance } });
      setSettings((current) => ({ ...current, performance }));
      setPerformanceOpen(false);
    }} /> : null}
    {editing ? <MetricEditorDialog challenge={challenge} metric={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSave={async (payload) => { await onSaveMetric(editing === "new" ? null : editing.id, payload); setVisibility((current) => { const next = { ...current }; if (editing !== "new") delete next[editing.id]; return next; }); setEditing(null); }} onDelete={editing === "new" ? undefined : async () => { await onDeleteMetric(editing.id); setEditing(null); }} /> : null}
  </div>;
}

export function MetricEditorDialog({ challenge, metric, onSave, onDelete, onCancel }: {
  challenge: ChallengeDetail; metric: Metric | null; onSave: (payload: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void>; onCancel: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("metricsManage");
  const tm = useTranslations("metrics");
  const f = useGoaFormat();
  const fields = metricFields(challenge);
  const initialType = metric?.entryTypeId ?? fields.find((field) => field.id === metric?.fieldId)?.entryTypeId ?? challenge.entryTypes.find((type) => type.isPrimary)?.id ?? challenge.entryTypes[0]?.id ?? "";
  const [label, setLabel] = useState(metric?.label ?? "");
  const [operation, setOperation] = useState<Metric["operation"]>(metric?.operation ?? (fields.length ? "average" : "count"));
  const [source, setSource] = useState(initialType);
  const [selected, setSelected] = useState<string[]>(metric?.fieldIds ?? (metric?.fieldId ? [metric.fieldId] : fields.filter((field) => field.entryTypeId === initialType).slice(0, 1).map((field) => field.id!)));
  const [combine, setCombine] = useState<"sum" | "average">(metric?.combineOp ?? "average");
  const [group, setGroup] = useState(metric?.groupBy ?? "none");
  const [minimum, setMinimum] = useState(metric?.minSample ?? 1);
  const [prior, setPrior] = useState(metric?.bayesPriorWeight ?? 4);
  const [during, setDuring] = useState(metric?.visibleDuring !== false);
  const [results, setResults] = useState(metric?.visibleInResults !== false);
  const [isRating, setIsRating] = useState(metric?.isRating ?? false);
  const [countDays, setCountDays] = useState(metric?.countDays ?? false);
  const [itemId, setItemId] = useState(metric?.itemId ?? "");
  const [cumulative, setCumulative] = useState(metric?.cumulative ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const change = (action: () => void) => { setTouched(true); action(); };
  const sourceType = challenge.entryTypes.find((type) => type.id === source);
  const available = fields.filter((field) => field.entryTypeId === source);
  const needsField = metricNeedsField(operation);
  const groups = metricGroupings(challenge, operation).filter((value) => sourceType?.answerScope !== "shared" || value !== "participant");
  const activeGroup = groups.includes(group) ? group : "none";
  const canScope = ["sum", "average", "median", "min", "max", "count"].includes(operation) && ["none", "participant", "checkpoint"].includes(activeGroup);
  const canRate = ["average", "bayesian_average"].includes(operation) && selected.length > 0 && (selected.length === 1 || combine === "average") && selected.every((id) => fields.find((field) => field.id === id)?.type === "rating");
  const operations = metricOperations.filter((op) => (!metricNeedsField(op) || fields.length > 0) && (op !== "surprise" || challenge.entryTypes.some((type) => type.purpose === "expectation")) && (sourceType?.answerScope !== "shared" || !["spread", "consensus", "surprise"].includes(op)));
  async function save() {
    setBusy(true); setError(null);
    try { await onSave({ label: label.trim(), operation, entryTypeId: source,
      ...(needsField ? selected.length > 1 ? { fieldIds: selected, combineOp: combine } : { fieldId: selected[0] } : {}),
      groupBy: activeGroup, minSample: minimum, bayesPriorWeight: prior, visibleDuring: during, visibleInResults: results,
      isRating: canRate && isRating, countDays: operation === "count" && countDays,
      itemId: canScope && itemId ? itemId : null, cumulative: activeGroup === "checkpoint" && cumulative }); }
    catch (cause) { setError(f.error(cause)); }
    finally { setBusy(false); }
  }
  return <FormDialog title={t(metric ? "editMetric" : "addMetric")} dirty={touched} busy={busy} error={error} onCancel={onCancel} onSubmit={save} submitDisabled={!label.trim() || (needsField && !selected.length)} onDelete={onDelete ? { body: t("deleteMetricConfirm", { label: metric!.label }), onConfirm: onDelete } : undefined}>
    <div className="space-y-5">
      <Field label={t("metricNameLabel")}><input className={inputClass} required maxLength={120} value={label} onChange={(event) => change(() => setLabel(event.target.value))} /></Field>
      <Field label={t("metricOperationLabel")}><Select ariaLabel={t("metricOperationLabel")} value={operation} onChange={(value) => change(() => setOperation(value))} options={operations.map((value) => ({ value, label: tm(`operationName.${value}`) }))} /></Field>
      {operation !== "completion_rate" ? <Field label={tx("source")}><Select ariaLabel={tx("source")} value={source} onChange={(value) => change(() => { setSource(value); setSelected(fields.filter((field) => field.entryTypeId === value).slice(0, 1).map((field) => field.id!)); })} options={challenge.entryTypes.filter((type) => !needsField || fields.some((field) => field.entryTypeId === type.id)).map((type) => ({ value: type.id, label: type.name }))} /></Field> : null}
      {needsField ? <fieldset><legend className="mb-2 text-sm font-medium">{t("metricFieldsLabel")}</legend><div className="space-y-2">{available.map((field) => <label key={field.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(field.id!)} disabled={!selected.includes(field.id!) && selected.length >= 8} onChange={(event) => change(() => setSelected(event.target.checked ? [...selected, field.id!] : selected.filter((id) => id !== field.id)))} />{field.label}</label>)}</div></fieldset> : null}
      {needsField && selected.length > 1 ? <Field label={t("metricCombineOpLabel")}><Select ariaLabel={t("metricCombineOpLabel")} value={combine} onChange={(value) => change(() => setCombine(value))} options={[{ value: "average", label: tm("combineOp.average") }, { value: "sum", label: tm("combineOp.sum") }]} /></Field> : null}
      <Field label={t("metricGroupByLabel")}><Select ariaLabel={t("metricGroupByLabel")} value={activeGroup} onChange={(value) => change(() => setGroup(value))} options={groups.map((value) => ({ value, label: tm(`groupBy.${value}`) }))} /></Field>
      {canRate ? <Toggle bare checked={isRating} onChange={(value) => change(() => setIsRating(value))} label={tx("rating")} hint={tx("ratingHint")} /> : null}
      <Disclosure summary={tx("options")}>
        <div className="space-y-4 pb-4">
          <Field label={t("metricMinSampleLabel")}><input type="number" className={inputClass} min={1} max={10000} required value={minimum} onChange={(event) => change(() => setMinimum(Number(event.target.value)))} /></Field>
          {operation === "bayesian_average" ? <Field label={tx("prior")}><input type="number" className={inputClass} min={0} max={10000} required value={prior} onChange={(event) => change(() => setPrior(Number(event.target.value)))} /></Field> : null}
          {operation === "count" ? <Toggle bare checked={countDays} onChange={(value) => change(() => setCountDays(value))} label={tx("countDays")} /> : null}
          {canScope && challenge.items.length ? <Field label={tx("item")}><Select ariaLabel={tx("item")} value={itemId} onChange={(value) => change(() => setItemId(value))} options={[{ value: "", label: tx("allItems") }, ...challenge.items.map((item) => ({ value: item.id, label: item.title }))]} /></Field> : null}
          {activeGroup === "checkpoint" ? <Toggle bare checked={cumulative} onChange={(value) => change(() => setCumulative(value))} label={tx("cumulative")} /> : null}
        </div>
      </Disclosure>
      <Toggle bare checked={during} onChange={(value) => change(() => setDuring(value))} label={t("metricVisibleDuring")} />
      <p className="text-xs leading-5 text-[var(--muted)]">{tx("visibilityHint")}</p>
      <Toggle bare checked={results} onChange={(value) => change(() => setResults(value))} label={tx("includeInResults")} />
    </div>
  </FormDialog>;
}


function PerformanceDialog({ challenge, entries, onCancel, onSave }: {
  challenge: ChallengeDetail; entries: Entry[]; onCancel: () => void;
  onSave: (performance: import("../../lib/progress-tracking").ProgressTracking["performance"]) => Promise<void>;
}) {
  const t = useTranslations("metricsManage");
  const f = useGoaFormat();
  const [value, setValue] = useState(challenge.trackingSettings ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <FormDialog title={t("personalRecordsSettings")} dirty={JSON.stringify(value) !== JSON.stringify(challenge.trackingSettings ?? {})} busy={busy} error={error} onCancel={onCancel} onSubmit={async () => {
    setBusy(true); setError(null);
    try { const parsed = parseProgressTracking(value); await onSave(parsed.performance); }
    catch (cause) { setError(f.error(cause)); }
    finally { setBusy(false); }
  }}>
    <ProgressSettings challenge={challenge} entries={entries} value={value} onChange={setValue} showCheckins={false} performanceBare />
  </FormDialog>;
}
