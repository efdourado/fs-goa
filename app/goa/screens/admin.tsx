"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useRef, useState } from "react";

import { API_PATHS } from "../api";
import { useGoaFormat } from "../format";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { copyText } from "../clipboard";
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
import { isChallengeScheduled, isLivingList, itemIdForEntry, recipeCatalogKind, valuesAsRecord } from "../utils";
import { DynamicEntryForm, ResultView } from "./participant-challenge";

const METRIC_OPERATIONS: Metric["operation"][] = [
  "sum", "average", "count", "min", "max", "completion_rate",
  "bayesian_average", "spread", "surprise", "indicator_bias",
];
const METRIC_GROUP_BY: NonNullable<Metric["groupBy"]>[] = ["none", "participant", "item"];

export interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
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
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("basicsTitle")}</h2>
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

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-light">{t("reuseTitle")}</h2>
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
      

      {!livingList ? (
        <section className={cx(cardClass, "p-5 sm:p-7")}>
          <h2 className="text-xl font-light">{t("stateTitle")}</h2>
          <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-[var(--wash)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} /><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? t("stateDraft") : scheduled ? t("stateScheduled", { date: f.date(challenge.startsOn, longDate) }) : challenge.status === "active" ? t("stateActive") : t("stateClosed")}</p></div>
            {challenge.status === "draft" ? <Button disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("activateConfirm"))) void run("transition", () => onTransition("active"), t("activated")); }}>{t("activate")}</Button> : null}
            {challenge.status === "active" ? <Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("closeConfirm"))) void run("transition", () => onTransition("closed"), t("closedDone")); }}>{t("close")}</Button> : null}
            {challenge.status === "closed" ? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("reopenConfirm"))) void run("transition", () => onTransition("active"), t("reopenedDone")); }}>{t("reopen")}</Button> : null}
          </div>
        </section>
      ) : null}
      
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
  onSave: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const types = challenge.entryTypes.length
    ? challenge.entryTypes
    : [{ id: "", name: "", fields: challenge.fields } as ChallengeDetail["entryTypes"][number]];
  const [selectedTypeId, setSelectedTypeId] = useState(
    types.find((type) => type.isPrimary)?.id ?? types[0]?.id ?? "",
  );
  const activeType = types.find((type) => type.id === selectedTypeId) ?? types[0];
  const [fields, setFields] = useState(activeType?.fields ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function pickType(id: Id) {
    setSelectedTypeId(id);
    setFields(types.find((type) => type.id === id)?.fields ?? []);
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
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  entries: Entry[];
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: {
    title: string; description: string; recommendedByUserId?: string | null;
    author?: string; year?: number | null; mainGenre?: string; pageCount?: number | null;
  }) => Promise<void>;
  onArchive: (itemId: Id) => Promise<void>;
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
  const [archivingId, setArchivingId] = useState<Id | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editRecommendedBy, setEditRecommendedBy] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editPages, setEditPages] = useState("");
  const [editMainGenre, setEditMainGenre] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const editLabel = challenge.submissionMode === "daily" ? t("editCheckpoint") : t("editItem");

  async function archive(item: ChallengeItem) {
    const entryCount = entries.filter((entry) => itemIdForEntry(entry) === item.id).length;
    const confirmMessage = entryCount > 0
      ? t("itemRemoveConfirmWithEntries", { title: item.title, count: entryCount })
      : t("itemRemoveConfirm", { title: item.title });
    if (!window.confirm(confirmMessage)) return;
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
    setEditRecommendedBy(item.recommendedBy?.id ?? "");
    setEditAuthor(item.catalogItem?.author ?? "");
    setEditYear(item.catalogItem?.year ? String(item.catalogItem.year) : "");
    setEditPages(item.catalogItem?.pageCount ? String(item.catalogItem.pageCount) : "");
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
      await onUpdate(itemId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        ...(challenge.submissionMode === "item" ? { recommendedByUserId: editRecommendedBy || null } : {}),
        ...(hasCatalogItem ? {
          year: Number.isInteger(year) && year > 0 ? year : null,
          mainGenre: editMainGenre.trim(),
          ...(catalogKind === "book"
            ? { author: editAuthor.trim(), pageCount: Number.isInteger(pages) && pages > 0 ? pages : null }
            : {}),
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
                          : null}
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
                      <span className="min-w-0"><strong className="block text-sm">{item.title}</strong>{item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}{item.recommendedBy || item.catalogItem?.author || item.catalogItem?.year || item.catalogItem?.mainGenre ? <small className="mt-1 block text-[var(--muted)]">{[item.catalogItem?.author ? tCine("byAuthor", { name: item.catalogItem.author }) : null, item.recommendedBy ? t("itemRecommendedByLine", { name: item.recommendedBy.name }) : null, item.catalogItem?.year ? String(item.catalogItem.year) : null, item.catalogItem?.mainGenre || null].filter(Boolean).join(" · ")}</small> : null}{item.date || item.opensAt || item.dueAt ? <small className="mt-1 block text-[var(--muted)]">{item.date ? f.date(item.date) : t("itemWindow", { opens: f.date(item.opensAt), due: f.date(item.dueAt) })}</small> : null}</span>
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
          {challenge.submissionMode === "daily" ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><label><span className={labelClass}>{t("firstDay")}</span><input className={inputClass} type="date" value={startsOn} readOnly required /></label><label><span className={labelClass}>{t("lastDay")}</span><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></label></> : <><CineItemsEditor value={newItemRows} onChange={setNewItemRows} members={members} catalogPath={group ? API_PATHS.groupCatalog(group.id) : API_PATHS.personalCatalog} kind={catalogKind} />{challenge.status === "active" ? <p className="text-xs leading-5 text-[var(--muted)]">{t("activeItemsNote")}</p> : null}</>}
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy || (challenge.submissionMode === "daily" ? challenge.status !== "draft" : !canAddItems || !newItemRows.length)}>{busy ? tc("saving") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : t("add")}</Button>
        </form>}
      </aside>
    </div>
  );
}

