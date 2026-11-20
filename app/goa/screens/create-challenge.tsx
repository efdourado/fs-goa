"use client";

import { StateButton } from "../state-button";
import { SettingsMenu } from "../SettingsMenu";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ChallengeDraftForm } from "../challenge-draft";
import { Dialog, ModalActions } from "../dialog";
import { useGoaFormat } from "../format";
import { cleanFields, FieldRows } from "../fields";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { type CatalogScope, useCatalogLibraries } from "../libraries";
import { ChallengeSource } from "../challenge-source";
import { ResponseFields } from "../response-fields";
import { initialResponseFields, challengeRecording, type ChallengeLibrary } from "../challenge-creation";
import { MAX_CHALLENGE_RULES } from "../../../lib/goa/domain/rule-limits";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeResponseInput, ChallengeRule, GroupSummary, Id } from "../types";
import { CreationButton, BackButton, backLinkClass, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, SchedulePeriodFields, SelectableCards, StatusMessage } from "../ui";

export type ChallengeStructure = "list" | "progress" | "daily";
export type LeaveGuard = (proceed: () => void) => boolean;
type StepKey = "setup" | "fields" | "checkpoints" | "people";

export function CreateChallengeScreen({ group, personal = false, onBack, backLabel, onCreate, initialDraft, onKeepDraft, onClearDraft, registerLeaveGuard }: {
  group?: GroupSummary; personal?: boolean; onBack: () => void; backLabel?: string;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
  initialDraft?: ChallengeDraftForm; onKeepDraft?: (form: ChallengeDraftForm) => void;
  onClearDraft?: () => void; registerLeaveGuard?: (guard: LeaveGuard | null) => void;
}) {
  const t = useTranslations("createChallenge");
  const ts = useTranslations("challengeCreate");
  const f = useGoaFormat();
  const draft = initialDraft;
  const [step, setStep] = useState(() => {
    if (!draft) return 1;
    const withItems = draft.libraryEnabled ?? draft.structure !== "daily";
    const oldSteps: StepKey[] = ["setup", "fields", ...(withItems ? ["checkpoints" as const] : []), ...(personal ? [] : ["people" as const])];
    const newSteps: StepKey[] = ["setup", ...(withItems ? ["checkpoints" as const] : []), "fields", ...(personal ? [] : ["people" as const])];
    return Math.max(1, newSteps.indexOf(draft.creationStep ?? oldSteps[draft.step - 1] ?? "setup") + 1);
  });
  const [linked, setLinked] = useState(draft?.libraryEnabled ?? (!draft || draft.structure !== "daily"));
  const [dated, setDated] = useState(draft?.dated ?? (draft ? draft.structure !== "list" || draft.recordingMode === "session" : false));
  const [legacyProgress, setLegacyProgress] = useState(Boolean(draft && !draft.sheetMode && draft.structure === "progress"));
  const [pickedKind, setPickedKind] = useState<string | null>(draft?.pickedKind ?? null);
  const [chosenLibrary, setChosenLibrary] = useState<ChallengeLibrary | null>(null);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [ruleSections, setRuleSections] = useState<ChallengeRule[]>(draft?.ruleSections ?? []);
  const [showOptional, setShowOptional] = useState(draft?.showOptional ?? false);
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">(draft?.scheduleMode ?? "none");
  const [startsOn, setStartsOn] = useState(draft?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(draft?.endsOn ?? "");
  const [fields, setFields] = useState<ChallengeField[]>(draft?.fields ?? initialResponseFields(ts("defaultField")));
  const [fieldsTouched, setFieldsTouched] = useState(draft?.fieldsTouched ?? false);
  const [answerScope, setAnswerScope] = useState<"individual" | "shared">(draft?.answerScope ?? "individual");
  const [additionalResponses, setAdditionalResponses] = useState<ChallengeResponseInput[]>(draft?.additionalResponses ?? []);
  const [cineItems, setCineItems] = useState<CineRow[]>(draft?.cineItems ?? []);
  const [itemsAdding, setItemsAdding] = useState(false);
  const [itemProblem, setItemProblem] = useState<"author" | null>(null);
  const [participantIds, setParticipantIds] = useState<Id[]>(draft?.participantIds ?? group?.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const finished = useRef(false);
  const started = dated || !linked || Boolean(pickedKind || title.trim() || description.trim() || startsOn || endsOn || fieldsTouched || cineItems.length || ruleSections.length);
  const startedRef = useRef(started);
  useEffect(() => { startedRef.current = started; }, [started]);
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard((proceed) => { if (finished.current || !startedRef.current) return false; setLeaving(() => proceed); return true; });
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard]);
  useEffect(() => {
    if (!started) return;
    const warn = (event: BeforeUnloadEvent) => { if (!finished.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [started]);
  const scope: CatalogScope = personal || !group ? "personal" : { groupId: group.id };
  const libraries = useCatalogLibraries(linked ? scope : null);
  const pickedLibrary = linked && pickedKind !== null ? libraries.data?.find((library) => library.kind === pickedKind) ?? chosenLibrary : null;
  const itemLibraries = pickedLibrary ? [pickedLibrary] : [];
  const itemInputs = linked ? cineRowsToInput(cineItems) : [];
  const stepKeys: StepKey[] = ["setup", ...(linked ? ["checkpoints" as const] : []), "fields", ...(personal ? [] : ["people" as const])];
  const lastStep = stepKeys.length;
  const visibleStep = Math.min(step, lastStep);
  const stepKey = stepKeys[visibleStep - 1];
  const navColsClass = stepKeys.length === 2 ? "grid-cols-2" : stepKeys.length === 3 ? "grid-cols-3" : "grid-cols-4";
  const optionalOpen = showOptional || Boolean(description.trim()) || ruleSections.length > 0;
  const lockedExtras = additionalResponses.length > 0 && (!linked || dated);
  const totalFields = fields.length + additionalResponses.reduce((total, response) => total + response.fields.length, 0);
  function pickLibrary(library: ChallengeLibrary) {
    const previous = pickedLibrary ?? chosenLibrary;
    const previousKind = pickedKind ?? previous?.kind ?? cineItems[0]?.libraryKind;
    if (previousKind && previousKind !== library.kind) { setCineItems([]); setItemProblem(null); }
    const changed = previousKind !== library.kind || (previous?.id ?? cineItems[0]?.libraryId) !== library.id;
    setChosenLibrary(library); setPickedKind(library.kind); if (changed) setLegacyProgress(false);
  }
  function clearLibrary() {
    // Keep the previous library and its draft items available if it is selected again.
    setChosenLibrary(pickedLibrary);
    setPickedKind(null);
  }
  function removeDraftLibrary(library: ChallengeLibrary) {
    const draftLibraryKind = pickedKind ?? chosenLibrary?.kind ?? cineItems[0]?.libraryKind;
    if (draftLibraryKind !== library.kind) return;
    setPickedKind(null);
    setChosenLibrary(null);
    setCineItems([]);
    setItemProblem(null);
    setLegacyProgress(false);
  }
  function problemForStep(key: StepKey): string | null {
    if (key === "setup") {
      if (!title.trim()) return t("errTitle");
      if (linked && !pickedLibrary) return t("errPickLibrary");
      if (scheduleMode === "period" && (!startsOn || !endsOn)) return t("errPeriod");
      if (scheduleMode === "period" && endsOn < startsOn) return t("errEndBeforeStart");
      if (ruleSections.length > MAX_CHALLENGE_RULES) return t("errRuleLimit", { max: MAX_CHALLENGE_RULES });
      if (ruleSections.some((rule) => !rule.title.trim() || !rule.description.trim() || rule.topics?.some((topic) => !topic.title.trim() || !topic.description.trim()))) return t("errRules");
    }
    if (key === "fields") {
      if (lockedExtras) return ts("incompatibleGroups");
      if (!fields.length || additionalResponses.some((response) => !response.fields.length)) return t("errNoFields");
      if ([...fields, ...additionalResponses.flatMap((response) => response.fields)].some((field) => !field.label.trim())) return t("errFieldLabel");
      if (totalFields > 30) return t("errTooManyFields");
    }
    if (key === "checkpoints") {
      if (!itemInputs.length) return ts("errNoItems");
      if (itemProblem) return t("errNoAuthor");
    }
    return null;
  }
  const currentStepReady = problemForStep(stepKey) === null;
  const formReady = stepKeys.every((key) => problemForStep(key) === null);
  function nextStep() { const problem = problemForStep(stepKey); if (problem) { setError(problem); return; } setError(null); setStep(Math.min(lastStep, visibleStep + 1)); }
  async function submit() {
    const problem = stepKeys.map(problemForStep).find(Boolean);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null); finished.current = true;
    try {
      const recording = challengeRecording(pickedLibrary, dated, ts("responseName"), ts("entryName"));
      await onCreate({
        ...recording,
        ...(legacyProgress ? { recipe: pickedLibrary?.kind === "book" ? "library" : "progress", recordingMode: undefined, includeSessionNote: undefined } : {}),
        title: title.trim(), description: description.trim(), ruleSections: ruleSections.map((rule) => ({ ...rule, title: rule.title.trim(), description: rule.description.trim() })),
        startsOn: scheduleMode === "period" ? startsOn : null, endsOn: scheduleMode === "period" ? endsOn : null,
        fields: cleanFields(fields), items: itemInputs, generateDaily: false,
        ...(!dated && linked ? { answerScope, sharedEditPolicy: "members_fill_admin_corrects", additionalResponses: additionalResponses.map((response) => ({ ...response, fields: cleanFields(response.fields) })) } : {}),
        expectation: Boolean(draft?.expectation && !dated && linked), participantIds,
      });
      onClearDraft?.();
    } catch (cause) { finished.current = false; setError(f.error(cause)); }
    finally { setBusy(false); }
  }
  function draftForm(): ChallengeDraftForm {
    return { creationStep: stepKey, sheetMode: !legacyProgress, libraryEnabled: linked, dated, step: visibleStep, structure: legacyProgress ? "progress" : linked ? "list" : "daily", title, description, ruleSections, showOptional, scheduleMode, startsOn, endsOn, fields, additionalResponses, answerScope, recordingMode: linked && dated ? "session" : "single", sessionName: ts("entryName"), sharedEditPolicy: "members_fill_admin_corrects", fieldsTouched, expectation: Boolean(draft?.expectation), cineItems, participantIds, pickedKind };
  }
  function saveDraftAndLeave() { if (!leaving) return; finished.current = true; onKeepDraft?.(draftForm()); const proceed = leaving; setLeaving(null); proceed(); }
  function discardAndLeave() { if (!leaving) return; finished.current = true; if (initialDraft) onClearDraft?.(); const proceed = leaving; setLeaving(null); proceed(); }
  return <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
    <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
    <div className="relative max-sm:pr-12">
      <PageHeading title={personal ? t("personalTitle") : ts("title")} description={ts("subtitle")} />
      <div className="absolute right-0 top-0 sm:hidden"><SettingsMenu /></div>
    </div>
    <nav className={cx("mb-6 grid gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1", navColsClass)} aria-label={t("stepsNav")}>
      {stepKeys.map((key, index) => <StateButton key={key} type="button" disabled={stepKeys.slice(0, index).some((previous) => problemForStep(previous))} onClick={() => { setError(null); setStep(index + 1); }} className={cx("min-h-11 rounded-xl px-2 text-sm", visibleStep === index + 1 ? "bg-[var(--paper)] shadow-[var(--elevate-1)]" : "text-[var(--muted)]", "disabled:opacity-45")} aria-current={visibleStep === index + 1 ? "step" : undefined}>{key === "fields" ? ts("questions") : key === "checkpoints" ? ts("itemsStep") : key === "setup" ? ts("setupStep") : t(`steps.${key}`)}</StateButton>)}
    </nav>
    <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
      {stepKey === "setup" ? (<div>
        <label className="mb-6 block"><span className={labelClass}>{ts("name")}</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required placeholder={ts("namePlaceholder")} /></label>
        <ChallengeSource scope={scope} libraries={libraries} linked={linked} libraryKind={pickedKind} dated={dated} onLinked={(next) => { setLinked(next); if (!next) { setDated(true); setItemProblem(null); } if (next !== linked) setLegacyProgress(false); }} onLibrary={pickLibrary} onDated={(next) => { setDated(next); if (next !== dated) setLegacyProgress(false); }} onLibraryCleared={clearLibrary} onLibraryDeleted={removeDraftLibrary} />
        {legacyProgress ? <p className="mt-4 text-sm text-[var(--muted)]">{ts("legacyDraft")}</p> : null}
            <h3 className="mt-8 mb-5 border-t border-[var(--line)] pt-6 text-lg font-light">{ts("detailsTitle")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="sm:col-span-2">
                <legend className="sr-only">{ts("deadline")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <StateButton className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "period" ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "period"} onClick={() => setScheduleMode("period")}><strong className="block text-sm">{ts("withDeadline")}</strong><span className={cx("mt-1 block text-xs font-normal", scheduleMode === "period" ? "text-white/75" : "text-[var(--muted)]")}>{ts("deadlineHint")}</span></StateButton>
                  <StateButton className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "none" ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "none"} onClick={() => setScheduleMode("none")}><strong className="block text-sm">{ts("withoutDeadline")}</strong><span className={cx("mt-1 block text-xs font-normal", scheduleMode === "none" ? "text-white/75" : "text-[var(--muted)]")}>{t("scheduleNoneHint")}</span></StateButton>
                </div>
              </fieldset>
              {scheduleMode === "period" ? <SchedulePeriodFields startsOn={startsOn} endsOn={endsOn} onStartsOn={setStartsOn} onEndsOn={setEndsOn} /> : null}

              <div className="sm:col-span-2">
                {optionalOpen ? (
                  <div className="grid gap-4">
                    <StateButton type="button" className={cx(backLinkClass, "justify-self-start")} onClick={() => setShowOptional(false)} hidden={Boolean(description.trim()) || ruleSections.length > 0}>{t("hideOptional")}</StateButton>
                    <label><span className={labelClass}>{t("descriptionLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
                    <div><div className="mb-3"><span className={labelClass}>{t("rulesLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><p className="text-xs leading-5 text-[var(--muted)]">{t("rulesHint")}</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} /></div>
                  </div>
                ) : (
                  <StateButton type="button" className={backLinkClass} onClick={() => setShowOptional(true)}>{t("showOptional", { count: 2 })}</StateButton>
                )}
              </div>
            </div>
          </div>
        ) : null}

      {stepKey === "fields" ? <div>
        <h2 className="mb-4 text-xl font-light">{ts("questions")}</h2>
        <ResponseFields fields={fields} onChange={(next) => { setFields(next); setFieldsTouched(true); }} linked={linked} dated={dated} answerScope={answerScope} onScope={setAnswerScope} />
        {additionalResponses.length ? <div className="mt-6 space-y-6">
          <p className="text-sm text-[var(--muted)]">{ts("savedGroups")}</p>
          {lockedExtras ? <p className="text-sm text-[var(--warn)]">{ts("incompatibleGroups")}</p> : null}
          {additionalResponses.map((response, index) => <section key={index} className="rounded-xl border border-[var(--line)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3"><h3>{response.name}</h3><Button variant="ghost" onClick={() => setAdditionalResponses((current) => current.filter((_, i) => i !== index))}>{t("removeResponse")}</Button></div>
            <SelectableCards value={response.answerScope} onChange={(answerScope) => setAdditionalResponses((current) => current.map((candidate, i) => i === index ? { ...candidate, answerScope } : candidate))} options={[{ value: "individual", label: t("scopeIndividual") }, { value: "shared", label: t("scopeShared") }]} />
            <FieldRows fields={response.fields} onChange={(fields) => setAdditionalResponses((current) => current.map((candidate, i) => i === index ? { ...candidate, fields } : candidate))} />
          </section>)}
        </div> : null}
      </div> : null}
        {stepKey === "checkpoints" && linked ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">{ts("itemsStep")}</h2>
              {itemLibraries.length ? (
                <StateButton
                  type="button"
                  onClick={() => setItemsAdding(true)}
                  aria-label={t("addItems")}
                  title={t("addItems")}
                  className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                </StateButton>
              ) : null}
            </div>
            {/* The hint follows what the list holds: films, books to rate, books to read day by day, or anything else. */}
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted)]">{ts("itemsHint")}</p>
            {itemLibraries.length ? (
              <CineItemsEditor
                value={cineItems}
                onChange={setCineItems}
                members={personal ? [] : group?.members ?? []}
                scope={scope}
                libraries={itemLibraries}

                onProblem={setItemProblem}
                addDialogOpen={itemsAdding}
                onAddDialogOpenChange={setItemsAdding}
                showAddButton={false}
              />
            ) : <EmptyState title={t("pickLibraryFirst")} />}
          </div>
        ) : null}

        {stepKey === "people" ? (
          <div>
            <h2 className="text-xl font-light">{t("peopleTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("peopleSubtitle")}</p>
            {group?.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2 sm:[&>label:last-child:nth-of-type(odd)]:col-span-2">
                <legend className="sr-only">{t("peopleLegend")}</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4" key={member.id}><input type="checkbox" aria-label={t("selectMember", { name: member.name })} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title={t("noMembersTitle")} />}
          </div>
        ) : null}

      <div className="mt-6"><StatusMessage error={error} /></div>
      <div className="mt-7 flex gap-2 border-t border-[var(--line)] pt-5 [&>*]:flex-1">
        {visibleStep > 1 ? <Button variant="secondary" onClick={() => setStep(visibleStep - 1)}>{t("backStep")}</Button> : null}
        {visibleStep < lastStep ? <CreationButton disabled={!currentStepReady} onClick={nextStep}>{t("next")}</CreationButton> : <CreationButton disabled={busy || !formReady} onClick={() => void submit()}>{busy ? t("creatingDraft") : t("createDraft")}</CreationButton>}
      </div>
    </section>
    {leaving ? <Dialog title={t("leaveTitle")} onClose={() => setLeaving(null)}><p className="text-sm text-[var(--muted)]">{t("leaveBody")}</p><ModalActions className="mt-6"><Button variant="secondary" onClick={discardAndLeave}>{t("leaveDiscard")}</Button><Button disabled={!onKeepDraft} onClick={saveDraftAndLeave}>{t("leaveSave")}</Button></ModalActions></Dialog> : null}
  </main>;
}
