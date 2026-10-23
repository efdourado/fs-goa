"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { ChallengeDraftForm } from "../challenge-draft";
import { Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { cleanFields, FieldBuilder, presetFields, sessionPresetFields, sharedPresetFields } from "../fields";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { NewLibraryDialog } from "../library-dialogs";
import { type CatalogScope, LibraryPills, libraryChoices, librarySuggestions, useCatalogLibraries } from "../libraries";
import { RecipeIcon, type RecipeIconName } from "../recipe-icons";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeResponseInput, ChallengeRule, CreatableRecipeKey, GroupSummary, Id, SharedEditPolicy } from "../types";
import { AddRow, ArrowRightIcon, BackButton, backLinkClass, Button, cardClass, ChevronIcon, CircleMinusIcon, cx, EmptyState, Field, inputClass, labelClass, PageHeading, rowIconClass, SchedulePeriodFields, SelectableCards, StatusMessage, Toggle } from "../ui";

/** Where the items come from: the books of a daily-progress challenge, the library a list picks, or none at all. */
type EditorLibrary = { id: Id | null; kind: string; source: "screens" | "pages" | "tables" | "custom"; label: string | null };

/**
 * The persisted creation shape. The UI presents only two top-level choices (with or without items); `list` and
 * `progress` are the recording behaviours inside the item-based choice. Keeping these values preserves drafts and
 * the existing server recipes.
 */
export type ChallengeStructure = "list" | "progress" | "daily";

const STRUCTURES: Array<{ key: ChallengeStructure; icon: RecipeIconName; scheduleMode: "period" | "none" }> = [
  { key: "list", icon: "custom", scheduleMode: "none" },
  { key: "progress", icon: "library", scheduleMode: "period" },
  { key: "daily", icon: "habit", scheduleMode: "none" },
];

type CreationType = "items" | "daily";
type ItemRecordingMode = "single" | "progress" | "session";
type ResponseDraft = ChallengeResponseInput & { clientKey: string };

const CREATION_TYPES: Array<{ key: CreationType; icon: RecipeIconName }> = [
  { key: "items", icon: "library" },
  { key: "daily", icon: "habit" },
];

/**
 * The server template a structure becomes. A list keeps the films and books templates (their ranking and
 * group stats) when it's one answer per person on those libraries; anything else on a list is the open one.
 */
function recipeFor(structure: ChallengeStructure, libraryKind: string | null, recording: "single" | "session", scope: "individual" | "shared"): CreatableRecipeKey {
  // Books keep the reading club, which knows their pages; any other library gets the same shape, counted to a goal.
  if (structure === "progress") return libraryKind === "book" ? "library" : "progress";
  if (structure === "daily") return "habit";
  if (recording === "session" || scope === "shared") return "custom";
  return libraryKind === "film" ? "cinema" : libraryKind === "book" ? "bookshelf" : "custom";
}

/**
 * Asked before the app leaves this screen for `proceed`'s destination: returns true when it takes over (to ask
 * whether to keep a draft) and will call `proceed` itself once answered.
 */
export type LeaveGuard = (proceed: () => void) => boolean;

/** The required things first (template and title, columns, then the list), the optional details after, then who's in. */
type StepKey = "setup" | "fields" | "checkpoints" | "details" | "people";


