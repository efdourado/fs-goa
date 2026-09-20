"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { CheckpointPlanner } from "../checkpoint-planner";
import { useGoaFormat } from "../format";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { ConfirmDialog, FormDialog } from "../dialog";
import { AddSharedResponseDialog, RemoveResponseDialog, SharedGlyph, SharedResponsePanel } from "../shared-responses";
import { cleanFields, FIELD_TYPES, FieldConfigInputs, newFieldConfig, uniqueFieldKey } from "../fields";
import { LibraryPropertiesDialog } from "../library-dialogs";
import { type CatalogScope, LibraryGlyph, LibraryPills, libraryChoices, useCatalogLibraries, useLibraryName } from "../libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, propertiesHaveProblem, useLibraryProperties, valuesFromItem } from "../property-inputs";
import { ListImportPanel } from "../list-import-panel";
import { recommenderBody, recommenderLine, RecommenderPicker, recommenderFromItem, type RecommenderValue, sameRecommender, useRecommenderSource } from "../recommender-picker";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import { ChallengeActions, type CopyMode } from "./challenge-actions";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeItemInput,
  CatalogLibrary,
  ChallengeLibraryRef,
  ChallengeSummary,
  CheckpointInput,
  CopyResult,
  Entry,
  GroupSummary,
  Id,
  ImportPreview,
  Member,
  SharedEditPolicy,
} from "../types";
import {
  BackButton,
  Button,
  ChallengeStatusBadge,
  CommentText,
  cx,
  Disclosure,
  EmptyState,
  Field,
  inputClass,
  PageHeading,
  SchedulePeriodFields,
  SelectableCards,
  StatusMessage,
  Toggle,
} from "../ui";
import { formatRuntime, isLivingList, itemIdForEntry, valuesAsRecord } from "../utils";
import { AdminMetrics } from "./metrics";

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
          className="mt-2 cursor-pointer text-xs font-light text-[var(--muted)] transition hover:text-[var(--ink)]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("showLess") : t("showMoreItems", { count: items.length - preview })}
        </button>
      ) : null}
    </>
  );
}
interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
}

