"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGoaFormat } from "../format";
import { API_PATHS } from "../api";
import { cleanFields, FieldBuilder, presetFields } from "../fields";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeRule, CreatableRecipeKey, GroupSummary, Id } from "../types";
import { backLinkClass, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, SchedulePeriodFields, StatusMessage } from "../ui";

const RECIPES: Array<{ key: CreatableRecipeKey; catalogKind: "film" | "book" | null; scheduleMode: "period" | "none"; glyph: string }> = [
  { key: "cinema", catalogKind: "film", scheduleMode: "none", glyph: "◉" },
  { key: "bookshelf", catalogKind: "book", scheduleMode: "none", glyph: "〇" },
  { key: "library", catalogKind: "book", scheduleMode: "period", glyph: "◎" },
  { key: "habit", catalogKind: null, scheduleMode: "none", glyph: "𖣐" },
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
  const [cineItems, setCineItems] = useState<CineRow[]>([]);
  const [participantIds, setParticipantIds] = useState<Id[]>(group?.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemInputs = cineRowsToInput(cineItems);
  const recipeMeta = RECIPES.find((entry) => entry.key === recipe) ?? null;
  const tracksCatalog = recipeMeta?.catalogKind ?? null;
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
    setTitle(t(`recipes.${next}.title`));
    setScheduleMode(meta.scheduleMode);
    setCineItems([]);
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
    if (step === checkpointsStep && tracksCatalog && !itemInputs.length) {
      setError(tracksCatalog === "book" ? t("errNoBooks") : t("errNoItems"));
      return;
    }
    if (step === checkpointsStep && tracksCatalog === "book"
      && cineItems.some((row) => row.title.trim() && !row.author.trim())) {
      setError(t("errNoAuthor"));
      return;
    }
    setStep((current) => Math.min(lastStep, current + 1));
  }

  async function submit() {
    if (!recipe) return;
    if (tracksCatalog && !itemInputs.length) {
      setError(tracksCatalog === "book" ? t("errNoBooks") : t("errNoItems"));
      return;
    }
    if (tracksCatalog === "book" && cineItems.some((row) => row.title.trim() && !row.author.trim())) {
      setError(t("errNoAuthor"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        recipe,
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
        items: tracksCatalog ? itemInputs : [],
        generateDaily: false,
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
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{personal ? tc("backHome") : t("back", { group: group?.name ?? "" })}</button>
      <PageHeading title={personal ? t("personalTitle") : t("title")} description={personal ? t("personalSubtitle") : t("subtitle")} />
      <nav className={cx("mb-6 grid gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1", navColsClass)} aria-label={t("stepsNav")}>
        {stepKeys.map((key, index) => <button className={cx("min-h-11 truncate rounded-xl px-2 text-xs font-light sm:text-sm", step === index + 1 ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : index + 1 < step ? "text-[var(--ink)]" : "text-[var(--muted)]")} type="button" onClick={() => index + 1 < step && setStep(index + 1)} disabled={index + 1 > step} key={key}><span className="hidden sm:inline">{index + 1}. </span>{t(`steps.${key}`)}</button>)}
      </nav>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        {step === 1 ? (
          <div>
            <h2 className="text-xl font-light">{t("startTitle")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {RECIPES.map((entry) => (
                <button className={cx("rounded-2xl border p-5 text-left transition", recipe === entry.key ? "border-[var(--main)] bg-[var(--main-soft)] ring-2 ring-[var(--main)]/25" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]")} type="button" aria-pressed={recipe === entry.key} onClick={() => chooseRecipe(entry.key)} key={entry.key}>
                  <span className="text-2xl" aria-hidden="true">{entry.glyph}</span>
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

        {step === 2 ? <div><h2 className="text-xl font-light">{t("fieldsTitle")}</h2><p className="mb-5 mt-1 text-sm text-[var(--muted)]">{t("fieldsSubtitle")}</p><FieldBuilder fields={fields} onChange={setFields} /></div> : null}

        {step === checkpointsStep && tracksCatalog ? (
          <div>
            <h2 className="text-xl font-light">{t("checkpointsTitle")}</h2>
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted)]">{recipe === "bookshelf" ? t("bookshelfItemsHint") : tracksCatalog === "book" ? t("bookItemsHint") : t("cineItemsHint")}</p>
            <CineItemsEditor value={cineItems} onChange={setCineItems} members={personal ? [] : group?.members ?? []} catalogPath={personal ? API_PATHS.personalCatalog : API_PATHS.groupCatalog(group!.id)} kind={tracksCatalog === "book" ? "book" : "film"} />
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
            ) : <EmptyState title={t("noMembersTitle")} description={t("noMembersBody")} />}
            <div className="mt-6 rounded-2xl bg-[var(--wash)] p-5 text-sm leading-6"><strong className="block text-base">{t("summaryTitle")}</strong><span className="mt-2 block text-[var(--muted)]">{t("summaryFields", { count: fields.length })} · {t("summaryItems", { count: itemInputs.length })} · {t("summaryParticipants", { count: participantIds.length })}</span><p className="mt-2 text-[var(--muted)]">{t("summaryNote")}</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={() => step === 1 ? onBack() : setStep((current) => current - 1)}>{step === 1 ? tc("cancel") : t("backStep")}</Button>
          {step < lastStep ? <Button onClick={nextStep}>{t("next")}</Button> : <Button disabled={busy} onClick={() => void submit()}>{busy ? t("creatingDraft") : t("createDraft")}</Button>}
        </div>
      </section>
    </main>
  );
}
