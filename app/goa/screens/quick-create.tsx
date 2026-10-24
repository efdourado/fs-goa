"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { cleanFields, FieldBuilder, presetFields, sessionPresetFields, sharedPresetFields } from "../fields";
import { useGoaFormat } from "../format";
import { type CatalogScope, LibraryPills, libraryChoices, librarySuggestions, useCatalogLibraries, useLibraryName } from "../libraries";
import { NewLibraryDialog } from "../library-dialogs";
import { RecipeIcon, type RecipeIconName } from "../recipe-icons";
import type { CatalogLibrary, ChallengeCreationInput, ChallengeField, ChallengeResponseInput, CreatableRecipeKey, GroupSummary, Id } from "../types";
import { AddRow, ArrowField, ArrowRightIcon, BackButton, Button, cardClass, ChevronIcon, choicePillClass, CircleMinusIcon, cx, PageHeading, rowIconClass, SelectableCards, StatusMessage } from "../ui";
import { canManage } from "../utils";

/**
 * The same two structures offered by manual creation: a challenge with a list of items, or a daily check-in.
 * Every path uses the same response fields and individual/shared answer model as the full creator.
 */
const KINDS = ["items", "daily"] as const;
type Kind = (typeof KINDS)[number];
const ICON_OF: Record<Kind, RecipeIconName> = { items: "library", daily: "habit" };

type Where = { kind: "personal" } | { kind: "group"; groupId: Id; name: string; participantIds: Id[] };
/** How a group's ratings come out: sealed until revealed, sealed with a guess first, or live. */
const RATING_MODES = ["reveal", "guess", "open"] as const;
type RatingMode = (typeof RATING_MODES)[number];
const MODE_KEY: Record<RatingMode, string> = { reveal: "modeReveal", guess: "modeGuess", open: "modeOpen" };
type RecordingMode = "single" | "session";
type LibraryPick = { id: Id | null; kind: string; source: CatalogLibrary["source"]; name: string };
type ResponseDraft = ChallengeResponseInput & { clientKey: string };

/** goa's own turn in the exchange — a small mark, then the question, in a quiet bubble. */
function Ask({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed little file from /public, like the header's Brand */}
      <img src="/logo.png" alt="" aria-hidden="true" draggable={false} className="mt-0.5 h-7 w-7 flex-none object-contain" />
      <p className="mt-0.5 text-[15px] leading-6">{children}</p>
    </div>
  );
}

/** The person's turn: what they picked, once picked — with a quiet way to change their mind. */
function Answered({ children, onEdit, editLabel }: { children: ReactNode; onEdit: () => void; editLabel: string }) {
  return (
    <div className="ml-10 flex items-center gap-2.5">
      <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[var(--main)] px-4 text-sm font-medium text-white">{children}</span>
      <button type="button" onClick={onEdit} className="cursor-pointer text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink)]">{editLabel}</button>
    </div>
  );
}

/** One big tappable option (a way the ratings come out): picking it answers the question immediately. */
function OptionCard({ onClick, title, hint }: { onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(cardClass, "flex cursor-pointer flex-col gap-1.5 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--main-line)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25")}
    >
      <strong className="text-[15px] font-medium tracking-[-0.01em]">{title}</strong>
      {hint ? <span className="text-xs leading-5 text-[var(--muted)]">{hint}</span> : null}
    </button>
  );
}

/** The same library choice as manual creation: your libraries, Films & series and Books suggested, or a new one. */
function LibraryStep({ scope, onPick }: { scope: CatalogScope; onPick: (library: LibraryPick) => void }) {
  const t = useTranslations("quickCreate");
  const libraryName = useLibraryName();
  const { data, reload } = useCatalogLibraries(scope);
  const libraries = data ?? [];
  const [creating, setCreating] = useState(false);
  return (
    <div className="ml-10">
      <LibraryPills
        choices={libraryChoices(libraries)}
        suggestions={librarySuggestions(libraries)}
        kind={null}
        label={t("qLibrary")}
        onPick={(library) => onPick({ id: library.id, kind: library.kind, source: library.source, name: libraryName(library) })}
        onNew={() => setCreating(true)}
      />
      {creating ? (
        <NewLibraryDialog
          scope={scope}
          onCancel={() => setCreating(false)}
          onCreated={(made) => { setCreating(false); reload(); onPick({ id: made.id, kind: made.kind, source: made.source, name: libraryName(made) }); }}
        />
      ) : null}
    </div>
  );
}

