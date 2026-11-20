"use client";

import { StateButton } from "../state-button";
import { SettingsMenu } from "../SettingsMenu";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cleanFields } from "../fields";
import { useGoaFormat } from "../format";
import { type CatalogScope, useCatalogLibraries } from "../libraries";
import { CineItemsEditor, cineRowsToInput, type CineRow } from "../cine-items";
import { ChallengeSource } from "../challenge-source";
import { ResponseFields } from "../response-fields";
import { initialResponseFields, challengeRecording, type ChallengeLibrary } from "../challenge-creation";
import type { ChallengeCreationInput, ChallengeField, GroupSummary, Id } from "../types";
import { BackButton, CreationButton, choicePillClass, inputClass, labelClass, PageHeading, SchedulePeriodFields, SelectableCards, StatusMessage } from "../ui";
import { canManage } from "../utils";

type Where = { kind: "personal" } | { kind: "group"; groupId: Id; name: string; participantIds: Id[] };
function Ask({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-3">
    {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand asset */}
    <img src="/logo.png" alt="" aria-hidden="true" draggable={false} className="mt-0.5 h-7 w-7 flex-none object-contain" />
    <p className="mt-0.5 text-[15px] leading-6">{children}</p>
  </div>;
}
function Answered({ children, onEdit, editLabel }: { children: ReactNode; onEdit: () => void; editLabel: string }) {
  return <div className="ml-10 flex items-center gap-2.5"><span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[var(--main)] px-4 text-sm font-medium text-white">{children}</span><StateButton type="button" onClick={onEdit} className="cursor-pointer text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink)]">{editLabel}</StateButton></div>;
}

