"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";

import { useGoaFormat } from "../format";
import { cleanFields, FieldBuilder } from "../fields";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeSummary,
  Entry,
  GroupSummary,
  Id,
  Metric,
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
import { isChallengeScheduled, itemIdForEntry, valuesAsRecord } from "../utils";
import { DynamicEntryForm, ResultView } from "./participant-challenge";

const METRIC_OPERATIONS: Metric["operation"][] = ["sum", "average", "count", "min", "max", "completion_rate"];
const METRIC_GROUP_BY: NonNullable<Metric["groupBy"]>[] = ["none", "participant", "item"];

export interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
}

function AdminOverview({
  challenge,
  entries,
  onSave,
  onTransition,
  onDuplicate,
  duplicateTargets,
  onDelete,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
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
  const [meetingUrl, setMeetingUrl] = useState(challenge.meetingUrl ?? "");
  const [ruleSections, setRuleSections] = useState(() => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle")));
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(
    challenge.startsOn && challenge.endsOn ? "period" : "none",
  );
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const [duplicateTitle, setDuplicateTitle] = useState(challenge.title);
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [duplicateTargetGroupId, setDuplicateTargetGroupId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const expected = challenge.items.length * challenge.participants.length;
  const missing = Math.max(0, expected - entries.length);
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn);

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
    if (meetingUrl.trim() && !/^https:\/\/\S+$/u.test(meetingUrl.trim())) {
      setError(t("errMeetingUrl"));
      return;
    }
    void run("save", () => onSave({
      title: title.trim(),
      description: description.trim(),
      meetingUrl: meetingUrl.trim() || null,
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

  const stats: Array<{ key: "participants" | "checkpoints" | "entries" | "pending"; value: number }> = [
    { key: "participants", value: challenge.participants.length },
    { key: "checkpoints", value: challenge.items.length },
    { key: "entries", value: entries.length },
    { key: "pending", value: missing },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => <article className={cx(cardClass, "p-5")} key={stat.key}><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{t(`stat.${stat.key}`)}</p><strong className="mt-2 block text-4xl tracking-[-0.05em]">{stat.value}</strong></article>)}
      </div>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("basicsTitle")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{challenge.status === "closed" ? t("basicsHintClosed") : t("basicsHintOpen")}</p>
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
          ) : <p className="sm:col-span-2 rounded-xl bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{t("noPeriodNote")}</p>}
          <label className="sm:col-span-2"><span className={labelClass}>{t("descriptionLabel")}</span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={challenge.status === "closed"} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>{t("meetingLabel")}</span><input className={inputClass} type="url" inputMode="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} maxLength={2000} placeholder="https://meet.example.com/…" disabled={challenge.status === "closed"} /><small className="mt-1 block text-xs text-[var(--muted)]">{t("meetingHint")}</small></label>
          <div className="sm:col-span-2"><div className="mb-3"><span className={labelClass}>{t("rulesLabel")}</span><p className="text-xs leading-5 text-[var(--muted)]">{t("rulesHint")}</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} disabled={challenge.status === "closed"} /></div>
          {challenge.status !== "closed" ? <div className="sm:col-span-2"><Button type="submit" disabled={busy === "save"}>{busy === "save" ? tc("saving") : t("saveBasics")}</Button></div> : null}
        </form>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("stateTitle")}</h2>
        <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-[var(--wash)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} /><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? t("stateDraft") : scheduled ? t("stateScheduled", { date: f.date(challenge.startsOn, longDate) }) : challenge.status === "active" ? t("stateActive") : t("stateClosed")}</p></div>
          {challenge.status === "draft" ? <Button disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("activateConfirm"))) void run("transition", () => onTransition("active"), t("activated")); }}>{t("activate")}</Button> : null}
          {challenge.status === "active" ? <Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("closeConfirm"))) void run("transition", () => onTransition("closed"), t("closedDone")); }}>{t("close")}</Button> : null}
        </div>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("reuseTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseBody")}</p>
        {duplicateTargets.length ? <form className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (!duplicateTargetGroupId) { setError(t("reusePickTarget")); return; } void run("duplicate", () => onDuplicate({ title: duplicateTitle.trim(), targetGroupId: duplicateTargetGroupId }), t("reuseDone")); }}>
          <label><span className={labelClass}>{t("reuseTitleLabel")}</span><input className={inputClass} value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.target.value)} required maxLength={160} /></label>
          <label><span className={labelClass}>{t("reuseTargetLabel")}</span><select className={inputClass} value={duplicateTargetGroupId} onChange={(event) => setDuplicateTargetGroupId(event.target.value)} required><option value="">{t("reuseTargetPlaceholder")}</option>{duplicateTargets.map((target) => { const full = target.challengeCount >= target.challengeLimit; return <option value={target.id} disabled={full} key={target.id}>{t("reuseTargetOption", { name: target.name, count: target.challengeCount, limit: target.challengeLimit })}{full ? t("reuseTargetFull") : ""}</option>; })}</select></label>
          <div className="flex items-end"><Button type="submit" variant="secondary" disabled={busy === "duplicate" || !duplicateTargetGroupId || !availableTargets.length}>{busy === "duplicate" ? t("reuseCreating") : t("reuseSubmit")}</Button></div>
        </form> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-5"><strong className="text-sm">{t("reuseNoneTitle")}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseNoneBody")}</p></div>}
      </section>

      {onDelete ? (
        <section className={cx(cardClass, "p-5 sm:p-7")}>
          <h2 className="text-xl font-light">{t("deleteTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("deleteBody")}</p>
          <div className="mt-4"><Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("deleteConfirm", { title: challenge.title }))) void run("delete", onDelete, t("deleteDone")); }}>{t("delete")}</Button></div>
        </section>
      ) : null}
      <StatusMessage error={error} success={success} />
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

