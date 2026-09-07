"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { CheckpointPlanner } from "../checkpoint-planner";
import { useGoaFormat } from "../format";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { copyText } from "../clipboard";
import { ConfirmDialog } from "../dialog";
import { cleanFields, FieldBuilder } from "../fields";
import { ListImportPanel } from "../list-import-panel";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import { TrashView } from "../trash-view";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeItemInput,
  ChallengeSummary,
  CheckpointInput,
  Entry,
  GroupSummary,
  Id,
  ImportPreview,
} from "../types";
import {
  backLinkClass,
  Button,
  cardClass,
  ChallengeStatusBadge,
  cx,
  EmptyState,
  inputClass,
  labelClass,
  PageHeading,
  SchedulePeriodFields,
  StatusMessage,
} from "../ui";
import { formatRuntime, isChallengeScheduled, isLivingList, itemIdForEntry, recipeCatalogKind, valuesAsRecord } from "../utils";
import { AdminMetrics } from "./metrics";
import { DynamicEntryForm, ResultView } from "./participant-challenge";

/** A curation list that shows its first `preview` rows, the rest behind a toggle. */
function ShowMoreList<T>({
  items,
  preview,
  className,
  render,
}: {
  items: T[];
  preview: number;
  className?: string;
  render: (item: T, index: number) => ReactNode;
}) {
  const t = useTranslations("adminChallenge");
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, preview);
  return (
    <>
      <div className={className}>{shown.map((item, index) => render(item, index))}</div>
      {items.length > preview ? (
        <button
          type="button"
          className="mt-2 text-xs font-light text-[var(--muted)] transition hover:text-[var(--ink)]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("showLess") : t("showMoreItems", { count: items.length - preview })}
        </button>
      ) : null}
    </>
  );
}
export interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
}

interface PreflightIssue { code: string; severity: "error" | "warning"; message: string }
interface PreflightReport { ready: boolean; errors: PreflightIssue[]; warnings: PreflightIssue[] }

/**
 * The pre-activation review: blocking errors, soft "worth reviewing" notes, or
 * a clean bill of health. Re-fetches on demand so the admin can fix something
 * in another tab and check again.
 */
