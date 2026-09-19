"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGoaFormat } from "../format";
import { cleanFields, FieldBuilder, presetFields, sharedPresetFields } from "../fields";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { API_PATHS, apiRequest } from "../api";
import { useCsrf } from "../csrf";
import { NewLibraryDialog } from "../library-dialogs";
import { type CatalogScope, LibraryPills, libraryChoices, useCatalogLibraries } from "../libraries";
import { RecipeIcon } from "../recipe-icons";
import { tablesStarterProperties } from "../property-inputs";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeRule, CreatableRecipeKey, GroupSummary, Id, SharedEditPolicy } from "../types";
import { BackButton, backLinkClass, Button, cardClass, cx, EmptyState, Field, inputClass, labelClass, PageHeading, SchedulePeriodFields, SelectableCards, StatusMessage, Toggle } from "../ui";

/** Where a recipe's items come from: a fixed built-in library, the workspace's Tables library, one the creator picks, or none at all. */
/** Stands in for the workspace's Tables library until it exists (it is created when the challenge is). */
const TABLES_PLACEHOLDER = "tables";

type EditorLibrary = { id: Id | null; kind: string; source: "screens" | "pages" | "tables" | "custom"; label: string | null };

type LibraryMode = "film" | "book" | "tables" | "pick" | null;

const RECIPES: Array<{ key: CreatableRecipeKey; library: LibraryMode; scheduleMode: "period" | "none" }> = [
  { key: "cinema", library: "film", scheduleMode: "none" },
  { key: "bookshelf", library: "book", scheduleMode: "none" },
  { key: "library", library: "book", scheduleMode: "period" },
  { key: "tables", library: "tables", scheduleMode: "none" },
  { key: "custom", library: "pick", scheduleMode: "none" },
  { key: "habit", library: null, scheduleMode: "none" },
];

type StepKey = "base" | "fields" | "checkpoints" | "people";

