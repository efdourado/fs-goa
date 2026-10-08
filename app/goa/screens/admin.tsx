"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { CheckpointPlanner } from "../checkpoint-planner";
import { useGoaFormat } from "../format";
import { AddItemsDialog } from "../cine-items";
import { ConfirmDialog, FormDialog } from "../dialog";
import { AddSharedResponseDialog, RemoveResponseDialog, SharedGlyph, SharedResponsePanel } from "../shared-responses";
import { cleanFields, FIELD_TYPES, FieldConfigInputs, newFieldConfig, uniqueFieldKey } from "../fields";
import { LibraryPropertiesDialog } from "../library-dialogs";
import { type CatalogScope, LibraryGlyph, LibraryPills, libraryChoices, useCatalogLibraries, useLibraryName } from "../libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, propertiesHaveProblem, useLibraryProperties, valuesFromItem } from "../property-inputs";
import { recommenderBody, RecommenderPicker, recommenderFromItem, type RecommenderValue, sameRecommender, useRecommenderSource } from "../recommender-picker";
import { canOrganise, OrganiseDialog, organiseFromItems } from "../organize-panel";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import { ChallengeSettings, ChallengeStateButton, type CopyMode } from "./challenge-actions";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  CatalogLibrary,
  ChallengeLibraryRef,
  ChallengeSummary,
  CheckpointInput,
  CopyResult,
  Entry,
  FieldCount,
  GroupSummary,
  Id,
  Member,
  SharedEditPolicy,
} from "../types";
import {
  BackButton,
  Button,
  ChallengeStatusBadge,
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
import { isLivingList, itemIdForEntry, PAGE_COUNT_KEY, recipeCatalogKind } from "../utils";
import { SETUP_STEPS, SetupSummary, setupState, StepMarker, useChallengePreflight } from "../setup-progress";

interface DuplicateTargetGroup {
  id: Id;
  name: string;
  challengeCount: number;
  challengeLimit: number;
}

/**
 * The General tab: the basic details and, in a group, who takes part — saved together. One button writes
 * whichever part changed, so there is never a question of whether "the other half" was saved.
 * Lifecycle + publication live in the "Challenge state" dialog.
 */
function AdminGeneral({
  challenge,
  group,
  isPersonal,
  onSaveBasics,
  onSaveParticipants,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  isPersonal: boolean;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onSaveParticipants: (participantIds: Id[]) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const trules = useTranslations("rules");
  const f = useGoaFormat();
  const initialRules = () => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle"));
  const [title, setTitle] = useState(challenge.title);
  const [description, setDescription] = useState(challenge.description ?? "");
  const [ruleSections, setRuleSections] = useState(initialRules);
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(
    challenge.startsOn && challenge.endsOn ? "period" : "none",
  );
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const initialIds = challenge.participants.map((participant) => participant.userId ?? participant.id);
  const idsKey = initialIds.join(",");
  const [selected, setSelected] = useState<Id[]>(initialIds);
  const [seenIdsKey, setSeenIdsKey] = useState(idsKey);
  // Who takes part changed on the server (someone left, a save landed): the list follows it.
  if (idsKey !== seenIdsKey) {
    setSeenIdsKey(idsKey);
    setSelected(initialIds);
  }
  const hasOptionalContent = Boolean(description.trim()) || ruleSections.length > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const livingList = isLivingList(challenge);
  const locked = challenge.status === "closed";
  const saving = busy;
  const canPickParticipants = !isPersonal && Boolean(group?.members?.length);

  const rulesPayload = (rules: typeof ruleSections) => rules.map((rule) => ({
    title: rule.title.trim(),
    description: rule.description.trim(),
    ...(rule.topics?.length
      ? { topics: rule.topics.map((topic) => ({ title: topic.title.trim(), description: topic.description.trim() })) }
      : {}),
  }));
  const basicsDirty = title.trim() !== challenge.title
    || description.trim() !== (challenge.description ?? "").trim()
    || JSON.stringify(rulesPayload(ruleSections)) !== JSON.stringify(rulesPayload(initialRules()))
    || (scheduleMode === "period"
      ? startsOn !== (challenge.startsOn ?? "") || endsOn !== (challenge.endsOn ?? "")
      : Boolean(challenge.startsOn || challenge.endsOn));
  const participantsDirty = canPickParticipants
    && (selected.length !== initialIds.length || selected.some((id) => !initialIds.includes(id)));
  const dirty = basicsDirty || participantsDirty;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (basicsDirty && scheduleMode === "period" && (!startsOn || !endsOn)) {
      setError(t("errPeriod"));
      return;
    }
    if (basicsDirty && scheduleMode === "period" && endsOn < startsOn) {
      setError(t("errEndBeforeStart"));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    let basicsSaved = false;
    try {
      if (basicsDirty) {
        await onSaveBasics({
          title: title.trim(),
          description: description.trim(),
          ruleSections: rulesPayload(ruleSections),
          startsOn: scheduleMode === "period" ? startsOn : null,
          endsOn: scheduleMode === "period" ? endsOn : null,
        });
        basicsSaved = true;
      }
      if (participantsDirty) await onSaveParticipants(selected);
      setSuccess(t("changesSaved"));
    } catch (cause) {
      setError(basicsSaved ? t("savedDetailsOnly", { error: f.error(cause) }) : f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={save}>
        <PageHeading title={t("basicsTitle")} description={t("basicsSubtitle")} />
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

        {!isPersonal ? (
          <section className="mt-10 border-t border-[var(--line)] pt-8">
            <PageHeading title={t("participantsTitle")} description={t("participantsSubtitle")} />
            {group?.members?.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.members.map((member) => {
                const checked = selected.includes(member.id);
                const disabled = locked || saving;
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
          </section>
        ) : null}

        <div className={cx("z-10 mt-8 border-[var(--line)] py-3", dirty ? "sticky bottom-0 -mx-4 border-t bg-[color-mix(in_srgb,var(--canvas)_92%,transparent)] px-4 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border" : "px-0")}>
          <StatusMessage error={error} success={success} />
          {locked ? null : (
            <div className="space-y-2">
              <span className="block text-xs text-[var(--muted)]" aria-live="polite">{dirty ? t("unsavedChanges") : null}</span>
              <Button type="submit" className="min-h-11 w-full px-6" disabled={saving || !dirty}>{saving ? tc("saving") : t("saveChanges")}</Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function AdminFields({
  challenge,
  onSave,
  onSetExpectation,
  onSetPageCount,
  onSaveEntryDate,
  onAddShared,
  onRemoveType,
  onSavePolicy,
}: {
  challenge: ChallengeDetail;
  onSave: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onSetPageCount: (enabled: boolean) => Promise<void>;
  onSaveEntryDate: (enabled: boolean) => Promise<void>;
  onAddShared: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
  onSavePolicy: (entryTypeId: Id, policy: SharedEditPolicy) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tf = useTranslations("fields");
  const tSr = useTranslations("sharedResponses");
  const f = useGoaFormat();
  const hasExpectation = challenge.entryTypes.some((type) => type.purpose === "expectation");
  const canToggleExpectation =
    challenge.status === "draft"
    && challenge.submissionMode === "item"
    && challenge.entryTypes.some((type) => type.purpose === "rating");
  const [expectationBusy, setExpectationBusy] = useState(false);
  // Pages' page count: on by default, off makes it a plain bookshelf. Only for books, and never where the
  // challenge already counts pages its own way (a reading club's "Páginas lidas").
  const countsPages = challenge.entryTypes.some((type) => type.semanticKey === PAGE_COUNT_KEY);
  const otherPageCount = challenge.entryTypes.some((type) => type.semanticKey !== PAGE_COUNT_KEY
    && type.fields.some((field) => field.config?.count?.goal && "from" in field.config.count.goal));
  const canTogglePageCount = recipeCatalogKind(challenge.recipeKey) === "book" && challenge.status !== "closed" && !otherPageCount;
  const [pageCountBusy, setPageCountBusy] = useState(false);
  // A day-by-day response always needs its day, so the choice only exists for the other kinds.
  const canToggleEntryDate = challenge.status !== "closed"
    && !challenge.entryTypes.some((type) => type.cardinality === "once_per_day" || type.cardinality === "once_per_item_day");
  const [entryDateBusy, setEntryDateBusy] = useState(false);
  // Pages' page count is the "Contar páginas" switch below, not fields of your own — it isn't listed here.
  const ownTypes = challenge.entryTypes.filter((type) => type.semanticKey !== PAGE_COUNT_KEY);
  const types = ownTypes.length
    ? ownTypes
    : [{ id: "", name: "", fields: challenge.fields } as ChallengeDetail["entryTypes"][number]];
  const [selectedTypeId, setSelectedTypeId] = useState(
    types.find((type) => type.isPrimary)?.id ?? types[0]?.id ?? "",
  );
  const activeType = types.find((type) => type.id === selectedTypeId) ?? types[0];
  const [fields, setFields] = useState(activeType?.fields ?? []);
  const [busy, setBusy] = useState(false);
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
      />
      {!locked ? <Button className="mb-6 min-h-11 w-full" onClick={() => { setError(null); setEditing("new"); }}>＋ {t("addField")}</Button> : null}
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
          countable={activeType && (activeType.cardinality === "once_per_day" || activeType.cardinality === "once_per_item_day") ? { bookGoal: recipeCatalogKind(challenge.recipeKey) === "book" } : undefined}
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

      {canToggleExpectation || hasExpectation || canToggleEntryDate || canTogglePageCount ? (
        <div className="mt-8 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
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
                bare
                label={t("entryDateTitle")}
                hint={t("entryDateHint")}
              />
            </div>
          ) : null}
          {canTogglePageCount ? (
            <div className="p-5">
              <Toggle
                checked={countsPages}
                disabled={pageCountBusy}
                onChange={(next) => {
                  setPageCountBusy(true);
                  setError(null);
                  onSetPageCount(next)
                    .then(() => setSuccess(next ? t("pageCountOn") : t("pageCountOff")))
                    .catch((cause: unknown) => setError(f.error(cause)))
                    .finally(() => setPageCountBusy(false));
                }}
                bare
                label={t("pageCountTitle")}
                hint={t("pageCountHint")}
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
                bare
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

/**
 * "Contagem" for a number field: count it along a road to a goal. Only where a count can be drawn — a form
 * answered day by day — and the book's page count is offered only when the items are books.
 */
function CountSettings({ field, bookGoal, onChange }: { field: ChallengeField; bookGoal: boolean; onChange: (count: FieldCount | undefined) => void }) {
  const t = useTranslations("countSettings");
  const count = field.config?.count;
  const goalKind = !count?.goal ? "none" : "from" in count.goal ? "page_count" : "value";
  const set = (patch: Partial<FieldCount>) => onChange({ goal: null, entry: "amount", showDates: true, ...count, ...patch });
  return (
    <div className="space-y-4 rounded-2xl border border-[var(--line)] p-4">
      <Toggle checked={Boolean(count)} onChange={(on) => onChange(on ? { goal: bookGoal ? { from: "page_count" } : null, entry: bookGoal ? "position" : "amount", showDates: true } : undefined)} label={t("title")} hint={t("hint")} />
      {count ? (
        <>
          <Field label={t("goal")}>
            <div className="flex flex-wrap items-center gap-2">
              <select className={cx(inputClass, "w-auto")} value={goalKind} onChange={(event) => set({ goal: event.target.value === "page_count" ? { from: "page_count" } : event.target.value === "value" ? { value: 100 } : null })}>
                <option value="none">{t("goalNone")}</option>
                <option value="value">{t("goalValue")}</option>
                {bookGoal || goalKind === "page_count" ? <option value="page_count">{t("goalPageCount")}</option> : null}
              </select>
              {count.goal && "value" in count.goal ? (
                <input className={cx(inputClass, "w-32")} type="number" min={1} step="any" aria-label={t("goalValue")} value={count.goal.value} onChange={(event) => set({ goal: { value: Math.max(1, Number(event.target.value) || 1) } })} />
              ) : null}
            </div>
          </Field>
          <Field label={t("entry")}>
            <select className={cx(inputClass, "w-auto")} value={count.entry} onChange={(event) => set({ entry: event.target.value === "position" ? "position" : "amount" })}>
              <option value="amount">{t("entryAmount")}</option>
              <option value="position">{t("entryPosition")}</option>
            </select>
          </Field>
          <Toggle checked={count.showDates} onChange={(on) => set({ showDates: on })} label={t("showDates")} hint={t("showDatesHint")} />
        </>
      ) : null}
    </div>
  );
}

export function FieldEditorDialog({
  field,
  takenKeys,
  lockType,
  countable,
  onCancel,
  onSave,
}: {
  field?: ChallengeField;
  takenKeys: string[];
  lockType: boolean;
  /** The form is answered day by day, so a number on it can be a count; `bookGoal` when the items are books. */
  countable?: { bookGoal: boolean };
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
      {countable && draft.type === "number" ? (
        <CountSettings field={draft} bookGoal={countable.bookGoal} onChange={(count) => setDraft((current) => ({ ...current, config: { ...current.config, count } }))} />
      ) : null}
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
  onOpenLibrary,
  onRemove,
  entryCount = 0,
}: {
  item: ChallengeItem;
  challenge: ChallengeDetail;
  members: Member[];
  /** The library this item's catalogue entry belongs to — decides which properties it can hold. */
  library: Pick<ChallengeLibraryRef, "id" | "kind"> | null;
  scope: CatalogScope;
  recommendationsEnabled: boolean;
  onCancel: () => void;
  /** Where new kinds of details are made: the library. The dialog only fills the ones it already has. */
  onOpenLibrary?: () => void;
  /** Takes the item out (with its entries, to the bin); `entryCount` warns how many go with it. */
  onRemove?: () => Promise<void>;
  entryCount?: number;
  onSave: (payload: ItemUpdatePayload) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const [removing, setRemoving] = useState(false);
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
      {catalogItem && onOpenLibrary ? (
        <p className="text-xs leading-5 text-[var(--muted)]">
          {t("moreDetailsInLibrary")}{" "}
          <button type="button" onClick={onOpenLibrary} className="cursor-pointer font-medium text-[var(--main-strong)] underline-offset-2 hover:underline">{t("openLibrary")}</button>
        </p>
      ) : null}
      {onRemove ? (
        <div className="border-t border-[var(--line)] pt-4">
          <button type="button" onClick={() => setRemoving(true)} className="min-h-10 cursor-pointer text-sm text-[var(--danger)] hover:underline">{t("removeItem")}</button>
        </div>
      ) : null}
      {removing && onRemove ? (
        <ConfirmDialog
          title={t("remove")}
          body={entryCount > 0 ? t("itemRemoveConfirmWithEntries", { title: item.title, count: entryCount }) : t("itemRemoveConfirm", { title: item.title })}
          confirmLabel={t("remove")}
          busyLabel={t("removing")}
          danger
          onClose={() => setRemoving(false)}
          onConfirm={onRemove}
        />
      ) : null}
    </FormDialog>
  );
}

/**
 * The one library this challenge draws its items from, with its properties. While no item
 * comes from it, it can be unlinked so a wrong pick can be swapped for another.
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
                  onClick={() => setPropertiesOf((workspaceLibraries ?? []).find((candidate) => candidate.kind === library.kind) ?? { id: library.id!, kind: library.kind, source: library.source, label: library.label, position: 0, coverTopProperty: null, coverBadgeHidden: false })}
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
        {!locked && !linked.length && available.length ? (
          <ActionMenu label={t("linkLibrary")}>
            {available.map((choice) => (
              <ActionMenuItem key={choice.kind} disabled={busy} onClick={() => void run(() => onLink(choice.id ? { libraryId: choice.id } : { libraryKind: choice.kind }))}>
                <span className="inline-flex items-center gap-2"><LibraryGlyph source={choice.source} />{libraryName(choice)}</span>
              </ActionMenuItem>
            ))}
          </ActionMenu>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{t("librariesHint")}</p>
      {error ? <div className="mt-2"><StatusMessage error={error} /></div> : null}
      {propertiesOf ? <LibraryPropertiesDialog scope={scope} library={propertiesOf} canEdit={!locked} onClose={() => setPropertiesOf(null)} onChanged={onChanged} /> : null}
    </div>
  );
}

/**
 * Manage › General's "Items": what only fits here — the challenge's library, adding items (a draft opens here,
 * before Today), "Organise" and, for a daily challenge, generating its days. The items themselves are seen,
 * edited and removed on Today.
 */
function AdminItemsSection({
  challenge,
  group,
  entries,
  onAdd,
  onLinkLibrary,
  onUnlinkLibrary,
  onLibraryChanged,
  onReorder,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  entries: Entry[];
  /** Saves a new order (positions, stages unchanged). */
  onReorder: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position: number }>) => Promise<void>;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onLinkLibrary: (spec: { libraryId?: Id; libraryKind?: string }) => Promise<void>;
  onUnlinkLibrary: (libraryId: Id) => Promise<void>;
  onLibraryChanged: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const members = group?.members ?? [];
  const scope: CatalogScope = group ? { groupId: group.id } : "personal";
  const recommendationsEnabled = group ? group.recommendationsEnabled !== false : true;
  const timeZone = challenge.timeZone ?? "America/Sao_Paulo";
  // The libraries the challenge is linked to, stored on the challenge. One with none yet (a custom
  // challenge, or one whose libraries were all unlinked) links its first here, below.
  const { data: workspaceLibraries } = useCatalogLibraries(scope);
  const linked = challenge.libraries ?? [];
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const undatedDaily = challenge.submissionMode === "daily" && !challenge.startsOn && !challenge.endsOn;
  const datedDaily = challenge.submissionMode === "daily" && !undatedDaily;
  const canShowAdd = challenge.status !== "closed"
    && !(challenge.submissionMode === "free")
    && !(undatedDaily)
    && !(datedDaily && challenge.status === "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // "Organise for the group": items someone already logged keep their place; the rest are spread out.
  const tOrganise = useTranslations("organise");
  const [organising, setOrganising] = useState(false);
  const { properties: libraryProperties } = useLibraryProperties(linked[0] ?? null);
  const organiseInput = challenge.submissionMode === "item" && linked.length
    ? organiseFromItems(
        [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        libraryProperties ?? [],
        new Set(entries.map((entry) => itemIdForEntry(entry)).filter((id): id is Id => Boolean(id))),
        (key) => tOrganise(`property.${key}`),
      )
    : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      if (challenge.submissionMode === "daily") {
        await onAdd({ generate: { frequency: "daily", startsOn, endsOn } });
        setSuccess(t("dailyGenerated"));
        setShowAdd(false);
      } else {
        // Items themselves are added in their dialog (once the challenge has its library); nothing to save here.
        setError(t("errNoItem"));
      }
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <section className="mt-12 border-t border-[var(--line)] pt-8">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-light tracking-[-0.02em]">{t("itemsTitle")}</h2>
        <span className="text-xs text-[var(--muted)]">{t("itemsOnToday", { count: challenge.items.length })}</span>
      </div>
      <p className="mb-5 text-sm leading-6 text-[var(--muted)]">{undatedDaily ? t("itemsHintUndatedDaily") : datedDaily ? t("itemsHintDatedDaily") : challenge.status === "closed" ? t("itemsHintClosed") : t("itemsHintToday")}</p>
      {canShowAdd ? (() => {
        // Adding items happens in a dialog, so the button never turns into "Close" for it.
        const inline = !(challenge.submissionMode === "item" && linked.length);
        return <Button className="mb-6 min-h-11 w-full" variant={showAdd && inline ? "secondary" : "primary"} onClick={() => setShowAdd((open) => !open)}>{showAdd && inline ? tc("close") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : `＋ ${tCine("addItems")}`}</Button>;
      })() : null}
      {challenge.submissionMode === "item" ? <ChallengeLibrariesBar challenge={challenge} scope={scope} onLink={onLinkLibrary} onUnlink={onUnlinkLibrary} onChanged={onLibraryChanged} /> : null}
      <div className="mb-5"><StatusMessage error={error} success={success} /></div>

      {/* Items are added in their own box, like when the challenge was created; a daily schedule or a challenge
          with no library yet keeps its short inline form. */}
      {showAdd && canShowAdd && challenge.submissionMode === "item" && linked.length ? (
        <AddItemsDialog
          members={members}
          scope={scope}
          libraries={linked}
          recommendationsEnabled={recommendationsEnabled}
          timeZone={timeZone}
          note={challenge.status === "active" ? t("activeItemsNote") : undefined}
          onClose={() => setShowAdd(false)}
          onAdd={async (items) => {
            setSuccess(null);
            await onAdd({ items });
            setShowAdd(false);
            setSuccess(t("itemsAdded"));
          }}
        />
      ) : showAdd && canShowAdd ? (
        <div className="mb-8 rounded-2xl border border-[var(--line)] p-5">
          <form className="space-y-5" onSubmit={submit}>
            {challenge.submissionMode === "daily"
              ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><Field label={t("firstDay")}><input className={inputClass} type="date" value={startsOn} readOnly required /></Field><Field label={t("lastDay")}><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></Field></>
              : (
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
            {challenge.submissionMode === "daily" ? <Button type="submit" disabled={busy || challenge.status !== "draft"}>{busy ? tc("saving") : t("generateCheckpoints")}</Button> : null}
          </form>
        </div>
      ) : null}

      {organiseInput && canOrganise(organiseInput) && challenge.status !== "closed" ? (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" className="min-h-9" onClick={() => setOrganising(true)}>{tOrganise("button")}</Button>
        </div>
      ) : null}
      {organising && organiseInput ? (
        <OrganiseDialog
          input={organiseInput}
          busy={busy}
          onClose={() => setOrganising(false)}
          onApply={async (order) => {
            setBusy(true); setError(null); setSuccess(null);
            try {
              const stageOf = new Map(challenge.items.map((item) => [item.id, item.checkpointId ?? null]));
              await onReorder(order.map((itemId, position) => ({ itemId, checkpointId: stageOf.get(itemId) ?? null, position })));
              setOrganising(false);
              setSuccess(tOrganise("applied"));
            } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
          }}
        />
      ) : null}
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
  onSetExpectation,
  onSetPageCount,
  onSaveEntryDate,
  onAddSharedResponse,
  onRemoveEntryType,
  onSaveSharedPolicy,
  onAddItems,
  onLinkLibrary,
  onUnlinkLibrary,
  onSaveCheckpoints,
  onAssignCheckpointItems,
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
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onSetPageCount: (enabled: boolean) => Promise<void>;
  onSaveEntryDate: (enabled: boolean) => Promise<void>;
  onAddSharedResponse: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveEntryType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
  onSaveSharedPolicy: (entryTypeId: Id, policy: SharedEditPolicy) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onLinkLibrary: (spec: { libraryId?: Id; libraryKind?: string }) => Promise<void>;
  onUnlinkLibrary: (libraryId: Id) => Promise<void>;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssignCheckpointItems: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position?: number }>) => Promise<void>;
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
    "fields",
    ...(showCheckpoints ? (["checkpoints"] as const) : []),
    // Metrics and the showcase are built by Goa itself now (auto-metrics + the thread on Results) — no tabs to tend.
    "settings",
  ];
  const requestedTab = tab === "participants" ? "overview" : tab;
  const activeTab = tabs.includes(requestedTab) ? requestedTab : "overview";
  // While it is a draft, the tabs that must be in order before it can start show their progress.
  const setupOrder = SETUP_STEPS.filter((step) => tabs.includes(step));
  const preflight = useChallengePreflight(challenge.id, challenge.status === "draft", challenge);
  const setup = preflight ? setupState(preflight, setupOrder) : null;

  return (
    <main className="pb-24">
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_90%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="flex-none" labelClassName="sr-only sm:not-sr-only" />
          <span className="h-5 w-px flex-none bg-[var(--line)]" aria-hidden="true" />
          <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{challenge.title}</h1>
          <ChallengeStateButton challenge={challenge} onTransition={onTransition} />
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
                  "inline-flex min-h-11 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-[13.5px] font-medium transition",
                  activeTab === id ? "border-[var(--main-strong)] text-[var(--main-strong)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
                )}
              >
                {setup && setupOrder.includes(id) ? <StepMarker number={setupOrder.indexOf(id) + 1} todo={(setup.errors[id] ?? 0) > 0} /> : null}
                {t(`tabs.${id}`)}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10">
        {setup ? <div className="mx-auto max-w-2xl"><SetupSummary state={setup} activeTab={activeTab} onGo={onTab} /></div> : null}
        {activeTab === "overview" ? (
          <>
            <AdminGeneral challenge={challenge} group={group} isPersonal={isPersonal} onSaveBasics={onSaveBasics} onSaveParticipants={onSaveParticipants} />
            <div className="mx-auto max-w-2xl">
              <AdminItemsSection challenge={challenge} group={group} entries={entries} onAdd={onAddItems} onLinkLibrary={onLinkLibrary} onUnlinkLibrary={onUnlinkLibrary} onLibraryChanged={onArchiveChanged} onReorder={onAssignCheckpointItems} />
            </div>
          </>
        ) : null}
        {activeTab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.visibilityPolicy}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} onSetExpectation={onSetExpectation} onSetPageCount={onSetPageCount} onSaveEntryDate={onSaveEntryDate} onAddShared={onAddSharedResponse} onRemoveType={onRemoveEntryType} onSavePolicy={onSaveSharedPolicy} /> : null}
        {activeTab === "checkpoints" ? <CheckpointPlanner key={`${challenge.id}:${challenge.checkpoints.map((cp) => cp.id).join(",")}`} challenge={challenge} onSaveCheckpoints={onSaveCheckpoints} onAssign={onAssignCheckpointItems} /> : null}
        {activeTab === "settings" ? <ChallengeSettings challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onOpenCopy={onOpenCopy} onDelete={onDelete} isPlatformAdmin={isPlatformAdmin} onPublishTemplate={onPublishTemplate} onUnpublishTemplate={onUnpublishTemplate} onPublish={onPublishResult} onUnpublish={onUnpublishResult} /> : null}
      </div>
    </main>
  );
}