/** The guided/chat creator asks the same list/check-in choices as manual creation. */
export function QuickCreateScreen({ currentUserId, groups, into, onBack, backLabel, onCreateGroup, onSubmit }: {
  currentUserId: Id; groups: GroupSummary[]; into?: { groupId: Id } | "personal"; onBack: () => void; backLabel?: string;
  onCreateGroup: (name: string) => Promise<Id | null>;
  onSubmit: (target: { groupId: Id } | { personal: true }, input: ChallengeCreationInput) => Promise<void>;
}) {
  const t = useTranslations("quickCreate");
  const ts = useTranslations("challengeCreate");
  const tr = useTranslations("createChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const standardGroups = groups.filter((group) => group.kind !== "personal" && canManage(group.role));
  const [where, setWhere] = useState<Where | null>(() => {
    if (into === "personal") return { kind: "personal" };
    const group = into ? standardGroups.find((group) => group.id === into.groupId) : null;
    return group ? { kind: "group", groupId: group.id, name: group.name, participantIds: group.members?.map((member) => member.id) ?? [currentUserId] } : null;
  });
  const [pickingNewGroup, setPickingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [linked, setLinked] = useState(true);
  const [dated, setDated] = useState(false);
  const [library, setLibrary] = useState<ChallengeLibrary | null>(null);
  const [setupReady, setSetupReady] = useState(false);
  const [fields, setFields] = useState<ChallengeField[]>(() => initialResponseFields(ts("defaultField")));
  const [itemsReady, setItemsReady] = useState(false);
  const [answerScope, setAnswerScope] = useState<"individual" | "shared">("individual");
  const [title, setTitle] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"none" | "period">("none");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [rows, setRows] = useState<CineRow[]>([]);
  const [itemProblem, setItemProblem] = useState<"author" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope: CatalogScope | null = where ? where.kind === "personal" ? "personal" : { groupId: where.groupId } : null;
  const libraries = useCatalogLibraries(linked && !setupReady ? scope : null);
  const selectedLibrary = linked ? library : null;
  const fieldsValid = fields.length > 0 && fields.length <= 30 && fields.every((field) => field.label.trim());
  const items = selectedLibrary ? cineRowsToInput(rows) : [];
  const setupValid = Boolean(title.trim()) && (!linked || Boolean(library)) && (scheduleMode === "none" || Boolean(startsOn && endsOn && endsOn >= startsOn));
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (setupReady) end.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }); }, [where, setupReady, itemsReady]);
  function changeWhere() {
    setWhere(null); setLibrary(null); setRows([]); setSetupReady(false); setItemsReady(false); setError(null);
  }
  async function makeGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newGroupName.trim()) return;
    setGroupBusy(true); setGroupError(null);
    try {
      const id = await onCreateGroup(newGroupName.trim());
      if (!id) throw new Error(t("groupWithoutId"));
      setWhere({ kind: "group", groupId: id, name: newGroupName.trim(), participantIds: [currentUserId] }); setPickingNewGroup(false);
    } catch (cause) { setGroupError(f.error(cause)); }
    finally { setGroupBusy(false); }
  }
  async function create() {
    if (!where || !setupValid || !fieldsValid || (linked && (!library || !items.length || itemProblem))) return;
    setBusy(true); setError(null);
    try {
      const input: ChallengeCreationInput = {
        ...challengeRecording(selectedLibrary, dated, ts("responseName"), ts("entryName")),
        title: title.trim(), description: "", ruleSections: [], startsOn: scheduleMode === "period" ? startsOn : null, endsOn: scheduleMode === "period" ? endsOn : null,
        fields: cleanFields(fields), items, generateDaily: false,
        ...(!dated && selectedLibrary ? { answerScope, sharedEditPolicy: "members_fill_admin_corrects" as const } : {}),
        participantIds: where.kind === "personal" ? [] : where.participantIds,
      };
      await onSubmit(where.kind === "personal" ? { personal: true } : { groupId: where.groupId }, input);
    } catch (cause) { setError(f.error(cause)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
    <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
    <div className="relative max-sm:pr-12">
      <PageHeading title={ts("chatTitle")} description={ts("subtitle")} />
      <div className="absolute right-0 top-0 sm:hidden"><SettingsMenu /></div>
    </div>
    <div className="space-y-6">
      <div className="space-y-3"><Ask>{t("q2")}</Ask>
        {where ? <Answered onEdit={changeWhere} editLabel={t("change")}>{where.kind === "personal" ? t("justMe") : where.name}</Answered> : <div className="ml-10 space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("q2")}>
            <StateButton type="button" className={choicePillClass({})} onClick={() => setWhere({ kind: "personal" })}>{t("justMe")}</StateButton>
            {standardGroups.map((group) => <StateButton type="button" key={group.id} className={choicePillClass({})} onClick={() => setWhere({ kind: "group", groupId: group.id, name: group.name, participantIds: group.members?.map((member) => member.id) ?? [currentUserId] })}>{group.name}</StateButton>)}
            <StateButton type="button" className={choicePillClass({ dashed: true })} onClick={() => setPickingNewGroup((current) => !current)}>＋ {t("newGroup")}</StateButton>
          </div>
          {pickingNewGroup ? <form onSubmit={makeGroup}><label><span className={labelClass}>{t("newGroupPlaceholder")}</span><input className={inputClass} aria-label={t("newGroupPlaceholder")} value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} maxLength={100} /></label><CreationButton type="submit" className="mt-3 w-full" disabled={groupBusy || !newGroupName.trim()}>{t("newGroupCreate")}</CreationButton><StatusMessage error={groupError} /></form> : null}
        </div>}
      </div>
      {where && scope ? <div className="space-y-3"><Ask>{ts("setupQuestion")}</Ask>
        {setupReady ? <Answered onEdit={() => { setSetupReady(false); setItemsReady(false); }} editLabel={t("change")}>{title} · {ts(dated ? "daily" : "list")}{selectedLibrary ? ` · ${selectedLibrary.label || ts("library")}` : ""}</Answered> : <form className="ml-10 space-y-5" onSubmit={(event) => { event.preventDefault(); if (setupValid) { setSetupReady(true); setError(null); } }}>
          <label className="block"><span className={labelClass}>{ts("name")}</span><input className={inputClass} aria-label={ts("name")} placeholder={ts("namePlaceholder")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} /></label>
          <ChallengeSource scope={scope} libraries={libraries} linked={linked} dated={dated} libraryKind={library?.kind ?? null} onLinked={(next) => { setLinked(next); if (!next) setItemProblem(null); }} onDated={setDated} onLibrary={(next) => { if (library?.kind !== next.kind) { setRows([]); setItemProblem(null); } setLibrary(next); }} />
          <fieldset className="space-y-3"><legend className={labelClass}>{ts("deadline")}</legend>
            <SelectableCards value={scheduleMode} onChange={setScheduleMode} options={[
              { value: "none", label: ts("withoutDeadline"), hint: tr("scheduleNoneHint") },
              { value: "period", label: ts("withDeadline"), hint: ts("deadlineHint") },
            ]} />
            {scheduleMode === "period" ? <SchedulePeriodFields startsOn={startsOn} endsOn={endsOn} onStartsOn={setStartsOn} onEndsOn={setEndsOn} /> : null}
          </fieldset>
          <CreationButton type="submit" className="w-full" disabled={!setupValid}>{tc("continue")}</CreationButton>
        </form>}
      </div> : null}
      {where && scope && setupReady && selectedLibrary ? <div className="space-y-3"><Ask>{ts("itemsQuestion")}</Ask>
        {itemsReady ? <Answered onEdit={() => setItemsReady(false)} editLabel={t("change")}>{items.map((item) => item.title).join(" · ")}</Answered> : <div className="ml-10 space-y-4">
          <p className="text-sm text-[var(--muted)]">{ts("itemsHint")}</p>
          <CineItemsEditor value={rows} onChange={setRows} scope={scope} libraries={[selectedLibrary]} members={where.kind === "group" ? standardGroups.find((group) => group.id === where.groupId)?.members ?? [] : []} onProblem={setItemProblem} />
          <CreationButton className="w-full" disabled={!items.length || Boolean(itemProblem)} onClick={() => { setItemsReady(true); setError(null); }}>{tc("continue")}</CreationButton>
        </div>}
      </div> : null}
      {where && setupReady && (!selectedLibrary || itemsReady) ? <div className="space-y-3"><Ask>{ts("questionsQuestion")}</Ask><div className="ml-10 space-y-4">
        <ResponseFields fields={fields} onChange={setFields} linked={linked} dated={dated} answerScope={answerScope} onScope={setAnswerScope} />
        <CreationButton className="w-full" disabled={busy || !setupValid || !fieldsValid || Boolean(selectedLibrary && (!items.length || itemProblem))} onClick={() => void create()}>{busy ? tr("creatingDraft") : tr("createDraft")}</CreationButton>
      </div></div> : null}
      <StatusMessage error={error} />
      <div ref={end} />
    </div>
  </main>;
}