/**
 * A short, guided way to start a challenge — a few questions, nearly every answer a tap (a title, a first
 * item and a new group's name are the only typing). Faster than the full wizard: where it goes is asked first,
 * whatever has a sensible default (the record, how films and books are logged, a session's name, a title) is
 * answered for you with a "Change" beside it, and each field takes the cursor as it appears.
 */
export function QuickCreateScreen({
  currentUserId,
  groups,
  into,
  onBack,
  backLabel,
  onCreateGroup,
  onSubmit,
}: {
  currentUserId: Id;
  groups: GroupSummary[];
  /** Started from a group page or My space: that answers "where" before it is asked. */
  into?: { groupId: Id } | "personal";
  onBack: () => void;
  backLabel?: string;
  /** Makes the group and hands back its id — does not navigate anywhere on its own. */
  onCreateGroup: (name: string) => Promise<Id | null>;
  onSubmit: (target: { groupId: Id } | { personal: true }, input: ChallengeCreationInput) => Promise<void>;
}) {
  const t = useTranslations("quickCreate");
  const tr = useTranslations("createChallenge");
  const tc = useTranslations("common");
  const tp = useTranslations("fields.preset");
  const f = useGoaFormat();
  const standardGroups = groups.filter((group) => group.kind !== "personal" && canManage(group.role));
  const presetWhere = (): Where | null => {
    if (into === "personal") return { kind: "personal" };
    const target = into ? standardGroups.find((group) => group.id === into.groupId) : null;
    return target ? { kind: "group", groupId: target.id, name: target.name, participantIds: target.members?.map((member) => member.id) ?? [currentUserId] } : null;
  };
  const [recipe, setRecipe] = useState<Kind | null>(null);
  const [fields, setFields] = useState<ChallengeField[]>([]);
  const [answerScope, setAnswerScope] = useState<"individual" | "shared">("individual");
  const [additionalResponses, setAdditionalResponses] = useState<ResponseDraft[]>([]);
  const [primaryResponseKey, setPrimaryResponseKey] = useState("primary");
  const [openResponse, setOpenResponse] = useState<string | null>("primary");
  const [responsesSettled, setResponsesSettled] = useState(false);
  const [fieldsTouched, setFieldsTouched] = useState(false);
  const responseSequence = useRef(0);
  const [library, setLibrary] = useState<LibraryPick | null>(null);
  const [recordingMode, setRecordingMode] = useState<RecordingMode | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [where, setWhere] = useState<Where | null>(presetWhere);
  const [pickingNewGroup, setPickingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [mode, setMode] = useState<RatingMode | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  /** null until typed in: the field shows the suggested title. */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [itemTitle, setItemTitle] = useState("");
  const [itemAuthor, setItemAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tracksItems = recipe === "items";
  const asksMode = Boolean(tracksItems && recordingMode === "single" && (library?.kind === "film" || library?.kind === "book") && where?.kind === "group" && answerScope === "individual");
  const asksSessionName = tracksItems && recordingMode === "session";
  const configurationSettled = responsesSettled && (!asksMode || mode !== null) && (!tracksItems || (library !== null && recordingMode !== null)) && (!asksSessionName || sessionName !== null);
  const responseRows: Array<ResponseDraft & { primary?: true }> = [
    { clientKey: primaryResponseKey, name: "", answerScope, fields, primary: true },
    ...additionalResponses,
  ];

  function resetFrom(step: "where" | "recipe" | "mode" | "title") {
    if (step === "where" || step === "recipe") {
      setRecipe(null);
      setFields([]);
      setAnswerScope("individual");
      setAdditionalResponses([]);
      setResponsesSettled(false);
      setFieldsTouched(false);
      setOpenResponse("primary");
      setRecordingMode(null);
      setSessionName(null);
      setSessionNameDraft("");
      setLibrary(null);
    }
    if (step !== "title") setMode(null);
    // The destination comes first, so changing it starts the rest over (a library belongs to where it lives).
    if (step === "where") { setWhere(null); setPickingNewGroup(false); setNewGroupName(""); setGroupError(null); }
    setTitle(null);
    setTitleDraft(null);
    setItemTitle("");
    setItemAuthor("");
    setError(null);
  }

  function chooseRecipe(next: Kind) {
    setRecipe(next);
    setAnswerScope("individual");
    setAdditionalResponses([]);
    setPrimaryResponseKey("primary");
    setOpenResponse(next === "items" ? "primary" : null);
    // A daily check-in's preset record is already an answer (Change opens it).
    setResponsesSettled(next === "daily");
    setFieldsTouched(false);
    setLibrary(null);
    setRecordingMode(null);
    setSessionName(null);
    setSessionNameDraft("");
    setFields(next === "daily" ? presetFields("habit", (key) => tp(key)) : []);
  }

  function chooseLibrary(next: LibraryPick) {
    setLibrary(next);
    setRecordingMode(null);
    setSessionName(null);
    setSessionNameDraft("");
    setFields([]);
    setAdditionalResponses([]);
    setAnswerScope("individual");
    setFieldsTouched(false);
    setResponsesSettled(false);
    setMode(null);
    // Films and books are logged one at a time; only a library of your own asks how.
    if (next.kind === "film" || next.kind === "book") chooseRecording("single", next);
  }

  function editLibrary() {
    setLibrary(null);
    setRecordingMode(null);
    setSessionName(null);
    setSessionNameDraft("");
    setFields([]);
    setAdditionalResponses([]);
    setAnswerScope("individual");
    setFieldsTouched(false);
    setResponsesSettled(false);
    setMode(null);
    setTitle(null);
    setTitleDraft(null);
    setItemTitle("");
    setItemAuthor("");
  }

  function chooseRecording(next: RecordingMode, picked: LibraryPick | null = library) {
    if (!picked) return;
    setRecordingMode(next);
    // A session already has a name ("Session"); Change renames it.
    setSessionName(next === "session" ? tr("sessionNameDefault") : null);
    setSessionNameDraft(next === "session" ? tr("sessionNameDefault") : "");
    setAnswerScope("individual");
    setAdditionalResponses([]);
    setOpenResponse(next === "single" ? "primary" : null);
    setFields(next === "session"
      ? sessionPresetFields((key) => tp(key))
      : presetFields(picked.kind === "film" || picked.kind === "book" ? "cinema" : "custom", (key) => tp(key)).slice(0, 1));
    setFieldsTouched(false);
    // The preset record is the answer until Change opens it.
    setResponsesSettled(true);
    setMode(null);
  }

  function editRecording() {
    setRecordingMode(null);
    setSessionName(null);
    setSessionNameDraft("");
    setFields([]);
    setAdditionalResponses([]);
    setAnswerScope("individual");
    setFieldsTouched(false);
    setResponsesSettled(false);
    setMode(null);
    setTitle(null);
    setTitleDraft(null);
    setItemTitle("");
    setItemAuthor("");
  }

  function chooseScope(next: "individual" | "shared") {
    setAnswerScope(next);
    setMode(null);
    if (!fieldsTouched) setFields(next === "shared" ? sharedPresetFields((key) => tp(key)) : presetFields(library?.kind === "film" || library?.kind === "book" ? "cinema" : "custom", (key) => tp(key)).slice(0, 1));
  }

  function addResponse() {
    const nextScope = answerScope === "individual" ? "shared" : "individual";
    const responseFields = nextScope === "shared" ? sharedPresetFields((key) => tp(key)) : presetFields("custom", (key) => tp(key));
    const clientKey = `new-${responseSequence.current += 1}`;
    setAdditionalResponses((current) => [...current, { clientKey, name: responseFields[0]?.label ?? "", answerScope: nextScope, fields: responseFields }]);
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
    setAdditionalResponses(nextAdditional.map(({ clientKey, name, answerScope: scope, fields: responseFields }) => ({ clientKey, name, answerScope: scope, fields: responseFields })));
    setMode(null);
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

  function confirmResponses() {
    if (!fields.length || additionalResponses.some((response) => !response.fields.length)) {
      setError(tr("errNoFields"));
      return;
    }
    if (fields.some((field) => !field.label.trim()) || additionalResponses.some((response) => response.fields.some((field) => !field.label.trim()))) {
      setError(tr("errFieldLabel"));
      return;
    }
    setError(null);
    setResponsesSettled(true);
    setOpenResponse(null);
  }

  function editResponses() {
    setResponsesSettled(false);
    setOpenResponse(primaryResponseKey);
    setMode(null);
    setTitle(null);
    setTitleDraft(null);
    setItemTitle("");
    setItemAuthor("");
    setError(null);
  }

  /** A title to keep with Enter or type over: the library and the year ("Books 2026"). */
  function suggestedTitle() {
    return library ? `${library.name} ${new Date().getFullYear()}` : "";
  }

  function confirmSessionName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = sessionNameDraft.trim();
    if (name) setSessionName(name);
  }

  async function makeGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      const groupId = await onCreateGroup(name);
      if (!groupId) throw new Error(t("groupWithoutId"));
      setWhere({ kind: "group", groupId, name, participantIds: [currentUserId] });
      setPickingNewGroup(false);
    } catch (cause) {
      setGroupError(f.error(cause));
    } finally {
      setGroupBusy(false);
    }
  }

  const isBook = library?.kind === "book";

  async function create(name: string, firstItem: string) {
    if (!recipe || !where) return;
    setBusy(true);
    setError(null);
    try {
      const creationRecipe: CreatableRecipeKey = recipe === "daily"
        ? "habit"
        : recordingMode === "session" || answerScope === "shared"
          ? "custom"
          : library?.kind === "film"
            ? "cinema"
            : library?.kind === "book"
              ? "bookshelf"
              : "custom";
      const input: ChallengeCreationInput = {
        recipe: creationRecipe,
        title: name,
        description: "",
        ruleSections: [],
        startsOn: null,
        endsOn: null,
        fields: cleanFields(fields),
        ...(tracksItems && recordingMode === "single" && additionalResponses.length ? {
          additionalResponses: additionalResponses.map((response) => ({
            name: response.fields[0]?.label.trim() || response.name.trim(),
            answerScope: response.answerScope,
            fields: cleanFields(response.fields),
          })),
        } : {}),
        ...(tracksItems && recordingMode === "session" && library
          ? {
              libraries: [library.id ? { libraryId: library.id } : { libraryKind: library.kind }],
              recordingMode: "session" as const,
              sessionName: sessionName ?? tr("sessionNameDefault"),
              sessionNoteLabel: tp("comoFoi"),
            }
          : {}),
        ...(tracksItems && recordingMode === "single" && creationRecipe === "custom" && library
          ? { libraries: [library.id ? { libraryId: library.id } : { libraryKind: library.kind }], answerScope }
          : {}),
        items: firstItem ? [{
          title: firstItem,
          position: 0,
          ...(isBook ? { author: itemAuthor.trim() } : {}),
          ...(library?.id ? { libraryId: library.id } : library ? { libraryKind: library.kind } : {}),
        }] : [],
        generateDaily: false,
        ...(asksMode && mode !== "open" ? { revealTogether: true } : {}),
        ...(asksMode && mode === "guess" ? { expectation: true } : {}),
        participantIds: where.kind === "personal" ? [] : where.participantIds,
      };
      await onSubmit(where.kind === "personal" ? { personal: true } : { groupId: where.groupId }, input);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  function confirmTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = (titleDraft ?? suggestedTitle()).trim();
    if (!recipe || !name) return;
    if (tracksItems) setTitle(name);
    else void create(name, "");
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = itemTitle.trim();
    if (title === null || !name || (isBook && !itemAuthor.trim())) return;
    void create(title, name);
  }

  // Each answer brings the next question into view (a typed one also takes the cursor).
  const endRef = useRef<HTMLDivElement>(null);
  const answered = useRef(false);
  useEffect(() => {
    if (answered.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    answered.current = true;
  }, [where, recipe, library, recordingMode, sessionName, responsesSettled, mode, title]);

  const kindName = (key: Kind) => tr(`creationTypes.${key}.name`);
  const scope: CatalogScope | null = where ? (where.kind === "personal" ? "personal" : { groupId: where.groupId }) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
      <PageHeading title={t("title")} />

      <div className="space-y-6">
        <div className="space-y-3">
          <Ask>{t("q2")}</Ask>
          {where ? (
            <Answered onEdit={() => resetFrom("where")} editLabel={t("change")}>
              {where.kind === "personal" ? t("justMe") : where.name}
            </Answered>
          ) : (
            <div className="ml-10 space-y-3">
              {/* The same round pills as the library step: you, each group you run, or a new one. */}
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("q2")}>
                <button type="button" onClick={() => setWhere({ kind: "personal" })} className={choicePillClass()}>{t("justMe")}</button>
                {standardGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setWhere({ kind: "group", groupId: group.id, name: group.name, participantIds: group.members?.map((member) => member.id) ?? [currentUserId] })}
                    className={choicePillClass()}
                  >
                    {group.name}
                    <span className="text-[var(--muted)]" aria-hidden="true">·</span>
                    <span className="text-xs text-[var(--muted)]">{t("groupHint", { count: group.memberCount ?? group.members?.length ?? 1 })}</span>
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={pickingNewGroup}
                  onClick={() => { setPickingNewGroup(!pickingNewGroup); setNewGroupName(""); setGroupError(null); }}
                  className={choicePillClass({ active: pickingNewGroup, dashed: !pickingNewGroup })}
                >
                  <span aria-hidden="true">＋</span>{t("newGroup")}
                </button>
              </div>
              {pickingNewGroup ? (
                <form onSubmit={makeGroup} className="max-w-md space-y-2">
                  <ArrowField
                    value={newGroupName}
                    onChange={setNewGroupName}
                    placeholder={t("newGroupPlaceholder")}
                    label={t("newGroupPlaceholder")}
                    submitLabel={groupBusy ? tc("saving") : t("newGroupCreate")}
                    maxLength={100}
                    disabled={groupBusy}
                    takesCursor
                  />
                  <p className="px-4 text-xs text-[var(--muted)]">{t("newGroupHint")}</p>
                  {groupError ? <StatusMessage error={groupError} /> : null}
                </form>
              ) : null}
            </div>
          )}
        </div>

        {where ? (
          <div className="space-y-3">
            <Ask>{t("q1")}</Ask>
            {recipe ? (
              <Answered onEdit={() => resetFrom("recipe")} editLabel={t("change")}>{kindName(recipe)}</Answered>
            ) : (
              /* The same cards as manual creation's first step: a plain icon, the name, its tagline. */
              <div className="ml-10 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                {KINDS.map((key) => (
                  <button key={key} type="button" onClick={() => chooseRecipe(key)} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3.5 text-left transition hover:border-[var(--main-line)] sm:block sm:p-5">
                    <span className="flex h-6 flex-none items-center sm:h-8" aria-hidden="true"><RecipeIcon name={ICON_OF[key]} className="h-5 w-5 sm:h-7 sm:w-7" /></span>
                    <span className="min-w-0">
                      <strong className="block text-[15px] leading-snug sm:mt-3 sm:text-lg">{kindName(key)}</strong>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)] sm:text-sm sm:leading-6">{tr(`creationTypes.${key}.tagline`)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tracksItems && where && scope ? (
          <div className="space-y-3">
            <Ask>{t("qLibrary")}</Ask>
            {library ? (
              <Answered onEdit={editLibrary} editLabel={t("change")}>{library.name}</Answered>
            ) : (
              <LibraryStep scope={scope} onPick={chooseLibrary} />
            )}
          </div>
        ) : null}

        {tracksItems && where && library ? (
          <div className="space-y-3">
            <Ask>{t("qRecording")}</Ask>
            {recordingMode ? (
              <Answered onEdit={editRecording} editLabel={t("change")}>{tr(recordingMode === "single" ? "recordingSingle" : "recordingSession")}</Answered>
            ) : (
              <div className="ml-10">
                <SelectableCards
                  value={null}
                  onChange={chooseRecording}
                  options={[
                    { value: "single", label: tr("recordingSingle"), hint: tr("recordingSingleHint") },
                    { value: "session", label: tr("recordingSession"), hint: tr("recordingSessionHint") },
                  ]}
                />
              </div>
            )}
          </div>
        ) : null}

        {asksSessionName && where ? (
          <div className="space-y-3">
            <Ask>{t("qSession")}</Ask>
            {sessionName !== null ? (
              <Answered onEdit={() => { setSessionName(null); setResponsesSettled(false); setTitle(null); }} editLabel={t("change")}>{sessionName}</Answered>
            ) : (
              <form onSubmit={confirmSessionName} className="ml-10 max-w-md">
                <ArrowField value={sessionNameDraft} onChange={setSessionNameDraft} placeholder={tr("sessionNamePlaceholder")} label={t("qSession")} submitLabel={tc("continue")} maxLength={60} takesCursor />
              </form>
            )}
          </div>
        ) : null}

        {recipe && where && (!tracksItems || (recordingMode !== null && (!asksSessionName || sessionName !== null))) ? (
          <div className="space-y-3">
            <Ask>{t("qResponses")}</Ask>
            {responsesSettled ? (
              <Answered onEdit={editResponses} editLabel={t("change")}>
                {t("responsesAnswer", { count: responseRows.length })}
              </Answered>
            ) : (
              <div className="ml-10 space-y-4">
                {tracksItems && recordingMode === "single" ? (
                  <div>
                    <ol>
                      {responseRows.map((response, index) => {
                        const isOpen = openResponse === response.clientKey;
                        const responseTitle = response.fields[0]?.label.trim() || tr("responseN", { n: index + 1 });
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
                                  <span className="truncate text-[15px] font-medium">{responseTitle}</span>
                                  <span className="truncate text-xs text-[var(--muted)]">{tr("responseSummary", { scope: tr(response.answerScope === "shared" ? "scopeShared" : "scopeIndividual"), count: response.fields.length })}</span>
                                </span>
                              </button>
                              {responseRows.length > 1 ? <>
                                <button type="button" className={rowIconClass} disabled={index === 0} onClick={() => moveResponse(response.clientKey, -1)} aria-label={tr("moveResponseUp")} title={tr("moveResponseUp")}><ChevronIcon dir="up" /></button>
                                <button type="button" className={rowIconClass} disabled={index === responseRows.length - 1} onClick={() => moveResponse(response.clientKey, 1)} aria-label={tr("moveResponseDown")} title={tr("moveResponseDown")}><ChevronIcon dir="down" /></button>
                                <button type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} onClick={() => removeResponse(response.clientKey)} aria-label={tr("removeResponse")} title={tr("removeResponse")}><CircleMinusIcon className="h-[18px] w-[18px]" /></button>
                              </> : null}
                            </div>
                            {isOpen ? (
                              <div className="space-y-5 pb-6 pl-[46px]">
                                <SelectableCards
                                  value={response.answerScope}
                                  onChange={(next) => response.primary ? chooseScope(next) : updateResponse(response.clientKey, { answerScope: next })}
                                  options={[
                                    { value: "individual", label: tr("scopeIndividual"), hint: tr("scopeIndividualHint") },
                                    { value: "shared", label: tr("scopeShared"), hint: tr("scopeSharedHint") },
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
                    {responseRows.length < 10 ? <AddRow label={tr("responseWord")} ariaLabel={tr("addResponse")} onClick={addResponse} /> : null}
                  </div>
                ) : (
                  <FieldBuilder fields={fields} onChange={(next) => { setFields(next); setFieldsTouched(true); }} />
                )}
                <Button className="w-full" onClick={confirmResponses} disabled={!fields.length || fields.some((field) => !field.label.trim())}>{tc("continue")}<ArrowRightIcon /></Button>
                {error ? <StatusMessage error={error} /> : null}
              </div>
            )}
          </div>
        ) : null}

        {asksMode && where && responsesSettled ? (
          <div className="space-y-3">
            <Ask>{t("q5")}</Ask>
            {mode ? (
              <Answered onEdit={() => resetFrom("mode")} editLabel={t("change")}>{t(MODE_KEY[mode])}</Answered>
            ) : (
              <div className="ml-10 grid gap-3 sm:grid-cols-3">
                {RATING_MODES.map((key) => (
                  <OptionCard key={key} onClick={() => setMode(key)} title={t(MODE_KEY[key])} hint={t(`${MODE_KEY[key]}Hint`)} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {recipe && where && configurationSettled ? (
          <div className="space-y-3">
            <Ask>{t("q3")}</Ask>
            {title !== null ? (
              <Answered onEdit={() => resetFrom("title")} editLabel={t("change")}>{title}</Answered>
            ) : (
              <form onSubmit={confirmTitle} className="ml-10 max-w-md">
                <ArrowField
                  value={titleDraft ?? suggestedTitle()}
                  onChange={setTitleDraft}
                  placeholder={t("titlePlaceholder")}
                  label={t("q3")}
                  submitLabel={tracksItems ? tc("continue") : t("create")}
                  maxLength={160}
                  disabled={busy}
                  takesCursor
                />
              </form>
            )}
            {title === null && error ? <div className="ml-10"><StatusMessage error={error} /></div> : null}
          </div>
        ) : null}

        {recipe && where && configurationSettled && title !== null && tracksItems ? (
          <div className="space-y-3">
            <Ask>{t(library?.kind === "film" ? "q4Cinema" : isBook ? "q4Bookshelf" : "q4Item")}</Ask>
            {/* The same round box as the name, the arrow at its end; a book also asks its author, in the same shape. */}
            <form onSubmit={submitItem} className="ml-10 max-w-md space-y-2.5">
              <ArrowField
                value={itemTitle}
                onChange={setItemTitle}
                placeholder={t(library?.kind === "film" ? "itemPlaceholderCinema" : isBook ? "itemPlaceholderBookshelf" : "itemPlaceholder")}
                label={t(library?.kind === "film" ? "q4Cinema" : isBook ? "q4Bookshelf" : "q4Item")}
                submitLabel={t("create")}
                submitDisabled={isBook && !itemAuthor.trim()}
                maxLength={300}
                disabled={busy}
                takesCursor
              />
              {isBook ? (
                <input
                  className="h-[46px] w-full rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--main)] focus:ring-4 focus:ring-[var(--main)]/15"
                  value={itemAuthor}
                  onChange={(event) => setItemAuthor(event.target.value)}
                  placeholder={t("authorPlaceholder")}
                  aria-label={t("authorLabel")}
                  maxLength={300}
                  disabled={busy}
                />
              ) : null}
            </form>
            {error ? <div className="ml-10"><StatusMessage error={error} /></div> : null}
          </div>
        ) : null}
        <div ref={endRef} aria-hidden="true" />
      </div>
    </main>
  );
}