function AdminFields({
  challenge,
  onSave,
}: {
  challenge: ChallengeDetail;
  onSave: (fields: ChallengeField[]) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [fields, setFields] = useState(challenge.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title={t("fieldsTitle")} description={challenge.status === "draft" ? t("fieldsHintDraft") : challenge.status === "active" ? t("fieldsHintActive") : t("fieldsHintClosed")} />
      <FieldBuilder fields={fields} onChange={setFields} lockPersistedTypes={challenge.status !== "draft"} />
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      <Button className="mt-5" disabled={busy || challenge.status === "closed"} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(cleanFields(fields)).then(() => setSuccess(t("fieldsSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setBusy(false)); }}>{busy ? tc("saving") : t("saveFields")}</Button>
    </section>
  );
}

function AdminItems({
  challenge,
  onAdd,
  onUpdate,
  onArchive,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
  onArchive: (itemId: Id) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [itemsText, setItemsText] = useState("");
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const datedDaily = challenge.submissionMode === "daily" && !undatedDaily;
  const canAddItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const canArchiveItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<Id | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const editLabel = challenge.submissionMode === "daily" ? t("editCheckpoint") : t("editItem");

  async function archive(item: ChallengeItem) {
    if (!window.confirm(t("itemRemoveConfirm", { title: item.title }))) return;
    setArchivingId(item.id);
    setError(null);
    setSuccess(null);
    try {
      await onArchive(item.id);
      setSuccess(t("itemRemoved"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setArchivingId(null);
    }
  }

  function startEditing(item: ChallengeItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditError(null);
    setEditSuccess(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, itemId: Id) {
    event.preventDefault();
    setEditBusy(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      await onUpdate(itemId, { title: editTitle.trim(), description: editDescription.trim() });
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
    const titles = itemsText.split("\n").map((item) => item.trim()).filter(Boolean);
    if (challenge.submissionMode !== "daily" && !titles.length) { setError(t("errNoItem")); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd(challenge.submissionMode === "daily"
        ? { generate: { frequency: "daily", startsOn, endsOn } }
        : { items: titles.map((title) => ({ title })) });
      setItemsText("");
      setSuccess(challenge.submissionMode === "daily" ? t("dailyGenerated") : t("itemsAdded"));
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
                  <form className="grid gap-3" onSubmit={(event) => void submitEdit(event, item.id)}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <strong className="text-sm">{editLabel}</strong>
                    </div>
                    <label><span className={labelClass}>{t("itemTitleLabel")}</span><input className={inputClass} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} /></label>
                    <label><span className={labelClass}>{t("itemDescriptionLabel")}</span><textarea className={inputClass} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} placeholder={t("itemDescriptionPlaceholder")} /></label>
                    <StatusMessage error={editError} />
                    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={editBusy}>{editBusy ? tc("saving") : tc("save")}</Button><Button variant="ghost" disabled={editBusy} onClick={() => { setEditingId(null); setEditError(null); }}>{tc("cancel")}</Button></div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-xs font-light text-[var(--muted)]">{index + 1}</span>
                      <span className="min-w-0"><strong className="block text-sm">{item.title}</strong>{item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}<small className="mt-1 block text-[var(--muted)]">{item.date ? f.date(item.date) : item.opensAt || item.dueAt ? t("itemWindow", { opens: f.date(item.opensAt), due: f.date(item.dueAt) }) : t("itemNoWindow")}</small></span>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-2"><span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light uppercase text-[var(--muted)]">{f.itemStatusLabel(item.status)}</span>{challenge.status !== "closed" ? <div className="flex gap-2"><Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" onClick={() => startEditing(item)}>{t("edit")}</Button>{canArchiveItems ? <Button variant="danger" className="min-h-9 px-3 py-1 text-xs" disabled={archivingId === item.id} onClick={() => void archive(item)}>{archivingId === item.id ? t("removing") : t("remove")}</Button> : null}</div> : null}</div>
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
          {challenge.submissionMode === "daily" ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><label><span className={labelClass}>{t("firstDay")}</span><input className={inputClass} type="date" value={startsOn} readOnly required /></label><label><span className={labelClass}>{t("lastDay")}</span><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></label></> : <><label><span className={labelClass}>{t("oneTitlePerLine")}</span><textarea className={inputClass} rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={t("itemsTextPlaceholder")} /></label>{challenge.status === "active" ? <p className="text-xs leading-5 text-[var(--muted)]">{t("activeItemsNote")}</p> : null}</>}
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy || (challenge.submissionMode === "daily" ? challenge.status !== "draft" : !canAddItems)}>{busy ? tc("saving") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : t("add")}</Button>
        </form>}
      </aside>
    </div>
  );
}

function AdminReview({
  challenge,
  entries,
  onPatch,
  onExport,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [query, setQuery] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = entries.filter((entry) => {
    const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
    const haystack = `${entry.participantName ?? ""} ${entry.participantUsername ?? ""} ${item?.title ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!lateOnly || entry.isLate);
  });
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedItem = challenge.items.find((item) => item.id === (selected ? itemIdForEntry(selected) : null)) ?? null;
  const expected = challenge.items.length * challenge.participants.length;

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("reviewTitle")} description={t("reviewSummary", { sent: entries.length, pending: Math.max(0, expected - entries.length), late: entries.filter((entry) => entry.isLate).length })} action={<Button variant="secondary" disabled={exporting} onClick={() => { setExporting(true); setError(null); onExport().catch((cause: unknown) => setError(f.error(cause))).finally(() => setExporting(false)); }}>{exporting ? t("preparing") : t("exportCsv")}</Button>} />
        <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label><span className="sr-only">{t("searchEntries")}</span><input className={inputClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} /></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm font-semibold"><input type="checkbox" checked={lateOnly} onChange={(event) => setLateOnly(event.target.checked)} />{t("lateOnly")}</label>
        </div>
        <StatusMessage error={error} />
        {filtered.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => {
              const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
              const values = valuesAsRecord(entry.values);
              return (
                <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3"><div><strong className="block">{entry.participantName ?? entry.participantUsername ?? t("participantFallback")}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{item?.title ?? t("freeEntry")} · {f.dateTime(entry.submittedAt ?? entry.updatedAt)}</span></div>{entry.isLate ? <span className="rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-light uppercase text-[var(--warn)]">{t("late")}</span> : null}</div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">{challenge.fields.slice(0, 4).map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 truncate text-sm font-semibold">{typeof values[field.id] === "boolean" ? values[field.id] ? tc("yes") : tc("no") : String(values[field.id])}</dd></div> : null)}</dl>
                  <Button className="mt-4 w-full" variant="secondary" onClick={() => { setSelectedId(entry.id); setReason(""); }}>{t("inspect")}</Button>
                </article>
              );
            })}
          </div>
        ) : <EmptyState title={t("noEntriesTitle")} description={entries.length ? t("noEntriesFiltered") : t("noEntriesEmpty")} />}
      </section>

      {selected ? (
        <section className={cx(cardClass, "p-5 sm:p-7")} aria-labelledby="correction-title">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{t("correctionKicker")}</p><h2 id="correction-title" className="mt-1 text-xl font-light">{t("correctionHeading", { name: selected.participantName ?? t("participantFallback"), item: selectedItem?.title ?? t("entryFallback") })}</h2></div><Button variant="ghost" onClick={() => setSelectedId(null)}>{tc("close")}</Button></div>
          <label className="mb-5 block"><span className={labelClass}>{t("reasonLabel")} <span className="text-[var(--main-2)]">*</span></span><textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("reasonPlaceholder")} maxLength={500} disabled={challenge.status === "closed"} /></label>
          <DynamicEntryForm key={`${selected.id}-${selected.updatedAt ?? ""}`} fields={challenge.fields} item={selectedItem} entry={selected} canEdit={challenge.status !== "closed"} unavailableMessage={challenge.status === "closed" ? f.entryUnavailableMessage({ challengeStatus: "closed" }) : null} onSave={async (values) => { if (!reason.trim()) throw new Error(t("reasonRequired")); await onPatch(selected.id, values, reason.trim()); setReason(""); }} />
        </section>
      ) : null}
    </div>
  );
}

function AdminMetrics({
  challenge,
  onAdd,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tm = useTranslations("metrics");
  const f = useGoaFormat();
  const [label, setLabel] = useState("");
  const [operation, setOperation] = useState<Metric["operation"]>("average");
  const [fieldId, setFieldId] = useState("");
  const [groupBy, setGroupBy] = useState<Metric["groupBy"]>("none");
  const [visibleDuring, setVisibleDuring] = useState(true);
  const [visibleInResults, setVisibleInResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const needsNumericField = ["sum", "average", "min", "max"].includes(operation);
  const selectableFields = challenge.fields.filter((field) => !needsNumericField || field.type === "number" || field.type === "rating");
  const needsField = operation !== "count" && operation !== "completion_rate";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsField && !fieldId) { setError(t("errPickField")); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd({ label: label.trim(), operation, fieldId: needsField ? fieldId : null, groupBy, visibleDuring, visibleInResults });
      setLabel("");
      setSuccess(t("metricAdded"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <PageHeading title={t("metricsTitle")} description={t("metricsSubtitle")} />
        {challenge.metrics.length ? <div className="grid gap-3 sm:grid-cols-2">{challenge.metrics.map((metric) => <article className={cx(cardClass, "p-5")} key={metric.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{tm(`operationName.${metric.operation}`)}</p><h3 className="mt-1 font-light">{metric.label}</h3></div><strong className="text-2xl tracking-[-0.04em]">{metric.formattedValue ?? metric.value ?? "—"}</strong></div><div className="mt-4 flex flex-wrap gap-2 text-[10px] font-light uppercase text-[var(--muted)]">{metric.visibleDuring ? <span className="rounded-full bg-[var(--ok-soft)] px-2 py-1">{t("metricDuring")}</span> : null}{metric.visibleInResults ? <span className="rounded-full bg-[var(--main-soft)] px-2 py-1">{t("metricInResults")}</span> : null}{metric.groupBy && metric.groupBy !== "none" ? <span className="rounded-full bg-[var(--wash)] px-2 py-1">{t("metricGroupedBy", { groupBy: tm(`groupByShort.${metric.groupBy}`) })}</span> : null}</div></article>)}</div> : <EmptyState title={t("noMetricsTitle")} description={t("noMetricsBody")} />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-light">{t("addMetric")}</h2>
        {challenge.status === "closed" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("metricsClosedNote")}</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          <label><span className={labelClass}>{t("metricNameLabel")}</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("metricNamePlaceholder")} required maxLength={100} /></label>
          <label><span className={labelClass}>{t("metricOperationLabel")}</span><select className={inputClass} value={operation} onChange={(event) => { const next = event.target.value as Metric["operation"]; setOperation(next); setFieldId(""); }}>{METRIC_OPERATIONS.map((op) => <option value={op} key={op}>{tm(`operationName.${op}`)}</option>)}</select></label>
          {needsField ? <label><span className={labelClass}>{t("metricFieldLabel")}</span><select className={inputClass} value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">{t("metricFieldPlaceholder")}</option>{selectableFields.filter((field) => field.id).map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label> : null}
          <label><span className={labelClass}>{t("metricGroupByLabel")}</span><select className={inputClass} value={groupBy} onChange={(event) => setGroupBy(event.target.value as Metric["groupBy"])}>{METRIC_GROUP_BY.map((value) => <option value={value} key={value}>{tm(`groupBy.${value}`)}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleDuring} onChange={(event) => setVisibleDuring(event.target.checked)} />{t("metricVisibleDuring")}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleInResults} onChange={(event) => setVisibleInResults(event.target.checked)} />{t("metricVisibleResults")}</label>
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? t("calculating") : t("addMetric")}</Button>
        </form>}
      </aside>
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
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [headline, setHeadline] = useState(challenge.result?.headline ?? challenge.title);
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
      });
      setSuccess(t("resultsSaved"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("resultsTitle")} description={t("resultsSubtitle")} />
        <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className={labelClass}>{t("headlineLabel")}</span><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={180} /></label><label className="sm:col-span-2"><span className={labelClass}>{t("summaryLabel")}</span><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></label></div>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("highlightMetrics")}</legend>{challenge.metrics.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{challenge.metrics.map((metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={t("highlightMetricAria", { label: metric.label })} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? t("metricNoValue")}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("createMetricsFirst")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("selectedComments")}</legend>{candidates.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{candidates.map((candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={t("selectCommentAria", { author: candidate.authorName })} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("noTextFields")}</p>}</fieldset>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <Button className="mt-5" disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveResults")}</Button>
      </section>
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
  onAddItems,
  onUpdateItem,
  onArchiveItem,
  onPatchEntry,
  onExport,
  onAddMetric,
  onSaveResult,
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
  onSaveFields: (fields: ChallengeField[]) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
  onArchiveItem: (itemId: Id) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const tabs: AdminTab[] = ["overview", "participants", "fields", "items", "review", "metrics", "results"];
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("back", { group: group?.name ?? tc("home") })}</button><div className="flex flex-wrap gap-2">{challenge.meetingUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)] px-4 text-sm font-light text-[var(--main-strong)] hover:opacity-90" href={challenge.meetingUrl} target="_blank" rel="noreferrer">{t("joinMeeting")}</a> : null}<Button variant="secondary" onClick={onViewParticipant}>{t("viewAsParticipant")}</Button></div></div>
      <PageHeading title={challenge.title} description={t("subtitle")} action={<ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} />} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label={t("tabsAria")}>{tabs.map((id) => <button className={cx("min-h-11 flex-none rounded-xl px-4 text-sm font-light", tab === id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(id)} key={id}>{t(`tabs.${id}`)}</button>)}</nav>
      {tab === "overview" ? <AdminOverview challenge={challenge} entries={entries} onSave={onSaveBasics} onTransition={onTransition} onDuplicate={onDuplicate} duplicateTargets={duplicateTargets} onDelete={onDelete} /> : null}
      {tab === "participants" ? <AdminParticipants key={`${challenge.id}:${challenge.participants.map((participant) => participant.userId ?? participant.id).join(",")}`} challenge={challenge} group={group} onSave={onSaveParticipants} /> : null}
      {tab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.fields.map((field) => field.id ?? field.key).join(",")}`} challenge={challenge} onSave={onSaveFields} /> : null}
      {tab === "items" ? <AdminItems challenge={challenge} onAdd={onAddItems} onUpdate={onUpdateItem} onArchive={onArchiveItem} /> : null}
      {tab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onExport={onExport} /> : null}
      {tab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} /> : null}
      {tab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} /> : null}
    </main>
  );
}
