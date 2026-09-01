"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGoaFormat } from "../format";
import { cleanFields, FieldBuilder, presetFields } from "../fields";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { RuleSectionsEditor } from "../rules";
import type { ChallengeCreationInput, ChallengeField, ChallengeRule, GroupSummary, Id, Template } from "../types";
import { backLinkClass, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, SchedulePeriodFields, StatusMessage } from "../ui";

export function CreateChallengeScreen({
  group,
  onBack,
  onCreate,
}: {
  group: GroupSummary;
  onBack: () => void;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
}) {
  const t = useTranslations("createChallenge");
  const tc = useTranslations("common");
  const tp = useTranslations("fields.preset");
  const f = useGoaFormat();
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<Template | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [ruleSections, setRuleSections] = useState<ChallengeRule[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"period" | "none">("none");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [fields, setFields] = useState<ChallengeField[]>([]);
  const [cineItems, setCineItems] = useState<CineRow[]>([]);
  const [participantIds, setParticipantIds] = useState<Id[]>(group.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemInputs = cineRowsToInput(cineItems);

  function chooseTemplate(next: Template) {
    setTemplate(next);
    setFields(presetFields(next, (key) => tp(key)));
    setTitle(next === "cine" ? t("templateCineTitle") : t("templateReadingTitle"));
    // Cine Livre é o padrão: sem prazo. Leitura (diário) começa com período.
    setScheduleMode(next === "reading" ? "period" : "none");
    setCineItems([]);
  }

  function nextStep() {
    setError(null);
    if (step === 1 && (!template || !title.trim())) {
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
    if (step === 1 && meetingUrl.trim() && !/^https:\/\/\S+$/u.test(meetingUrl.trim())) {
      setError(t("errMeetingUrl"));
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
    if (step === 3 && template === "cine" && !itemInputs.length) {
      setError(t("errNoItems"));
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        template,
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
        submissionMode: template === "reading" ? "daily" : "item",
        fields: cleanFields(fields),
        items: template === "cine" ? itemInputs : [],
        generateDaily: template === "reading" && scheduleMode === "period",
        participantIds,
      });
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  const stepKeys = ["base", "fields", "checkpoints", "people"] as const;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back", { group: group.name })}</button>
      <PageHeading title={t("title")} description={t("subtitle")} />
      <nav className="mb-6 grid grid-cols-4 gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1" aria-label={t("stepsNav")}>
        {stepKeys.map((key, index) => <button className={cx("min-h-11 rounded-xl px-2 text-xs font-light sm:text-sm", step === index + 1 ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : index + 1 < step ? "text-[var(--ink)]" : "text-[var(--muted)]")} type="button" onClick={() => index + 1 < step && setStep(index + 1)} disabled={index + 1 > step} key={key}><span className="hidden sm:inline">{index + 1}. </span>{t(`steps.${key}`)}</button>)}
      </nav>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        {step === 1 ? (
          <div>
            <h2 className="text-xl font-light">{t("startTitle")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["cine", "reading"] as const).map((value) => (
                <button className={cx("rounded-2xl border p-5 text-left transition", template === value ? "border-[var(--main)] bg-[var(--main-soft)] ring-2 ring-[var(--main)]/25" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]")} type="button" aria-pressed={template === value} onClick={() => chooseTemplate(value)} key={value}>
                  <span className="text-2xl" aria-hidden="true">{value === "cine" ? "◉" : "▤"}</span>
                  <strong className="mt-3 block text-lg">{value === "cine" ? t("templateCine") : t("templateReading")}</strong>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{value === "cine" ? t("templateCineBody") : t("templateReadingBody")}</span>
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
              <label className="sm:col-span-2"><span className={labelClass}>{t("descriptionLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>{t("meetingLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><input className={inputClass} type="url" inputMode="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} maxLength={2000} placeholder="https://meet.example.com/…" /><small className="mt-1 block text-xs text-[var(--muted)]">{t("meetingHint")}</small></label>
              <div className="sm:col-span-2"><div className="mb-3"><span className={labelClass}>{t("rulesLabel")} <small className="font-light text-[var(--muted)]">{t("optional")}</small></span><p className="text-xs leading-5 text-[var(--muted)]">{t("rulesHint")}</p></div><RuleSectionsEditor value={ruleSections} onChange={setRuleSections} /></div>
            </div>
          </div>
        ) : null}

        {step === 2 ? <div><h2 className="text-xl font-light">{t("fieldsTitle")}</h2><p className="mb-5 mt-1 text-sm text-[var(--muted)]">{t("fieldsSubtitle")}</p><FieldBuilder fields={fields} onChange={setFields} /></div> : null}

        {step === 3 ? (
          <div>
            <h2 className="text-xl font-light">{t("checkpointsTitle")}</h2>
            {template === "cine" ? (
              <><p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted)]">{t("cineItemsHint")}</p><CineItemsEditor value={cineItems} onChange={setCineItems} members={group.members ?? []} groupId={group.id} /><p className="mt-3 text-xs font-semibold text-[var(--muted)]">{t("itemsCount", { count: itemInputs.length })}</p></>
            ) : scheduleMode === "period" ? (
              <div className="mt-5 rounded-2xl border border-[var(--ok-line)] bg-[var(--ok-soft)] p-5"><strong className="text-[var(--ok)]">{t("dailyTitle")}</strong><p className="mt-2 text-sm leading-6 text-[var(--ok)]">{t("dailyBody", { start: f.date(startsOn), end: f.date(endsOn) })}</p></div>
            ) : (
              <div className="mt-5 rounded-2xl border border-[var(--ok-line)] bg-[var(--ok-soft)] p-5"><strong className="text-[var(--ok)]">{t("habitTitle")}</strong><p className="mt-2 text-sm leading-6 text-[var(--ok)]">{t("habitBody")}</p></div>
            )}
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <h2 className="text-xl font-light">{t("peopleTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("peopleSubtitle")}</p>
            {group.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">{t("peopleLegend")}</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4" key={member.id}><input type="checkbox" aria-label={t("selectMember", { name: member.name })} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title={t("noMembersTitle")} description={t("noMembersBody")} />}
            <div className="mt-6 rounded-2xl bg-[var(--wash)] p-5 text-sm leading-6"><strong className="block text-base">{t("summaryTitle")}</strong><span className="mt-2 block text-[var(--muted)]">{t("summaryFields", { count: fields.length })} · {template === "reading" ? scheduleMode === "period" ? t("summaryDaily") : t("summaryHabit") : t("summaryItems", { count: itemInputs.length })} · {t("summaryParticipants", { count: participantIds.length })}</span><p className="mt-2 text-[var(--muted)]">{t("summaryNote")}</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={() => step === 1 ? onBack() : setStep((current) => current - 1)}>{step === 1 ? tc("cancel") : t("backStep")}</Button>
          {step < 4 ? <Button onClick={nextStep}>{t("next")}</Button> : <Button disabled={busy} onClick={() => void submit()}>{busy ? t("creatingDraft") : t("createDraft")}</Button>}
        </div>
      </section>
    </main>
  );
}