/** Basic details form. Lifecycle + publication live in the "Challenge state" dialog. */
function AdminOverview({
  challenge,
  onSave,
}: {
  challenge: ChallengeDetail;
  onSave: (payload: Partial<ChallengeSummary>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const trules = useTranslations("rules");
  const f = useGoaFormat();
  const [title, setTitle] = useState(challenge.title);
  const [description, setDescription] = useState(challenge.description ?? "");
  const [ruleSections, setRuleSections] = useState(() => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle")));
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(
    challenge.startsOn && challenge.endsOn ? "period" : "none",
  );
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const hasOptionalContent = Boolean(description.trim()) || ruleSections.length > 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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

  const locked = challenge.status === "closed";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeading title={t("basicsTitle")} description={t("basicsSubtitle")} />
      <form className="space-y-6" onSubmit={saveBasics}>
        <fieldset disabled={locked} className="min-w-0 space-y-6">
          <Field label={t("titleLabel")}>
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} />
          </Field>

          <Field label={t("scheduleLegend")} plain>
            {livingList ? (
              <p className="rounded-xl bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{t("livingListBody")}</p>
            ) : (
              <>
                <SelectableCards
                  value={scheduleMode}
                  onChange={setScheduleMode}
                  disabled={locked}
                  options={[
                    { value: "period", label: t("schedulePeriod"), hint: t("schedulePeriodHint") },
                    { value: "none", label: t("scheduleNone"), hint: t("scheduleNoneHint") },
                  ]}
                />
                {scheduleMode === "period" ? (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <SchedulePeriodFields startsOn={startsOn} endsOn={endsOn} onStartsOn={setStartsOn} onEndsOn={setEndsOn} disabled={locked} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("noPeriodNote")}</p>
                )}
                {challenge.status === "active" ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("scheduleActiveNote")}</p> : null}
              </>
            )}
          </Field>

          <Disclosure summary={t("descRulesTitle")} defaultOpen={hasOptionalContent}>
            <div className="space-y-5 pt-3">
              <Field label={t("descriptionLabel")} optional>
                <textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={locked} />
              </Field>
              <Field label={t("rulesLabel")} hint={t("rulesHint")} optional plain>
                <RuleSectionsEditor value={ruleSections} onChange={setRuleSections} disabled={locked} />
              </Field>
            </div>
          </Disclosure>
        </fieldset>

        <StatusMessage error={error} success={success} />
        {!locked ? <Button type="submit" className="w-full" disabled={busy === "save"}>{busy === "save" ? tc("saving") : t("saveBasics")}</Button> : null}
      </form>
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
    <section className="mx-auto max-w-2xl">
      <PageHeading title={t("participantsTitle")} description={t("participantsSubtitle")} />
      {group?.members?.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {group.members.map((member) => {
            const checked = selected.includes(member.id);
            const disabled = challenge.status === "closed" || busy;
            return (
              <li key={member.id}>
                <label className={cx(
                  "flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 transition",
                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  checked ? "border-[var(--main)] bg-[var(--main-soft)]" : "border-[var(--line)] hover:border-[var(--main-line)]",
                )}>
                  <input type="checkbox" className="peer sr-only" aria-label={t("selectMember", { name: member.name })} checked={checked} disabled={disabled}
                    onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />
                  <span className={cx("grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-white transition", checked ? "border-[var(--main)] bg-[var(--main)]" : "border-[var(--line)]")}>
                    <svg viewBox="0 0 16 16" className={cx("h-2.5 w-2.5", checked ? "opacity-100" : "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-medium">{member.name}</strong>
                    <small className="text-[var(--muted)]">{t("memberMeta", { username: member.username, role: tr(member.role) })}</small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title={t("noMembersTitle")} />}
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      {challenge.status !== "closed" && group?.members?.length ? <Button className="mt-5 w-full" disabled={busy} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(selected).then(() => setSuccess(t("participantsSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setBusy(false)); }}>{busy ? tc("saving") : t("saveParticipants")}</Button> : null}
    </section>
  );
}

const VISIBILITY_POLICIES = ["group_realtime", "after_own", "after_close", "author_only"] as const;

function AdminFields({
  challenge,
  onSave,
  onSaveVisibility,
  onSetExpectation,
  onSaveEntryDate,
  onAddShared,
  onRemoveType,
  onSavePolicy,
}: {
  challenge: ChallengeDetail;
  onSave: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onSaveEntryDate: (enabled: boolean) => Promise<void>;
  onAddShared: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
  onSavePolicy: (entryTypeId: Id, policy: SharedEditPolicy) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tf = useTranslations("fields");
  const tv = useTranslations("visibility");
  const tSr = useTranslations("sharedResponses");
  const f = useGoaFormat();
  const hasExpectation = challenge.entryTypes.some((type) => type.purpose === "expectation");
  const canToggleExpectation =
    challenge.status === "draft"
    && challenge.submissionMode === "item"
    && challenge.entryTypes.some((type) => type.purpose === "rating");
  const [expectationBusy, setExpectationBusy] = useState(false);
  // A day-by-day response always needs its day, so the choice only exists for the other kinds.
  const canToggleEntryDate = challenge.status !== "closed"
    && !challenge.entryTypes.some((type) => type.cardinality === "once_per_day" || type.cardinality === "once_per_item_day");
  const [entryDateBusy, setEntryDateBusy] = useState(false);
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

  const [editing, setEditing] = useState<ChallengeField | "new" | null>(null);
  const [addingShared, setAddingShared] = useState(false);
  const [removingType, setRemovingType] = useState<ChallengeDetail["entryTypes"][number] | null>(null);
  const locked = challenge.status === "closed";
  const isShared = activeType?.answerScope === "shared";
  const otherResponseCount = types.filter((type) => type.id !== activeType?.id && type.purpose !== "expectation").length;
  const removable = otherResponseCount > 0 && activeType?.purpose !== "expectation";
  const canAddShared = challenge.submissionMode === "item" && !locked && challenge.entryTypes.length > 0;

  function pickType(id: Id) {
    setSelectedTypeId(id);
    const type = types.find((candidate) => candidate.id === id);
    setFields(type?.fields ?? []);
    setVisibility(type?.visibilityPolicy ?? "group_realtime");
    setError(null);
    setSuccess(null);
  }

  async function commit(next: ChallengeField[], message: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(selectedTypeId, cleanFields(next));
      setFields(next);
      setSuccess(message);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next, t("fieldsSaved"));
  }

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeading
        title={t("fieldsTitle")}
        description={challenge.status === "draft" ? t("fieldsHintDraft") : challenge.status === "active" ? t("fieldsHintActive") : t("fieldsHintClosed")}
        action={!locked ? <Button onClick={() => { setError(null); setEditing("new"); }}>＋ {t("addField")}</Button> : undefined}
      />
      {types.length > 1 || canAddShared ? (
        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label={t("fieldsTypeLegend")}>
          {types.map((type) => {
            const active = type.id === selectedTypeId;
            return (
              <button
                key={type.id}
                type="button"
                aria-pressed={active}
                onClick={() => pickType(type.id)}
                className={cx(
                  "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition",
                  active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] hover:border-[var(--main-line)]",
                )}
              >
                {type.answerScope === "shared" ? <SharedGlyph /> : null}
                {type.name}
                {type.answerScope === "shared" ? <span className="rounded-full bg-[var(--main)]/10 px-2 py-0.5 text-[10px] font-medium">{tSr("badge")}</span> : null}
              </button>
            );
          })}
          {canAddShared ? (
            <button
              type="button"
              onClick={() => { setError(null); setAddingShared(true); }}
              className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-4 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
            >
              ＋ {tSr("addShort")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mb-4"><StatusMessage error={error} success={success} /></div>
      {fields.length ? (
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {fields.map((field, index) => (
            <li className="flex items-center gap-3 py-3.5" key={field.id ?? field.key}>
              <div className="min-w-0 flex-1">
                <strong className="block text-[15px] font-medium">{field.label}</strong>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                  {tf(`type.${field.type}`)}
                  {field.required ? <span className="text-[var(--main-strong)]">· {t("fieldRequiredShort")}</span> : null}
                  <code className="rounded bg-[var(--wash)] px-1.5 py-0.5 font-mono text-[11px]">{field.key}</code>
                </span>
              </div>
              {!locked ? (
                <div className="flex flex-none items-center gap-0.5">
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-25" disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={tf("moveUp")}>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-25" disabled={index === fields.length - 1 || busy} onClick={() => move(index, 1)} aria-label={tf("moveDown")}>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <ActionMenu label={t("moreActions")} iconOnly>
                    <ActionMenuItem onClick={() => { setError(null); setEditing(field); }}>{t("edit")}</ActionMenuItem>
                    <ActionMenuItem danger onClick={() => void commit(fields.filter((candidate) => candidate !== field), t("fieldsSaved"))}>{t("remove")}</ActionMenuItem>
                  </ActionMenu>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : locked
        ? <EmptyState title={t("fieldsEmptyTitle")} hint={t("fieldsEmptyBody")} />
        : <EmptyState title={t("fieldsEmptyTitle")} onClick={() => { setError(null); setEditing("new"); }} />}

      {editing ? (
        <FieldEditorDialog
          field={editing === "new" ? undefined : editing}
          takenKeys={fields.filter((candidate) => candidate !== editing).map((candidate) => candidate.key)}
          lockType={challenge.status !== "draft" && editing !== "new" && Boolean(editing.id)}
          onCancel={() => setEditing(null)}
          onSave={async (built) => {
            const next = editing === "new"
              ? [...fields, built]
              : fields.map((candidate) => candidate === editing ? { ...candidate, ...built } : candidate);
            await commit(next, editing === "new" ? t("fieldAdded") : t("fieldsSaved"));
            setEditing(null);
          }}
        />
      ) : null}

      {isShared && activeType ? (
        <SharedResponsePanel
          key={activeType.id}
          type={activeType}
          locked={locked}
          removable={removable}
          onChangePolicy={(policy) => onSavePolicy(activeType.id, policy)}
          onRemove={() => setRemovingType(activeType)}
        />
      ) : !locked && removable && activeType ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] px-5 py-4">
          <p className="max-w-md text-xs leading-5 text-[var(--muted)]">{tSr("removeHintIndividual")}</p>
          <button type="button" onClick={() => setRemovingType(activeType)} className="min-h-10 cursor-pointer rounded-xl border border-[var(--danger-line)] px-4 text-sm text-[var(--danger)] transition hover:bg-[var(--danger-soft)]">{tSr("remove")}</button>
        </div>
      ) : null}

      {addingShared ? (
        <AddSharedResponseDialog
          onCancel={() => setAddingShared(false)}
          onAdd={async (payload) => { await onAddShared(payload); setAddingShared(false); }}
        />
      ) : null}
      {removingType ? (
        <RemoveResponseDialog
          type={removingType}
          onClose={() => setRemovingType(null)}
          onRemove={async (confirmed) => { await onRemoveType(removingType.id, confirmed); setRemovingType(null); }}
        />
      ) : null}

      {(selectedTypeId && challenge.status !== "closed") || canToggleExpectation || hasExpectation || canToggleEntryDate ? (
        <div className="mt-8 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
          {selectedTypeId && challenge.status !== "closed" ? (
            <div className="p-5">
              <h3 className="text-sm font-semibold">{tv("title")}</h3>
              <p className="mb-3 mt-1 text-xs leading-5 text-[var(--muted)]">{tv("hint")}</p>
              <select
                className={inputClass}
                aria-label={tv("title")}
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
              <p className="mt-2 text-xs text-[var(--muted)]">{tv(`explain.${visibility}`)}</p>
            </div>
          ) : null}
          {canToggleEntryDate ? (
            <div className="p-5">
              <Toggle
                checked={challenge.collectsEntryDate !== false}
                disabled={entryDateBusy}
                onChange={(next) => {
                  setEntryDateBusy(true);
                  setError(null);
                  onSaveEntryDate(next)
                    .then(() => setSuccess(next ? t("entryDateOn") : t("entryDateOff")))
                    .catch((cause: unknown) => setError(f.error(cause)))
                    .finally(() => setEntryDateBusy(false));
                }}
                label={t("entryDateTitle")}
                hint={t("entryDateHint")}
              />
            </div>
          ) : null}
          {canToggleExpectation || hasExpectation ? (
            <div className="p-5">
              <Toggle
                checked={hasExpectation}
                disabled={expectationBusy || !canToggleExpectation}
                onChange={(next) => {
                  setExpectationBusy(true);
                  setError(null);
                  onSetExpectation(next)
                    .then(() => setSuccess(next ? t("expectationOn") : t("expectationOff")))
                    .catch((cause: unknown) => setError(f.error(cause)))
                    .finally(() => setExpectationBusy(false));
                }}
                label={t("expectationTitle")}
                hint={!canToggleExpectation && hasExpectation ? t("expectationLockedNote") : t("expectationHint")}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function FieldEditorDialog({
  field,
  takenKeys,
  lockType,
  onCancel,
  onSave,
}: {
  field?: ChallengeField;
  takenKeys: string[];
  lockType: boolean;
  onCancel: () => void;
  onSave: (field: ChallengeField) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tf = useTranslations("fields");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const initial = field ?? { key: "", label: "", type: "text" as const, required: true, config: newFieldConfig("text") };
  const [draft, setDraft] = useState<ChallengeField>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const hasConfig = ["rating", "number", "select", "text"].includes(draft.type);

  async function submit() {
    const label = draft.label.trim();
    if (!label) { setError(tf("labelRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, label, key: draft.key || uniqueFieldKey(label, takenKeys) });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }

  return (
    <FormDialog
      title={field ? tf("editFieldTitle") : t("addField")}
      dirty={dirty}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={field ? tc("saveChanges") : t("addField")}
    >
      <Field label={tf("labelLabel")}>
        <input className={inputClass} value={draft.label} maxLength={100} required onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
      </Field>
      <Field label={tf("typeLabel")}>
        <select className={inputClass} value={draft.type} disabled={lockType} onChange={(event) => { const type = event.target.value as ChallengeField["type"]; setDraft((current) => ({ ...current, type, config: newFieldConfig(type) })); }}>{FIELD_TYPES.map((value) => <option value={value} key={value}>{tf(`type.${value}`)}</option>)}</select>
      </Field>
      {hasConfig ? <FieldConfigInputs field={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} /> : null}
      <Toggle checked={draft.required} onChange={(next) => setDraft((current) => ({ ...current, required: next }))} label={tf("required")} hint={tf("requiredHint")} />
    </FormDialog>
  );
}

type ItemUpdatePayload = { title: string; description: string } & Record<string, unknown>;

export function ItemEditorDialog({
  item,
  challenge,
  members,
  library,
  scope,
  recommendationsEnabled,
  onCancel,
  onSave,
}: {
  item: ChallengeItem;
  challenge: ChallengeDetail;
  members: Member[];
  /** The library this item's catalogue entry belongs to — decides which properties it can hold. */
  library: Pick<ChallengeLibraryRef, "id" | "kind"> | null;
  scope: CatalogScope;
  recommendationsEnabled: boolean;
  onCancel: () => void;
  onSave: (payload: ItemUpdatePayload) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const catalogItem = item.catalogItem ?? null;
  const isItem = challenge.submissionMode === "item";
  const initialRecommender = recommenderFromItem(item.recommendedBy, item.originNote);
  const initial = { title: item.title, description: item.description ?? "" };
  const [draft, setDraft] = useState(initial);
  const [recommender, setRecommender] = useState<RecommenderValue>(initialRecommender);
  // The library's own properties — renamed, hidden or added by its owners — not a fixed set of columns.
  const { properties } = useLibraryProperties(catalogItem && library ? library : null);
  const initialValues = useMemo(() => (catalogItem && properties ? valuesFromItem(properties, catalogItem) : {}), [catalogItem, properties]);
  const [editedValues, setEditedValues] = useState<PropertyValues | null>(null);
  const values = editedValues ?? initialValues;
  const source = useRecommenderSource(scope, recommendationsEnabled && isItem);
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recommenderChanged = !sameRecommender(recommender, initialRecommender);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || recommenderChanged || editedValues !== null;
  const authorNeeded = library?.kind === "book" && properties?.find((property) => property.key === "author")?.hidden !== true;
  // The event's own date and time is asked up front; the rest of the library's facts sit in a disclosure.
  const scheduleProperty = properties?.find((property) => property.type === "schedule" && !property.hidden) ?? null;
  const factProperties = (properties ?? []).filter((property) => property.type !== "schedule");
  const factsPreview = editableProperties(factProperties).map((property) => values[property.key]).filter(Boolean).slice(0, 3).join(" · ");

  async function submit() {
    if (catalogItem && authorNeeded && !(values.author ?? "").trim()) { setError(tCine("authorRequired")); return; }
    if (properties && propertiesHaveProblem(properties, values)) { setError(t("eventScheduleInvalid")); return; }
    setBusy(true);
    setError(null);
    try {
      const facts = catalogItem && properties && editedValues ? bodyFromValues(properties, editedValues, "update") : null;
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        ...(isItem && recommendationsEnabled && recommenderChanged ? recommenderBody(recommender, "item", true) : {}),
        ...(facts ? { ...facts.native, ...(Object.keys(facts.attributes).length ? { attributes: facts.attributes } : {}) } : {}),
      });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }

  return (
    <FormDialog
      title={challenge.submissionMode === "daily" ? t("editCheckpoint") : t("editItem")}
      dirty={dirty}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={tc("saveChanges")}
    >
      <Field label={t("itemTitleLabel")}>
        <input className={inputClass} value={draft.title} onChange={(event) => set({ title: event.target.value })} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} />
      </Field>
      <Field label={t("itemDescriptionLabel")} optional>
        <textarea className={inputClass} rows={3} value={draft.description} onChange={(event) => set({ description: event.target.value })} maxLength={2000} placeholder={t("itemDescriptionPlaceholder")} />
      </Field>
      {isItem && recommendationsEnabled ? (
        <RecommenderPicker value={recommender} onChange={setRecommender} members={members} source={source} />
      ) : null}
      {catalogItem && scheduleProperty ? (
        <PropertyInputs properties={[scheduleProperty]} values={values} onChange={(key, value) => setEditedValues({ ...values, [key]: value })} />
      ) : null}
      {catalogItem && properties && editableProperties(factProperties).length ? (
        <Disclosure summary={tCine("catalogFacts")} preview={factsPreview || undefined} defaultOpen={authorNeeded && !(values.author ?? "").trim()}>
          <div className="pt-2">
            <PropertyInputs properties={factProperties} values={values} onChange={(key, value) => setEditedValues({ ...values, [key]: value })} />
          </div>
        </Disclosure>
      ) : null}
    </FormDialog>
  );
}

/**
 * The libraries this challenge draws its items from. Each can be dropped while none of
 * its items are in the challenge, and any workspace library can be linked — that is
 * how one challenge combines Movies and TV Shows.
 */
function ChallengeLibrariesBar({
  challenge,
  scope,
  onLink,
  onUnlink,
  onChanged,
}: {
  challenge: ChallengeDetail;
  scope: CatalogScope;
  onLink: (spec: { libraryId?: Id; libraryKind?: string }) => Promise<void>;
  onUnlink: (libraryId: Id) => Promise<void>;
  /** A library's properties changed (say, the event date was switched on) — reload what depends on them. */
  onChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const { data: workspaceLibraries } = useCatalogLibraries(scope);
  const linked = challenge.libraries ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propertiesOf, setPropertiesOf] = useState<CatalogLibrary | null>(null);
  const locked = challenge.status === "closed";
  const available = libraryChoices(workspaceLibraries ?? []).filter((choice) => !linked.some((library) => library.kind === choice.kind));
  const itemsIn = (kind: string) => challenge.items.filter((item) => item.catalogItem?.kind === kind).length;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("librariesLabel")}>
        <span className="mr-1 text-[13px] font-medium">{t("librariesLabel")}</span>
        {linked.map((library) => {
          const removable = !locked && library.id !== null && itemsIn(library.kind) === 0;
          return (
            <span key={library.kind} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--main-line)] bg-[var(--main-soft)] pl-3 pr-1 text-sm text-[var(--main-strong)]">
              <LibraryGlyph source={library.source} />
              {libraryName(library)}
              <span className="text-[11px] text-[var(--muted)]">{itemsIn(library.kind)}</span>
              {library.id !== null ? (
                <button
                  type="button"
                  aria-label={t("libraryProperties", { name: libraryName(library) })}
                  title={t("libraryProperties", { name: libraryName(library) })}
                  className="ml-0.5 grid h-6 w-6 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--main)]/15 hover:text-[var(--ink)]"
                  onClick={() => setPropertiesOf({ id: library.id!, kind: library.kind, source: library.source, label: library.label, position: 0 })}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" strokeLinecap="round" /><circle cx="11" cy="4.5" r="1.5" /><circle cx="5" cy="11.5" r="1.5" /></svg>
                </button>
              ) : null}
              {removable ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("unlinkLibrary", { name: libraryName(library) })}
                  title={t("unlinkLibrary", { name: libraryName(library) })}
                  className="ml-0.5 grid h-6 w-6 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--main)]/15 hover:text-[var(--ink)] disabled:opacity-50"
                  onClick={() => void run(() => onUnlink(library.id!))}
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                </button>
              ) : <span className="w-2" />}
            </span>
          );
        })}
        {!locked && available.length ? (
          <ActionMenu label={t("linkLibrary")}>
            {available.map((choice) => (
              <ActionMenuItem key={choice.kind} disabled={busy} onClick={() => void run(() => onLink(choice.id ? { libraryId: choice.id } : { libraryKind: choice.kind }))}>
                <span className="inline-flex items-center gap-2"><LibraryGlyph source={choice.source} />{libraryName(choice)}</span>
              </ActionMenuItem>
            ))}
          </ActionMenu>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{linked.length > 1 ? t("librariesCombined") : t("librariesHint")}</p>
      {error ? <div className="mt-2"><StatusMessage error={error} /></div> : null}
      {propertiesOf ? <LibraryPropertiesDialog scope={scope} library={propertiesOf} canEdit={!locked} onClose={() => setPropertiesOf(null)} onChanged={onChanged} /> : null}
    </div>
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
  onLinkLibrary,
  onUnlinkLibrary,
  onLibraryChanged,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  entries: Entry[];
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: ItemUpdatePayload) => Promise<void>;
  onArchive: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
  onLinkLibrary: (spec: { libraryId?: Id; libraryKind?: string }) => Promise<void>;
  onUnlinkLibrary: (libraryId: Id) => Promise<void>;
  onLibraryChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const members = group?.members ?? [];
  const scope: CatalogScope = group ? { groupId: group.id } : "personal";
  const recommendationsEnabled = group ? group.recommendationsEnabled !== false : true;
  const timeZone = challenge.timeZone ?? "America/Sao_Paulo";
  // The libraries the challenge is linked to, stored on the challenge. One with none yet (a custom
  // challenge, or one whose libraries were all unlinked) links its first here, below.
  const { data: workspaceLibraries } = useCatalogLibraries(scope);
  const linked = challenge.libraries ?? [];
  const itemLibrary = (item: ChallengeItem) => linked.find((library) => library.kind === item.catalogItem?.kind) ?? null;
  const [newItemRows, setNewItemRows] = useState<CineRow[]>([]);
  const [itemProblem, setItemProblem] = useState<"author" | "schedule" | null>(null);
  const [importTarget, setImportTarget] = useState<Pick<ChallengeLibraryRef, "id" | "kind"> | null>(null);
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const datedDaily = challenge.submissionMode === "daily" && !undatedDaily;
  const canAddItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const canArchiveItems = challenge.submissionMode === "item" && challenge.status !== "closed";
  const canShowAdd = challenge.status !== "closed"
    && !(challenge.submissionMode === "free")
    && !(undatedDaily)
    && !(datedDaily && challenge.status === "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChallengeItem | null>(null);
  const [archiving, setArchiving] = useState<ChallengeItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function archive(item: ChallengeItem) {
    setError(null);
    setSuccess(null);
    await onArchive(item.id);
    setArchiving(null);
    setSuccess(t("itemRemoved"));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      if (challenge.submissionMode === "daily") {
        await onAdd({ generate: { frequency: "daily", startsOn, endsOn } });
        setSuccess(t("dailyGenerated"));
        setShowAdd(false);
      } else {
        const items = cineRowsToInput(newItemRows);
        if (!items.length) { setError(t("errNoItem")); setBusy(false); return; }
        if (itemProblem === "author") { setError(tCine("authorRequired")); setBusy(false); return; }
        if (itemProblem === "schedule") { setError(t("eventScheduleInvalid")); setBusy(false); return; }
        await onAdd({ items });
        setNewItemRows([]);
        setSuccess(t("itemsAdded"));
        setShowAdd(false);
      }
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeading
        title={t("itemsTitle")}
        description={undatedDaily ? t("itemsHintUndatedDaily") : datedDaily ? t("itemsHintDatedDaily") : challenge.status === "closed" ? t("itemsHintClosed") : t("itemsHintDefault")}
        action={canShowAdd ? <Button variant={showAdd ? "secondary" : "primary"} onClick={() => setShowAdd((open) => !open)}>{showAdd ? tc("close") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : `＋ ${t("add")}`}</Button> : undefined}
      />
      {challenge.submissionMode === "item" ? <ChallengeLibrariesBar challenge={challenge} scope={scope} onLink={onLinkLibrary} onUnlink={onUnlinkLibrary} onChanged={onLibraryChanged} /> : null}
      <div className="mb-5"><StatusMessage error={error} success={success} /></div>

      {showAdd && canShowAdd ? (
        <div className="mb-8 rounded-2xl border border-[var(--line)] p-5">
          <form className="space-y-5" onSubmit={submit}>
            {challenge.submissionMode === "daily"
              ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><Field label={t("firstDay")}><input className={inputClass} type="date" value={startsOn} readOnly required /></Field><Field label={t("lastDay")}><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></Field></>
              : <>
                  {linked.length ? (
                    <CineItemsEditor value={newItemRows} onChange={setNewItemRows} members={members} scope={scope} libraries={linked} recommendationsEnabled={recommendationsEnabled} onProblem={setItemProblem} onTargetChange={setImportTarget} />
                  ) : (
                    <Field label={t("libraryLabel")} hint={t("libraryHint")} plain>
                      <LibraryPills
                        choices={libraryChoices(workspaceLibraries ?? [])}
                        selectedKinds={[]}
                        label={t("libraryLabel")}
                        onPick={(choice) => {
                          setError(null);
                          void onLinkLibrary(choice.id ? { libraryId: choice.id } : { libraryKind: choice.kind }).catch((cause: unknown) => setError(f.error(cause)));
                        }}
                      />
                    </Field>
                  )}
                  {challenge.status === "active" ? <p className="text-xs leading-5 text-[var(--muted)]">{t("activeItemsNote")}</p> : null}
                </>}
            <Button type="submit" disabled={busy || (challenge.submissionMode === "daily" ? challenge.status !== "draft" : !canAddItems || !newItemRows.length)}>{busy ? tc("saving") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : t("add")}</Button>
          </form>
          {challenge.submissionMode === "item" && linked.length ? (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <ListImportPanel
                library={importTarget}
                onPreview={onPreviewImport}
                onCommit={(items: ChallengeItemInput[]) => onAdd({ items })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {challenge.items.length ? (
        <ol className="divide-y divide-[var(--line)]">
          {[...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((item, index) => (
            <li className="flex items-start justify-between gap-4 py-4" key={item.id}>
              <div className="flex min-w-0 gap-4">
                <span className="w-6 shrink-0 pt-0.5 text-sm tabular-nums text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <strong className="block text-base font-medium">{item.title}{item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}</strong>
                  {linked.length > 1 && itemLibrary(item) ? <small className="mt-1 inline-flex items-center gap-1.5 text-[var(--muted)]"><LibraryGlyph source={itemLibrary(item)!.source} className="h-3 w-3" />{libraryName(itemLibrary(item)!)}</small> : null}
                  {item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}
                  {(recommendationsEnabled && (item.recommendedBy || item.originNote)) || item.catalogItem?.author || item.catalogItem?.mainGenre || item.catalogItem?.runtimeMinutes ? <small className="mt-1 block text-[var(--muted)]">{[item.catalogItem?.author ? tCine("byAuthor", { name: item.catalogItem.author }) : null, recommendationsEnabled ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("itemRecommendedByLine", { name }), (text) => t("itemOriginLine", { text })) : null, item.catalogItem?.mainGenre || null, formatRuntime(item.catalogItem?.runtimeMinutes)].filter(Boolean).join(" · ")}</small> : null}
                  {item.catalogItem?.scheduledAt ? <small className="mt-1 inline-flex items-center gap-1.5 text-[var(--ink)]"><svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2.2" y="3.2" width="11.6" height="10.6" rx="2" /><path d="M2.2 6.6h11.6M5.4 1.9v2.6M10.6 1.9v2.6" strokeLinecap="round" /></svg>{f.eventWhen(item.catalogItem.scheduledAt)}</small> : null}
                  {item.date ? <small className="mt-1 block text-[var(--muted)]">{f.date(item.date)}</small> : f.itemWindow(item, timeZone) ? <small className="mt-1 inline-flex items-center gap-1.5 text-[var(--muted)]"><svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.8" /><path d="M8 5v3.2l2 1.2" strokeLinecap="round" /></svg>{f.itemWindow(item, timeZone)}</small> : null}
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                {item.status !== "open" ? <span className="rounded-full bg-[var(--wash)] px-2 py-1 text-[10px] font-light text-[var(--muted)]">{f.itemStatusLabel(item.status)}</span> : null}
                {challenge.status !== "closed" ? (
                  <ActionMenu label={t("moreActions")} iconOnly>
                    <ActionMenuItem onClick={() => { setError(null); setEditing(item); }}>{t("edit")}</ActionMenuItem>
                    {canArchiveItems ? <ActionMenuItem danger onClick={() => { setError(null); setArchiving(item); }}>{t("remove")}</ActionMenuItem> : null}
                  </ActionMenu>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : undatedDaily
        ? <EmptyState title={t("noItemsUndatedTitle")} />
        : canShowAdd && !showAdd
          ? <EmptyState title={t("noItemsTitle")} onClick={() => { setError(null); setShowAdd(true); }} />
          : <EmptyState title={t("noItemsTitle")} hint={t("noItemsBody")} />}

      {editing ? (
        <ItemEditorDialog
          item={editing}
          challenge={challenge}
          members={members}
          library={itemLibrary(editing)}
          scope={scope}
          recommendationsEnabled={recommendationsEnabled}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            await onUpdate(editing.id, payload);
            setEditing(null);
            setSuccess(challenge.submissionMode === "daily" ? t("checkpointUpdated") : t("itemUpdated"));
          }}
        />
      ) : null}

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
    </section>
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
  onSave: (payload: Record<string, unknown>) => Promise<{ published?: boolean } | undefined>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [headline, setHeadline] = useState(challenge.result?.headline ?? "");
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [allComments, setAllComments] = useState(challenge.resultsAllComments === true);
  const [anonymize, setAnonymize] = useState(challenge.resultsAnon === true);
  const [includeRankings, setIncludeRankings] = useState((challenge.result?.personalRankings?.length ?? 0) > 0 || !challenge.result);
  const [includeAffinity, setIncludeAffinity] = useState(Boolean(challenge.result?.affinity?.pairs.length) || !challenge.result);
  const [showSchedule, setShowSchedule] = useState(challenge.showSchedule !== false);
  const hasSchedule = challenge.checkpoints.some((cp) => cp.kind && cp.kind !== "day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const textFields = useMemo(() => [...new Map([...challenge.fields, ...challenge.entryTypes.flatMap((type) => type.fields)].filter((field) => field.id && field.type === "text").map((field) => [field.id, field])).values()], [challenge.fields, challenge.entryTypes]);
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

  const isPublished = Boolean(challenge.result?.publishedAt);

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
        allComments,
        anonymizeParticipants: anonymize,
        includeRankings,
        includeAffinity,
        ...(hasSchedule ? { showSchedule } : {}),
      });
      setSuccess(t("resultsSaved"));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeading title={t("resultsTitle")} description={t("resultsSubtitle")} />
      <fieldset disabled={busy} className="min-w-0">
        <div className="space-y-5 pb-7">
          <Field label={t("headlineLabel")}><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={160} placeholder={challenge.title} /></Field>
          <Field label={t("summaryLabel")}><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></Field>
        </div>

        <Disclosure summary={t("highlightMetrics")} preview={challenge.metrics.length ? t("selectedOf", { selected: metricIds.length, total: challenge.metrics.length }) : undefined} defaultOpen>
          {challenge.metrics.length ? <div className="pb-5 pt-1"><ShowMoreList items={challenge.metrics} preview={6} className="grid gap-2" render={(metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={t("highlightMetricAria", { label: metric.label })} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? t("metricNoValue")}</small></span></label>} /></div> : <p className="pb-5 pt-1 text-sm text-[var(--muted)]">{t("createMetricsFirst")}</p>}
        </Disclosure>

        <Disclosure summary={t("selectedComments")} preview={allComments ? t("allCommentsShown") : candidates.length ? t("selectedOf", { selected: commentKeys.length, total: candidates.length }) : undefined} defaultOpen={allComments || commentKeys.length > 0}>
          <Toggle className="mt-1" checked={allComments} onChange={setAllComments} label={t("allCommentsLabel")} hint={t("allCommentsHint")} />
          <p className="mt-3 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{t("commentPrivacyWarning")}</p>
          {allComments ? null : candidates.length ? <div className="mt-3 pb-5"><ShowMoreList items={candidates} preview={4} className="grid gap-2 sm:grid-cols-2" render={(candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={t("selectCommentAria", { author: candidate.authorName })} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6"><CommentText text={candidate.text} className="space-y-1" /></span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>} /></div> : <p className="mt-2 pb-5 text-sm text-[var(--muted)]">{t("noTextFields")}</p>}
          {allComments ? <div className="pb-4" /> : null}
        </Disclosure>

        <Disclosure summary={t("wrappedBlocks")} preview={t("blocksOn", { count: Number(includeRankings) + Number(includeAffinity) })}>
          <div className="grid gap-2 pb-5 pt-1 sm:grid-cols-2">
            <Toggle checked={includeRankings} onChange={setIncludeRankings} label={t("includeRankings")} />
            <Toggle checked={includeAffinity} onChange={setIncludeAffinity} label={t("includeAffinity")} />
          </div>
        </Disclosure>

        <div className="space-y-3 border-t border-[var(--line)] py-7">
          <Toggle checked={anonymize} onChange={setAnonymize} label={t("anonymizeParticipants")} hint={t("anonymizeHint")} />
          {hasSchedule ? <Toggle checked={showSchedule} onChange={setShowSchedule} label={t("showScheduleLabel")} hint={t("showScheduleHint")} /> : null}
        </div>

        <div className="border-t border-[var(--line)] pt-7">
          <StatusMessage error={error} success={success} />
          <Button className="mt-5 w-full" disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveResults")}</Button>
          {isPublished ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("alreadyPublicHint")}</p> : null}
        </div>
      </fieldset>
    </section>
  );
}

export function AdminScreen({
  challenge,
  entries,
  group,
  tab,
  onTab,
  onBack,
  backLabel,
  onSaveBasics,
  onTransition,
  onDuplicate,
  onOpenCopy,
  isPlatformAdmin = false,
  onPublishTemplate,
  onUnpublishTemplate,
  duplicateTargets,
  onDelete,
  onSaveParticipants,
  onSaveFields,
  onSaveEntryTypeVisibility,
  onSetExpectation,
  onSaveEntryDate,
  onAddSharedResponse,
  onRemoveEntryType,
  onSaveSharedPolicy,
  onAddItems,
  onLinkLibrary,
  onUnlinkLibrary,
  onUpdateItem,
  onArchiveItem,
  onPreviewImport,
  onSaveCheckpoints,
  onAssignCheckpointItems,
  onAddMetric,
  onUpdateMetric,
  onDeleteMetric,
  onSaveResult,
  onPublishResult,
  onUnpublishResult,
  onArchiveChanged,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id; mode: CopyMode }) => Promise<CopyResult>;
  onOpenCopy: (challengeId: Id) => void;
  isPlatformAdmin?: boolean;
  onPublishTemplate: () => Promise<void>;
  onUnpublishTemplate: () => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveEntryTypeVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onSaveEntryDate: (enabled: boolean) => Promise<void>;
  onAddSharedResponse: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveEntryType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
  onSaveSharedPolicy: (entryTypeId: Id, policy: SharedEditPolicy) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onLinkLibrary: (spec: { libraryId?: Id; libraryKind?: string }) => Promise<void>;
  onUnlinkLibrary: (libraryId: Id) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: ItemUpdatePayload) => Promise<void>;
  onArchiveItem: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssignCheckpointItems: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position?: number }>) => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateMetric: (metricId: Id, payload: Record<string, unknown>) => Promise<void>;
  onDeleteMetric: (metricId: Id) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<{ published?: boolean } | undefined>;
  onPublishResult: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublishResult: () => Promise<void>;
  csrfToken: string;
  onArchiveChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  // The checkpoint planner is for round-item challenges organised into
  // weeks/sessions — a day-by-day round derives its checkpoints from the period.
  const showCheckpoints = challenge.submissionMode === "item";
  // A personal challenge has exactly one participant (the owner). "Participants"
  // is folded into the overview tab, never its own tab.
  const isPersonal = challenge.scope === "personal";
  const tabs: AdminTab[] = [
    "overview",
    "fields", "items",
    ...(showCheckpoints ? (["checkpoints"] as const) : []),
    "metrics", "results",
  ];
  const requestedTab = tab === "participants" ? "overview" : tab;
  const activeTab = tabs.includes(requestedTab) ? requestedTab : "overview";

  return (
    <main className="pb-24">
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_90%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="flex-none" labelClassName="sr-only sm:not-sr-only" />
          <span className="h-5 w-px flex-none bg-[var(--line)]" aria-hidden="true" />
          <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{challenge.title}</h1>
          <ChallengeActions challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onOpenCopy={onOpenCopy} onDelete={onDelete} onTransition={onTransition} isPlatformAdmin={isPlatformAdmin} onPublishTemplate={onPublishTemplate} onUnpublishTemplate={onUnpublishTemplate} onPublish={onPublishResult} onUnpublish={onUnpublishResult} />
        </div>
        <nav className="mx-auto max-w-5xl px-2 sm:px-5" aria-label={t("tabsAria")}>
          <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                aria-current={activeTab === id ? "page" : undefined}
                onClick={() => onTab(id)}
                className={cx(
                  "min-h-11 flex-none cursor-pointer whitespace-nowrap border-b-2 px-3.5 text-[13.5px] font-medium transition",
                  activeTab === id ? "border-[var(--main-strong)] text-[var(--main-strong)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
                )}
              >
                {t(`tabs.${id}`)}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10">
        {activeTab === "overview" ? <div className="mx-auto max-w-2xl space-y-10"><AdminOverview challenge={challenge} onSave={onSaveBasics} />{!isPersonal ? <div className="border-t border-[var(--line)] pt-8"><AdminParticipants key={challenge.participants.map((p) => p.userId ?? p.id).join(",")} challenge={challenge} group={group} onSave={onSaveParticipants} /></div> : null}</div> : null}
        {activeTab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.visibilityPolicy}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} onSaveVisibility={onSaveEntryTypeVisibility} onSetExpectation={onSetExpectation} onSaveEntryDate={onSaveEntryDate} onAddShared={onAddSharedResponse} onRemoveType={onRemoveEntryType} onSavePolicy={onSaveSharedPolicy} /> : null}
        {activeTab === "items" ? <AdminItems challenge={challenge} group={group} entries={entries} onAdd={onAddItems} onUpdate={onUpdateItem} onArchive={onArchiveItem} onPreviewImport={onPreviewImport} onLinkLibrary={onLinkLibrary} onUnlinkLibrary={onUnlinkLibrary} onLibraryChanged={onArchiveChanged} /> : null}
        {activeTab === "checkpoints" ? <CheckpointPlanner key={`${challenge.id}:${challenge.checkpoints.map((cp) => cp.id).join(",")}`} challenge={challenge} onSaveCheckpoints={onSaveCheckpoints} onAssign={onAssignCheckpointItems} /> : null}
        {activeTab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} onUpdate={onUpdateMetric} onDelete={onDeleteMetric} /> : null}
        {activeTab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} /> : null}
      </div>
    </main>
  );
}