export function CreateChallengeScreen({
  group,
  personal = false,
  onBack,
  onCreate,
}: {
  group?: GroupSummary;
  /** Solo mode: no "people" step, no group chrome, submits to the personal workspace. */
  personal?: boolean;
  onBack: () => void;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
}) {
  const t = useTranslations("createChallenge");
  const tc = useTranslations("common");
  const tp = useTranslations("fields.preset");
  const tl = useTranslations("libraries");
  const tSr = useTranslations("sharedResponses");
  const f = useGoaFormat();
  const [step, setStep] = useState(1);
  const [recipe, setRecipe] = useState<CreatableRecipeKey | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSections, setRuleSections] = useState<ChallengeRule[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">("none");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [fields, setFields] = useState<ChallengeField[]>([]);
  // Custom only: who fills the main response in — every participant, or once for the whole group.
  const [answerScope, setAnswerScope] = useState<"individual" | "shared">("individual");
  const [sharedEditPolicy, setSharedEditPolicy] = useState<SharedEditPolicy>("members_fill_admin_corrects");
  const [fieldsTouched, setFieldsTouched] = useState(false);
  // Custom starts without "when did it happen" — that date belongs to the response, not to the match.
  const [collectsEntryDate, setCollectsEntryDate] = useState(false);
  // Each item carries its own date and time (a match's kickoff), kept on the library's items.
  const [itemDates, setItemDates] = useState(false);
  const [expectation, setExpectation] = useState(false);
  const [cineItems, setCineItems] = useState<CineRow[]>([]);
  const [participantIds, setParticipantIds] = useState<Id[]>(group?.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Libraries beyond the recipe's own that the items also come from, by kind (Movies and TV Shows in one list).
  const [extraKinds, setExtraKinds] = useState<string[]>([]);
  const [itemProblem, setItemProblem] = useState<"author" | "schedule" | null>(null);
  const [newLibrary, setNewLibrary] = useState(false);
  const csrf = useCsrf();
  const scope: CatalogScope = personal || !group ? "personal" : { groupId: group.id };
  const { data: libraries, reload: reloadLibraries } = useCatalogLibraries(scope);
  const recommendationsEnabled = personal || group?.recommendationsEnabled !== false;
  const itemInputs = cineRowsToInput(cineItems);
  const recipeMeta = RECIPES.find((entry) => entry.key === recipe) ?? null;
  const libraryMode = recipeMeta?.library ?? null;
  const tracksCatalog = libraryMode !== null;
  const choices = libraryChoices(libraries ?? []);
  // The recipe's own library — Screens for Cinema, Pages for the book recipes, the workspace's Tables for
  // Tables — plus whichever others the creator ticks. `custom` has none of its own: everything is ticked.
  const tablesLibrary = libraries?.find((library) => library.source === "tables");
  const ownLibrary: EditorLibrary | null = libraryMode === "film" || libraryMode === "book"
    ? {
        id: libraries?.find((library) => library.kind === libraryMode)?.id ?? null,
        kind: libraryMode, source: libraryMode === "film" ? "screens" : "pages",
        label: libraries?.find((library) => library.kind === libraryMode)?.label ?? null,
      }
    : libraryMode === "tables"
      ? { id: tablesLibrary?.id ?? null, kind: tablesLibrary?.kind ?? TABLES_PLACEHOLDER, source: "tables", label: tablesLibrary?.label ?? null }
      : null;
  const extraChoices = choices.filter((choice) => choice.kind !== ownLibrary?.kind && !(libraryMode === "tables" && choice.source === "tables"));
  const extraLibraries = extraKinds.flatMap((kind) => extraChoices.filter((choice) => choice.kind === kind));
  const itemLibraries: EditorLibrary[] = [...(ownLibrary ? [ownLibrary] : []), ...extraLibraries];
  const allBooks = itemLibraries.length > 0 && itemLibraries.every((library) => library.kind === "book");
  const tablesFallback = ownLibrary && !ownLibrary.id && libraryMode === "tables"
    ? { [ownLibrary.kind]: tablesStarterProperties((key) => tl(`tablesStarter.${key}`)) }
    : undefined;
  // Expectation is the pre-watch rating for the two "rate each title" recipes.
  const canOfferExpectation = recipe === "cinema" || recipe === "bookshelf";
  // A no-catalog recipe (Hábito) has nothing to list, so the checkpoints step
  // never appears — the wizard is base → fields (→ people) and nothing else.
  const stepKeys: StepKey[] = [
    "base",
    "fields",
    ...(tracksCatalog ? (["checkpoints"] as const) : []),
    ...(personal ? [] : (["people"] as const)),
  ];
  const lastStep = stepKeys.length;
  const checkpointsStep = tracksCatalog ? stepKeys.indexOf("checkpoints") + 1 : null;
  const peopleStep = personal ? null : stepKeys.indexOf("people") + 1;
  const navColsClass = stepKeys.length <= 2 ? "grid-cols-2" : stepKeys.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  const optionalOpen = showOptional || Boolean(description.trim()) || ruleSections.length > 0;

  function chooseRecipe(next: CreatableRecipeKey) {
    const meta = RECIPES.find((entry) => entry.key === next)!;
    setRecipe(next);
    setFields(presetFields(next, (key) => tp(key)));
    setAnswerScope("individual");
    setSharedEditPolicy("members_fill_admin_corrects");
    setFieldsTouched(false);
    setCollectsEntryDate(false);
    setItemDates(false);
    setTitle(t(`recipes.${next}.title`));
    setScheduleMode(meta.scheduleMode);
    setCineItems([]);
    setExtraKinds([]);
  }

  function chooseScope(next: "individual" | "shared") {
    setAnswerScope(next);
    // A group result isn't a 0–5 rating: swap the starting field, but never one the creator already edited.
    if (!fieldsTouched) setFields(next === "shared" ? sharedPresetFields((key) => tp(key)) : presetFields("custom", (key) => tp(key)));
  }

  function toggleExtraLibrary(kind: string) {
    if (extraKinds.includes(kind)) {
      // Items already listed for a library that's being taken out go with it.
      setCineItems((rows) => rows.filter((row) => row.libraryKind !== kind));
      setExtraKinds((current) => current.filter((entry) => entry !== kind));
    } else {
      setExtraKinds((current) => [...current, kind]);
    }
  }

  function nextStep() {
    setError(null);
    if (step === 1 && (!recipe || !title.trim())) {
      setError(t("errPickTemplate"));
      return;
    }
    if (step === 1 && scheduleMode === "period" && (!startsOn || !endsOn)) {
      setError(t("errPeriod"));
      return;
    }
    if (step === 1 && scheduleMode === "period" && endsOn < startsOn) {
      setError(t("errEndBeforeStart"));
      return;
    }
    if (step === 1 && ruleSections.some((rule) =>
      !rule.title.trim() || !rule.description.trim()
      || (rule.topics ?? []).some((topic) => !topic.title.trim() || !topic.description.trim())
    )) {
      setError(t("errRules"));
      return;
    }
    if (step === 2 && !fields.length) {
      setError(t("errNoFields"));
      return;
    }
    if (step === checkpointsStep && !itemLibraries.length) {
      setError(t("errPickLibrary"));
      return;
    }
    if (step === checkpointsStep && tracksCatalog && !itemInputs.length) {
      setError(allBooks ? t("errNoBooks") : t("errNoItems"));
      return;
    }
    if (step === checkpointsStep && itemProblem === "author") {
      setError(t("errNoAuthor"));
      return;
    }
    if (step === checkpointsStep && itemProblem === "schedule") {
      setError(t("errItemSchedule"));
      return;
    }
    setStep((current) => Math.min(lastStep, current + 1));
  }

  async function submit() {
    if (!recipe) return;
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
    try {
      // The Tables preset's library is created the moment it is first needed, so its items can name it.
      let items = itemInputs;
      if (libraryMode === "tables" && ownLibrary && !ownLibrary.id) {
        const made = await apiRequest<{ id: Id }>(API_PATHS.catalogWorkspace(scope).libraries, {
          method: "POST", body: { source: "tables" }, csrfToken: csrf,
        });
        items = itemInputs.map(({ libraryKind, ...item }) => (libraryKind === ownLibrary.kind ? { ...item, libraryId: made.id } : { ...item, ...(libraryKind ? { libraryKind } : {}) }));
      }
      await onCreate({
        recipe,
        ...(extraLibraries.length
          ? { libraries: extraLibraries.map((library) => (library.id ? { libraryId: library.id } : { libraryKind: library.kind })) }
          : {}),
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
        items: tracksCatalog ? items : [],
        generateDaily: false,
        expectation: canOfferExpectation && expectation,
        ...(recipe === "custom" ? { collectsEntryDate, answerScope, ...(answerScope === "shared" ? { sharedEditPolicy } : {}) } : {}),
        ...(tracksCatalog && itemDates ? { itemDates: true } : {}),
        participantIds,
      });
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={t("back")} className="mb-6" />
      <PageHeading title={personal ? t("personalTitle") : t("title")} description={personal ? t("personalSubtitle") : t("subtitle")} />
      <nav className={cx("mb-6 grid gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1", navColsClass)} aria-label={t("stepsNav")}>
        {stepKeys.map((key, index) => <button className={cx("min-h-11 truncate rounded-xl px-2 text-xs font-light sm:text-sm", step === index + 1 ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : index + 1 < step ? "text-[var(--ink)]" : "text-[var(--muted)]")} type="button" onClick={() => index + 1 < step && setStep(index + 1)} disabled={index + 1 > step} key={key}><span className="hidden sm:inline">{index + 1}. </span>{key === "checkpoints" && (libraryMode === "tables" || libraryMode === "pick") ? t("steps.items") : t(`steps.${key}`)}</button>)}
      </nav>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        {step === 1 ? (
          <div>
            <h2 className="text-xl font-light">{t("startTitle")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {RECIPES.map((entry) => (
                <button className={cx("rounded-2xl border p-5 text-left transition", recipe === entry.key ? "border-[var(--main)] bg-[var(--main-soft)] ring-2 ring-[var(--main)]/25" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]")} type="button" aria-pressed={recipe === entry.key} onClick={() => chooseRecipe(entry.key)} key={entry.key}>
                  <span className="flex h-8 items-center" aria-hidden="true"><RecipeIcon name={entry.key} className="h-7 w-7" /></span>
                  <strong className="mt-3 block text-lg">{t(`recipes.${entry.key}.name`)}</strong>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{t(`recipes.${entry.key}.body`)}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className={labelClass}>{t("titleLabel")}</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required /></label>
              <fieldset className="sm:col-span-2">
                <legend className={labelClass}>{t("scheduleLegend")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "period" ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "period"} onClick={() => setScheduleMode("period")}><strong className="block text-sm">{t("schedulePeriod")}</strong><span className="mt-1 block text-xs font-normal text-[var(--muted)]">{t("schedulePeriodHint")}</span></button>
                  <button className={cx("min-h-16 rounded-xl border px-4 py-3 text-left", scheduleMode === "none" ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={scheduleMode === "none"} onClick={() => setScheduleMode("none")}><strong className="block text-sm">{t("scheduleNone")}</strong><span className="mt-1 block text-xs font-normal text-[var(--muted)]">{t("scheduleNoneHint")}</span></button>
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
                  <button type="button" className={cx("min-h-11 rounded-xl border border-dashed border-[var(--line)] px-4 text-sm font-light text-[var(--muted)] hover:border-[var(--main-line)] hover:text-[var(--ink)]")} onClick={() => setShowOptional(true)}>{t("showOptional", { count: 2 })}</button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? <div><h2 className="text-xl font-light">{t("fieldsTitle")}</h2><p className="mb-5 mt-1 text-sm text-[var(--muted)]">{t("fieldsSubtitle")}</p>{recipe === "custom" ? <div className="mb-6 space-y-5">
              <Field label={t("scopeLabel")} hint={t("scopeHint")} plain>
                <SelectableCards
                  value={answerScope}
                  onChange={chooseScope}
                  options={[
                    { value: "individual", label: t("scopeIndividual"), hint: t("scopeIndividualHint") },
                    { value: "shared", label: t("scopeShared"), hint: t("scopeSharedHint") },
                  ]}
                />
              </Field>
              {answerScope === "shared" ? (
                <Field label={tSr("policyLabel")} hint={tSr(`policyHint.${sharedEditPolicy}`)} plain>
                  <SelectableCards
                    value={sharedEditPolicy}
                    onChange={setSharedEditPolicy}
                    options={[
                      { value: "members_fill_admin_corrects", label: tSr("policy.members_fill_admin_corrects") },
                      { value: "members_can_edit", label: tSr("policy.members_can_edit") },
                    ]}
                  />
                </Field>
              ) : null}
            </div> : null}<FieldBuilder fields={fields} onChange={(next) => { setFields(next); setFieldsTouched(true); }} />{recipe === "custom" ? <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4"><Toggle checked={collectsEntryDate} onChange={setCollectsEntryDate} label={t("entryDateLabel")} hint={t("entryDateHint")} /></div> : null}{canOfferExpectation ? <label className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm"><input type="checkbox" className="mt-0.5" aria-label={t("expectationLabel")} checked={expectation} onChange={(event) => setExpectation(event.target.checked)} /><span><strong className="block">{t("expectationLabel")}</strong><span className="mt-0.5 block text-xs text-[var(--muted)]">{t("expectationHint")}</span></span></label> : null}</div> : null}

        {step === checkpointsStep && tracksCatalog ? (
          <div>
            <h2 className="text-xl font-light">{t("checkpointsTitle")}</h2>
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted)]">{recipe === "bookshelf" ? t("bookshelfItemsHint") : libraryMode === "tables" ? t("tablesItemsHint") : libraryMode === "pick" ? t("customItemsHint") : allBooks ? t("bookItemsHint") : t("cineItemsHint")}</p>
            <Field label={libraryMode === "pick" ? t("libraryLabel") : t("moreLibrariesLabel")} hint={libraryMode === "pick" ? t("libraryHint") : t("moreLibrariesHint")} plain className="mb-5">
              <LibraryPills
                choices={extraChoices}
                selectedKinds={extraKinds}
                label={libraryMode === "pick" ? t("libraryLabel") : t("moreLibrariesLabel")}
                onPick={(choice) => toggleExtraLibrary(choice.kind)}
                onNew={() => setNewLibrary(true)}
              />
            </Field>
            <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4">
              <Toggle checked={itemDates} onChange={setItemDates} label={t("itemDatesLabel")} hint={t("itemDatesHint")} />
            </div>
            {itemLibraries.length ? (
              <CineItemsEditor
                value={cineItems}
                onChange={setCineItems}
                members={personal ? [] : group?.members ?? []}
                scope={scope}
                libraries={itemLibraries}
                recommendationsEnabled={recommendationsEnabled}
                fallbackProperties={tablesFallback}
                showSchedule={itemDates}
                onProblem={setItemProblem}
              />
            ) : <EmptyState title={t("pickLibraryFirst")} />}
            <p className="mt-3 text-xs font-medium text-[var(--muted)]">{t("itemsCount", { count: itemInputs.length })}</p>
          </div>
        ) : null}

        {step === peopleStep ? (
          <div>
            <h2 className="text-xl font-light">{t("peopleTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("peopleSubtitle")}</p>
                {group?.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">{t("peopleLegend")}</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4" key={member.id}><input type="checkbox" aria-label={t("selectMember", { name: member.name })} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title={t("noMembersTitle")} />}
            <div className="mt-6 rounded-2xl bg-[var(--wash)] p-5 text-sm leading-6"><strong className="block text-base">{t("summaryTitle")}</strong><span className="mt-2 block text-[var(--muted)]">{t("summaryFields", { count: fields.length })} · {t("summaryItems", { count: itemInputs.length })} · {t("summaryParticipants", { count: participantIds.length })}</span><p className="mt-2 text-[var(--muted)]">{t("summaryNote")}</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={() => step === 1 ? onBack() : setStep((current) => current - 1)}>{step === 1 ? tc("cancel") : t("backStep")}</Button>
          {step < lastStep ? <Button onClick={nextStep}>{t("next")}</Button> : <Button disabled={busy} onClick={() => void submit()}>{busy ? t("creatingDraft") : t("createDraft")}</Button>}
        </div>
      </section>
      {newLibrary ? (
        <NewLibraryDialog
          scope={scope}
          onCancel={() => setNewLibrary(false)}
          onCreated={(made) => { setNewLibrary(false); reloadLibraries(); setExtraKinds((current) => [...current, made.kind]); }}
        />
      ) : null}
    </main>
  );
}