export function CreateChallengeScreen({
  group,
  personal = false,
  onBack,
  backLabel,
  onCreate,
  initialDraft,
  onKeepDraft,
  onClearDraft,
  registerLeaveGuard,
}: {
  group?: GroupSummary;
  /** Solo mode: no "people" step, no group chrome, submits to the personal workspace. */
  personal?: boolean;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
  /** The form as it was left, when it's being picked up again. */
  initialDraft?: ChallengeDraftForm;
  /** Keeps the form as the person's one draft (it replaces any earlier one). */
  onKeepDraft?: (form: ChallengeDraftForm) => void;
  /** Lets go of the kept draft: the challenge was made, or this form was thrown away. */
  onClearDraft?: () => void;
  /** Lets the app ask this screen before going anywhere else (see `LeaveGuard`). */
  registerLeaveGuard?: (guard: LeaveGuard | null) => void;
}) {
  const t = useTranslations("createChallenge");
  const tp = useTranslations("fields.preset");
  const f = useGoaFormat();
  const draft = initialDraft;
  const [step, setStep] = useState(draft?.step ?? 1);
  // A list is already chosen, so the page opens on something to look at rather than an empty choice.
  // Progress is enabled after creation in Manage. An older locally-saved progress draft resumes as a normal list.
  const [structure, setStructure] = useState<ChallengeStructure>(draft?.structure === "progress" ? "list" : draft?.structure ?? "list");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [ruleSections, setRuleSections] = useState<ChallengeRule[]>(draft?.ruleSections ?? []);
  const [showOptional, setShowOptional] = useState(draft?.showOptional ?? false);
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(draft?.scheduleMode ?? STRUCTURES[0].scheduleMode);
  const [startsOn, setStartsOn] = useState(draft?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(draft?.endsOn ?? "");
  const [fields, setFields] = useState<ChallengeField[]>(() => draft?.fields ?? presetFields("custom", (key) => tp(key)));
  // A single-item response can belong to each participant or be one shared answer for the group.
  const [answerScope, setAnswerScope] = useState<"individual" | "shared">(draft?.answerScope ?? "individual");
  const [additionalResponses, setAdditionalResponses] = useState<ResponseDraft[]>(() =>
    (draft?.additionalResponses ?? []).map((response, index) => ({ ...response, clientKey: `draft-${index}` })),
  );
  const [primaryResponseKey, setPrimaryResponseKey] = useState("primary");
  const [openResponse, setOpenResponse] = useState<string | null>("primary");
  const responseSequence = useRef(0);
  // A list only: one response per item, or one check-in that holds a record for each of several items.
  const [recordingMode, setRecordingMode] = useState<"single" | "session">(draft?.recordingMode ?? "single");
  const [sessionName, setSessionName] = useState(draft?.sessionName ?? "");
  const sharedEditPolicy: SharedEditPolicy = "members_fill_admin_corrects";
  const [fieldsTouched, setFieldsTouched] = useState(draft?.fieldsTouched ?? false);
  // Custom starts without "when did it happen" — that date belongs to the response, not to the match.
  // Each item carries its own date and time (a match's kickoff), kept on the library's items.
  const [itemDates, setItemDates] = useState(draft?.itemDates ?? false);
  const [expectation, setExpectation] = useState(draft?.expectation ?? false);
  const [cineItems, setCineItems] = useState<CineRow[]>(draft?.cineItems ?? []);
  const [participantIds, setParticipantIds] = useState<Id[]>(draft?.participantIds ?? group?.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Leaving part-way: where the way out was going, held while "save a draft or discard?" is asked.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  // Set once the challenge is made (or saved, or discarded), so the way out no longer asks.
  const finished = useRef(false);
  // Worth keeping only once something real is filled in (a title, columns, items, dates, a description or rules);
  // picking a template alone isn't.
  const started = Boolean(title.trim() || description.trim() || startsOn || endsOn) || fieldsTouched || additionalResponses.length > 0
    || cineItems.length > 0 || ruleSections.length > 0;
  const startedRef = useRef(started);
  useEffect(() => { startedRef.current = started; }, [started]);
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard((proceed) => {
      if (finished.current || !startedRef.current) return false;
      setLeaving(() => proceed);
      return true;
    });
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard]);
  // Closing the tab or reloading: the browser's own "leave this page?" is all a page can offer there.
  useEffect(() => {
    if (!started) return;
    const warn = (event: BeforeUnloadEvent) => { if (!finished.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [started]);
  // An item-based challenge's one library (none to start with: the person picks or makes one).
  const [pickedKind, setPickedKind] = useState<string | null>(draft?.pickedKind ?? null);
  const [itemProblem, setItemProblem] = useState<"author" | "schedule" | null>(null);
  const [newLibrary, setNewLibrary] = useState(false);
  const scope: CatalogScope = personal || !group ? "personal" : { groupId: group.id };
  const { data: libraries, reload: reloadLibraries } = useCatalogLibraries(scope);
  const recommendationsEnabled = personal || group?.recommendationsEnabled !== false;
  const itemInputs = cineRowsToInput(cineItems);
  const recipe = recipeFor(structure, pickedKind, recordingMode, answerScope);
  const tracksCatalog = structure !== "daily";
  const creationType: CreationType = tracksCatalog ? "items" : "daily";
  const itemRecordingMode: ItemRecordingMode = structure === "progress" ? "progress" : recordingMode;
  const choices = libraryChoices(libraries ?? []);
  const suggestions = librarySuggestions(libraries ?? []);
  // The challenge's one library, picked with the structure.
  const pickedLibrary = tracksCatalog ? [...choices, ...suggestions].find((choice) => choice.kind === pickedKind) ?? null : null;
  const itemLibraries: EditorLibrary[] = pickedLibrary ? [pickedLibrary] : [];
  const allBooks = itemLibraries.length > 0 && itemLibraries.every((library) => library.kind === "book");
  // Expectation is the pre-watch rating for the two "rate each title" recipes.
  const canOfferExpectation = recipe === "cinema" || recipe === "bookshelf";
  // A no-catalog recipe (a daily habit) has nothing to list, so the list step
  // never appears; a personal challenge has no people step.
  const stepKeys: StepKey[] = [
    "setup",
    "fields",
    ...(tracksCatalog ? (["checkpoints"] as const) : []),
    "details",
    ...(personal ? [] : (["people"] as const)),
  ];
  const lastStep = stepKeys.length;
  const stepKey = stepKeys[Math.min(step, lastStep) - 1];
  const navColsClass = stepKeys.length === 3 ? "grid-cols-3" : stepKeys.length === 4 ? "grid-cols-4" : "grid-cols-5";
  const optionalOpen = showOptional || Boolean(description.trim()) || ruleSections.length > 0;
  const responseRows: Array<ResponseDraft & { primary?: true }> = [
    { clientKey: primaryResponseKey, name: "", answerScope, fields, primary: true },
    ...additionalResponses,
  ];
  const totalFields = fields.length + (tracksCatalog && itemRecordingMode === "single"
    ? additionalResponses.reduce((total, response) => total + response.fields.length, 0)
    : 0);

  /**
   * The columns a structure starts with: a rating and a comment for films and books, just a comment for any other
   * library, a check-in's weight and reps, a group result, pages a day, or a note for a daily check-in.
   */
  function startingFields(next: ChallengeStructure, kind: string | null, recording: "single" | "session", scope: "individual" | "shared"): ChallengeField[] {
    const label = (key: string) => tp(key);
    if (next === "progress") {
      if (kind === "book") return presetFields("library", label);
      // How much today, counted along a road: the goal is chosen right under the columns.
      return [{ key: "quantidade", label: t("progressValueDefault"), type: "number", required: true, config: { min: 0, count: { goal: null, entry: "position", showDates: true } } }];
    }
    if (next === "daily") return presetFields("habit", label);
    if (recording === "session") return sessionPresetFields(label);
    if (scope === "shared") return sharedPresetFields(label);
    return presetFields(kind === "film" || kind === "book" ? "cinema" : "custom", label);
  }

  function chooseStructure(next: ChallengeStructure) {
    if (next === structure) return;
    const meta = STRUCTURES.find((entry) => entry.key === next)!;
    const kind = next === "daily" ? null : pickedKind;
    setStructure(next);
    setPickedKind(kind);
    setFields(startingFields(next, kind, "single", answerScope));
    setRecordingMode("single");
    setSessionName("");
    setFieldsTouched(false);
    setItemDates(false);
    setScheduleMode(meta.scheduleMode);
    setCineItems([]);
  }

  function chooseCreationType(next: CreationType) {
    if (next === creationType) return;
    chooseStructure(next === "daily" ? "daily" : "list");
  }

  function chooseItemRecording(next: ItemRecordingMode) {
    if (next === itemRecordingMode) return;
    if (next === "progress") {
      chooseStructure("progress");
      return;
    }
    if (structure === "progress") {
      // Moving between one-off answers and progress changes the entry cardinality, so start with fitting fields.
      chooseStructure("list");
      setRecordingMode(next);
      setFields(startingFields("list", pickedKind, next, next === "session" ? "individual" : answerScope));
      return;
    }
    chooseRecording(next);
  }

  // The starting columns follow each choice below, but never once the creator has edited them.
  function chooseRecording(next: "single" | "session") {
    setRecordingMode(next);
    if (!fieldsTouched) setFields(startingFields(structure, pickedKind, next, next === "session" ? "individual" : answerScope));
  }

  function chooseScope(next: "individual" | "shared") {
    setAnswerScope(next);
    if (!fieldsTouched) setFields(startingFields(structure, pickedKind, recordingMode, next));
  }

  function addResponse() {
    const nextScope = answerScope === "individual" ? "shared" : "individual";
    const clientKey = `new-${responseSequence.current += 1}`;
    // One new row is one new question/measure. More rows are added with the single rule-style control below.
    const responseFields = nextScope === "shared" ? sharedPresetFields((key) => tp(key)) : presetFields("custom", (key) => tp(key));
    setAdditionalResponses((current) => [...current, {
      clientKey,
      name: responseFields[0]?.label ?? "",
      answerScope: nextScope,
      fields: responseFields,
    }]);
    setFieldsTouched(true);
    setOpenResponse(clientKey);
  }

  function updateResponse(clientKey: string, patch: Partial<ChallengeResponseInput>) {
    setAdditionalResponses((current) => current.map((response) => response.clientKey === clientKey ? { ...response, ...patch } : response));
    setFieldsTouched(true);
  }

  function applyResponseOrder(next: Array<ResponseDraft & { primary?: true }>) {
    if (!next.length) return;
    const [nextPrimary, ...nextAdditional] = next;
    setPrimaryResponseKey(nextPrimary.clientKey);
    setFields(nextPrimary.fields);
    setAnswerScope(nextPrimary.answerScope);
    setAdditionalResponses(nextAdditional.map(({ clientKey: key, name, answerScope: scope, fields: responseFields }) => ({
      clientKey: key,
      name,
      answerScope: scope,
      fields: responseFields,
    })));
    setFieldsTouched(true);
  }

  function removeResponse(clientKey: string) {
    if (responseRows.length <= 1) return;
    applyResponseOrder(responseRows.filter((response) => response.clientKey !== clientKey));
    setOpenResponse((current) => current === clientKey ? null : current);
  }

  function moveResponse(clientKey: string, offset: -1 | 1) {
    const index = responseRows.findIndex((response) => response.clientKey === clientKey);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= responseRows.length) return;
    const next = [...responseRows];
    [next[index], next[target]] = [next[target], next[index]];
    applyResponseOrder(next);
  }

  function pickLibrary(kind: string) {
    if (kind === pickedKind) return;
    // Items listed for the library being swapped out go with it.
    setCineItems((rows) => rows.filter((row) => !row.libraryKind || row.libraryKind === kind));
    setPickedKind(kind);
    if (!fieldsTouched) setFields(startingFields(structure, kind, recordingMode, answerScope));
  }

  /** The dates and the rules: what the details step needs before the challenge can be made. */
  function detailsProblem(): string | null {
    if (scheduleMode === "period" && (!startsOn || !endsOn)) return t("errPeriod");
    if (scheduleMode === "period" && endsOn < startsOn) return t("errEndBeforeStart");
    if (ruleSections.some((rule) =>
      !rule.title.trim() || !rule.description.trim()
      || (rule.topics ?? []).some((topic) => !topic.title.trim() || !topic.description.trim())
    )) return t("errRules");
    return null;
  }

  /** One source of truth for both Continue and the next step tab. */
  function problemForStep(key: StepKey): string | null {
    if (key === "setup") {
      if (tracksCatalog && !pickedLibrary) return t("errPickLibrary");
      if (!title.trim()) return t("errTitle");
    }
    if (key === "fields") {
      if (!fields.length) return t("errNoFields");
      if (fields.some((field) => !field.label.trim())) return t("errFieldLabel");
      if (tracksCatalog && itemRecordingMode === "single") {
        if (additionalResponses.some((response) => !response.fields.length)) return t("errNoFields");
        if (additionalResponses.some((response) => response.fields.some((field) => !field.label.trim()))) return t("errFieldLabel");
        if (fields.length + additionalResponses.reduce((total, response) => total + response.fields.length, 0) > 30) return t("errTooManyFields");
      }
    }
    if (key === "checkpoints") {
      if (!itemLibraries.length) return t("errPickLibrary");
      if (tracksCatalog && !itemInputs.length) return allBooks ? t("errNoBooks") : t("errNoItems");
      if (itemProblem === "author") return t("errNoAuthor");
      if (itemProblem === "schedule") return t("errItemSchedule");
    }
    if (key === "details") return detailsProblem();
    return null;
  }

  const currentStepReady = problemForStep(stepKey) === null;
  const formReady = stepKeys.every((key) => problemForStep(key) === null);

  function nextStep() {
    setError(null);
    const problem = problemForStep(stepKey);
    if (problem) {
      setError(problem);
      return;
    }
    setStep((current) => Math.min(lastStep, current + 1));
  }

  async function submit() {
    if (!title.trim()) {
      setError(t("errTitle"));
      return;
    }
    const problem = detailsProblem();
    if (problem) {
      setError(problem);
      return;
    }
    if (tracksCatalog && !itemLibraries.length) {
      setError(t("errPickLibrary"));
      return;
    }
    if (tracksCatalog && !itemInputs.length) {
      setError(allBooks ? t("errNoBooks") : t("errNoItems"));
      return;
    }
    if (itemProblem === "author") {
      setError(t("errNoAuthor"));
      return;
    }
    if (itemProblem === "schedule") {
      setError(t("errItemSchedule"));
      return;
    }
    setBusy(true);
    setError(null);
    finished.current = true;
    try {
      await onCreate(buildInput());
      onClearDraft?.();
    } catch (cause) {
      finished.current = false;
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  /** The challenge as the finished form describes it. */
  function buildInput(): ChallengeCreationInput {
    return {
      recipe,
      // The open list names its library in `libraries` (the only library field the request carries); the films
      // and books templates bring their own.
      ...((recipe === "custom" || recipe === "progress") && pickedLibrary ? { libraries: [pickedLibrary.id ? { libraryId: pickedLibrary.id } : { libraryKind: pickedLibrary.kind }] } : {}),
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
      fields: cleanFields(fields),
      ...(tracksCatalog && itemRecordingMode === "single" && additionalResponses.length ? {
        additionalResponses: additionalResponses.map((response) => ({
          name: response.fields[0]?.label.trim() || response.name.trim(),
          answerScope: response.answerScope,
          fields: cleanFields(response.fields),
        })),
      } : {}),
      items: tracksCatalog ? itemInputs : [],
      generateDaily: false,
      expectation: canOfferExpectation && expectation,
      ...(recipe === "custom" && recordingMode === "session"
        ? { recordingMode, sessionName: sessionName.trim() || t("sessionNameDefault"), sessionNoteLabel: tp("comoFoi") }
        : recipe === "custom" ? { answerScope, ...(answerScope === "shared" ? { sharedEditPolicy } : {}) } : {}),
      ...(tracksCatalog && itemDates ? { itemDates: true } : {}),
      participantIds,
    };
  }

  /** Everything typed so far, as the draft that keeps it. */
  function draftForm(): ChallengeDraftForm {
    return {
      step, structure, title, description, ruleSections, showOptional, scheduleMode, startsOn, endsOn, fields, answerScope,
      additionalResponses: additionalResponses.map(({ name, answerScope: responseScope, fields: responseFields }) => ({ name, answerScope: responseScope, fields: responseFields })),
      recordingMode, sessionName, sharedEditPolicy, fieldsTouched, itemDates, expectation, cineItems, participantIds, pickedKind,
    };
  }

  function saveDraftAndLeave() {
    if (!leaving) return;
    finished.current = true;
    onKeepDraft?.(draftForm());
    const proceed = leaving;
    setLeaving(null);
    proceed();
  }

  function discardAndLeave() {
    if (!leaving) return;
    finished.current = true;
    // Throwing away a draft that was picked up again lets it go; a fresh form leaves an older draft alone.
    if (initialDraft) onClearDraft?.();
    const proceed = leaving;
    setLeaving(null);
    proceed();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
      <PageHeading title={personal ? t("personalTitle") : t("title")} description={personal ? t("personalSubtitle") : t("subtitle")} />
      <nav className={cx("mb-6 grid gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1", navColsClass)} aria-label={t("stepsNav")}>
        {stepKeys.map((key, index) => {
          const position = index + 1;
          const current = step === position;
          // A completed path stays navigable even after the person jumps back. Availability follows the data in
          // every earlier step, not the tab that happens to be open right now.
          const available = current || stepKeys.slice(0, index).every((previousKey) => problemForStep(previousKey) === null);
          const blocked = !current && !available;
          return (
            <button
              className={cx(
                "min-h-11 truncate rounded-xl px-2 text-xs font-light transition sm:text-sm",
                current && "cursor-default bg-[var(--paper)] text-[var(--ink)] shadow-sm",
                available && "cursor-pointer text-[var(--ink)] hover:bg-[var(--paper)]/75",
                blocked && "cursor-not-allowed text-[var(--muted)] opacity-45",
              )}
              type="button"
              onClick={() => { if (available) { setError(null); setStep(position); } }}
              disabled={blocked}
              key={key}
            >
              <span className="hidden sm:inline">{position}. </span>{t(`steps.${key}`)}
            </button>
          );
        })}
      </nav>

      <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
        {stepKey === "setup" ? (
          <div>
            <h2 className="text-xl font-light">{t("startTitle")}</h2>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
              {CREATION_TYPES.map((entry) => (
                <button className={cx("flex min-w-0 items-center gap-3 rounded-2xl border p-3.5 text-left transition sm:block sm:p-5", creationType === entry.key ? "border-[var(--main)] bg-[var(--main)] text-white ring-2 ring-[var(--main)]/25" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]")} type="button" aria-pressed={creationType === entry.key} onClick={() => chooseCreationType(entry.key)} key={entry.key}>
                  <span className="flex h-6 flex-none items-center sm:h-8" aria-hidden="true"><RecipeIcon name={entry.icon} className="h-5 w-5 sm:h-7 sm:w-7" /></span>
                  <span className="min-w-0">
                    <strong className="block text-[15px] leading-snug sm:mt-3 sm:text-lg">{t(`creationTypes.${entry.key}.name`)}</strong>
                    <span className={cx("mt-0.5 block text-xs leading-5 sm:text-sm sm:leading-6", creationType === entry.key ? "text-white/75" : "text-[var(--muted)]")}>{t(`creationTypes.${entry.key}.tagline`)}</span>
                  </span>
                </button>
              ))}
            </div>
            {tracksCatalog ? (
              <Field label={t("libraryLabel")} plain className="mt-6">
                <LibraryPills
                  choices={choices}
                  kind={pickedKind}
                  label={t("libraryLabel")}
                  onPick={(choice) => pickLibrary(choice.kind)}
                  onNew={() => setNewLibrary(true)}
                  suggestions={suggestions}
                />
              </Field>
            ) : null}
            <label className="mt-6 block"><span className={labelClass}>{t("titleLabel")}</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required placeholder={t(`structures.${structure}.name`)} /></label>
          </div>
        ) : null}

        {stepKey === "fields" ? (
          <div>
            <h2 className="text-xl font-light">{t("entriesTitle")}</h2>

            {tracksCatalog ? (
              <div className="mt-6 space-y-5">
                <SelectableCards
                  value={itemRecordingMode}
                  onChange={chooseItemRecording}
                  options={[
                    { value: "single", label: t("recordingSingle"), hint: t("recordingSingleHint") },
                    { value: "session", label: t("recordingSession"), hint: t("recordingSessionHint") },
                  ]}
                />
                {itemRecordingMode === "session" ? (
                  <Field label={t("sessionNameLabel")}>
                    <input className={inputClass} value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={60} placeholder={t("sessionNamePlaceholder")} />
                  </Field>
                ) : null}
              </div>
            ) : null}

            <div className={cx("mt-7", tracksCatalog && "border-t border-[var(--line)] pt-6")}>
              <h3 className="mb-5 text-base font-medium">{t(`fieldsConfigTitle.${tracksCatalog ? itemRecordingMode : "daily"}`)}</h3>
              {tracksCatalog && itemRecordingMode === "single" ? (
                <div>
                  <ol>
                    {responseRows.map((response, index) => {
                      const isOpen = openResponse === response.clientKey;
                      // The row names itself from the actual question/measure, just like a rule row uses its title.
                      const title = response.fields[0]?.label.trim() || t("responseN", { n: index + 1 });
                      return (
                        <li className="border-t border-[var(--line)] first:border-t-0" key={response.clientKey}>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => setOpenResponse(isOpen ? null : response.clientKey)}
                              className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3.5 py-2.5 text-left"
                            >
                              <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--ink)] text-[13px] font-medium tabular-nums">{index + 1}</span>
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-[15px] font-medium">{title}</span>
                                <span className="truncate text-xs text-[var(--muted)]">{t("responseSummary", { scope: t(response.answerScope === "shared" ? "scopeShared" : "scopeIndividual"), count: response.fields.length })}</span>
                              </span>
                            </button>
                            {responseRows.length > 1 ? <>
                              <button type="button" className={rowIconClass} disabled={index === 0} onClick={() => moveResponse(response.clientKey, -1)} aria-label={t("moveResponseUp")} title={t("moveResponseUp")}><ChevronIcon dir="up" /></button>
                              <button type="button" className={rowIconClass} disabled={index === responseRows.length - 1} onClick={() => moveResponse(response.clientKey, 1)} aria-label={t("moveResponseDown")} title={t("moveResponseDown")}><ChevronIcon dir="down" /></button>
                            </> : null}
                            {responseRows.length > 1 ? (
                                <button
                                  type="button"
                                  className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")}
                                  onClick={() => removeResponse(response.clientKey)}
                                  aria-label={t("removeResponse")}
                                  title={t("removeResponse")}
                                >
                                  <CircleMinusIcon className="h-[18px] w-[18px]" />
                                </button>
                            ) : null}
                          </div>
                          {isOpen ? (
                            <div className="space-y-5 pb-6 pl-[46px]">
                              <SelectableCards
                                value={response.answerScope}
                                onChange={(next) => response.primary ? chooseScope(next) : updateResponse(response.clientKey, { answerScope: next })}
                                options={[
                                  { value: "individual", label: t("scopeIndividual"), hint: t("scopeIndividualHint") },
                                  { value: "shared", label: t("scopeShared"), hint: t("scopeSharedHint") },
                                ]}
                              />
                              <div className="border-t border-[var(--line)] pt-5">
                                <FieldBuilder
                                  fields={response.fields}
                                  allowAdd={false}
                                  minimumFields={1}
                                  showOrdering={false}
                                  onChange={(next) => {
                                    if (response.primary) setFields(next);
                                    else updateResponse(response.clientKey, { fields: next });
                                    setFieldsTouched(true);
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {responseRows.length < 10 ? <AddRow label={t("responseWord")} ariaLabel={t("addResponse")} onClick={addResponse} /> : null}
                </div>
              ) : (
                <FieldBuilder fields={fields} onChange={(next) => { setFields(next); setFieldsTouched(true); }} />
              )}
            </div>

            {canOfferExpectation ? <label className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm"><input type="checkbox" className="mt-0.5" aria-label={t("expectationLabel")} checked={expectation} onChange={(event) => setExpectation(event.target.checked)} /><span><strong className="block">{t("expectationLabel")}</strong><span className="mt-0.5 block text-xs text-[var(--muted)]">{t("expectationHint")}</span></span></label> : null}
          </div>
        ) : null}

        {stepKey === "checkpoints" && tracksCatalog ? (
          <div>
            <h2 className="text-xl font-light">{t("checkpointsTitle")}</h2>
            {/* The hint follows what the list holds: films, books to rate, books to read day by day, or anything else. */}
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted)]">{structure === "progress" ? (pickedKind === "book" ? t("bookItemsHint") : t("progressItemsHint")) : pickedKind === "film" ? t("cineItemsHint") : pickedKind === "book" ? t("bookshelfItemsHint") : t("customItemsHint")}</p>
            <Toggle className="mb-5 bg-[var(--paper)]" checked={itemDates} onChange={setItemDates} label={t("itemDatesLabel")} hint={t("itemDatesHint")} />
            {itemLibraries.length ? (
              <CineItemsEditor
                value={cineItems}
                onChange={setCineItems}
                members={personal ? [] : group?.members ?? []}
                scope={scope}
                libraries={itemLibraries}
                recommendationsEnabled={recommendationsEnabled}
                showSchedule={itemDates}
                onProblem={setItemProblem}
              />
            ) : <EmptyState title={t("pickLibraryFirst")} />}
          </div>
        ) : null}

        {stepKey === "details" ? (
          <div>
            <h2 className="mb-5 text-xl font-light">{t("detailsTitle")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="sm:col-span-2">
                <legend className={labelClass}>{t("scheduleLegend")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "period" ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "period"} onClick={() => setScheduleMode("period")}><strong className="block text-sm">{t("schedulePeriod")}</strong><span className={cx("mt-1 block text-xs font-normal", scheduleMode === "period" ? "text-white/75" : "text-[var(--muted)]")}>{t("schedulePeriodHint")}</span></button>
                  <button className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "none" ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "none"} onClick={() => setScheduleMode("none")}><strong className="block text-sm">{t("scheduleNone")}</strong><span className={cx("mt-1 block text-xs font-normal", scheduleMode === "none" ? "text-white/75" : "text-[var(--muted)]")}>{t("scheduleNoneHint")}</span></button>
                </div>
              </fieldset>
              {scheduleMode === "period" ? <>
                <SchedulePeriodFields startsOn={startsOn} endsOn={endsOn} onStartsOn={setStartsOn} onEndsOn={setEndsOn} />
                <p className="sm:col-span-2 text-xs leading-5 text-[var(--muted)]">{t("periodNote")}</p>
              </> : <p className="sm:col-span-2 rounded-xl bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{t("noneNote")}</p>}

              <div className="sm:col-span-2">
                {optionalOpen ? (
                  <div className="grid gap-4">
                    <button type="button" className={cx(backLinkClass, "justify-self-start")} onClick={() => setShowOptional(false)} hidden={Boolean(description.trim()) || ruleSections.length > 0}>{t("hideOptional")}</button>
                    <label><span className={labelClass}>{t("descriptionLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
                    <div><div className="mb-3"><span className={labelClass}>{t("rulesLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><p className="text-xs leading-5 text-[var(--muted)]">{t("rulesHint")}</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} /></div>
                  </div>
                ) : (
                  <button type="button" className={backLinkClass} onClick={() => setShowOptional(true)}>{t("showOptional", { count: 2 })}</button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {stepKey === "people" ? (
          <div>
            <h2 className="text-xl font-light">{t("peopleTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("peopleSubtitle")}</p>
                {group?.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">{t("peopleLegend")}</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4" key={member.id}><input type="checkbox" aria-label={t("selectMember", { name: member.name })} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title={t("noMembersTitle")} />}
            <div className="mt-6 rounded-2xl bg-[var(--wash)] p-5 text-sm leading-6"><strong className="block text-base">{t("summaryTitle")}</strong><span className="mt-2 block text-[var(--muted)]">{t("summaryFields", { count: totalFields })} · {t("summaryItems", { count: itemInputs.length })} · {t("summaryParticipants", { count: participantIds.length })}</span><p className="mt-2 text-[var(--muted)]">{t("summaryNote")}</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex gap-2 border-t border-[var(--line)] pt-5 [&>*]:flex-1">
          {/* No Cancel: leaving is the page's Back (or any other way out), which offers to keep a draft. */}
          {step > 1 ? (
            <Button variant="secondary" className="min-h-11 !flex-none px-4" onClick={() => setStep((current) => current - 1)}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M13 8H3m4-4L3 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">{t("backStep")}</span>
            </Button>
          ) : null}
          {step < lastStep ? <Button className="min-h-11 px-6" disabled={!currentStepReady} onClick={nextStep}>{t("next")}<ArrowRightIcon /></Button> : <Button className="min-h-11 px-6" disabled={busy || !formReady} onClick={() => void submit()}>{busy ? t("creatingDraft") : t("createDraft")}</Button>}
        </div>
      </section>
      {leaving ? (
        <Dialog title={t("leaveTitle")} onClose={() => setLeaving(null)}>
          <p className="text-sm leading-6 text-[var(--muted)]">{t("leaveBody")}</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="secondary" className="!rounded-full" onClick={discardAndLeave}>{t("leaveDiscard")}</Button>
            <Button className="!rounded-full" disabled={!onKeepDraft} onClick={saveDraftAndLeave}>{t("leaveSave")}</Button>
          </div>
        </Dialog>
      ) : null}
      {newLibrary ? (
        <NewLibraryDialog
          scope={scope}
          onCancel={() => setNewLibrary(false)}
          onCreated={(made) => { setNewLibrary(false); reloadLibraries(); pickLibrary(made.kind); }}
        />
      ) : null}
    </main>
  );
}
