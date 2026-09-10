"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { API_PATHS } from "../api";
import { CheckpointPlanner } from "../checkpoint-planner";
import { Segmented } from "../Segmented";
import { useGoaFormat } from "../format";
import { CineItemsEditor, type CineRow, cineRowsToInput } from "../cine-items";
import { ConfirmDialog, Dialog, FormDialog } from "../dialog";
import { cleanFields, FIELD_TYPES, FieldConfigInputs, newFieldConfig, uniqueFieldKey } from "../fields";
import { ListImportPanel } from "../list-import-panel";
import { RuleSectionsEditor, visibleRuleSections } from "../rules";
import { ChallengeActions } from "./challenge-actions";
import type {
  AdminTab,
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  ChallengeItemInput,
  ChallengeSummary,
  CheckpointInput,
  Entry,
  GroupSummary,
  Id,
  ImportPreview,
  Member,
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
import { formatRuntime, isLivingList, itemIdForEntry, recipeCatalogKind, valuesAsRecord } from "../utils";
import { AdminMetrics } from "./metrics";
import { DynamicEntryForm } from "./participant-challenge";

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
export interface DuplicateTargetGroup {
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
}: {
  challenge: ChallengeDetail;
  onSave: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tf = useTranslations("fields");
  const tv = useTranslations("visibility");
  const f = useGoaFormat();
  const hasExpectation = challenge.entryTypes.some((type) => type.purpose === "expectation");
  const canToggleExpectation =
    challenge.status === "draft"
    && challenge.submissionMode === "item"
    && challenge.entryTypes.some((type) => type.purpose === "rating");
  const [expectationBusy, setExpectationBusy] = useState(false);
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
  const locked = challenge.status === "closed";

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
      {types.length > 1 ? (
        <Segmented
          className="mb-6 max-w-md"
          ariaLabel={t("fieldsTypeLegend")}
          value={selectedTypeId}
          onChange={pickType}
          options={types.map((type) => ({ value: type.id, label: type.name }))}
        />
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

      {(selectedTypeId && challenge.status !== "closed") || canToggleExpectation || hasExpectation ? (
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

type ItemUpdatePayload = {
  title: string; description: string; recommendedByUserId?: string | null;
  author?: string; year?: number | null; mainGenre?: string; pageCount?: number | null; runtimeMinutes?: number | null;
};

export function ItemEditorDialog({
  item,
  challenge,
  members,
  catalogKind,
  onCancel,
  onSave,
}: {
  item: ChallengeItem;
  challenge: ChallengeDetail;
  members: Member[];
  catalogKind: "film" | "book";
  onCancel: () => void;
  onSave: (payload: ItemUpdatePayload) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const hasCatalog = Boolean(item.catalogItem);
  const initial = {
    title: item.title,
    description: item.description ?? "",
    recommendedBy: item.recommendedBy?.id ?? "",
    author: item.catalogItem?.author ?? "",
    year: item.catalogItem?.year ? String(item.catalogItem.year) : "",
    pages: item.catalogItem?.pageCount ? String(item.catalogItem.pageCount) : "",
    runtime: item.catalogItem?.runtimeMinutes ? String(item.catalogItem.runtimeMinutes) : "",
    genre: item.catalogItem?.mainGenre ?? "",
  };
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const catalogPreview = [draft.year, draft.genre, catalogKind === "book" ? (draft.pages && `${draft.pages} p.`) : (draft.runtime && `${draft.runtime} min`)].filter(Boolean).join(" · ");

  async function submit() {
    if (hasCatalog && catalogKind === "book" && !draft.author.trim()) { setError(tCine("authorRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const year = Number(draft.year);
      const pages = Number(draft.pages);
      const runtime = Number(draft.runtime);
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        ...(challenge.submissionMode === "item" ? { recommendedByUserId: draft.recommendedBy || null } : {}),
        ...(hasCatalog ? {
          year: Number.isInteger(year) && year > 0 ? year : null,
          mainGenre: draft.genre.trim(),
          ...(catalogKind === "book"
            ? { author: draft.author.trim(), pageCount: Number.isInteger(pages) && pages > 0 ? pages : null }
            : { runtimeMinutes: Number.isInteger(runtime) && runtime > 0 ? runtime : null }),
        } : {}),
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
      {challenge.submissionMode === "item" && members.length ? (
        <Field label={t("itemRecommendedBy")}>
          <select className={inputClass} value={draft.recommendedBy} onChange={(event) => set({ recommendedBy: event.target.value })}><option value="">{t("itemRecommendedByNone")}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select>
        </Field>
      ) : null}
      {hasCatalog ? (
        <Disclosure summary={tCine("catalogFacts")} preview={catalogPreview || undefined} defaultOpen={catalogKind === "book" && !draft.author.trim()}>
          <div className="space-y-4 pt-2">
            {catalogKind === "book" ? (
              <Field label={tCine("author")} error={draft.author.trim() ? null : tCine("authorRequired")}>
                <input className={cx(inputClass, draft.author.trim() ? "" : "border-[var(--danger)]")} value={draft.author} maxLength={200} placeholder={tCine("authorPlaceholder")} onChange={(event) => set({ author: event.target.value })} />
              </Field>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={tCine(catalogKind === "film" ? "latestYear" : "year")}>
                <input className={inputClass} type="number" inputMode="numeric" min={1870} max={2200} value={draft.year} onChange={(event) => set({ year: event.target.value })} />
              </Field>
              {catalogKind === "book" ? (
                <Field label={tCine("pages")}><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={draft.pages} onChange={(event) => set({ pages: event.target.value })} /></Field>
              ) : (
                <Field label={tCine("runtimeMinutes")}><input className={inputClass} type="number" inputMode="numeric" min={1} max={2000} value={draft.runtime} placeholder={tCine("runtimeMinutesPlaceholder")} onChange={(event) => set({ runtime: event.target.value })} /></Field>
              )}
              <Field label={tCine("mainGenre")}><input className={inputClass} value={draft.genre} maxLength={80} placeholder={tCine("mainGenrePlaceholder")} onChange={(event) => set({ genre: event.target.value })} /></Field>
            </div>
          </div>
        </Disclosure>
      ) : null}
    </FormDialog>
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
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  entries: Entry[];
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: ItemUpdatePayload) => Promise<void>;
  onArchive: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
}) {
  const t = useTranslations("adminChallenge");
  const tCine = useTranslations("cineItems");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const members = group?.members ?? [];
  const catalogKind = recipeCatalogKind(challenge.recipeKey) === "book" ? "book" : "film";
  const [newItemRows, setNewItemRows] = useState<CineRow[]>([]);
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
        if (catalogKind === "book" && newItemRows.some((row) => row.title.trim() && !row.author.trim())) {
          setError(tCine("authorRequired")); setBusy(false); return;
        }
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
      <div className="mb-5"><StatusMessage error={error} success={success} /></div>

      {showAdd && canShowAdd ? (
        <div className="mb-8 rounded-2xl border border-[var(--line)] p-5">
          <form className="space-y-5" onSubmit={submit}>
            {challenge.submissionMode === "daily"
              ? <><p className="text-xs leading-5 text-[var(--muted)]">{t("dailyGenNote")}</p><Field label={t("firstDay")}><input className={inputClass} type="date" value={startsOn} readOnly required /></Field><Field label={t("lastDay")}><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></Field></>
              : <><CineItemsEditor value={newItemRows} onChange={setNewItemRows} members={members} catalogPath={group ? API_PATHS.groupCatalog(group.id) : API_PATHS.personalCatalog} kind={catalogKind} />{challenge.status === "active" ? <p className="text-xs leading-5 text-[var(--muted)]">{t("activeItemsNote")}</p> : null}</>}
            <Button type="submit" disabled={busy || (challenge.submissionMode === "daily" ? challenge.status !== "draft" : !canAddItems || !newItemRows.length)}>{busy ? tc("saving") : challenge.submissionMode === "daily" ? t("generateCheckpoints") : t("add")}</Button>
          </form>
          {challenge.submissionMode === "item" ? (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <ListImportPanel onPreview={onPreviewImport} onCommit={(items: ChallengeItemInput[]) => onAdd({ items })} />
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
                  {item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}
                  {item.recommendedBy || item.catalogItem?.author || item.catalogItem?.mainGenre || item.catalogItem?.runtimeMinutes ? <small className="mt-1 block text-[var(--muted)]">{[item.catalogItem?.author ? tCine("byAuthor", { name: item.catalogItem.author }) : null, item.recommendedBy ? t("itemRecommendedByLine", { name: item.recommendedBy.name }) : null, item.catalogItem?.mainGenre || null, formatRuntime(item.catalogItem?.runtimeMinutes)].filter(Boolean).join(" · ")}</small> : null}
                  {item.date || item.opensAt || item.dueAt ? <small className="mt-1 block text-[var(--muted)]">{item.date ? f.date(item.date) : t("itemWindow", { opens: f.date(item.opensAt), due: f.date(item.dueAt) })}</small> : null}
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
          catalogKind={catalogKind}
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

function AdminReview({
  challenge,
  entries,
  onPatch,
  onDelete,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDelete: (entryId: Id, reason: string) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const f = useGoaFormat();
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedItem = challenge.items.find((item) => item.id === (selected ? itemIdForEntry(selected) : null)) ?? null;
  const selectedFields = (selected?.entryTypeId
    && challenge.entryTypes.find((type) => type.id === selected.entryTypeId)?.fields)
    || challenge.fields;
  const expected = challenge.items.length * challenge.participants.length;
  const doneCount = challenge.completionEntryTypeId
    ? entries.filter((entry) => entry.entryTypeId === challenge.completionEntryTypeId).length
    : entries.length;

  return (
    <section className="mx-auto max-w-5xl space-y-12">
      <div>
        <PageHeading title={t("reviewTitle")} description={t("reviewSummary", { sent: entries.length, pending: Math.max(0, expected - doneCount), late: entries.filter((entry) => entry.isLate).length })} />
        <div className="mb-5"><StatusMessage success={success} /></div>
        {entries.length ? (
          <ShowMoreList
            items={entries}
            preview={12}
            className="divide-y divide-[var(--line)]"
            render={(entry) => {
              const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
              const type = challenge.entryTypes.find((candidate) => candidate.id === entry.entryTypeId);
              return (
                <div className="flex items-start justify-between gap-4 py-4" key={entry.id}>
                  <div className="min-w-0">
                    <strong className="block text-base font-medium">{entry.participantName ?? entry.participantUsername ?? t("participantFallback")}</strong>
                    <span className="mt-1 block text-xs text-[var(--muted)]">{[item?.title ?? t("freeEntry"), type && challenge.entryTypes.length > 1 ? type.name : null, f.dateTime(entry.submittedAt ?? entry.updatedAt)].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {entry.isLate ? <span className="rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-light text-[var(--warn)]">{t("late")}</span> : null}
                    <Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" onClick={() => setSelectedId(entry.id)}>{t("inspect")}</Button>
                  </div>
                </div>
              );
            }}
          />
        ) : <EmptyState title={t("noEntriesTitle")} />}
      </div>


      {selected ? (
        <CorrectionDialog
          entry={selected}
          challenge={challenge}
          item={selectedItem}
          fields={selectedFields}
          onClose={() => setSelectedId(null)}
          onPatch={async (values, reason) => { await onPatch(selected.id, values, reason); setSuccess(t("entryCorrected")); }}
          onDelete={async (reason) => { await onDelete(selected.id, reason); setSelectedId(null); setSuccess(t("entryDeleted")); }}
        />
      ) : null}
    </section>
  );
}

export function CorrectionDialog({
  entry,
  challenge,
  item,
  fields,
  onClose,
  onPatch,
  onDelete,
}: {
  entry: Entry;
  challenge: ChallengeDetail;
  item: ChallengeItem | null;
  fields: ChallengeField[];
  onClose: () => void;
  onPatch: (values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDelete: (reason: string) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const f = useGoaFormat();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closed = challenge.status === "closed";

  return (
    <Dialog title={t("correctionHeading", { name: entry.participantName ?? t("participantFallback"), item: item?.title ?? t("entryFallback") })} onClose={onClose}>
      <p className="text-xs text-[var(--muted)]">{t("correctionKicker")}</p>
      <div className="mt-4">
        <Field label={`${t("reasonLabel")} *`}>
          <textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("reasonPlaceholder")} maxLength={500} disabled={closed} />
        </Field>
      </div>
      <div className="mt-5">
        <DynamicEntryForm
          key={`${entry.id}-${entry.updatedAt ?? ""}`}
          fields={fields}
          item={item}
          entry={entry}
          canEdit={!closed}
          unavailableMessage={closed ? f.entryUnavailableMessage({ challengeStatus: "closed" }) : null}
          onSave={async (values) => { if (!reason.trim()) throw new Error(t("reasonRequired")); await onPatch(values, reason.trim()); onClose(); }}
          alwaysEditable
        />
      </div>
      {!closed ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
          <p className="text-sm text-[var(--muted)]">{t("deleteEntryHint")}</p>
          <Button variant="danger" onClick={() => { if (!reason.trim()) { setError(t("deleteEntryReasonRequired")); return; } setError(null); setConfirmDelete(true); }}>{t("deleteEntry")}</Button>
        </div>
      ) : null}
      <div className="mt-4"><StatusMessage error={error} /></div>

      {confirmDelete ? (
        <ConfirmDialog title={t("deleteEntry")} body={t("deleteEntryConfirm")} confirmLabel={t("deleteEntry")} busyLabel={t("deletingEntry")} danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => onDelete(reason.trim())} />
      ) : null}
    </Dialog>
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
  onReorderBlocks,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<{ unpublished?: boolean } | undefined>;
  onReorderBlocks: (blocks: Array<{ id: Id; visible: boolean }>) => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("managementUX");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [headline, setHeadline] = useState(challenge.result?.headline ?? "");
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [anonymize, setAnonymize] = useState(challenge.resultsAnon === true);
  const [includeRankings, setIncludeRankings] = useState((challenge.result?.personalRankings?.length ?? 0) > 0 || !challenge.result);
  const [includeAffinity, setIncludeAffinity] = useState(Boolean(challenge.result?.affinity?.pairs.length) || !challenge.result);
  const savedOrderKey = (challenge.result?.blocks ?? []).map((b) => b.id).join(",");
  const [blockOrder, setBlockOrder] = useState(
    [...(challenge.result?.blocks ?? [])].sort((a, b) => a.position - b.position).map((block) => ({ id: block.id, visible: block.visible })),
  );
  const [previousOrderKey, setPreviousOrderKey] = useState(savedOrderKey);
  if (previousOrderKey !== savedOrderKey) {
    setPreviousOrderKey(savedOrderKey);
    setBlockOrder([...(challenge.result?.blocks ?? [])].sort((a, b) => a.position - b.position).map((b) => ({ id: b.id, visible: b.visible })));
  }
  const [orderBusy, setOrderBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const blockLabelById = useMemo(() => {
    const map = new Map<Id, string>();
    for (const block of challenge.result?.blocks ?? []) {
      map.set(block.id,
        block.kind === "text" ? (block.heading === "headline" ? t("blockHeadline") : t("blockSummary"))
        : block.kind === "metric" ? (block.metric?.label ?? t("blockMetric"))
        : block.kind === "ranking" ? t("includeRankings")
        : block.kind === "affinity" ? t("includeAffinity")
        : block.kind === "entry_value" ? t("blockComment")
        : block.kind);
    }
    return map;
  }, [challenge.result?.blocks, t]);
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

  const isClosed = challenge.status === "closed";
  const isPublished = Boolean(challenge.result?.publishedAt);
  function savedMessage(result: { unpublished?: boolean } | undefined, base: string) {
    if (result?.unpublished) return t("draftSavedUnpublishedAnon");
    return isPublished ? t("draftSavedRepublishHint") : base;
  }

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
        anonymizeParticipants: anonymize,
        includeRankings,
        includeAffinity,
      });
      setSuccess(savedMessage(result, t("resultsSaved")));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await onSave({ regenerate: true, anonymizeParticipants: anonymize });
      setSuccess(savedMessage(result, t("showcaseRegenerated")));
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="min-w-0 space-y-6">
        {!isClosed ? <p className="rounded-xl bg-[var(--wash)] p-4 text-sm leading-6 text-[var(--muted)]">{tx("curationAfterClose")}</p> : null}
        <details open className="group border-b border-[var(--line)] pb-6">
          <summary className="cursor-pointer list-none py-3 text-xl font-medium tracking-tight [&::-webkit-details-marker]:hidden">{tx("curation")}</summary>
          <fieldset disabled={!isClosed || busy} className="min-w-0 space-y-4">
      <div>
        <p className="mb-5 text-sm leading-6 text-[var(--muted)]">{t("resultsSubtitle")}</p>
        <div className="space-y-5">
          <Field label={t("headlineLabel")}><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={160} placeholder={challenge.title} /></Field>
          <Field label={t("summaryLabel")}><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></Field>
        </div>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("highlightMetrics")}</legend>{challenge.metrics.length ? <div className="mt-3"><ShowMoreList items={challenge.metrics} preview={6} className="grid gap-2" render={(metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={t("highlightMetricAria", { label: metric.label })} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? t("metricNoValue")}</small></span></label>} /></div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("createMetricsFirst")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("selectedComments")}</legend><p className="mt-2 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">{t("commentPrivacyWarning")}</p>{candidates.length ? <div className="mt-3"><ShowMoreList items={candidates} preview={4} className="grid gap-2 sm:grid-cols-2" render={(candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={t("selectCommentAria", { author: candidate.authorName })} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-light text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>} /></div> : <p className="mt-2 text-sm text-[var(--muted)]">{t("noTextFields")}</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-light">{t("wrappedBlocks")}</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm"><input type="checkbox" aria-label={t("includeRankings")} checked={includeRankings} onChange={(event) => setIncludeRankings(event.target.checked)} /><span>{t("includeRankings")}</span></label>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm"><input type="checkbox" aria-label={t("includeAffinity")} checked={includeAffinity} onChange={(event) => setIncludeAffinity(event.target.checked)} /><span>{t("includeAffinity")}</span></label>
          </div>
        </fieldset>
        <label className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm"><input className="mt-0.5" type="checkbox" aria-label={t("anonymizeParticipants")} checked={anonymize} onChange={(event) => setAnonymize(event.target.checked)} /><span><strong className="block">{t("anonymizeParticipants")}</strong><small className="text-[var(--muted)]">{t("anonymizeHint")}</small></span></label>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveDraft")}</Button><Button variant="secondary" disabled={busy} onClick={() => void regenerate()}>{t("regenerateDraft")}</Button></div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("regenerateHint")}</p>
      </div>
          </fieldset>
        </details>

      {blockOrder.length ? (
        <details className="border-b border-[var(--line)] pb-6">
          <summary className="cursor-pointer list-none py-3 text-xl font-medium tracking-tight [&::-webkit-details-marker]:hidden">{tx("order")}</summary>
          <p className="mb-4 text-sm leading-6 text-[var(--muted)]">{t("blockOrderSubtitle")}</p>
          <fieldset disabled={!isClosed || busy || orderBusy} className="min-w-0">
          <ShowMoreList
            items={blockOrder}
            preview={8}
            className="space-y-2"
            render={(entry, index) => (
              <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm" key={entry.id}>
                <span className="w-5 flex-none tabular-nums text-[var(--muted)]">{index + 1}</span>
                <span className={cx("min-w-0 flex-1 truncate", !entry.visible && "text-[var(--muted)] line-through")}>{blockLabelById.get(entry.id) ?? entry.id}</span>
                <label className="flex flex-none items-center gap-1.5 text-xs"><input type="checkbox" aria-label={t("blockVisible")} checked={entry.visible} onChange={(event) => setBlockOrder((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, visible: event.target.checked } : item))} />{t("blockVisible")}</label>
                <Button variant="ghost" className="px-2" disabled={index === 0} onClick={() => setBlockOrder((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑<span className="sr-only">{t("blockUp")}</span></Button>
                <Button variant="ghost" className="px-2" disabled={index === blockOrder.length - 1} onClick={() => setBlockOrder((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓<span className="sr-only">{t("blockDown")}</span></Button>
              </div>
            )}
          />
          <Button className="mt-4" disabled={orderBusy} onClick={() => { setOrderBusy(true); setError(null); onReorderBlocks(blockOrder).then(() => setSuccess(t("blockOrderSaved"))).catch((cause: unknown) => setError(f.error(cause))).finally(() => setOrderBusy(false)); }}>{orderBusy ? tc("saving") : t("blockOrderSave")}</Button>
          </fieldset>
        </details>
      ) : <p className="text-sm text-[var(--muted)]">{tx("orderAfterSave")}</p>}

      </div>
    </div>
  );
}

export function AdminScreen({
  challenge,
  entries,
  group,
  tab,
  onTab,
  onBack,
  onViewParticipant,
  onSaveBasics,
  onTransition,
  onDuplicate,
  isPlatformAdmin = false,
  onPublishTemplate,
  onUnpublishTemplate,
  duplicateTargets,
  onDelete,
  onSaveParticipants,
  onSaveFields,
  onSaveEntryTypeVisibility,
  onSetExpectation,
  onAddItems,
  onUpdateItem,
  onArchiveItem,
  onPreviewImport,
  onSaveCheckpoints,
  onAssignCheckpointItems,
  onPatchEntry,
  onDeleteEntry,
  onAddMetric,
  onUpdateMetric,
  onDeleteMetric,
  onSaveResult,
  onPublishResult,
  onUnpublishResult,
  onReorderBlocks,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  onViewParticipant: () => void;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  isPlatformAdmin?: boolean;
  onPublishTemplate: (summary: string) => Promise<void>;
  onUnpublishTemplate: () => Promise<void>;
  duplicateTargets: DuplicateTargetGroup[];
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (entryTypeId: Id, fields: ChallengeField[]) => Promise<void>;
  onSaveEntryTypeVisibility: (entryTypeId: Id, visibilityPolicy: string) => Promise<void>;
  onSetExpectation: (enabled: boolean) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: {
    title: string; description: string; recommendedByUserId?: string | null;
    author?: string; year?: number | null; mainGenre?: string; pageCount?: number | null; runtimeMinutes?: number | null;
  }) => Promise<void>;
  onArchiveItem: (itemId: Id) => Promise<void>;
  onPreviewImport: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
  onSaveCheckpoints: (checkpoints: CheckpointInput[]) => Promise<void>;
  onAssignCheckpointItems: (assignments: Array<{ itemId: Id; checkpointId: Id | null; position?: number }>) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onDeleteEntry: (entryId: Id, reason: string) => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateMetric: (metricId: Id, payload: Record<string, unknown>) => Promise<void>;
  onDeleteMetric: (metricId: Id) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<{ unpublished?: boolean } | undefined>;
  onPublishResult: (payload: Record<string, unknown>) => Promise<{ url?: string | null; publishedAt?: string; anonymized?: boolean } | undefined>;
  onUnpublishResult: () => Promise<void>;
  onReorderBlocks: (blocks: Array<{ id: Id; visible: boolean }>) => Promise<void>;
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
    "review", "metrics", "results",
  ];
  const requestedTab = tab === "participants" ? "overview" : tab;
  const activeTab = tabs.includes(requestedTab) ? requestedTab : "overview";

  return (
    <main className="pb-24">
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_90%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <BackButton onClick={onBack} label={tc("back")} className="flex-none" />
          <span className="h-5 w-px flex-none bg-[var(--line)]" aria-hidden="true" />
          <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{challenge.title}</h1>
          <ChallengeActions challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onDelete={onDelete} onTransition={onTransition} onViewParticipant={onViewParticipant} isPlatformAdmin={isPlatformAdmin} onPublishTemplate={onPublishTemplate} onUnpublishTemplate={onUnpublishTemplate} onPublish={onPublishResult} onUnpublish={onUnpublishResult} />
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
        {activeTab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.entryTypes.map((type) => `${type.id}#${type.visibilityPolicy}#${type.fields.map((field) => field.id ?? field.key).join(",")}`).join("|")}`} challenge={challenge} onSave={onSaveFields} onSaveVisibility={onSaveEntryTypeVisibility} onSetExpectation={onSetExpectation} /> : null}
        {activeTab === "items" ? <AdminItems challenge={challenge} group={group} entries={entries} onAdd={onAddItems} onUpdate={onUpdateItem} onArchive={onArchiveItem} onPreviewImport={onPreviewImport} /> : null}
        {activeTab === "checkpoints" ? <CheckpointPlanner key={`${challenge.id}:${challenge.checkpoints.map((cp) => cp.id).join(",")}`} challenge={challenge} onSaveCheckpoints={onSaveCheckpoints} onAssign={onAssignCheckpointItems} /> : null}
        {activeTab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onDelete={onDeleteEntry} /> : null}
        {activeTab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} onUpdate={onUpdateMetric} onDelete={onDeleteMetric} /> : null}
        {activeTab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} onReorderBlocks={onReorderBlocks} /> : null}
      </div>
    </main>
  );
}