function AdminReview({
  challenge,
  entries,
  onPatch,
  onDelete,
  onExport,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDelete: (entryId: Id) => Promise<void>;
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
  const [deleting, setDeleting] = useState(false);
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
                  <div className="flex items-start justify-between gap-3"><div><strong className="block">{entry.participantName ?? entry.participantUsername ?? t("participantFallback")}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{[item?.title ?? t("freeEntry"), type && challenge.entryTypes.length > 1 ? type.name : null, f.dateTime(entry.submittedAt ?? entry.updatedAt)].filter(Boolean).join(" · ")}</span></div>{entry.isLate ? <span className="rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-light uppercase text-[var(--warn)]">{t("late")}</span> : null}</div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">{entryFields.slice(0, 4).map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-[var(--wash)] px-3 py-2" key={field.id}><dt className="text-[10px] font-light uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 truncate text-sm font-medium">{typeof values[field.id] === "boolean" ? values[field.id] ? tc("yes") : tc("no") : String(values[field.id])}</dd></div> : null)}</dl>
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
          <DynamicEntryForm key={`${selected.id}-${selected.updatedAt ?? ""}`} fields={selectedFields} item={selectedItem} entry={selected} canEdit={challenge.status !== "closed"} unavailableMessage={challenge.status === "closed" ? f.entryUnavailableMessage({ challengeStatus: "closed" }) : null} onSave={async (values) => { if (!reason.trim()) throw new Error(t("reasonRequired")); await onPatch(selected.id, values, reason.trim()); setReason(""); }} />
          {challenge.status !== "closed" ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
              <p className="text-sm text-[var(--muted)]">{t("deleteEntryHint")}</p>
              <Button variant="danger" disabled={deleting} onClick={async () => {
                if (!window.confirm(t("deleteEntryConfirm"))) return;
                setDeleting(true); setError(null);
                try { await onDelete(selected.id); setSelectedId(null); }
                catch (cause) { setError(f.error(cause)); }
                finally { setDeleting(false); }
              }}>{deleting ? t("deletingEntry") : t("deleteEntry")}</Button>
            </div>
          ) : null}
          <div className="mt-4"><StatusMessage error={error} /></div>
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
        {challenge.metrics.length ? <div className="grid gap-3 sm:grid-cols-2">{challenge.metrics.map((metric) => <article className={cx(cardClass, "p-5")} key={metric.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-light uppercase tracking-[0.1em] text-[var(--muted)]">{tm(`operationName.${metric.operation}`)}</p><h3 className="mt-1 font-light">{metric.label}</h3></div><strong className="text-2xl tracking-[-0.04em]">{metric.series?.length ? "" : metric.formattedValue ?? metric.value ?? "—"}</strong></div>{metric.series?.length ? <ol className="mt-3 space-y-1 text-sm">{metric.series.slice(0, 8).map((row, index) => <li key={row.key} className={cx("flex items-center justify-between gap-2", row.value === null && "opacity-45")}><span className="truncate"><span className="mr-2 tabular-nums text-[var(--muted)]">{index + 1}</span>{row.label}</span><span className="flex-none tabular-nums font-medium">{row.value === null ? tm("smallSample") : row.formattedValue ?? row.value}<span className="ml-1.5 text-[10px] font-light text-[var(--muted)]">n={row.sampleSize}</span></span></li>)}</ol> : null}<div className="mt-4 flex flex-wrap gap-2 text-[10px] font-light uppercase text-[var(--muted)]">{metric.visibleDuring ? <span className="rounded-full bg-[var(--ok-soft)] px-2 py-1">{t("metricDuring")}</span> : null}{metric.visibleInResults ? <span className="rounded-full bg-[var(--main-soft)] px-2 py-1">{t("metricInResults")}</span> : null}{metric.groupBy && metric.groupBy !== "none" ? <span className="rounded-full bg-[var(--wash)] px-2 py-1">{t("metricGroupedBy", { groupBy: tm(`groupByShort.${metric.groupBy}`) })}</span> : null}</div></article>)}</div> : <EmptyState title={t("noMetricsTitle")} description={t("noMetricsBody")} />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-light">{t("addMetric")}</h2>
        {challenge.status === "closed" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("metricsClosedNote")}</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          <label><span className={labelClass}>{t("metricNameLabel")}</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("metricNamePlaceholder")} required maxLength={100} /></label>
          <label><span className={labelClass}>{t("metricOperationLabel")}</span><select className={inputClass} value={operation} onChange={(event) => { const next = event.target.value as Metric["operation"]; setOperation(next); setFieldId(""); }}>{METRIC_OPERATIONS.map((op) => <option value={op} key={op}>{tm(`operationName.${op}`)}</option>)}</select></label>
          {needsField ? <label><span className={labelClass}>{t("metricFieldLabel")}</span><select className={inputClass} value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">{t("metricFieldPlaceholder")}</option>{selectableFields.filter((field) => field.id).map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label> : null}
          <label><span className={labelClass}>{t("metricGroupByLabel")}</span><select className={inputClass} value={groupBy} onChange={(event) => setGroupBy(event.target.value as Metric["groupBy"])}>{METRIC_GROUP_BY.map((value) => <option value={value} key={value}>{tm(`groupBy.${value}`)}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={visibleDuring} onChange={(event) => setVisibleDuring(event.target.checked)} />{t("metricVisibleDuring")}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={visibleInResults} onChange={(event) => setVisibleInResults(event.target.checked)} />{t("metricVisibleResults")}</label>
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
  onPublish,
  onUnpublish,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const linkRef = useRef<HTMLInputElement>(null);
  const [headline, setHeadline] = useState(challenge.result?.headline ?? challenge.title);
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [anonymize, setAnonymize] = useState(challenge.resultsAnon === true);
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

  const isClosed = challenge.status === "closed";
  const isPublished = Boolean(challenge.result?.publishedAt);
  const publicUrl =
    publishedUrl
    ?? (challenge.result?.shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/results/${challenge.result.shareToken}`
      : null);

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
        anonymizeParticipants: anonymize,
      });
      setSuccess(isPublished ? t("draftSavedRepublishHint") : t("resultsSaved"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({ regenerate: true, anonymizeParticipants: anonymize });
      setSuccess(isPublished ? t("draftSavedRepublishHint") : t("showcaseRegenerated"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function publish(rotateLink: boolean) {
    const confirmText = rotateLink
      ? t("rotateLinkConfirm")
      : anonymize ? t("publishConfirmAnon") : t("publishConfirmNoAnon");
    if (!window.confirm(confirmText)) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await onPublish(rotateLink ? { rotateLink: true } : {});
      if (result?.url) setPublishedUrl(result.url);
      setCopyState("idle");
      setSuccess(rotateLink ? t("linkRotated") : t("showcasePublished"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function unpublish() {
    if (!window.confirm(t("unpublishConfirm"))) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onUnpublish();
      setPublishedUrl(null);
      setSuccess(t("showcaseUnpublished"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
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
        </div>
        {isClosed ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void publish(false)}>{isPublished ? t("republishShowcase") : t("publishShowcase")}</Button>
            {isPublished ? <Button variant="secondary" disabled={busy} onClick={() => void publish(true)}>{t("rotateLink")}</Button> : null}
            {isPublished ? <Button variant="danger" disabled={busy} onClick={() => void unpublish()}>{t("unpublish")}</Button> : null}
          </div>
        ) : null}
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("publishHint")}</p>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title={t("resultsTitle")} description={t("resultsSubtitle")} />
        <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className={labelClass}>{t("headlineLabel")}</span><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={180} /></label><label className="sm:col-span-2"><span className={labelClass}>{t("summaryLabel")}</span><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></label></div>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("highlightMetrics")}</legend>{challenge.metrics.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{challenge.metrics.map((metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={t("highlightMetricAria", { label: metric.label })} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? t("metricNoValue")}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("createMetricsFirst")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("selectedComments")}</legend>{candidates.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{candidates.map((candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={t("selectCommentAria", { author: candidate.authorName })} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("noTextFields")}</p>}</fieldset>
        <label className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm"><input className="mt-0.5" type="checkbox" aria-label={t("anonymizeParticipants")} checked={anonymize} onChange={(event) => setAnonymize(event.target.checked)} /><span><strong className="block">{t("anonymizeParticipants")}</strong><small className="text-[var(--muted)]">{t("anonymizeHint")}</small></span></label>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveDraft")}</Button><Button variant="secondary" disabled={busy} onClick={() => void regenerate()}>{t("regenerateDraft")}</Button></div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("regenerateHint")}</p>
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
  onDeleteEntry,
  onExport,
  onAddMetric,
  onSaveResult,
  onPublishResult,
  onUnpublishResult,
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
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: {
    title: string; description: string; recommendedByUserId?: string | null;
    year?: number | null; mainGenre?: string; pageCount?: number | null;
  }) => Promise<void>;
  onArchiveItem: (itemId: Id) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDeleteEntry: (entryId: Id) => Promise<void>;
  onExport: () => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<void>;
  onPublishResult: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublishResult: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const tabs: AdminTab[] = ["overview", "participants", "fields", "items", "review", "metrics", "results"];
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className={backLinkClass} type="button" onClick={onBack}>{t("back", { group: group?.name ?? tc("home") })}</button><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onViewParticipant}>{t("simulateAsParticipant")}</Button></div></div>
      <PageHeading title={challenge.title} description={t("subtitle")} action={<ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label={t("tabsAria")}>{tabs.map((id) => <button className={cx("min-h-11 flex-none rounded-xl px-4 text-sm font-light", tab === id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(id)} key={id}>{t(`tabs.${id}`)}</button>)}</nav>
      {tab === "overview" ? <AdminOverview challenge={challenge} onSave={onSaveBasics} onTransition={onTransition} onDuplicate={onDuplicate} duplicateTargets={duplicateTargets} onDelete={onDelete} /> : null}
      {tab === "participants" ? <AdminParticipants key={`${challenge.id}:${challenge.participants.map((participant) => participant.userId ?? participant.id).join(",")}`} challenge={challenge} group={group} onSave={onSaveParticipants} /> : null}
      {tab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} /> : null}
      {tab === "items" ? <AdminItems challenge={challenge} group={group} entries={entries} onAdd={onAddItems} onUpdate={onUpdateItem} onArchive={onArchiveItem} /> : null}
      {tab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onDelete={onDeleteEntry} onExport={onExport} /> : null}
      {tab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} /> : null}
      {tab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} onPublish={onPublishResult} onUnpublish={onUnpublishResult} /> : null}
    </main>
  );
}