function PreflightPanel({ challengeId, onReady }: { challengeId: Id; onReady: (ready: boolean) => void }) {
  const t = useTranslations("preflight");
  const tCodes = useTranslations("preflight.codes");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    apiRequest<PreflightReport>(API_PATHS.preflight(challengeId), { signal: controller.signal })
      .then((data) => { setReport(data); onReady(data.ready); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : t("loadError"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [challengeId, onReady, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => load(), [load]);

  const label = (issue: PreflightIssue) => (tCodes.has(issue.code) ? tCodes(issue.code) : issue.message);

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-light">{t("title")}</h2>
        <button type="button" className="text-xs font-light text-[var(--muted)] hover:text-[var(--ink)] hover:underline" onClick={load} disabled={loading}>
          {loading ? t("checking") : t("recheck")}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {report ? (
        <div className="mt-4 space-y-4">
          {report.errors.length ? (
            <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-4">
              <p className="text-sm font-medium text-[var(--danger)]">{t("fixFirst", { count: report.errors.length })}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {report.errors.map((issue, index) => <li key={`${issue.code}-${index}`}>· {label(issue)}</li>)}
              </ul>
            </div>
          ) : null}
          {report.warnings.length ? (
            <div className="rounded-2xl border border-[var(--warn-line)]/50 bg-[var(--warn-soft)] p-4">
              <p className="text-sm font-medium text-[var(--warn-strong)]">{t("worthReviewing", { count: report.warnings.length })}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {report.warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>· {label(issue)}</li>)}
              </ul>
            </div>
          ) : null}
          {report.ready && !report.warnings.length ? (
            <p className="rounded-2xl border border-[var(--ok-line)]/40 bg-[var(--ok-soft)] p-4 text-sm font-medium text-[var(--ok-strong)]">{t("allReady")}</p>
          ) : null}
          {report.ready && report.warnings.length ? (
            <p className="text-xs text-[var(--muted)]">{t("readyWithWarnings")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AdminOverview({
  challenge,
  onSave,
  onTransition,
  onDuplicate,
  duplicateTargets,
  onDelete,
}: {
  challenge: ChallengeDetail;
  onSave: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const trules = useTranslations("rules");
  const f = useGoaFormat();
  const longDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const [title, setTitle] = useState(challenge.title);
  const [description, setDescription] = useState(challenge.description ?? "");
  const [ruleSections, setRuleSections] = useState(() => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle")));
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(
    challenge.startsOn && challenge.endsOn ? "period" : "none",
  );
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const [showOptional, setShowOptional] = useState(false);
  const hasOptionalContent = Boolean(description.trim()) || ruleSections.length > 0;
  const [duplicateTitle, setDuplicateTitle] = useState(challenge.title);
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [duplicateTargetGroupId, setDuplicateTargetGroupId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"activate" | "close" | "reopen" | "delete" | null>(null);
  const [preflightReady, setPreflightReady] = useState(false);
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode);
  const livingList = isLivingList(challenge);

  async function run(label: string, action: () => Promise<void>, successText: string) {
    setBusy(label);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successText);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(null);
    }
  }

  function saveBasics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scheduleMode === "period" && (!startsOn || !endsOn)) {
      setError(t("errPeriod"));
      return;
    }
    if (scheduleMode === "period" && endsOn < startsOn) {
      setError(t("errEndBeforeStart"));
      return;
    }
    void run("save", () => onSave({
      title: title.trim(),
      description: description.trim(),
      ruleSections: ruleSections.map((rule) => ({
        title: rule.title.trim(),
        description: rule.description.trim(),
        ...(rule.topics?.length
          ? { topics: rule.topics.map((topic) => ({ title: topic.title.trim(), description: topic.description.trim() })) }
          : {}),
      })),
      startsOn: scheduleMode === "period" ? startsOn : null,
      endsOn: scheduleMode === "period" ? endsOn : null,
    }), t("basicsSaved"));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <section>
        <h2 className="text-lg font-medium tracking-tight">{t("basicsTitle")}</h2>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveBasics}>
          <label className="sm:col-span-2"><span className={labelClass}>{t("titleLabel")}</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} disabled={challenge.status === "closed"} /></label>
          <fieldset className="sm:col-span-2" disabled={challenge.status === "closed"}>
            <legend className={labelClass}>{t("scheduleLegend")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button className={cx("min-h-14 rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60", scheduleMode === "period" ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)]")} type="button" aria-pressed={scheduleMode === "period"} onClick={() => setScheduleMode("period")}><strong className="block text-sm">{t("schedulePeriod")}</strong><span className="text-xs font-normal text-[var(--muted)]">{t("schedulePeriodHint")}</span></button>
              <button className={cx("min-h-14 rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60", scheduleMode === "none" ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)]")} type="button" aria-pressed={scheduleMode === "none"} onClick={() => setScheduleMode("none")}><strong className="block text-sm">{t("scheduleNone")}</strong><span className="text-xs font-normal text-[var(--muted)]">{t("scheduleNoneHint")}</span></button>
            </div>
            {challenge.status === "active" ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("scheduleActiveNote")}</p> : null}
          </fieldset>
          {scheduleMode === "period" ? (
            <SchedulePeriodFields startsOn={startsOn} endsOn={endsOn} onStartsOn={setStartsOn} onEndsOn={setEndsOn} disabled={challenge.status === "closed"} />
          ) : <p className="sm:col-span-2 rounded-xl bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{livingList ? t("livingListBody") : t("noPeriodNote")}</p>}
          <div className="sm:col-span-2">
            {showOptional ? (
              <div className="grid gap-4">
                <button type="button" className={cx(backLinkClass, "justify-self-start")} onClick={() => setShowOptional(false)}>{t("hideOptional")}</button>
                <label><span className={labelClass}>{t("descriptionLabel")}</span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={challenge.status === "closed"} /></label>
                <div><div className="mb-3"><span className={labelClass}>{t("rulesLabel")}</span><p className="text-xs leading-5 text-[var(--muted)]">{t("rulesHint")}</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} disabled={challenge.status === "closed"} /></div>
              </div>
            ) : (
              <button type="button" className={cx("min-h-11 rounded-xl border border-dashed border-[var(--line)] px-4 text-sm font-light text-[var(--muted)] hover:border-[var(--main-line)] hover:text-[var(--ink)]")} onClick={() => setShowOptional(true)}>{hasOptionalContent ? t("showOtherFields") : t("showOptional", { count: 2 })}</button>
            )}
          </div>
          {challenge.status !== "closed" ? <div className="sm:col-span-2"><Button type="submit" disabled={busy === "save"}>{busy === "save" ? tc("saving") : t("saveBasics")}</Button></div> : null}
        </form>
      </section>

      <section className="border-t border-[var(--line)] pt-10">
        <h2 className="text-lg font-medium tracking-tight">{t("reuseTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseBody")}</p>
        {duplicateTargets.length ? <form className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); if (!duplicateTargetGroupId) { setError(t("reusePickTarget")); return; } void run("duplicate", () => onDuplicate({ title: duplicateTitle.trim(), targetGroupId: duplicateTargetGroupId }), t("reuseDone")); }}>
          <label>
            <span className={labelClass}>{t("reuseTitleLabel")}</span>
            <input
              className={inputClass}
              value={duplicateTitle}
              onChange={(event) => setDuplicateTitle(event.target.value)}
              required
              maxLength={160} />
          </label>

          <label>
            <span className={labelClass}>{t("reuseTargetLabel")}</span>

            <select
              className={inputClass}
              value={duplicateTargetGroupId}
              onChange={(event) => setDuplicateTargetGroupId(event.target.value)}
              required
            >
              <option value="">{t("reuseTargetPlaceholder")}</option>

              {duplicateTargets.map((target) => {
                const full = target.challengeCount >= target.challengeLimit;

                return (
                  <option key={target.id} value={target.id} disabled={full}>
                    {t("reuseTargetOption", {
                      name: target.name,
                      count: target.challengeCount,
                      limit: target.challengeLimit,
                    })}
                    {full ? t("reuseTargetFull") : ""}
                  </option>
                );
              })}
            </select>
          </label>
            
          <div className="mb-1"><Button type="submit" variant="secondary" disabled={busy === "duplicate" || !duplicateTargetGroupId || !availableTargets.length}>{busy === "duplicate" ? t("reuseCreating") : t("reuseSubmit")}</Button></div>
        </form> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-5"><strong className="text-sm">{t("reuseNoneTitle")}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseNoneBody")}</p></div>}
      </section>
      

      {!livingList && challenge.status === "draft" ? (
        <PreflightPanel challengeId={challenge.id} onReady={setPreflightReady} />
      ) : null}

      {!livingList ? (
        <section className="border-t border-[var(--line)] pt-10">
          <h2 className="text-lg font-medium tracking-tight">{t("stateTitle")}</h2>
          <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-[var(--wash)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? t("stateDraft") : scheduled ? t("stateScheduled", { date: f.date(challenge.startsOn, longDate) }) : challenge.status === "active" ? t("stateActive") : t("stateClosed")}</p></div>
            {challenge.status === "draft" ? <Button disabled={Boolean(busy) || !preflightReady} onClick={() => setConfirm("activate")}>{t("activate")}</Button> : null}
            {challenge.status === "active" ? <Button variant="danger" disabled={Boolean(busy)} onClick={() => setConfirm("close")}>{t("close")}</Button> : null}
            {challenge.status === "closed" ? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirm("reopen")}>{t("reopen")}</Button> : null}
          </div>
        </section>
      ) : null}

      {onDelete ? (
        <section className="border-t border-[var(--line)] pt-10">
          <h2 className="text-lg font-medium tracking-tight">{t("deleteTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("deleteBody")}</p>
          <div className="mt-4"><Button variant="danger" disabled={Boolean(busy)} onClick={() => setConfirm("delete")}>{t("delete")}</Button></div>
        </section>
      ) : null}
      <StatusMessage error={error} success={success} />

      {confirm === "activate" ? (
        <ConfirmDialog title={t("activateTitle")} body={t("activateConfirm")} confirmLabel={t("activate")} busyLabel={tc("saving")}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await onTransition("active"); setConfirm(null); setSuccess(t("activated")); }} />
      ) : null}
      {confirm === "close" ? (
        <ConfirmDialog title={t("closeTitle")} body={t("closeConfirm")} confirmLabel={t("close")} busyLabel={tc("saving")} danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await onTransition("closed"); setConfirm(null); setSuccess(t("closedDone")); }} />
      ) : null}
      {confirm === "reopen" ? (
        <ConfirmDialog title={t("reopenTitle")} body={t("reopenConfirm")} confirmLabel={t("reopen")} busyLabel={tc("saving")}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await onTransition("active"); setConfirm(null); setSuccess(t("reopenedDone")); }} />
      ) : null}
      {confirm === "delete" && onDelete ? (
        <ConfirmDialog title={t("deleteTitle")} body={t("deleteConfirm", { title: challenge.title })} confirmLabel={t("delete")} busyLabel={t("deleting")} danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await onDelete(); setConfirm(null); setSuccess(t("deleteDone")); }} />
      ) : null}
    </div>
  );
}

