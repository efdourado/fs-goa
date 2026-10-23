"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { CheckpointPlanner } from "../checkpoint-planner";
import { useGoaFormat } from "../format";
import { ConfirmDialog, FormDialog } from "../dialog";
import { AddSharedResponseDialog, ResponseSettingsDialog, SharedGlyph } from "../shared-responses";
import { cleanFields, type CountGoalOption, countGoalOptions, CountSettings, FIELD_TYPES, FieldConfigInputs, newFieldConfig, uniqueFieldKey } from "../fields";
import { type CatalogScope } from "../libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, propertiesHaveProblem, showsRecommender, useLibraryProperties, valuesFromItem } from "../property-inputs";
import { recommenderBody, RecommenderPicker, recommenderFromItem, type RecommenderValue, sameRecommender, useRecommenderSource } from "../recommender-picker";
import { canOrganise, OrganiseDialog, organiseFromItems } from "../organize-panel";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import { ChallengeSettings, ChallengeStatePanel, type CopyMode } from "./challenge-actions";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeLibraryRef,
  ChallengeSummary,
  CheckpointInput,
  CopyResult,
  Entry,
  GroupSummary,
  Id,
  Member,
  SharedEditPolicy,
} from "../types";
import {
  BackButton,
  BoxSection,
  Button,
  ChallengeStatusBadge,
  CheckCircle,
  cx,
  Disclosure,
  EmptyState,
  Field,
  inputClass,
  PageHeading,
  SchedulePeriodFields,
  Select,
  SelectableCards,
  SlidersIcon,
  StatusMessage,
  Toggle,
} from "../ui";
import { isLivingList, itemIdForEntry } from "../utils";
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
  lead,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  isPersonal: boolean;
  /** The first box, above the form: where the challenge stands (activate, close, reopen). */
  lead?: ReactNode;
  /** Resolves with `linkRotated` when new dates replaced a published results link. */
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<{ linkRotated?: boolean } | undefined | void>;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const livingList = isLivingList(challenge);
  // Already under way with no dates (a personal list, an open-ended round): it can be given an end, and only
  // an end — its start is the first day it has, which the server fills in.
  const endOnly = challenge.status === "active" && !challenge.startsOn;
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
    if (basicsDirty && scheduleMode === "period" && endOnly && !endsOn) {
      setError(t("errEnd"));
      return;
    }
    if (basicsDirty && scheduleMode === "period" && !endOnly && (!startsOn || !endsOn)) {
      setError(t("errPeriod"));
      return;
    }
    if (basicsDirty && scheduleMode === "period" && !endOnly && endsOn < startsOn) {
      setError(t("errEndBeforeStart"));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    let basicsSaved = false;
    let linkRotated = false;
    try {
      if (basicsDirty) {
        const saved = await onSaveBasics({
          title: title.trim(),
          description: description.trim(),
          ruleSections: rulesPayload(ruleSections),
          startsOn: scheduleMode === "period" && !endOnly ? startsOn : null,
          endsOn: scheduleMode === "period" ? endsOn : null,
        });
        linkRotated = saved?.linkRotated === true;
        basicsSaved = true;
      }
      if (participantsDirty) await onSaveParticipants(selected);
      setSuccess(linkRotated ? t("changesSavedNewLink") : t("changesSaved"));
    } catch (cause) {
      setError(basicsSaved ? t("savedDetailsOnly", { error: f.error(cause) }) : f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeading title={t("basicsTitle")} />
      {lead ? <div className="mb-4">{lead}</div> : null}
      <form onSubmit={save}>
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          {/* What the challenge is called and what it asks, in one box. */}
          <BoxSection title={t("titleLabel")}>
            <div className="space-y-5">
              <input className={inputClass} aria-label={t("titleLabel")} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} />
              <Field label={t("descriptionLabel")} optional>
                <textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={locked} />
              </Field>
              <Field label={t("rulesLabel")} hint={t("rulesHint")} optional plain>
                <RuleSectionsEditor value={ruleSections} onChange={setRuleSections} disabled={locked} />
              </Field>
            </div>
          </BoxSection>

          <BoxSection title={t("scheduleLegend")}>
            {endOnly ? (
              <>
                <SelectableCards
                  value={scheduleMode}
                  onChange={setScheduleMode}
                  options={[
                    { value: "none", label: t("scheduleNone"), hint: livingList ? t("livingListBody") : t("scheduleNoneHint") },
                    { value: "period", label: t("scheduleEnd"), hint: t("scheduleEndHint") },
                  ]}
                />
                {scheduleMode === "period" ? (
                  <div className="mt-3">
                    <Field label={t("scheduleEndLabel")}>
                      <input className={inputClass} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
                    </Field>
                  </div>
                ) : null}
              </>
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
          </BoxSection>
        </fieldset>

        {!isPersonal ? (
          <div className="mt-4">
          <BoxSection title={t("participantsTitle")} hint={t("participantsSubtitle")}>
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
                      <CheckCircle on={checked} />
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
          </BoxSection>
          </div>
        ) : null}

        <div className={cx("z-10 mt-8 border-[var(--line)] py-3", dirty ? "sticky bottom-0 -mx-4 border-t bg-[color-mix(in_srgb,var(--canvas)_92%,transparent)] px-4 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border" : "px-0")}>
          <StatusMessage error={error} success={success} />
          {locked ? null : (
            <div className="space-y-2">
              <span className="block text-xs text-[var(--muted)]" aria-live="polite">{dirty ? t("unsavedChanges") : null}</span>
              <Button type="submit" className="w-full px-6" disabled={saving || !dirty}>{saving ? tc("saving") : t("saveBasics")}</Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

/** The small plain icons at the end of a row (move up, move down, settings): one size, one colour, no background. */
const rowIconClass = "grid h-8 w-8 flex-none cursor-pointer place-items-center text-[var(--muted)] transition hover:text-[var(--ink-strong)] disabled:cursor-default disabled:opacity-25 disabled:hover:text-[var(--muted)]";

function AdminFields({
  challenge,
  onSave,
  onRenameType,
  onSetExpectation,
  onSetTracking,
  onAddShared,
  onRemoveType,
}: {
  challenge: ChallengeDetail;
  /** `deleteAnswers`: a removed field that already has answers takes them with it (asked for first). */
  onSave: (entryTypeId: Id, fields: ChallengeField[], deleteAnswers?: boolean) => Promise<void>;
  onRenameType: (entryTypeId: Id, name: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onSetTracking: (propertyKey: string | false) => Promise<void>;
  onAddShared: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
}) {
  const tCount = useTranslations("countSettings");
  // What a count on these items can run up to: their library's number properties (a book's pages, a route's distance).
  const { properties: libraryProperties } = useLibraryProperties(challenge.libraries?.[0] ?? null);
  const countGoals: CountGoalOption[] = countGoalOptions(libraryProperties, tCount("goalPageCount"));
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
  const trackingType = challenge.entryTypes.find((type) => type.purpose === "progress");
  const trackingField = trackingType?.fields.find((field) => field.config?.count) ?? null;
  const trackingGoal = trackingField?.config?.count?.goal;
  const trackedProperty = trackingGoal && "from" in trackingGoal ? trackingGoal.from : "";
  const [trackingProperty, setTrackingProperty] = useState(trackedProperty);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingConfirm, setTrackingConfirm] = useState<{ action: "change" | "off"; propertyKey?: string } | null>(null);
  const chosenTrackingProperty = trackingProperty || trackedProperty || countGoals[0]?.key || "";
  // Progress has its own setting below the fields, regardless of whether it came from an old reading template or
  // the new Manage action. It should not appear again among the ordinary response forms.
  const ownTypes = challenge.entryTypes.filter((type) => type.purpose !== "progress");
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
  const [managingType, setManagingType] = useState(false);
  const locked = challenge.status === "closed";
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

  async function commit(next: ChallengeField[], message: string, deleteAnswers = false) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(selectedTypeId, cleanFields(next), deleteAnswers);
      setFields(next);
      setSuccess(message);
    } catch (cause) {
      // Removing is confirmed in the field's own modal, which shows the error itself.
      if (deleteAnswers) throw cause;
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
      {/* Adding a field: the round "+" beside the title, as on Home (on a phone too, so not PageHeading's stacked action). */}
      <div className="mb-7 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{t("fieldsTitle")}</h1>
        {!locked ? (
          <button
            type="button"
            onClick={() => { setError(null); setEditing("new"); }}
            aria-label={t("addField")}
            title={t("addField")}
            className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        ) : null}
      </div>
      {types.length > 1 || canAddShared || activeType?.id ? (
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
                  "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition",
                  active ? "border-[var(--main)] bg-[var(--main)] font-medium text-white" : "border-[var(--line)] hover:border-[var(--main-line)]",
                )}
              >
                {type.answerScope === "shared" ? <SharedGlyph /> : null}
                {type.name}
                {type.answerScope === "shared" ? <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-medium", active ? "bg-white/20" : "bg-[var(--main)]/10")}>{tSr("badge")}</span> : null}
              </button>
            );
          })}
          {canAddShared ? (
            <button
              type="button"
              onClick={() => { setError(null); setAddingShared(true); }}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-4 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
            >
              ＋ {tSr("addShort")}
            </button>
          ) : null}
          {/* The picked response's own settings (its name, removing it): at the end of the row that picks it. */}
          {activeType?.id && !locked ? (
            <button type="button" aria-label={t("responseSettings")} title={t("responseSettings")} onClick={() => { setError(null); setManagingType(true); }} className={cx(rowIconClass, "ml-auto")}>
              <SlidersIcon className="h-4 w-4" />
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
                  <button type="button" className={rowIconClass} disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={tf("moveUp")}>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" className={rowIconClass} disabled={index === fields.length - 1 || busy} onClick={() => move(index, 1)} aria-label={tf("moveDown")}>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" aria-label={t("fieldSettings", { label: field.label })} title={t("edit")} onClick={() => { setError(null); setEditing(field); }} className={rowIconClass}>
                    <SlidersIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : locked
        ? <EmptyState title={t("fieldsEmptyTitle")} />
        : <EmptyState title={t("fieldsEmptyTitle")} onClick={() => { setError(null); setEditing("new"); }} />}

      {editing ? (
        <FieldEditorDialog
          field={editing === "new" ? undefined : editing}
          takenKeys={fields.filter((candidate) => candidate !== editing).map((candidate) => candidate.key)}
          lockType={challenge.status !== "draft" && editing !== "new" && Boolean(editing.id)}
          countable={activeType && (activeType.cardinality === "once_per_day" || activeType.cardinality === "once_per_item_day") ? { goals: countGoals } : undefined}
          onCancel={() => setEditing(null)}
          onRemove={editing === "new" || fields.length < 2 ? undefined : async () => {
            await commit(fields.filter((candidate) => candidate !== editing), t("fieldsSaved"), true);
            setEditing(null);
          }}
          onSave={async (built) => {
            const next = editing === "new"
              ? [...fields, built]
              : fields.map((candidate) => candidate === editing ? { ...candidate, ...built } : candidate);
            await commit(next, editing === "new" ? t("fieldAdded") : t("fieldsSaved"));
            setEditing(null);
          }}
        />
      ) : null}

      {addingShared ? (
        <AddSharedResponseDialog
          onCancel={() => setAddingShared(false)}
          onAdd={async (payload) => { await onAddShared(payload); setAddingShared(false); }}
        />
      ) : null}
      {managingType && activeType ? (
        <ResponseSettingsDialog
          type={activeType}
          onCancel={() => setManagingType(false)}
          onRename={async (name) => { await onRenameType(activeType.id, name); setManagingType(false); setSuccess(t("fieldsSaved")); }}
          onRemove={removable ? async (confirmed) => { await onRemoveType(activeType.id, confirmed); setManagingType(false); } : undefined}
        />
      ) : null}

      {challenge.libraries?.length || canToggleExpectation || hasExpectation ? (
        <div className="mt-8 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
          {challenge.libraries?.length ? (
            <div className="p-5">
              <Toggle
                checked={Boolean(trackingType)}
                disabled={locked || trackingBusy || (!trackingType && !chosenTrackingProperty)}
                onChange={(next) => {
                  if (!next) { setTrackingConfirm({ action: "off" }); return; }
                  setTrackingBusy(true);
                  setError(null);
                  onSetTracking(chosenTrackingProperty)
                    .then(() => setSuccess(t("trackingStarted")))
                    .catch((cause: unknown) => setError(f.error(cause)))
                    .finally(() => setTrackingBusy(false));
                }}
                bare
                label={t("trackingTitle")}
                hint={t("trackingHint")}
              />
              {/* Which number it runs up to is only asked once progress is on; turning it on starts from the first one. */}
              {!trackingType ? (
                libraryProperties !== null && !countGoals.length ? <p className="mt-4 text-sm text-[var(--muted)]">{t("trackingNoProperty")}</p> : null
              ) : libraryProperties === null ? (
                <p className="mt-4 text-sm text-[var(--muted)]">{t("trackingLoading")}</p>
              ) : countGoals.length ? (
                <div className="mt-4">
                  <Select
                    ariaLabel={t("trackingTitle")}
                    value={chosenTrackingProperty}
                    onChange={setTrackingProperty}
                    disabled={locked || trackingBusy}
                    options={countGoals.map((goal) => ({ value: goal.key, label: goal.label }))}
                  />
                  <Button
                    className="mt-3 w-full"
                    disabled={locked || trackingBusy || !chosenTrackingProperty || chosenTrackingProperty === trackedProperty}
                    onClick={() => setTrackingConfirm({ action: "change", propertyKey: chosenTrackingProperty })}
                  >
                    {t("trackingSave")}
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">{t("trackingNoProperty")}</p>
              )}
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
      {trackingConfirm ? (
        <ConfirmDialog
          title={trackingConfirm.action === "off" ? t("trackingOffConfirmTitle") : t("trackingChangeConfirmTitle")}
          body={trackingConfirm.action === "off" ? t("trackingOffConfirmBody") : t("trackingChangeConfirmBody")}
          confirmLabel={trackingConfirm.action === "off" ? t("trackingTurnOff") : t("trackingChange")}
          danger
          onClose={() => setTrackingConfirm(null)}
          onConfirm={async () => {
            await onSetTracking(trackingConfirm.action === "off" ? false : trackingConfirm.propertyKey!);
            setSuccess(trackingConfirm.action === "off" ? t("trackingStopped") : t("trackingSaved"));
            setTrackingConfirm(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function FieldEditorDialog({
  field,
  takenKeys,
  lockType,
  countable,
  onCancel,
  onSave,
  onRemove,
}: {
  field?: ChallengeField;
  takenKeys: string[];
  lockType: boolean;
  /** The form is answered day by day, so a number on it can be a count; `goals` are the item properties it can count up to. */
  countable?: { goals: CountGoalOption[] };
  onCancel: () => void;
  onSave: (field: ChallengeField) => Promise<void>;
  /** Removes the field and whatever was already answered in it (confirmed inside this modal). */
  onRemove?: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tf = useTranslations("fields");
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
      submitLabel={field ? undefined : t("addField")}
      onDelete={onRemove ? { body: t("fieldDeleteBody"), onConfirm: onRemove } : undefined}
    >
      <Field label={tf("labelLabel")}>
        <input className={inputClass} value={draft.label} maxLength={100} required onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
      </Field>
      <Field label={tf("typeLabel")}>
        <Select ariaLabel={tf("typeLabel")} value={draft.type} disabled={lockType} onChange={(type) => setDraft((current) => ({ ...current, type, config: newFieldConfig(type) }))} options={FIELD_TYPES.map((value) => ({ value, label: tf(`type.${value}`) }))} />
      </Field>
      {hasConfig ? <FieldConfigInputs field={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} /> : null}
      {countable && draft.type === "number" ? (
        <CountSettings field={draft} goals={countable.goals} onChange={(count) => setDraft((current) => ({ ...current, config: { ...current.config, count } }))} />
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
  /** Takes the item out (with its entries, to the bin); `entryCount` warns how many go with it. */
  onRemove?: () => Promise<void>;
  entryCount?: number;
  onSave: (payload: ItemUpdatePayload) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
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
  // The group's switch, then the library's own: either can turn "who recommended it" off.
  const askRecommender = recommendationsEnabled && isItem && showsRecommender(properties);
  const source = useRecommenderSource(scope, askRecommender);
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
        ...(askRecommender && recommenderChanged ? recommenderBody(recommender, "item", true) : {}),
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
      onDelete={onRemove ? {
        body: entryCount > 0 ? t("itemRemoveConfirmWithEntries", { title: item.title, count: entryCount }) : t("itemRemoveConfirm", { title: item.title }),
        busyLabel: t("removing"),
        onConfirm: onRemove,
      } : undefined}
    >
      <Field label={t("itemTitleLabel")}>
        <input className={inputClass} value={draft.title} onChange={(event) => set({ title: event.target.value })} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} />
      </Field>
      <Field label={t("itemDescriptionLabel")} optional>
        <textarea className={inputClass} rows={3} value={draft.description} onChange={(event) => set({ description: event.target.value })} maxLength={2000} placeholder={t("itemDescriptionPlaceholder")} />
      </Field>
      {askRecommender ? (
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
 * Manage › General's one item job: "Organise" — spreading the items so similar ones don't bunch up. Only when it
 * applies (three items or more, with a library detail to spread); everything else about items lives on Today.
 */
export function AdminItemsSection({ challenge, entries, onReorder }: {
  challenge: ChallengeDetail;
  entries: Entry[];
  /** Saves a new order (positions, stages unchanged). */
  onReorder: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position: number }>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tOrganise = useTranslations("organise");
  const f = useGoaFormat();
  const linked = challenge.libraries ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [organising, setOrganising] = useState(false);
  // Items someone already logged keep their place; the rest are spread out.
  const { properties: libraryProperties } = useLibraryProperties(linked[0] ?? null);
  const organiseInput = challenge.submissionMode === "item" && linked.length
    ? organiseFromItems(
        [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        libraryProperties ?? [],
        new Set(entries.map((entry) => itemIdForEntry(entry)).filter((id): id is Id => Boolean(id))),
        (key) => tOrganise(`property.${key}`),
      )
    : null;
  if (!organiseInput || !canOrganise(organiseInput) || challenge.status === "closed") return null;

  return (
    <section className="mt-6">
      <Button variant="secondary" className="w-full rounded-full" onClick={() => setOrganising(true)}>
        {/* A small chart: the order being worked out. */}
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4.5 16v-5M10 16V4M15.5 16V8" /></svg>
        {t("organiseItems")}
      </Button>
      <div className="mt-3"><StatusMessage error={error} success={success} /></div>
      {organising ? (
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
  onRenameEntryType,
  onSetExpectation,
  onSetPageCount,
  onAddSharedResponse,
  onRemoveEntryType,
  onSaveCheckpoints,
  onAssignCheckpointItems,
  onPublishResult,
  onUnpublishResult,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  /** Resolves with `linkRotated` when new dates replaced a published results link. */
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<{ linkRotated?: boolean } | undefined | void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId?: Id; target?: "personal"; mode: CopyMode }) => Promise<CopyResult>;
  onOpenCopy: (challengeId: Id) => void;
  isPlatformAdmin?: boolean;
  onPublishTemplate: () => Promise<void>;
  onUnpublishTemplate: () => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (entryTypeId: Id, fields: ChallengeField[], deleteAnswers?: boolean) => Promise<void>;
  /** Renames what one check-in is called ("Workout") on a challenge that logs several items per check-in. */
  onRenameEntryType: (entryTypeId: Id, name: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  /** Starts or edits item progress using a numeric library property's stable key. */
  onSetPageCount: (propertyKey: string | false) => Promise<void>;
  onAddSharedResponse: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
  onRemoveEntryType: (entryTypeId: Id, confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
  onSaveSharedPolicy: (entryTypeId: Id, policy: SharedEditPolicy) => Promise<void>;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssignCheckpointItems: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position?: number }>) => Promise<void>;
  onPublishResult: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublishResult: () => Promise<void>;
  csrfToken: string;
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
          <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="flex-none" labelClassName="sr-only" />
          <span className="h-5 w-px flex-none bg-[var(--line)] sm:hidden [.has-dock_&]:hidden" aria-hidden="true" />
          <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{challenge.title}</h1>
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
            <AdminGeneral challenge={challenge} group={group} isPersonal={isPersonal} onSaveBasics={onSaveBasics} onSaveParticipants={onSaveParticipants}
              lead={<ChallengeStatePanel challenge={challenge} onTransition={onTransition} />} />
            <div className="mx-auto max-w-2xl">
              <AdminItemsSection challenge={challenge} entries={entries} onReorder={onAssignCheckpointItems} />
            </div>
          </>
        ) : null}
        {activeTab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.visibilityPolicy}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} onRenameType={onRenameEntryType} onSetExpectation={onSetExpectation} onSetTracking={onSetPageCount} onAddShared={onAddSharedResponse} onRemoveType={onRemoveEntryType} /> : null}
        {activeTab === "checkpoints" ? <CheckpointPlanner key={`${challenge.id}:${challenge.checkpoints.map((cp) => cp.id).join(",")}`} challenge={challenge} onSaveCheckpoints={onSaveCheckpoints} onAssign={onAssignCheckpointItems} /> : null}
        {activeTab === "settings" ? <ChallengeSettings challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onOpenCopy={onOpenCopy} onDelete={onDelete} isPlatformAdmin={isPlatformAdmin} onPublishTemplate={onPublishTemplate} onUnpublishTemplate={onUnpublishTemplate} onPublish={onPublishResult} onUnpublish={onUnpublishResult} /> : null}
      </div>
    </main>
  );
}