function AdminParticipants({
  challenge,
  group,
  onSave,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  onSave: (participantIds: Id[]) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const f = useGoaFormat();
  const initial = challenge.participants.map((participant) => participant.userId ?? participant.id);
  const [selected, setSelected] = useState<Id[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title={t("participantsTitle")} description={t("participantsSubtitle")} />
      {group?.members?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{group.members.map((member) => { const checked = selected.includes(member.id); return <label className={cx("flex min-h-16 items-center gap-3 rounded-xl border bg-[var(--paper)] px-4", checked ? "border-[var(--main-line)]" : "border-[var(--line)]")} key={member.id}><input type="checkbox" aria-label={t("selectMember", { name: member.name })} checked={checked} disabled={challenge.status === "closed" || busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">{t("memberMeta", { username: member.username, role: tr(member.role) })}</small></span></label>; })}</div>
      ) : <EmptyState title={t("noMembersTitle")} description={t("noMembersBody")} />}
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      {challenge.status !== "closed" && group?.members?.length ? <Button className="mt-5" disabled={busy} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(selected).then(() => setSuccess(t("participantsSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setBusy(false)); }}>{busy ? tc("saving") : t("saveParticipants")}</Button> : null}
    </section>
  );
}

const VISIBILITY_POLICIES = ["group_realtime", "after_own", "after_close", "author_only"] as const;

function AdminFields({
  challenge,
  onSave,
  onSaveVisibility,
  onSetExpectation,
}: {
  challenge: ChallengeDetail;
  onSave: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tv = useTranslations("visibility");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const hasExpectation = challenge.entryTypes.some((type) => type.purpose === "expectation");
  const canToggleExpectation =
    challenge.status === "draft"
    && challenge.submissionMode === "item"
    && challenge.entryTypes.some((type) => type.purpose === "rating");
  const [expectationBusy, setExpectationBusy] = useState(false);
  const types = challenge.entryTypes.length
    ? challenge.entryTypes
    : [{ id: "", name: "", fields: challenge.fields } as ChallengeDetail["entryTypes"][number]];
  const [selectedTypeId, setSelectedTypeId] = useState(
    types.find((type) => type.isPrimary)?.id ?? types[0]?.id ?? "",
  );
  const activeType = types.find((type) => type.id === selectedTypeId) ?? types[0];
  const [fields, setFields] = useState(activeType?.fields ?? []);
  const [visibility, setVisibility] = useState<string>(activeType?.visibilityPolicy ?? "group_realtime");
  const [busy, setBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function pickType(id: Id) {
    setSelectedTypeId(id);
    const type = types.find((candidate) => candidate.id === id);
    setFields(type?.fields ?? []);
    setVisibility(type?.visibilityPolicy ?? "group_realtime");
    setError(null);
    setSuccess(null);
  }

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title={t("fieldsTitle")} description={challenge.status === "draft" ? t("fieldsHintDraft") : challenge.status === "active" ? t("fieldsHintActive") : t("fieldsHintClosed")} />
      {types.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1" role="tablist" aria-label={t("fieldsTypeLegend")}>
          {types.map((type) => (
            <button
              key={type.id}
              type="button"
              role="tab"
              aria-selected={type.id === selectedTypeId}
              className={cx("min-h-10 rounded-xl px-4 text-sm font-light", type.id === selectedTypeId ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}
              onClick={() => pickType(type.id)}
            >
              {type.name}
            </button>
          ))}
        </div>
      ) : null}
      <FieldBuilder key={selectedTypeId} fields={fields} onChange={setFields} lockPersistedTypes={challenge.status !== "draft"} />
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      <Button className="mt-5" disabled={busy || challenge.status === "closed"} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(selectedTypeId, cleanFields(fields)).then(() => setSuccess(t("fieldsSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setBusy(false)); }}>{busy ? tc("saving") : t("saveFields")}</Button>

      {selectedTypeId && challenge.status !== "closed" ? (
        <div className="mt-7 border-t border-[var(--line)] pt-5">
          <h3 className="text-sm font-medium">{tv("title")}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{tv("hint")}</p>
          <label className="mt-3 block">
            <span className="sr-only">{tv("title")}</span>
            <select
              className={inputClass}
              value={visibility}
              onChange={(event) => {
                const next = event.target.value;
                setVisibility(next);
                setVisibilityBusy(true);
                setError(null);
                onSaveVisibility(selectedTypeId, next)
                  .then(() => setSuccess(tv("saved")))
                  .catch((cause: unknown) => { setError(f.error(cause)); setVisibility(activeType?.visibilityPolicy ?? "group_realtime"); })
                  .finally(() => setVisibilityBusy(false));
              }}
              disabled={visibilityBusy}
            >
              {VISIBILITY_POLICIES.map((policy) => (
                <option key={policy} value={policy}>{tv(`policy.${policy}`)}</option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-[var(--muted)]">{tv(`explain.${visibility}`)}</p>
        </div>
      ) : null}

      {canToggleExpectation || hasExpectation ? (
        <div className="mt-7 border-t border-[var(--line)] pt-5">
          <h3 className="text-sm font-medium">{t("expectationTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("expectationHint")}</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasExpectation}
              disabled={expectationBusy || !canToggleExpectation}
              onChange={(event) => {
                const next = event.target.checked;
                setExpectationBusy(true);
                setError(null);
                onSetExpectation(next)
                  .then(() => setSuccess(next ? t("expectationOn") : t("expectationOff")))
                  .catch((cause: unknown) => setError(f.error(cause)))
                  .finally(() => setExpectationBusy(false));
              }}
            />
            {t("expectationCheckbox")}
          </label>
          {!canToggleExpectation && hasExpectation ? (
            <p className="mt-2 text-xs text-[var(--muted)]">{t("expectationLockedNote")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AdminItems({
  challenge,
  group,
  entries,
  onAdd,
  onUpdate,
  onArchive,
  onPreviewImport,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  entries: Entry[];
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: {
    title: string; description: string; recommendedByUserId?: string | null;
    author?: string; year?: number | null; mainGenre?: string; pageCount?: number | null; runtimeMinutes?: number | null;
  }) => Promise<void>;
  onArchive: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const members = group?.members ?? [];
  const catalogKind = recipeCatalogKind(challenge.recipeKey) === "book" ? "book" : "film";
  const [newItemRows, setNewItemRows] = useState<CineRow[]>([]);
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const datedDaily = challenge.submissionMode === "daily" && !undatedDaily;
  const canAddItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const canArchiveItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editRecommendedBy, setEditRecommendedBy] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editPages, setEditPages] = useState("");
  const [editRuntimeMinutes, setEditRuntimeMinutes] = useState("");
  const [editMainGenre, setEditMainGenre] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ChallengeItem | null>(null);
  const editLabel = challenge.submissionMode === "daily" ? t("editCheckpoint") : t("editItem");

  async function archive(item: ChallengeItem) {
    setError(null);
    setSuccess(null);
    await onArchive(item.id);
    setArchiving(null);
    setSuccess(t("itemRemoved"));
  }

  function startEditing(item: ChallengeItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditRecommendedBy(item.recommendedBy?.id ?? "");
    setEditAuthor(item.catalogItem?.author ?? "");
    setEditYear(item.catalogItem?.year ? String(item.catalogItem.year) : "");
    setEditPages(item.catalogItem?.pageCount ? String(item.catalogItem.pageCount) : "");
    setEditRuntimeMinutes(item.catalogItem?.runtimeMinutes ? String(item.catalogItem.runtimeMinutes) : "");
    setEditMainGenre(item.catalogItem?.mainGenre ?? "");
    setEditError(null);
    setEditSuccess(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, itemId: Id, hasCatalogItem: boolean) {
    event.preventDefault();
    if (hasCatalogItem && catalogKind === "book" && !editAuthor.trim()) {
      setEditError(tCine("authorRequired"));
      return;
    }
    setEditBusy(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      const year = Number(editYear);
      const pages = Number(editPages);
      const runtimeMinutes = Number(editRuntimeMinutes);
      await onUpdate(itemId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        ...(challenge.submissionMode === "item" ? { recommendedByUserId: editRecommendedBy || null } : {}),
        ...(hasCatalogItem ? {
          year: Number.isInteger(year) && year > 0 ? year : null,
          mainGenre: editMainGenre.trim(),
          ...(catalogKind === "book"
            ? { author: editAuthor.trim(), pageCount: Number.isInteger(pages) && pages > 0 ? pages : null }
            : { runtimeMinutes: Number.isInteger(runtimeMinutes) && runtimeMinutes > 0 ? runtimeMinutes : null }),
        } : {}),
      });
      setEditingId(null);
      setEditSuccess(challenge.submissionMode === "daily" ? t("checkpointUpdated") : t("itemUpdated"));
    } catch (cause) {
      setEditError(f.error(cause));
    } finally {
      setEditBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      if (challenge.submissionMode === "daily") {
        await onAdd({ generate: { frequency: "daily", startsOn, endsOn } });
        setSuccess(t("dailyGenerated"));
      } else {
        const items = cineRowsToInput(newItemRows);
        if (!items.length) { setError(t("errNoItem")); setBusy(false); return; }
        if (catalogKind === "book" && newItemRows.some((row) => row.title.trim() && !row.author.trim())) {
          setError(tCine("authorRequired")); setBusy(false); return;
        }
        await onAdd({ items });
        setNewItemRows([]);
        setSuccess(t("itemsAdded"));
      }
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("itemsTitle")} description={undatedDaily ? t("itemsHintUndatedDaily") : datedDaily ? t("itemsHintDatedDaily") : challenge.status === "closed" ? t("itemsHintClosed") : t("itemsHintDefault")} />
        {editSuccess ? <div className="mb-3"><StatusMessage success={editSuccess} /></div> : null}
        {challenge.items.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {[...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((item, index) => (
              <li className="py-4" key={item.id}>
                {editingId === item.id ? (
                  <form className="grid gap-3" onSubmit={(event) => void submitEdit(event, item.id, Boolean(item.catalogItem))}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <strong className="text-sm">{editLabel}</strong>
                    </div>
                    <label><span className={labelClass}>{t("itemTitleLabel")}</span><input className={inputClass} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} /></label>
                    <label><span className={labelClass}>{t("itemDescriptionLabel")}</span><textarea className={inputClass} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} placeholder={t("itemDescriptionPlaceholder")} /></label>
                    {challenge.submissionMode === "item" && members.length ? <label><span className={labelClass}>{t("itemRecommendedBy")}</span><select className={inputClass} value={editRecommendedBy} onChange={(event) => setEditRecommendedBy(event.target.value)}><option value="">{t("itemRecommendedByNone")}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label> : null}
                    {item.catalogItem && catalogKind === "book" ? (
                      <label><span className={labelClass}>{tCine("author")}</span><input className={cx(inputClass, editAuthor.trim() ? "" : "border-[var(--danger)]")} value={editAuthor} maxLength={200} placeholder={tCine("authorPlaceholder")} onChange={(event) => setEditAuthor(event.target.value)} /></label>
                    ) : null}
                    {item.catalogItem ? (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label><span className={labelClass}>{tCine(catalogKind === "film" ? "latestYear" : "year")}</span><input className={inputClass} type="number" inputMode="numeric" min={1870} max={2200} value={editYear} onChange={(event) => setEditYear(event.target.value)} /></label>
                        {catalogKind === "book"
                          ? <label><span className={labelClass}>{tCine("pages")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={editPages} onChange={(event) => setEditPages(event.target.value)} /></label>
                          : <label><span className={labelClass}>{tCine("runtimeMinutes")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={2000} value={editRuntimeMinutes} placeholder={tCine("runtimeMinutesPlaceholder")} onChange={(event) => setEditRuntimeMinutes(event.target.value)} /></label>}
                        <label><span className={labelClass}>{tCine("mainGenre")}</span><input className={inputClass} value={editMainGenre} maxLength={80} placeholder={tCine("mainGenrePlaceholder")} onChange={(event) => setEditMainGenre(event.target.value)} /></label>
                      </div>
                    ) : null}
                    <StatusMessage error={editError} />
                    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={editBusy}>{editBusy ? tc("saving") : tc("save")}</Button><Button variant="ghost" disabled={editBusy} onClick={() => { setEditingId(null); setEditError(null); }}>{tc("cancel")}</Button></div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <span className="min-w-0"><strong className="block text-sm">{item.title}{item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}</strong>{item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}{item.recommendedBy || item.catalogItem?.author || item.catalogItem?.mainGenre || item.catalogItem?.runtimeMinutes ? <small className="mt-1 block text-[var(--muted)]">{[item.catalogItem?.author ? tCine("byAuthor", { name: item.catalogItem.author }) : null, item.recommendedBy ? t("itemRecommendedByLine", { name: item.recommendedBy.name }) : null, item.catalogItem?.mainGenre || null, formatRuntime(item.catalogItem?.runtimeMinutes)].filter(Boolean).join(" · ")}</small> : null}{item.date || item.opensAt || item.dueAt ? <small className="mt-1 block text-[var(--muted)]">{item.date ? f.date(item.date) : t("itemWindow", { opens: f.date(item.opensAt), due: f.date(item.dueAt) })}</small> : null}</span>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-2"><span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light text-[var(--muted)]">{f.itemStatusLabel(item.status)}</span>{challenge.status !== "closed" ? <div className="flex gap-2"><Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" onClick={() => startEditing(item)}>{t("edit")}</Button>{canArchiveItems ? <button type="button" className="min-h-9 px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => { setError(null); setArchiving(item); }}>{t("remove")}</button> : null}</div> : null}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : undatedDaily
          ? <EmptyState title={t("noItemsUndatedTitle")} description={t("noItemsUndatedBody")} />
          : <EmptyState title={t("noItemsTitle")} description={t("noItemsBody")} />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-light">{undatedDaily ? t("asideUndated") : datedDaily ? t("asideDatedDaily") : t("asideItems")}</h2>
        {challenge.submissionMode === "free" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("freeModeNote")}</p>
          : undatedDaily ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("undatedAsideNote")}</p>
          : datedDaily && challenge.status === "active" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("datedDailyActiveNote")}</p>
          : challenge.submissionMode === "item" && challenge.status === "closed" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("itemClosedNote")}</p>
          : <form className="mt-4 space-y-4" onSubmit={submit}>
          {challenge.submissionMode === "daily" ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><label><span className={labelClass}>{t("firstDay")}</span><input className={inputClass} type="date" value={startsOn} readOnly required /></label><label><span className={labelClass}>{t("lastDay")}</span><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></label></> : <><CineItemsEditor value={newItemRows} onChange={setNewItemRows} members={members} catalogPath={group ? API_PATHS.groupCatalog(group.id) : API_PATHS.personalCatalog} kind={catalogKind} />{challenge.status === "active" ? <p className="text-xs leading-5 text-[var(--muted)]">{t("activeItemsNote")}</p> : null}</>}
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy || (challenge.submissionMode === "daily" ? challenge.status !== "draft" : !canAddItems || !newItemRows.length)}>{busy ? tc("saving") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : t("add")}</Button>
        </form>}
        {challenge.submissionMode === "item" && challenge.status !== "closed" ? (
          <div className="mt-5">
            <ListImportPanel
              onPreview={onPreviewImport}
              onCommit={(items: ChallengeItemInput[]) => onAdd({ items })}
            />
          </div>
        ) : null}
      </aside>

      {archiving ? (
        <ConfirmDialog
          title={challenge.submissionMode === "daily" ? t("editCheckpoint") : t("remove")}
          body={entries.filter((entry) => itemIdForEntry(entry) === archiving.id).length > 0
            ? t("itemRemoveConfirmWithEntries", { title: archiving.title, count: entries.filter((entry) => itemIdForEntry(entry) === archiving.id).length })
            : t("itemRemoveConfirm", { title: archiving.title })}
          confirmLabel={t("remove")}
          busyLabel={t("removing")}
          danger
          onClose={() => setArchiving(null)}
          onConfirm={() => archive(archiving)}
        />
      ) : null}
    </div>
  );
}

function AdminReview({
  challenge,
  entries,
  onPatch,
  onDelete,
  onExport,
  csrfToken,
  onArchiveChanged,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDelete: (entryId: Id, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
  csrfToken: string;
  onArchiveChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [query, setQuery] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = entries.filter((entry) => {
    const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
    const haystack = `${entry.participantName ?? ""} ${entry.participantUsername ?? ""} ${item?.title ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!lateOnly || entry.isLate);
  });
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedItem = challenge.items.find((item) => item.id === (selected ? itemIdForEntry(selected) : null)) ?? null;
  const selectedFields = (selected?.entryTypeId
    && challenge.entryTypes.find((type) => type.id === selected.entryTypeId)?.fields)
    || challenge.fields;
  const expected = challenge.items.length * challenge.participants.length;
  const doneCount = challenge.completionEntryTypeId
    ? entries.filter((entry) => entry.entryTypeId === challenge.completionEntryTypeId).length
    : entries.length;

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("reviewTitle")} description={t("reviewSummary", { sent: entries.length, pending: Math.max(0, expected - doneCount), late: entries.filter((entry) => entry.isLate).length })} action={<Button variant="secondary" disabled={exporting} onClick={() => { setExporting(true); setError(null); onExport().catch((cause: unknown) => setError(f.error(cause))).finally(() => setExporting(false)); }}>{exporting ? t("preparing") : t("exportCsv")}</Button>} />
        <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label><span className="sr-only">{t("searchEntries")}</span><input className={inputClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} /></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm font-medium"><input type="checkbox" checked={lateOnly} onChange={(event) => setLateOnly(event.target.checked)} />{t("lateOnly")}</label>
        </div>
        <StatusMessage error={error} />
        {filtered.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => {
              const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
              const values = valuesAsRecord(entry.values);
              const type = challenge.entryTypes.find((candidate) => candidate.id === entry.entryTypeId);
              const entryFields = type?.fields ?? challenge.fields;
              return (
                <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3"><div><strong className="block">{entry.participantName ?? entry.participantUsername ?? t("participantFallback")}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{[item?.title ?? t("freeEntry"), type && challenge.entryTypes.length > 1 ? type.name : null, f.dateTime(entry.submittedAt ?? entry.updatedAt)].filter(Boolean).join(" · ")}</span></div>{entry.isLate ? <span className="rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-light text-[var(--warn)]">{t("late")}</span> : null}</div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">{entryFields.slice(0, 4).map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light text-[var(--muted)]">{field.label}</dt><dd className="mt-1 truncate text-sm font-medium">{typeof values[field.id] === "boolean" ? values[field.id] ? tc("yes") : tc("no") : String(values[field.id])}</dd></div> : null)}</dl>
                  <Button className="mt-4 w-full" variant="secondary" onClick={() => { setSelectedId(entry.id); setReason(""); }}>{t("inspect")}</Button>
                </article>
              );
            })}
          </div>
        ) : <EmptyState title={t("noEntriesTitle")} description={entries.length ? t("noEntriesFiltered") : t("noEntriesEmpty")} />}
      </section>

      {selected ? (
        <section className={cx(cardClass, "p-5 sm:p-7")} aria-labelledby="correction-title">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-light text-[var(--muted)]">{t("correctionKicker")}</p><h2 id="correction-title" className="mt-1 text-xl font-light">{t("correctionHeading", { name: selected.participantName ?? t("participantFallback"), item: selectedItem?.title ?? t("entryFallback") })}</h2></div><Button variant="ghost" onClick={() => setSelectedId(null)}>{tc("close")}</Button></div>
          <label className="mb-5 block"><span className={labelClass}>{t("reasonLabel")} <span className="text-[var(--main-2)]">*</span></span><textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("reasonPlaceholder")} maxLength={500} disabled={challenge.status === "closed"} /></label>
          <DynamicEntryForm key={`${selected.id}-${selected.updatedAt ?? ""}`} fields={selectedFields} item={selectedItem} entry={selected} canEdit={challenge.status !== "closed"} unavailableMessage={challenge.status === "closed" ? f.entryUnavailableMessage({ challengeStatus: "closed" }) : null} onSave={async (values) => { if (!reason.trim()) throw new Error(t("reasonRequired")); await onPatch(selected.id, values, reason.trim()); setReason(""); }} alwaysEditable />
          {challenge.status !== "closed" ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
              <p className="text-sm text-[var(--muted)]">{t("deleteEntryHint")}</p>
              <Button variant="danger" disabled={confirmDelete} onClick={() => {
                if (!reason.trim()) { setError(t("deleteEntryReasonRequired")); return; }
                setError(null); setConfirmDelete(true);
              }}>{t("deleteEntry")}</Button>
            </div>
          ) : null}
          <div className="mt-4"><StatusMessage error={error} /></div>
        </section>
      ) : null}

      {selected && confirmDelete ? (
        <ConfirmDialog title={t("deleteEntry")} body={t("deleteEntryConfirm")} confirmLabel={t("deleteEntry")} busyLabel={t("deletingEntry")} danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await onDelete(selected.id, reason.trim()); setReason(""); setSelectedId(null); setConfirmDelete(false); }} />
      ) : null}

      <section className={cx(cardClass, "p-5 sm:p-7")} aria-labelledby="removed-structure-title">
        <h2 id="removed-structure-title" className="text-xl font-light">{t("removedStructureTitle")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("removedStructureBody")}</p>
        <div className="mt-4">
          <TrashView scope={{ challengeId: challenge.id }} csrfToken={csrfToken} onChanged={onArchiveChanged} />
        </div>
      </section>
    </div>
  );
}

interface CuratedCommentCandidate {
  key: string;
  entryId: Id;
  fieldId: Id;
  authorName: string;
  itemTitle: string;
  text: string;
}

function AdminResults({
  challenge,
  entries,
  onSave,
  onPublish,
  onUnpublish,
  onReorderBlocks,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<{ unpublished?: boolean } | undefined>;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublish: () => Promise<void>;
  onReorderBlocks: (blocks: Array<{ id: Id; visible: boolean }>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const linkRef = useRef<HTMLInputElement>(null);
  const [headline, setHeadline] = useState(challenge.result?.headline ?? "");
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [anonymize, setAnonymize] = useState(challenge.resultsAnon === true);
  const [includeRankings, setIncludeRankings] = useState((challenge.result?.personalRankings?.length ?? 0) > 0 || !challenge.result);
  const [includeAffinity, setIncludeAffinity] = useState(Boolean(challenge.result?.affinity?.pairs.length) || !challenge.result);
  const [blockOrder, setBlockOrder] = useState(
    [...(challenge.result?.blocks ?? [])].sort((a, b) => a.position - b.position).map((block) => ({ id: block.id, visible: block.visible })),
  );
  const [orderBusy, setOrderBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const blockLabelById = useMemo(() => {
    const map = new Map<Id, string>();
    for (const block of challenge.result?.blocks ?? []) {
      map.set(block.id,
        block.kind === "text" ? (block.heading === "headline" ? t("blockHeadline") : t("blockSummary"))
        : block.kind === "metric" ? (block.metric?.label ?? t("blockMetric"))
        : block.kind === "ranking" ? t("includeRankings")
        : block.kind === "affinity" ? t("includeAffinity")
        : block.kind === "entry_value" ? t("blockComment")
        : block.kind);
    }
    return map;
  }, [challenge.result?.blocks, t]);
  const textFields = challenge.fields.filter((field) => field.id && field.type === "text");
  const candidates = useMemo(() => {
    const result: CuratedCommentCandidate[] = [];
    for (const entry of entries) {
      const values = valuesAsRecord(entry.values);
      for (const field of textFields) {
        if (!field.id || typeof values[field.id] !== "string" || !String(values[field.id]).trim()) continue;
        const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
        result.push({ key: `${entry.id}:${field.id}`, entryId: entry.id, fieldId: field.id, authorName: entry.participantName ?? t("participantFallback"), itemTitle: item?.title ?? t("entryFallback"), text: String(values[field.id]).trim() });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.items, entries, textFields]);

  const isClosed = challenge.status === "closed";
  const isPublished = Boolean(challenge.result?.publishedAt);
  // The link is durable now (migration 0035): build it from the stored token,
  // falling back to the one this session just minted. A round published before
  // 0035 has no stored token — the admin rotates once to get a fresh link.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const storedUrl = challenge.result?.shareToken && origin
    ? `${origin}/results/${encodeURIComponent(challenge.result.shareToken)}`
    : null;
  const publicUrl = publishedUrl ?? storedUrl;
  const linkOnlyOnce = isPublished && !publicUrl;

  function savedMessage(result: { unpublished?: boolean } | undefined, base: string) {
    if (result?.unpublished) return t("draftSavedUnpublishedAnon");
    return isPublished ? t("draftSavedRepublishHint") : base;
  }

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
        anonymizeParticipants: anonymize,
        includeRankings,
        includeAffinity,
      });
      setSuccess(savedMessage(result, t("resultsSaved")));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await onSave({ regenerate: true, anonymizeParticipants: anonymize });
      setSuccess(savedMessage(result, t("showcaseRegenerated")));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  const [confirm, setConfirm] = useState<"publish" | "rotate" | "unpublish" | null>(null);

  async function doPublish(rotateLink: boolean) {
    setError(null); setSuccess(null);
    const result = await onPublish(rotateLink ? { rotateLink: true } : {});
    setPublishedUrl(result?.url ?? null);
    setCopyState("idle");
    setConfirm(null);
    setSuccess(rotateLink ? t("linkRotated") : t("showcasePublished"));
  }

  async function doUnpublish() {
    setError(null); setSuccess(null);
    await onUnpublish();
    setPublishedUrl(null);
    setConfirm(null);
    setSuccess(t("showcaseUnpublished"));
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await copyText(publicUrl, linkRef.current);
      setCopyState("done");
    } catch { setCopyState("failed"); }
  }

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("publishTitle")} description={t("publishSubtitle")} />
        <div className="rounded-2xl bg-[var(--wash)] p-4 text-sm">
          {isPublished ? (
            <p>
              <strong>{t("publishedOn", { date: f.dateTime(challenge.result?.publishedAt) })}</strong>
              {" · "}
              {challenge.resultsAnon ? t("publishStateAnon") : t("publishStateNamed")}
            </p>
          ) : (
            <p className="text-[var(--muted)]">{isClosed ? t("notPublished") : t("publishNeedsClose")}</p>
          )}
          {isPublished && publicUrl ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input ref={linkRef} className={cx(inputClass, "sm:flex-1")} readOnly value={publicUrl} onFocus={(event) => event.target.select()} aria-label={t("publicLinkLabel")} />
              <Button variant="secondary" disabled={busy} onClick={() => void copyLink()}>
                {copyState === "done" ? t("linkCopied") : copyState === "failed" ? t("copyFailed") : t("copyLink")}
              </Button>
            </div>
          ) : null}
          {linkOnlyOnce ? <p className="mt-3 text-xs text-[var(--muted)]">{t("linkNotStored")}</p> : null}
        </div>
        {isClosed ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => setConfirm("publish")}>{isPublished ? t("republishShowcase") : t("publishShowcase")}</Button>
            {isPublished ? <Button variant="secondary" disabled={busy} onClick={() => setConfirm("rotate")}>{t("rotateLink")}</Button> : null}
            {isPublished ? <Button variant="danger" disabled={busy} onClick={() => setConfirm("unpublish")}>{t("unpublish")}</Button> : null}
          </div>
        ) : null}
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("publishHint")}</p>
      </section>

      {confirm === "publish" ? (
        <ConfirmDialog title={isPublished ? t("republishShowcase") : t("publishShowcase")} body={anonymize ? t("publishConfirmAnon") : t("publishConfirmNoAnon")}
          confirmLabel={isPublished ? t("republishShowcase") : t("publishShowcase")} onClose={() => setConfirm(null)} onConfirm={() => doPublish(false)} />
      ) : null}
      {confirm === "rotate" ? (
        <ConfirmDialog title={t("rotateLink")} body={t("rotateLinkConfirm")} confirmLabel={t("rotateLink")} danger
          onClose={() => setConfirm(null)} onConfirm={() => doPublish(true)} />
      ) : null}
      {confirm === "unpublish" ? (
        <ConfirmDialog title={t("unpublish")} body={t("unpublishConfirm")} confirmLabel={t("unpublish")} danger
          onClose={() => setConfirm(null)} onConfirm={() => doUnpublish()} />
      ) : null}

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("resultsTitle")} description={t("resultsSubtitle")} />
        <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className={labelClass}>{t("headlineLabel")}</span><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={180} placeholder={challenge.title} /></label><label className="sm:col-span-2"><span className={labelClass}>{t("summaryLabel")}</span><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></label></div>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("highlightMetrics")}</legend>{challenge.metrics.length ? <div className="mt-3"><ShowMoreList items={challenge.metrics} preview={6} className="grid gap-2 sm:grid-cols-2" render={(metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={t("highlightMetricAria", { label: metric.label })} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? t("metricNoValue")}</small></span></label>} /></div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("createMetricsFirst")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("selectedComments")}</legend><p className="mt-2 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{t("commentPrivacyWarning")}</p>{candidates.length ? <div className="mt-3"><ShowMoreList items={candidates} preview={4} className="grid gap-2 sm:grid-cols-2" render={(candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={t("selectCommentAria", { author: candidate.authorName })} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>} /></div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("noTextFields")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("wrappedBlocks")}</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm"><input type="checkbox" aria-label={t("includeRankings")} checked={includeRankings} onChange={(event) => setIncludeRankings(event.target.checked)} /><span>{t("includeRankings")}</span></label>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm"><input type="checkbox" aria-label={t("includeAffinity")} checked={includeAffinity} onChange={(event) => setIncludeAffinity(event.target.checked)} /><span>{t("includeAffinity")}</span></label>
          </div>
        </fieldset>
        <label className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm"><input className="mt-0.5" type="checkbox" aria-label={t("anonymizeParticipants")} checked={anonymize} onChange={(event) => setAnonymize(event.target.checked)} /><span><strong className="block">{t("anonymizeParticipants")}</strong><small className="text-[var(--muted)]">{t("anonymizeHint")}</small></span></label>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveDraft")}</Button><Button variant="secondary" disabled={busy} onClick={() => void regenerate()}>{t("regenerateDraft")}</Button></div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("regenerateHint")}</p>
      </section>

      {blockOrder.length ? (
        <section className={cx(cardClass, "p-5 sm:p-7")}>
          <PageHeading title={t("blockOrderTitle")} description={t("blockOrderSubtitle")} />
          <ShowMoreList
            items={blockOrder}
            preview={8}
            className="space-y-2"
            render={(entry, index) => (
              <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm" key={entry.id}>
                <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
                <span className={cx("min-w-0 flex-1 truncate", !entry.visible && "text-[var(--muted)] line-through")}>{blockLabelById.get(entry.id) ?? entry.id}</span>
                <label className="flex flex-none items-center gap-1.5 text-xs"><input type="checkbox" aria-label={t("blockVisible")} checked={entry.visible} onChange={(event) => setBlockOrder((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, visible: event.target.checked } : item))} />{t("blockVisible")}</label>
                <Button variant="ghost" className="px-2" disabled={index === 0} onClick={() => setBlockOrder((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑<span className="sr-only">{t("blockUp")}</span></Button>
                <Button variant="ghost" className="px-2" disabled={index === blockOrder.length - 1} onClick={() => setBlockOrder((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓<span className="sr-only">{t("blockDown")}</span></Button>
              </div>
            )}
          />
          <Button className="mt-4" disabled={orderBusy} onClick={() => { setOrderBusy(true); setError(null); onReorderBlocks(blockOrder).then(() => setSuccess(t("blockOrderSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setOrderBusy(false)); }}>{orderBusy ? tc("saving") : t("blockOrderSave")}</Button>
        </section>
      ) : null}

      {challenge.result || challenge.status === "closed" ? <section><PageHeading title={t("previewTitle")} description={t("previewSubtitle")} /><ResultView challenge={challenge} /></section> : <EmptyState title={t("previewEmptyTitle")} description={t("previewEmptyBody")} />}
    </div>
  );
}

export function AdminScreen({
  challenge,
  entries,
  group,
  tab,
  onTab,
  onBack,
  onViewParticipant,
  onSaveBasics,
  onTransition,
  onDuplicate,
  duplicateTargets,
  onDelete,
  onSaveParticipants,
  onSaveFields,
  onSaveEntryTypeVisibility,
  onSetExpectation,
  onAddItems,
  onUpdateItem,
  onArchiveItem,
  onPreviewImport,
  onSaveCheckpoints,
  onAssignCheckpointItems,
  onPatchEntry,
  onDeleteEntry,
  onExport,
  onAddMetric,
  onUpdateMetric,
  onDeleteMetric,
  onSaveResult,
  onPublishResult,
  onUnpublishResult,
  onReorderBlocks,
  csrfToken,
  onArchiveChanged,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  onViewParticipant: () => void;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveEntryTypeVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: {
    title: string; description: string; recommendedByUserId?: string | null;
    author?: string; year?: number | null; mainGenre?: string; pageCount?: number | null; runtimeMinutes?: number | null;
  }) => Promise<void>;
  onArchiveItem: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssignCheckpointItems: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position?: number }>) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDeleteEntry: (entryId: Id, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateMetric: (metricId: Id, payload: Record<string, unknown>) => Promise<void>;
  onDeleteMetric: (metricId: Id) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<{ unpublished?: boolean } | undefined>;
  onPublishResult: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublishResult: () => Promise<void>;
  onReorderBlocks: (blocks: Array<{ id: Id; visible: boolean }>) => Promise<void>;
  csrfToken: string;
  onArchiveChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  // The checkpoint planner is for round-item challenges organised into
  // weeks/sessions — a day-by-day round derives its checkpoints from the period.
  const showCheckpoints = challenge.submissionMode === "item";
  // A personal challenge has exactly one participant (the owner) — there is
  // nothing to manage on a "Pessoas" tab.
  const isPersonal = challenge.scope === "personal";
  const tabs: AdminTab[] = [
    "overview",
    ...(isPersonal ? [] : (["participants"] as const)),
    "fields", "items",
    ...(showCheckpoints ? (["checkpoints"] as const) : []),
    "review", "metrics", "results",
  ];
  const activeTab = tabs.includes(tab) ? tab : "overview";
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("back")}</button><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onViewParticipant}>{t("simulateAsParticipant")}</Button></div></div>
      <PageHeading title={challenge.title} description={t("subtitle")} action={<ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label={t("tabsAria")}>{tabs.map((id) => <button className={cx("min-h-11 flex-none rounded-xl px-4 text-sm font-light", activeTab === id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(id)} key={id}>{t(`tabs.${id}`)}</button>)}</nav>
      {activeTab === "overview" ? <AdminOverview challenge={challenge} onSave={onSaveBasics} onTransition={onTransition} onDuplicate={onDuplicate} duplicateTargets={duplicateTargets} onDelete={onDelete} /> : null}
      {activeTab === "participants" ? <AdminParticipants key={`${challenge.id}:${challenge.participants.map((participant) => participant.userId ?? participant.id).join(",")}`} challenge={challenge} group={group} onSave={onSaveParticipants} /> : null}
      {activeTab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.visibilityPolicy}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} onSaveVisibility={onSaveEntryTypeVisibility} onSetExpectation={onSetExpectation} /> : null}
      {activeTab === "items" ? <AdminItems challenge={challenge} group={group} entries={entries} onAdd={onAddItems} onUpdate={onUpdateItem} onArchive={onArchiveItem} onPreviewImport={onPreviewImport} /> : null}
      {activeTab === "checkpoints" ? <CheckpointPlanner key={`${challenge.id}:${challenge.checkpoints.map((cp) => cp.id).join(",")}`} challenge={challenge} onSaveCheckpoints={onSaveCheckpoints} onAssign={onAssignCheckpointItems} /> : null}
      {activeTab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onDelete={onDeleteEntry} onExport={onExport} csrfToken={csrfToken} onArchiveChanged={onArchiveChanged} /> : null}
      {activeTab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} onUpdate={onUpdateMetric} onDelete={onDeleteMetric} /> : null}
      {activeTab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} onPublish={onPublishResult} onUnpublish={onUnpublishResult} onReorderBlocks={onReorderBlocks} /> : null}
    </main>
  );
}
