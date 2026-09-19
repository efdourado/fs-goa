"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, forwardRef, type ReactNode, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { ApiError } from "../api";
import { copyText } from "../clipboard";
import { useGoaFormat } from "../format";
import { useDoneItems } from "../use-done-items";
import { recommenderLine } from "../recommender-picker";
import { SharedGlyph } from "../shared-responses";
import { defaultShowcaseBlocks, hasShowcaseContent, ShowcaseView } from "../showcase-view";
import { RuleSectionsView, visibleRuleSections } from "../rules";
import type {
  ChallengeDetail,
  ChallengeField,
  ChallengeItem,
  Entry,
  EntryTypeView,
  FieldConfig,
  Id,
  Metric,
  ParticipantTab,
  User,
} from "../types";
import {
  BackButton,
  Button,
  cardClass,
  ChallengeStatusBadge,
  CommentText,
  cx,
  EmptyState,
  inputClass,
  labelClass,
  sectionLabelClass,
  StatusMessage,
} from "../ui";
import {
  canManage,
  dateKeyInSaoPaulo,
  displayAnswer,
  findMissingRequiredField,
  formatRuntime,
  isChallengeScheduled,
  isEmptySaveADelete,
  isLivingList,
  itemIdForEntry,
  valuesAsRecord,
} from "../utils";

function ratingChoices(config?: FieldConfig): number[] {
  const min = config?.min ?? 0;
  const max = config?.max ?? 5;
  const step = config?.step && config.step > 0 ? config.step : 0.5;
  const count = Math.min(41, Math.floor((max - min) / step) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => Number((min + index * step).toFixed(4)));
}

/**
 * On desktop this is one clean row of equal pills (`sm:grid-cols-11`). On a phone
 * an odd count would wrap into a lopsided 6-over-5, so it becomes a single
 * horizontal snap-scroller of same-size pills, pre-scrolled to the current pick.
 * Tapping the already-picked pill clears it — the field goes blank, same as
 * never having answered, which on a required field lets a re-save delete the
 * entry instead of needing a separate delete button.
 */
function RatingField({
  id,
  field,
  value,
  disabled,
  ariaLabel,
  onPick,
}: {
  id: string;
  field: ChallengeField;
  value: unknown;
  disabled: boolean;
  ariaLabel: (rating: string) => string;
  onPick: (rating: number | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <div
      ref={scroller}
      id={id}
      tabIndex={-1}
      className="flex w-full min-w-0 snap-x gap-1.5 overflow-x-auto pb-2 sm:grid sm:grid-cols-11 sm:overflow-visible sm:pb-0 [scrollbar-width:thin]"
    >
      {ratingChoices(field.config).map((rating) => {
        // `Number(null)` and `Number("")` are both 0 — without this guard, a
        // cleared field wrongly re-lights the "0" pill instead of showing
        // nothing picked.
        const picked = value !== null && value !== undefined && value !== "" && Number(value) === rating;
        const text = String(rating).replace(".", ",");
        return (
          <button
            key={rating}
            type="button"
            aria-pressed={picked}
            aria-label={ariaLabel(text)}
            disabled={disabled}
            onClick={() => onPick(picked ? null : rating)}
            className={cx(
              "h-10 w-10 flex-none snap-center rounded-xl border text-sm font-light tabular-nums sm:h-11 sm:w-auto sm:text-xs",
              picked
                ? "border-[var(--main)] bg-[var(--main)] text-white"
                : "border-transparent bg-[var(--wash)] hover:border-[var(--main-line)]",
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function ChevronGlyph({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx(className ?? "h-3 w-3", "transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/** A small bordered pill for a secondary action — deliberately more present than an underlined word. */
const actionChipClass =
  "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const ghostChipClass = "border-transparent bg-[var(--wash)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

/** Two hanging quote marks — the "insert a quote line" affordance under a comment field. */
function QuoteGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M3.5 5.5c-1.1 0-2 .9-2 2v3h3v-3H3.5c0-.55.45-1 1-1v-1zM10 5.5c-1.1 0-2 .9-2 2v3h3v-3H10c0-.55.45-1 1-1v-1z" />
    </svg>
  );
}

/** A short rule — the "insert a divider line" affordance under a comment field. */
function DividerGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 8h11" />
    </svg>
  );
}

/** A closed padlock — the affordance next to an already-answered section's name that reopens it for editing. */
function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/** Imperative handle for a combined "save everything" button above several stacked sections. */
export interface DynamicEntryFormHandle {
  /** Saves this section if it's currently open for editing; a no-op (resolves `ok: true`) when it's collapsed/locked, since there's nothing to save. */
  submitIfEditing: () => Promise<{ ok: boolean }>;
}

export const DynamicEntryForm = forwardRef<DynamicEntryFormHandle, {
  fields: ChallengeField[];
  item: ChallengeItem | null;
  entry?: Entry;
  canEdit: boolean;
  unavailableMessage?: string | null;
  // A quiet "(read-only)" next to each field's own label instead of the usual
  // sentence banner below the form — for a state the label already explains
  // (the expectation locks once you rate; the label already says which field).
  readOnlyInline?: boolean;
  // The section's own name (e.g. "Se terminei...") — shown next to the lock
  // icon that reopens it for editing. Omit it (leaving the icon row unlabeled)
  // for a type whose own required field's label already says what it is.
  heading?: string;
  // Left border + lock-icon treatment. Defaults to whether `heading` is set;
  // pass it explicitly to decouple the two — a required-field type keeps the
  // border with no heading text, an all-optional type gets a heading with no
  // border at all (nothing there to lock, see `alwaysEditable`).
  sectioned?: boolean;
  // A short note rendered under the heading, before the summary/form — e.g.
  // the visibility policy sentence for this entry type.
  note?: ReactNode;
  // An "when did it happen" date that rides with the optional fields — blank
  // means the entry is saved without a date. Owned by the caller.
  dateField?: { label: string; hint: string; value: string; max: string; onChange: (value: string) => void };
  onSave: (values: Record<Id, unknown>, entry?: Entry) => Promise<void>;
  // The challenge's own zone, for reading the item's due date the way its admin set it.
  timeZone?: string;
  // Present only when this form is editing a saved entry the viewer may
  // remove. There is no delete button: clearing a required field (e.g.
  // tapping the already-picked rating again) and submitting calls this
  // instead of blocking with a "fill this in" error.
  onDelete?: () => Promise<void>;
  // Admin correction always wants the live form, never the read-only summary —
  // that IS the point of that screen. The participant's Today tab leaves this
  // false: an already-answered checkpoint shows a quiet summary instead of a
  // save button and a delete link sitting there forever.
  alwaysEditable?: boolean;
  // When several required-field sections are stacked, a single button below
  // the whole group saves all of them — each section's own Save button would
  // just be redundant then (Cancel, and the section's own validation/error
  // message, still show normally).
  hideOwnSaveButton?: boolean;
  // Reports every change of the open/collapsed state — the combined button
  // above uses this to know whether any section actually needs saving.
  onEditingChange?: (editing: boolean) => void;
}>(function DynamicEntryForm({
  fields,
  item,
  entry,
  canEdit,
  unavailableMessage,
  readOnlyInline = false,
  heading,
  sectioned: sectionedProp,
  note,
  dateField,
  timeZone,
  onSave,
  onDelete,
  alwaysEditable = false,
  hideOwnSaveButton = false,
  onEditingChange,
}, ref) {
  const t = useTranslations("entryForm");
  const tp = useTranslations("participant");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [values, setValues] = useState<Record<Id, unknown>>(() => entry ? valuesAsRecord(entry.values) : {});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // An already-answered checkpoint opens as a summary; editing is opt-in.
  const [editing, setEditing] = useState(alwaysEditable || !entry);
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

  const optionalFields = fields.filter((field) => field.id && !field.required);
  const isBlank = (value: unknown) => value === undefined || value === null || value === "";
  const optionalCount = optionalFields.length + (dateField ? 1 : 0);
  const hasFilledOptional = optionalFields.some((field) => field.id && !isBlank(values[field.id]))
    || Boolean(dateField?.value);
  // Optional fields (e.g. "Nota do livro") stay tucked away so nobody feels
  // nudged to rate a book they have not finished. Auto-open once one is filled.
  const [showOptional, setShowOptional] = useState(hasFilledOptional || !canEdit);

  function setValue(field: ChallengeField, value: unknown) {
    if (!field.id) return;
    setValues((current) => ({ ...current, [field.id as Id]: value }));
    setSuccess(null);
  }

  // Keyed by field id so an "insert marker" button can reach the exact
  // textarea it belongs to and drop the marker at the cursor, not the end.
  const textareaRefs = useRef<Record<Id, HTMLTextAreaElement | null>>({});
  // A standalone "---" line never needs blank-line isolation — it's read per
  // exact line regardless of what's around it (see `parseCommentBlocks`) — so
  // this just drops the marker on its own fresh line at the cursor.
  function insertLineMarker(field: ChallengeField, marker: string) {
    if (!field.id) return;
    const current = String(values[field.id] ?? "");
    const el = textareaRefs.current[field.id];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const insertion = (before.length > 0 && !before.endsWith("\n") ? "\n" : "") + marker;
    const next = before + insertion + after;
    if (field.config?.maxLength && next.length > field.config.maxLength) return;
    setValue(field, next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length + insertion.length, before.length + insertion.length);
    });
  }

  // A quote has to be its own paragraph (blank line on each side) for
  // `parseCommentBlocks` to read it — this wraps the current selection (or
  // just drops an empty '' to type into) and pads with blank lines only where
  // one isn't already there, so it never merges with text before or after.
  function insertQuoteWrap(field: ChallengeField) {
    if (!field.id) return;
    const current = String(values[field.id] ?? "");
    const el = textareaRefs.current[field.id];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const selected = current.slice(start, end);
    const after = current.slice(end);
    const gapBefore = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const gapAfter = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const insertion = `${gapBefore}'${selected}'${gapAfter}`;
    const next = before + insertion + after;
    if (field.config?.maxLength && next.length > field.config.maxLength) return;
    setValue(field, next);
    requestAnimationFrame(() => {
      el?.focus();
      const cursor = before.length + gapBefore.length + 1 + selected.length;
      el?.setSelectionRange(cursor, cursor);
    });
  }

  // Returns whether it saved cleanly (or had nothing to save) — used both by
  // this form's own submit and by a combined "save everything" button above
  // several stacked sections, which calls every open section's version of
  // this in one go instead of each showing its own Save button.
  async function performSubmit(): Promise<boolean> {
    const missing = findMissingRequiredField(fields, values);
    if (missing) {
      // No separate delete button: clearing the required answer (e.g. tapping
      // the already-picked rating again) and saving removes the entry — the
      // same intent, without an extra control sitting on screen at all times.
      if (isEmptySaveADelete(missing, Boolean(entry), Boolean(onDelete))) {
        setDeleting(true);
        setError(null);
        try {
          await onDelete!();
          return true;
        } catch (cause) {
          setError(f.error(cause));
          setDeleting(false);
          return false;
        }
      }
      setError(t("fillField", { label: missing.label }));
      document.getElementById(`entry-field-${missing.id}`)?.focus();
      return false;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(values, entry);
      setSuccess(entry ? t("entryUpdated") : t("entrySaved"));
      if (!alwaysEditable) setEditing(false);
      return true;
    } catch (cause) {
      setError(f.error(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performSubmit();
  }

  useImperativeHandle(ref, () => ({
    submitIfEditing: async () => (editing ? { ok: await performSubmit() } : { ok: true }),
  }));

  if (!fields.length) {
    return <EmptyState title={t("notConfiguredTitle")} />;
  }

  // A saved answer keeps showing the same fields (disabled), just with the
  // Save/Cancel row swapped out for a lock icon next to the heading — no
  // separate "summary" box. The icon is offered independent of `canEdit`'s
  // effect on interactivity below, so a lock that engages AFTER the answer
  // was given (e.g. an expectation once the rating comes in) still reads as
  // a normal locked field, not a disabled-but-still-open-looking form.
  const canReopen = Boolean(entry) && canEdit && !editing;
  const interactive = canEdit && editing;
  const showsButtons = editing && canEdit;
  const sectioned = sectionedProp ?? Boolean(heading);
  // An all-optional section (Terminei) has nothing to show until you opt in —
  // no required field ever appears on its own, so with nothing filled yet it
  // collapses to a single control; clicking it reveals the heading, the
  // fields, and the Save button together, instead of a heading (and a Save
  // button that saves nothing yet) sitting above an empty "show optional
  // fields" toggle.
  const collapsedOptional = alwaysEditable && !showOptional && optionalCount > 0;
  if (collapsedOptional) {
    // Same chip as the "hide optional fields" one below (just closed rather
    // than open) — not a visually different button for opening vs. closing.
    return (
      <button type="button" className={cx(actionChipClass, ghostChipClass)} onClick={() => setShowOptional(true)}>
        <ChevronGlyph open={false} />
        {heading ?? t("showOptional", { count: optionalCount })}
      </button>
    );
  }

  return (
    <div className={cx(sectioned ? "border-l-[3px] border-[var(--line)] pl-4" : undefined, !heading && canReopen ? "relative" : undefined)}>
      {heading ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className={sectionLabelClass}>{heading}</h3>
          {canReopen ? (
            <button
              type="button"
              className="flex-none rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)]"
              aria-label={t("editAnswer")}
              onClick={() => setEditing(true)}
            >
              <LockIcon />
            </button>
          ) : null}
        </div>
      ) : canReopen ? (
        // No heading text here (the field's own label already says what this
        // is) — a dedicated row for nothing but the icon would just be a gap
        // with a floating button, so it sits over the top-right corner
        // instead, taking no space of its own.
        <button
          type="button"
          className="absolute -top-1 right-0 z-10 flex-none rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)]"
          aria-label={t("editAnswer")}
          onClick={() => setEditing(true)}
        >
          <LockIcon />
        </button>
      ) : null}
      {note}
      <form className="space-y-5" onSubmit={handleFormSubmit} noValidate>
        {fields.map((field) => {
          if (!field.id) return null;
          if (!field.required && !showOptional) return null;
          const id = `entry-field-${field.id}`;
          const value = values[field.id];
          const fieldId = field.id;
          return (
            <div key={field.id}>
              <label className={labelClass} htmlFor={field.type === "rating" || field.type === "boolean" ? undefined : id}>{field.label}{readOnlyInline ? <span className="ml-1 font-normal text-[var(--muted)]">{t("readOnlyInline")}</span> : null}{field.required ? <span className="ml-1 text-[var(--main-2)]" aria-label={t("required")}>*</span> : <small className="ml-2 font-light text-[var(--muted)]">{t("optional")}</small>}</label>
              {field.type === "text" && field.config?.multiline ? (
                interactive ? (
                  <div>
                    <textarea
                      ref={(el) => { textareaRefs.current[fieldId] = el; }}
                      id={id}
                      className={inputClass}
                      rows={4}
                      value={String(value ?? "")}
                      maxLength={field.config.maxLength}
                      disabled={busy}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <small className="text-[var(--muted)]">{t("quoteHint")}</small>
                      <div className="flex flex-none gap-1.5">
                        <button type="button" className={cx(actionChipClass, ghostChipClass, "min-h-7 px-2.5 text-[11px]")} disabled={busy} onClick={() => insertQuoteWrap(field)}>
                          <QuoteGlyph />
                          {t("insertQuote")}
                        </button>
                        <button type="button" className={cx(actionChipClass, ghostChipClass, "min-h-7 px-2.5 text-[11px]")} disabled={busy} onClick={() => insertLineMarker(field, "---\n")}>
                          <DividerGlyph />
                          {t("insertDivider")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div id={id} className={cx(inputClass, "min-h-11 py-2.5")}>
                    <CommentText text={String(value ?? "")} />
                  </div>
                )
              ) : null}
              {field.type === "text" && !field.config?.multiline ? <input id={id} className={inputClass} value={String(value ?? "")} maxLength={field.config?.maxLength} disabled={!interactive || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
              {field.type === "number" ? <input id={id} className={inputClass} type="number" inputMode="decimal" min={field.config?.min} max={field.config?.max} step={field.config?.step ?? "any"} value={typeof value === "number" || typeof value === "string" ? value : ""} disabled={!interactive || busy} onChange={(event) => setValue(field, event.target.value === "" ? "" : Number(event.target.value))} /> : null}
              {field.type === "date" ? <input id={id} className={inputClass} type="date" value={typeof value === "string" ? value : ""} disabled={!interactive || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
              {field.type === "select" ? <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} disabled={!interactive || busy} onChange={(event) => setValue(field, event.target.value)}><option value="">{t("select")}</option>{(field.config?.options ?? []).filter((option) => !option.archived || (option.id ?? option.value ?? option.label) === value).map((option) => <option value={option.id ?? option.value ?? option.label} key={option.id ?? option.value ?? option.label}>{option.label}{option.archived ? ` ${t("optionArchived")}` : ""}</option>)}</select> : null}
              {field.type === "boolean" ? <div id={id} className="grid grid-cols-2 gap-2" tabIndex={-1}>{[{ label: tc("yes"), value: true }, { label: tc("no"), value: false }].map((option) => <button className={cx("min-h-12 rounded-xl border text-sm font-light", value === option.value ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)]")} type="button" aria-pressed={value === option.value} disabled={!interactive || busy} onClick={() => setValue(field, option.value)} key={option.label}>{option.label}</button>)}</div> : null}
              {field.type === "rating" ? <RatingField id={id} field={field} value={value} disabled={!interactive || busy} ariaLabel={(rating) => t("ratingAria", { rating })} onPick={(rating) => setValue(field, rating)} /> : null}
            </div>
          );
        })}
        {dateField && showOptional ? (
          <div>
            <label className={labelClass} htmlFor="entry-occurred-on">{dateField.label}<small className="ml-2 font-light text-[var(--muted)]">{t("optional")}</small></label>
            <input id="entry-occurred-on" className={inputClass} type="date" max={dateField.max} value={dateField.value} disabled={!interactive || busy} onChange={(event) => dateField.onChange(event.target.value)} />
            <small className="mt-1 block text-[var(--muted)]">{dateField.hint}</small>
          </div>
        ) : null}
        {optionalCount && interactive ? (
          <button type="button" className={cx(actionChipClass, ghostChipClass)} onClick={() => setShowOptional((open) => !open)}>
            <ChevronGlyph open={showOptional} />
            {showOptional ? t("hideOptional") : t("showOptional", { count: optionalCount })}
          </button>
        ) : null}
        <StatusMessage error={error} success={success} />
        {showsButtons ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {!hideOwnSaveButton ? <Button type="submit" className="w-full sm:flex-1" disabled={busy || deleting}>{deleting ? tp("deletingEntry") : busy ? tc("saving") : entry ? tc("saveChanges") : t("saveEntry")}<span aria-hidden="true">→</span></Button> : null}
            {entry && !alwaysEditable ? <Button type="button" variant="secondary" className="w-full sm:flex-1" disabled={busy || deleting} onClick={() => setEditing(false)}>{tc("cancel")}</Button> : null}
          </div>
        ) : !canEdit && !readOnlyInline ? <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage ?? t("readOnly")}</p> : null}
        {item?.dueAt ? <p className="text-center text-xs text-[var(--muted)]">{t("dueAt", { date: timeZone ? f.itemDeadline(item, timeZone) ?? "" : f.dateTime(item.dueAt) })}</p> : null}
      </form>
    </div>
  );
});

export function ResultView({
  challenge,
  live = false,
  hideCompletionRate = false,
}: {
  challenge: ChallengeDetail;
  /** Seen by a participant of a running round (not a preview): an empty result reads "No numbers yet". */
  live?: boolean;
  /** The participant tab shows a dedicated "completed" card, so the completion-rate metric is redundant there. */
  hideCompletionRate?: boolean;
}) {
  const t = useTranslations("resultView");
  const f = useGoaFormat();
  const result = challenge.result;
  const solo = challenge.scope === "personal" || challenge.participants.length < 2;
  const names = solo ? [] : challenge.participants.map((participant) => participant.name);

  const dropsCompletion = (metric?: Metric | null) =>
    hideCompletionRate && metric?.operation === "completion_rate";

  const blocks = (result?.blocks?.length ?? 0) > 0
    ? result!.blocks!.map((block) =>
        block.kind === "metric" && dropsCompletion(block.metric) ? { ...block, visible: false } : block)
    : defaultShowcaseBlocks({
        metrics: (result?.metrics?.length
          ? result.metrics
          : challenge.metrics.filter((metric) => metric.visibleInResults !== false)
        ).filter((metric) => !dropsCompletion(metric)),
        personalRankings: solo ? [] : result?.personalRankings,
        affinity: solo ? null : result?.affinity,
        comments: result?.comments,
      });

  if (!hasShowcaseContent(blocks)) {
    return <EmptyState title={live ? t("liveEmptyTitle") : t("emptyTitle")} />;
  }

  return (
    <ShowcaseView
      dateRange={f.dateRange(challenge.startsOn, challenge.endsOn)}
      headline={result?.headline || ""}
      summary={result?.summary}
      participantNames={names}
      totalEntries={result?.totalEntries ?? null}
      blocks={blocks}
      hideThinLabel={solo}
    />
  );
}

/**
 * Copies the public `/results/<token>` link — a header button beside "Manage",
 * for every member (not just admins). On click the copy glyph fades out and a
 * circled checkmark draws itself in, then reverts after a couple of seconds.
 */
function SharePublicButton({ token }: { token: string }) {
  const t = useTranslations("resultView");
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined"
    ? `/results/${token}`
    : `${window.location.origin}/results/${encodeURIComponent(token)}`;
  return (
    <button
      type="button"
      aria-live="polite"
      onClick={async () => {
        try { await copyText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
        catch { /* leave the button as it was */ }
      }}
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-light transition-colors",
        copied ? "border-[var(--ok-line)] bg-[var(--ok-soft)] text-[var(--ok)]" : "border-[var(--line)] text-[var(--ink)] hover:bg-[var(--hover)]",
      )}
    >
      <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <g className={cx("transition-opacity duration-150", copied ? "opacity-0" : "opacity-100")}>
          <rect x="7" y="7" width="9" height="9" rx="2" />
          <path d="M13 4H6a2 2 0 0 0-2 2v7" strokeLinecap="round" />
        </g>
        <circle
          cx="10" cy="10" r="8"
          pathLength={1}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
          style={{ strokeDasharray: 1, strokeDashoffset: copied ? 0 : 1 }}
        />
        <path
          d="M6 10.3 9 13l5-5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="transition-[stroke-dashoffset] duration-300 ease-out [transition-delay:180ms]"
          style={{ strokeDasharray: 1, strokeDashoffset: copied ? 0 : 1 }}
        />
      </svg>
      {copied ? t("shareCopied") : t("shareCopy")}
    </button>
  );
}

/** The entry types a round item can receive (expectation, rating, progress…). */
export function itemEntryTypes(challenge: ChallengeDetail): EntryTypeView[] {
  if (challenge.entryTypes.length) {
    // Expectation is a pre-watch note — always render it first, above the rating.
    return challenge.entryTypes
      .filter((type) => type.targetPolicy !== "none")
      .sort((a, b) => Number(b.purpose === "expectation") - Number(a.purpose === "expectation"));
  }
  // Legacy detail payload without `entryTypes` — reconstruct from the flat fields.
  return challenge.submissionMode === "item" && challenge.fields.length
    ? [{
        id: "",
        name: "",
        semanticKey: "registro",
        purpose: "rating",
        submissionMode: "item",
        targetPolicy: "required",
        cardinality: "once_per_item",
        schedulePolicy: "while_active",
        isPrimary: true,
        fields: challenge.fields,
      }]
    : [];
}

/**
 * One answer for the whole group on one item — a final score, an agreed verdict.
 * Nobody owns it: everyone sees the same current value and who last changed it.
 * Saving sends the version this person last saw, so two people editing at once
 * never silently overwrite each other — the second one is told, shown the latest
 * value, and can decide whether their change still applies.
 */
function SharedAnswerSection({
  challenge,
  item,
  type,
  entries,
  timeZone,
  unavailableMessage,
  onSaveEntry,
  onDeleteEntry,
  onReload,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  type: EntryTypeView;
  entries: Entry[];
  timeZone: string;
  /** Why this item can't take answers at all (closed round, not a participant…), before any sharing rule. */
  unavailableMessage: string | null;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string | null, entryTypeId?: Id, checkpointId?: Id | null, options?: { expectedUpdatedAt?: string | null }) => Promise<void>;
  onDeleteEntry?: (entryId: Id) => Promise<void>;
  onReload?: () => Promise<void>;
}) {
  const t = useTranslations("sharedAnswers");
  const f = useGoaFormat();
  const admin = canManage(challenge.viewerRole);
  const policy = type.sharedEditPolicy ?? "members_fill_admin_corrects";
  const entry = entries.find((candidate) => candidate.entryTypeId === type.id && itemIdForEntry(candidate) === item.id && candidate.answerScope === "shared");
  const [conflict, setConflict] = useState(false);
  const hasRequiredField = type.fields.some((field) => field.required);
  // Anyone taking part can fill it the first time; who may change it afterwards is the admin's setting.
  const lockedByPolicy = Boolean(entry) && policy === "members_fill_admin_corrects" && !admin;
  // An admin who isn't taking part can still correct an answer that exists, just not start one.
  const blocked = admin && entry && challenge.isParticipant === false
    ? f.entryUnavailableMessage({ challengeStatus: challenge.status, isParticipant: true, itemStatus: item.status, opensAt: item.opensAt, schedulePrecision: item.schedulePrecision, timeZone })
    : unavailableMessage;
  const message = blocked ?? (lockedByPolicy ? t("lockedByPolicy") : null);
  const canEdit = !message;

  async function save(values: Record<Id, unknown>, saved?: Entry) {
    try {
      await onSaveEntry(item.id, values, saved, undefined, type.id, undefined, { expectedUpdatedAt: saved?.updatedAt ?? null });
      setConflict(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "shared_conflict") {
        // Show the latest value (the reload swaps the form's entry) and say why the save didn't go through.
        await onReload?.();
        setConflict(true);
        throw new Error(t("conflictShort"));
      }
      throw cause;
    }
  }

  const who = entry?.lastEditedByName?.trim() || null;
  return (
    <section className="rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)]/25 p-4 sm:p-5" aria-label={type.name}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--main-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--main-strong)]">
          <SharedGlyph />{t("badge")}
        </span>
        <span className="text-[11px] text-[var(--muted)]">{t(`policy.${policy}`)}</span>
      </div>
      {conflict ? (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">
          <span className="flex-1 leading-6">{t("conflictBody", { name: who ?? t("someone") })}</span>
          <button type="button" className="flex-none cursor-pointer text-xs underline underline-offset-2" onClick={() => setConflict(false)}>{t("dismiss")}</button>
        </div>
      ) : null}
      <DynamicEntryForm
        key={`${type.id}-${item.id}-${entry?.id ?? "new"}-${entry?.updatedAt ?? ""}`}
        heading={type.name}
        sectioned={false}
        alwaysEditable={!hasRequiredField}
        fields={type.fields}
        item={null}
        entry={entry}
        canEdit={canEdit}
        unavailableMessage={message}
        timeZone={timeZone}
        onSave={save}
        onDelete={entry && canEdit && onDeleteEntry ? () => onDeleteEntry(entry.id) : undefined}
      />
      <p className="mt-4 border-t border-[var(--main-line)]/60 pt-3 text-[11px] leading-5 text-[var(--muted)]">
        {entry
          ? (who ? t("lastEdited", { name: who, when: f.dateTime(entry.updatedAt) }) : t("lastEditedAnon", { when: f.dateTime(entry.updatedAt) }))
          : t("notFilled")}
      </p>
    </section>
  );
}

/**
 * One item, one or more forms. Cine Curadoria stacks an "Expectativa" form (which
 * locks once the film is rated) above the "Avaliação"; a reading club stacks
 * progress / completion / rating. A plain Cine round renders a single form.
 */

function ItemEntryPanel({
  challenge,
  item,
  entries,
  ownEntries,
  timeZone,
  onReload,
  occurredOn,
  onOccurredOnChange,
  offerOptionalDate,
  today,
  unavailableMessage,
  canEdit,
  checkpointId,
  onSaveEntry,
  onDeleteEntry,
}: {
  challenge: ChallengeDetail;
  item: ChallengeItem;
  entries: Entry[];
  ownEntries: Entry[];
  timeZone: string;
  onReload?: () => Promise<void>;
  // "" when the participant left the (optional) date blank; `today` is the
  // fallback for the day-keyed forms that still require one.
  occurredOn: string;
  onOccurredOnChange: (value: string) => void;
  // When a prominent date picker is already on screen (a per-day round), the
  // per-form optional date is skipped so there is only one control.
  offerOptionalDate: boolean;
  today: string;
  unavailableMessage: string | null;
  canEdit: boolean;
  // The session this item is being logged against — "filme X na sessão Y".
  checkpointId?: Id | null;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string | null, entryTypeId?: Id, checkpointId?: Id | null, options?: { expectedUpdatedAt?: string | null }) => Promise<void>;
  // Present only while the round is active and the viewer may remove entries.
  onDeleteEntry?: (entryId: Id) => Promise<void>;
}) {
  const t = useTranslations("participant");
  const tc = useTranslations("common");
  const tv = useTranslations("visibility");
  // Individual answers first, each person's own; the group's shared ones follow.
  const allTypes = itemEntryTypes(challenge);
  const types = allTypes.filter((type) => type.answerScope !== "shared");
  const sharedTypes = allTypes.filter((type) => type.answerScope === "shared");
  const ratingTypeId = types.find((type) => type.purpose === "rating")?.id;
  const stacked = types.length > 1;
  // Looked up once (both to build the JSX below and to seed the shared
  // button's initial open/closed state) — a type is unanswered exactly when
  // it has no matching entry yet.
  const entryForType = (type: EntryTypeView) => {
    const perDay = type.cardinality === "once_per_item_day";
    return ownEntries.find((candidate) =>
      itemIdForEntry(candidate) === item.id
      && (candidate.entryTypeId ?? "") === type.id
      && (!perDay || candidate.occurredOn === (occurredOn || today)));
  };
  // Required-field sections (Expectativa, Avaliação, Progresso do dia) each
  // answer-once-then-lock — when there's more than one stacked, they share
  // one Save button at the bottom instead of each carrying its own. An
  // all-optional section (Terminei) is a standalone action you can take any
  // time, not a fact you fill in once, so it always keeps its own button.
  const combinableTypeIds = stacked
    ? types.filter((type) => type.fields.some((field) => field.required)).map((type) => type.id)
    : [];
  const useSharedButton = combinableTypeIds.length > 1;
  const formRefs = useRef(new Map<Id, DynamicEntryFormHandle | null>());
  // Seeded from each combinable type's OWN initial `editing` rule
  // (`alwaysEditable || !entry` — always `!entry` here, since a combinable
  // type by definition has a required field and so is never `alwaysEditable`)
  // so the button is correctly visible/hidden on the very first render, not
  // only after a section's effect reports in.
  const [openTypeIds, setOpenTypeIds] = useState<Set<Id>>(() => new Set(
    types.filter((type) => combinableTypeIds.includes(type.id) && !entryForType(type)).map((type) => type.id),
  ));
  const [savingAll, setSavingAll] = useState(false);
  const markOpen = (typeId: Id, open: boolean) => setOpenTypeIds((current) => {
    if (current.has(typeId) === open) return current;
    const next = new Set(current);
    if (open) next.add(typeId); else next.delete(typeId);
    return next;
  });
  const anyOpenToSave = combinableTypeIds.some((typeId) => openTypeIds.has(typeId));
  async function saveAll() {
    setSavingAll(true);
    try {
      await Promise.all(combinableTypeIds.map((typeId) => formRefs.current.get(typeId)?.submitIfEditing()));
    } finally {
      setSavingAll(false);
    }
  }
  return (
    <div className={stacked || sharedTypes.length ? "space-y-8" : undefined}>
      {types.map((type) => {
        const perDay = type.cardinality === "once_per_item_day";
        const entry = entryForType(type);
        const rated = ratingTypeId
          ? ownEntries.some((candidate) => itemIdForEntry(candidate) === item.id && candidate.entryTypeId === ratingTypeId)
          : false;
        const locked = type.purpose === "expectation" && rated;
        // A first plain-round entry may carry a date; day-keyed forms take it
        // from the picker above, an expectation is pre-watch, and once an entry
        // exists the date is fixed.
        const offersDate = offerOptionalDate && !perDay && !entry && canEdit && !locked && type.purpose !== "expectation";
        // A type with a required field (Expectativa, Avaliação, Progresso do
        // dia) is a fact you answer once and then lock away — its required
        // field's own label already says what it is, so the section name on
        // top would just be noise; it keeps the bordered/lockable treatment
        // instead. A type with only optional fields (Terminei: nota and
        // comentário both come later, "the entry existing means done") has
        // nothing to lock — it stays always open, and needs its own heading
        // since there's no required-field label to lean on.
        const hasRequiredField = type.fields.some((field) => field.required);
        // Solo (not stacked) always takes "Sua resposta" as its heading —
        // there's only one form, so the icon shares its row instead of
        // floating alone below the label with a visible gap between them.
        const heading = !stacked
          ? t("yourResponseTitle")
          : hasRequiredField
            ? undefined
            : type.purpose === "completion"
              ? t("completionHeading")
              : type.name;
        // Spell out who will see this answer before the first submit (V1 §8) — except
        // the two "the group sees it soon enough" cases, which don't need a sentence
        // of their own. The two that actually withhold the answer (only after close,
        // only you) still get one.
        const note = type.visibilityPolicy === "after_close" || type.visibilityPolicy === "author_only"
          ? <p className="mb-3 rounded-lg bg-[var(--wash)] px-3 py-2 text-xs text-[var(--muted)]">{tv(`note.${type.visibilityPolicy}`)}</p>
          : undefined;
        const combinable = stacked && hasRequiredField && useSharedButton;
        return (
          <div key={type.id || "registro"}>
            <DynamicEntryForm
              key={`${type.id}-${item.id}-${perDay ? occurredOn || today : "fixed"}-${entry?.id ?? "new"}`}
              ref={(handle) => { formRefs.current.set(type.id, handle); }}
              heading={heading}
              sectioned={stacked && hasRequiredField}
              alwaysEditable={!hasRequiredField}
              hideOwnSaveButton={combinable}
              onEditingChange={combinable ? (open) => markOpen(type.id, open) : undefined}
              note={note}
              fields={type.fields}
              item={item}
              entry={entry}
              canEdit={canEdit && !locked}
              unavailableMessage={unavailableMessage}
              readOnlyInline={locked}
              dateField={offersDate ? { label: t("occurredOnLabel"), hint: t("occurredOnOptionalHint"), value: occurredOn, max: today, onChange: onOccurredOnChange } : undefined}
              timeZone={timeZone}
              onSave={(values, saved) => onSaveEntry(
                item.id,
                values,
                saved,
                saved ? undefined : perDay ? occurredOn || today : offersDate ? occurredOn || null : undefined,
                type.id || undefined,
                type.schedulePolicy === "checkpoint" ? checkpointId ?? null : undefined,
              )}
              onDelete={entry && onDeleteEntry ? () => onDeleteEntry(entry.id) : undefined}
            />
          </div>
        );
      })}
      {useSharedButton && anyOpenToSave ? (
        <Button type="button" className="w-full" disabled={savingAll} onClick={saveAll}>
          {savingAll ? tc("saving") : t("saveAllButton")}<span aria-hidden="true">→</span>
        </Button>
      ) : null}
      {sharedTypes.map((type) => (
        <SharedAnswerSection
          key={type.id}
          challenge={challenge}
          item={item}
          type={type}
          entries={entries}
          timeZone={timeZone}
          unavailableMessage={unavailableMessage}
          onSaveEntry={onSaveEntry}
          onDeleteEntry={onDeleteEntry}
          onReload={onReload}
        />
      ))}
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A rating on a 0–5 scale as a small filled meter, the number beside it. */
function RatingBar({ value }: { value: number }) {
  const nf = useFormatter();
  return (
    <div className="flex w-6 items-center justify-end gap-2">
      <span className="flex-none text-sm font-medium tabular-nums text-[var(--ink)]">{nf.number(value, { maximumFractionDigits: 1 })}</span>
    </div>
  );
}

/**
 * The "which one am I filling?" list in the sidebar — a stack of tappable rows
 * with a numbered chip that flips to a checkmark once the entry is in. Replaces a
 * bare `<select>` so progress reads at a glance on both phone and desktop.
 */
interface PickerOption {
  id: Id;
  label: string;
  done?: boolean;
  soon?: boolean;
  statusLabel?: string;
  /** Extra detail (author, genre, runtime…) — room for it opens up on wider screens. */
  meta?: string;
  /** The rating this participant gave the item, shown at the end of the row. */
  rating?: number | null;
}

function EntryPicker({
  title,
  tally,
  options,
  selectedId,
  onSelect,
}: {
  title: string;
  tally?: string;
  options: PickerOption[];
  selectedId: Id | null;
  onSelect: (id: Id) => void;
}) {
  const nf = useFormatter();
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={sectionLabelClass}>{title}</p>
        {tally ? <span className="text-xs text-[var(--muted)]">{tally}</span> : null}
      </div>
      <section className={cx(cardClass, "p-4 sm:p-5")}>
      <ol className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5">
        {options.map((option, index) => {
          const active = option.id === selectedId;
          const rating = typeof option.rating === "number" ? option.rating : null;
          const caption = [option.statusLabel, option.meta].filter(Boolean).join(" · ");
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={option.soon}
                aria-pressed={active}
                aria-label={`${index + 1}. ${option.label}${option.statusLabel ? ` — ${option.statusLabel}` : ""}`}
                onClick={() => onSelect(option.id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-45",
                  active
                    ? "border-[var(--main)] bg-[var(--main-soft)]"
                    : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]",
                )}
              >
                <span
                  className={cx(
                    "grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-medium tabular-nums",
                    option.done
                      ? "bg-[var(--ok)] text-white"
                      : active
                        ? "bg-[var(--main)] text-white"
                        : "bg-[var(--wash)] text-[var(--muted)]",
                  )}
                >
                  {option.done ? <CheckGlyph /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-sm", active ? "font-medium text-[var(--main-strong)]" : "font-light")}>{option.label}</span>
                  {option.statusLabel ? (
                    <span className={cx("block truncate text-[11px] sm:hidden", option.done ? "text-[var(--ok)]" : "text-[var(--muted)]")}>{option.statusLabel}</span>
                  ) : null}
                  {caption ? (
                    <span className={cx("hidden truncate text-[11px] sm:block", "text-[var(--muted)]")}>{caption}</span>
                  ) : null}
                </span>
                {rating !== null ? (
                  <span className="flex-none text-sm font-medium tabular-nums text-[var(--ink)]">{nf.number(rating, { maximumFractionDigits: 1 })}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      </section>
    </div>
  );
}

/** How many items a stage card lists before "show more". */
const STAGE_PREVIEW = 6;

/**
 * Read-only stages view: each stage as a card with its items, a past/now/upcoming badge, and the
 * total runtime when the items carry one. Only shown for round-item challenges organised into
 * stages (not the automatic day-by-day ones).
 */
function CheckpointSchedule({ challenge }: { challenge: ChallengeDetail }) {
  const tp = useTranslations("checkpointPlanner");
  const planned = useMemo(
    () =>
      [...challenge.checkpoints]
        .filter((cp) => cp.kind && cp.kind !== "day")
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [challenge.checkpoints],
  );
  if (planned.length === 0 || challenge.showSchedule === false) return null;
  const itemsByCheckpoint = new Map<Id, ChallengeItem[]>();
  for (const item of challenge.items) {
    if (!item.checkpointId) continue;
    const list = itemsByCheckpoint.get(item.checkpointId) ?? [];
    list.push(item);
    itemsByCheckpoint.set(item.checkpointId, list);
  }

  return (
    <section className="mt-5">
      <h2 className={cx("mb-3", sectionLabelClass)}>{tp("title")}</h2>
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {planned.map((cp) => (
          <StageCard
            key={cp.id}
            stage={cp}
            items={[...(itemsByCheckpoint.get(cp.id) ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))}
          />
        ))}
      </div>
    </section>
  );
}

function StageCard({ stage, items }: { stage: ChallengeItem; items: ChallengeItem[] }) {
  const t = useTranslations("participant");
  const tp = useTranslations("checkpointPlanner");
  const f = useGoaFormat();
  const [open, setOpen] = useState(false);
  const runtime = formatRuntime(stage.totalRuntimeMinutes ?? items.reduce((sum, item) => sum + (item.catalogItem?.runtimeMinutes ?? 0), 0));
  const shown = open ? items : items.slice(0, STAGE_PREVIEW);
  return (
    <article
      className={cx(
        "rounded-2xl border p-4",
        stage.timeframe === "current"
          ? "border-[var(--main)] bg-[var(--main-soft)]/40"
          : "border-[var(--line)] bg-[var(--paper)]",
        stage.timeframe === "past" && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{stage.title}
          <span className="text-xs text-[var(--muted)]">
            {runtime ? ` | ${runtime}` : ""}
          </span>
        </strong>
        <span className="rounded-full bg-[var(--wash)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {tp(`timeframe.${stage.timeframe ?? "current"}`)}
        </span>
      </div>
      {items.length ? (
        <>
          <ul className="mt-2 space-y-1 text-sm">
            {shown.map((item) => (
              <li key={item.id}>
                <span className="block truncate">
                  {item.title}
                  {item.catalogItem?.year ? ` (${item.catalogItem.year})` : ""}
                </span>
                {item.catalogItem?.scheduledAt ? <small className="block truncate text-xs text-[var(--muted)]">{f.eventWhen(item.catalogItem.scheduledAt)}</small> : null}
              </li>
            ))}
          </ul>
          {items.length > STAGE_PREVIEW ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="mt-2 min-h-9 w-full rounded-xl border border-[var(--line)] text-xs font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
            >
              {open ? tp("showLess") : tp("showMore", { count: items.length - STAGE_PREVIEW })}
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">{t("checkpointEmpty")}</p>
      )}
    </article>
  );
}


/** The group's shared answers for one item, read-only, with who last changed each — shown on the Grupo tab. */
function SharedAnswersSummary({ types, entries, itemId }: { types: EntryTypeView[]; entries: Entry[]; itemId: Id }) {
  const tSa = useTranslations("sharedAnswers");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const words = { yes: tc("yes"), no: tc("no") };
  return (
    <div className="mb-5 space-y-3 border-b border-[var(--line)] pb-5">
      {types.map((type) => {
        const shared = entries.find((entry) => entry.entryTypeId === type.id && itemIdForEntry(entry) === itemId && entry.answerScope === "shared");
        const values = shared ? valuesAsRecord(shared.values) : {};
        const shown = type.fields.filter((field) => field.id && displayAnswer(field, values[field.id], words));
        return (
          <div key={type.id} className="rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)]/25 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--main-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--main-strong)]"><SharedGlyph />{tSa("badge")}</span>
              <strong className="text-sm font-medium">{type.name}</strong>
            </div>
            {shared ? (
              <dl className="mt-2 space-y-1">
                {shown.map((field) => (
                  <div key={field.id} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-xs text-[var(--muted)]">{field.label}</dt>
                    <dd className="text-base font-light">{displayAnswer(field, values[field.id as Id], words)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="mt-2 text-sm text-[var(--muted)]">{tSa("notFilled")}</p>}
            {shared?.lastEditedByName ? <p className="mt-2 text-[11px] text-[var(--muted)]">{tSa("lastEdited", { name: shared.lastEditedByName, when: f.dateTime(shared.updatedAt) })}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ParticipantChallengeScreen({
  challenge,
  entries,
  user,
  tab,
  onTab,
  onBack,
  backLabel,
  onAdmin,
  onSaveEntry,
  onDeleteEntry,
  onReload,
  preview = false,
  previewActions,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  user: User | null;
  tab: ParticipantTab;
  onTab: (tab: ParticipantTab) => void;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onAdmin?: () => void;
  onSaveEntry?: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry, occurredOn?: string | null, entryTypeId?: Id, checkpointId?: Id | null, options?: { expectedUpdatedAt?: string | null }) => Promise<void>;
  onDeleteEntry?: (entryId: Id) => Promise<void>;
  /** Re-reads the challenge and its entries — used to show the latest shared answer after a clash. */
  onReload?: () => Promise<void>;
  /** Read-only public view (a published template): drops the Today tab and every
   *  entry form, keeps the header + rules + schedule + the Results showcase. */
  preview?: boolean;
  /** Replaces the "Manage" button in the header (the template's "Copiar" CTA). */
  previewActions?: ReactNode;
}) {
  const t = useTranslations("participant");
  const trules = useTranslations("rules");
  const f = useGoaFormat();
  const longDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const timeZone = challenge.timeZone ?? "America/Sao_Paulo";
  const showRecommenders = challenge.recommendationsEnabled !== false;
  // A shared answer has no author (`userId` is null), so it rides along with every person's own.
  const ownEntries = entries.filter((entry) => !entry.userId || entry.userId === user?.id);
  const sharedTypes = challenge.entryTypes.filter((type) => type.answerScope === "shared");
  const hasShared = sharedTypes.length > 0;
  // Progress counts only the "done" signal — an expectation or a mid-round
  // progress note isn't a completion.
  const doneEntries = challenge.completionEntryTypeId
    ? ownEntries.filter((entry) => entry.entryTypeId === challenge.completionEntryTypeId)
    : ownEntries;
  const entriesByItem = useMemo(() => {
    const map = new Map<Id | null, Entry>();
    for (const entry of ownEntries) {
      if (entry.answerScope !== "shared") map.set(itemIdForEntry(entry), entry);
    }
    return map;
  }, [ownEntries]);
  // The "done" tick tracks completion only — any other entry (an expectation, a
  // half-read progress note) leaves the item still pending. With shared answers
  // in play it also waits for the group's required ones (see `isItemDone`).
  const doneItems = useDoneItems(challenge, entries, user?.id);
  const doneByItem: Set<Id | null> = hasShared
    ? doneItems.forViewer
    : new Set(doneEntries.map((entry) => itemIdForEntry(entry)));
  // The rating this participant gave each item (from whichever entry carries the
  // rating field) — shown at the end of every checkpoint row. Only entry types
  // whose *purpose* is "rating" count here — an expectation's field uses the
  // same rating widget but is a different question, and mixing the two in with
  // the real rating both overwrote it (self) and duplicated the person (group).
  const ratingByItem = useMemo(() => {
    const ratingFieldByType = new Map(
      challenge.entryTypes
        .filter((type) => type.purpose === "rating" && type.answerScope !== "shared")
        .map((type) => [type.id, type.fields.find((field) => field.type === "rating")?.id ?? null]),
    );
    const map = new Map<Id, number>();
    for (const entry of ownEntries) {
      const itemId = itemIdForEntry(entry);
      const fieldId = ratingFieldByType.get(entry.entryTypeId ?? "");
      if (!itemId || !fieldId) continue;
      const raw = valuesAsRecord(entry.values)[fieldId];
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isNaN(value)) map.set(itemId, value);
    }
    return map;
  }, [ownEntries, challenge.entryTypes]);
  // Everyone else's rating for each item — shown alongside the entry form so a
  // person can weigh their own take against the group's while filling it in,
  // not just after the round closes.
  const groupRatingsByItem = useMemo(() => {
    const ratingFieldByType = new Map(
      challenge.entryTypes
        .filter((type) => type.purpose === "rating" && type.answerScope !== "shared")
        .map((type) => [type.id, type.fields.find((field) => field.type === "rating")?.id ?? null]),
    );
    const map = new Map<Id, Array<{ id: Id; name: string; value: number }>>();
    for (const entry of entries) {
      if (entry.userId && entry.userId === user?.id) continue;
      const itemId = itemIdForEntry(entry);
      const fieldId = ratingFieldByType.get(entry.entryTypeId ?? "");
      if (!itemId || !fieldId) continue;
      const raw = valuesAsRecord(entry.values)[fieldId];
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (Number.isNaN(value)) continue;
      const list = map.get(itemId) ?? [];
      list.push({ id: entry.userId ?? entry.id, name: entry.participantName ?? "—", value });
      map.set(itemId, list);
    }
    return map;
  }, [entries, user?.id, challenge.entryTypes]);
  const sortedItems = useMemo(() => [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [challenge.items]);
  const sortedSessions = useMemo(
    () => [...(challenge.checkpoints ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [challenge.checkpoints],
  );
  // "Filme X na sessão Y" — a round whose entries carry both a round item and a
  // dated session. The session picker drives the item; a plain items-only or
  // sessions-only round never enters this branch.
  const sessionMode =
    sortedSessions.length > 0
    && sortedItems.length > 0
    && challenge.entryTypes.some((type) => type.targetPolicy !== "none" && type.schedulePolicy === "checkpoint");
  // A daily check-in that is NOT tied to a checkpoint (an undated habit, or a
  // dated habit whose type is `while_active`) always shows the plain "check in
  // today" form — it never needs an item or a checkpoint selected. Only a
  // checkpoint-scheduled daily type (dated Library / reading_daily) uses the
  // session picker.
  const directDaily = challenge.submissionMode === "daily"
    && !challenge.entryTypes.some((type) => type.submissionMode === "daily" && type.schedulePolicy === "checkpoint");
  const undatedDaily = directDaily;
  const today = dateKeyInSaoPaulo(new Date());
  // "" means the participant hasn't picked a date. The plain round form saves it
  // as-is (no date); the daily / per-day forms fall back to `today`.
  const [occurredOn, setOccurredOn] = useState("");
  const effectiveOccurredOn = occurredOn || today;
  const defaultItem = sortedItems.find((item) => item.status === "open" && !entriesByItem.has(item.id))
    ?? sortedItems.find((item) => !entriesByItem.has(item.id) && item.status !== "scheduled" && item.status !== "closed")
    ?? [...sortedItems].reverse().find((item) => entriesByItem.has(item.id))
    ?? sortedItems[0]
    ?? null;
  const [selectedItemId, setSelectedItemId] = useState<Id | null>(defaultItem?.id ?? null);
  const [selectedSessionId, setSelectedSessionId] = useState<Id | null>(null);
  const selectedSession = sessionMode
    ? sortedSessions.find((session) => session.id === selectedSessionId)
      ?? sortedSessions.find((session) => session.status === "open")
      ?? sortedSessions[0]
      ?? null
    : null;
  const selectedItem = sessionMode
    ? sortedItems.find((item) => item.checkpointId === selectedSession?.id) ?? null
    : sortedItems.find((item) => item.id === selectedItemId) ?? defaultItem;
  const currentEntry = undatedDaily
    ? ownEntries.find((entry) => entry.occurredOn === effectiveOccurredOn)
    : selectedItem
      ? entriesByItem.get(selectedItem.id)
      : ownEntries.find((entry) => !itemIdForEntry(entry));
  const doneCount = hasShared ? doneByItem.size : Math.min(doneEntries.length, sortedItems.length);
  const completion = sortedItems.length ? Math.min(100, Math.round((doneCount / sortedItems.length) * 100)) : 0;
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode);
  const livingList = isLivingList(challenge);
  const ruleSections = useMemo(
    () => visibleRuleSections(challenge.ruleSections, challenge.rules, trules("legacyTitle")),
    [challenge.ruleSections, challenge.rules, trules],
  );
  const unavailableMessage = f.entryUnavailableMessage({
    challengeStatus: challenge.status,
    isParticipant: challenge.isParticipant,
    itemStatus: selectedItem?.status,
    opensAt: selectedItem?.opensAt,
    schedulePrecision: selectedItem?.schedulePrecision,
    timeZone,
  });
  const itemForms = itemEntryTypes(challenge);
  const useItemPanel = itemForms.length > 0 && !undatedDaily && Boolean(selectedItem);
  const perDayItem = itemForms.some((type) => type.cardinality === "once_per_item_day");
  const individualFormCount = itemForms.filter((type) => type.answerScope !== "shared").length;
  // Whether this challenge has any rating-purpose form at all.
  const hasRatingType = itemForms.some((type) => type.purpose === "rating" && type.answerScope !== "shared");
  // A retrospective list (Estante) has no "when" — its entry form skips the date.
  const collectsEntryDate = challenge.collectsEntryDate !== false;
  // A daily / per-day round needs a concrete date, so it gets a prominent picker.
  // A plain round instead offers the date among the entry form's optional fields.
  const dateRequired = undatedDaily || (useItemPanel && perDayItem);
  const canDeleteEntry = challenge.status === "active" ? onDeleteEntry : undefined;
  const hasGroup = challenge.participants.length > 1;

  // The Grupo tab shows everyone's status for whichever item/session is
  // currently selected in the shared "Checkpoints" picker, plus two
  // mode-independent stats: overall completion and freshness of their last entry.
  const doneForParticipant = (participantUserId: Id | undefined, itemId: Id) =>
    hasShared
      ? doneItems.isDone(participantUserId, itemId)
      : entries.some((entry) =>
          entry.userId === participantUserId
          && itemIdForEntry(entry) === itemId
          && (!challenge.completionEntryTypeId || entry.entryTypeId === challenge.completionEntryTypeId));
  const ratingForParticipant = (participantUserId: Id | undefined, itemId: Id): number | null => {
    if (participantUserId && participantUserId === user?.id) return ratingByItem.get(itemId) ?? null;
    return groupRatingsByItem.get(itemId)?.find((rating) => rating.id === participantUserId)?.value ?? null;
  };
  const completedCountForParticipant = (participantUserId: Id | undefined): number =>
    sortedItems.filter((item) => doneForParticipant(participantUserId, item.id)).length;
  // An entry with no explicit date (a retrospective/undated form) still has a
  // submission timestamp — fall back to that so "last register" always has an answer.
  const dayKeyForEntry = (entry: Entry): string | null =>
    entry.occurredOn ?? (entry.submittedAt ? dateKeyInSaoPaulo(new Date(entry.submittedAt)) : null);
  const lastEntryDaysAgo = (participantUserId: Id | undefined): number | null => {
    let latest: string | null = null;
    for (const entry of entries) {
      if (entry.userId !== participantUserId) continue;
      const day = dayKeyForEntry(entry);
      if (day && (!latest || day > latest)) latest = day;
    }
    if (!latest) return null;
    return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000);
  };

  // A template preview has nothing to log — only the Results showcase.
  const activeTab: ParticipantTab = preview ? "results" : tab;
  const tabs: Array<{ id: ParticipantTab }> = preview
    ? [{ id: "results" }]
    : hasGroup
      ? [{ id: "today" }, { id: "grupo" }, { id: "results" }]
      : [{ id: "today" }, { id: "results" }];

  // Extra detail for a picker row — only worth showing where there's room
  // for it (widened once the picker moved out of the narrow Today sidebar).
  const metaForItem = (item: ChallengeItem): string | undefined =>
    [
      item.catalogItem?.scheduledAt ? f.eventWhen(item.catalogItem.scheduledAt) : null,
      item.catalogItem?.author ? t("byAuthor", { name: item.catalogItem.author }) : null,
      showRecommenders ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text })) : null,
      item.catalogItem?.mainGenre || null,
      formatRuntime(item.catalogItem?.runtimeMinutes),
    ].filter(Boolean).join(" · ") || undefined;

  // The picker on Today drives which checkpoint the form is filling; each row
  // ends with the rating this participant gave it.
  const checkpointPicker = sessionMode && sortedSessions.length > 1 ? (
    <EntryPicker
      title={t("sessionsTitle")}
      selectedId={selectedSession?.id ?? null}
      onSelect={(id) => setSelectedSessionId(id)}
      options={sortedSessions.map((session) => {
        const boundItem = sortedItems.find((item) => item.checkpointId === session.id);
        const soon = session.status === "scheduled";
        const label = boundItem?.title ?? session.title;
        return {
          id: session.id,
          label: boundItem?.catalogItem?.year ? `${label} (${boundItem.catalogItem.year})` : label, soon, statusLabel: soon ? t("checkpointSoonLabel") : undefined, meta: boundItem ? metaForItem(boundItem) : undefined, rating: boundItem ? ratingByItem.get(boundItem.id) ?? null : null };
      })}
    />
  ) : sortedItems.length > 1 ? (
    <EntryPicker
      title={t("checkpointsTitle")}
      tally={t("checkpointTally", { done: doneCount, pending: Math.max(0, sortedItems.length - doneCount) })}
      selectedId={selectedItem?.id ?? null}
      onSelect={(id) => setSelectedItemId(id)}
      options={sortedItems.map((item) => {
        const done = doneByItem.has(item.id);
        const soon = item.status === "scheduled" && !entriesByItem.has(item.id);
        const label = item.catalogItem?.year ? `${item.title} (${item.catalogItem.year})` : item.title;
        return { id: item.id, label, done, soon, statusLabel: done ? "" : soon ? t("checkpointSoonLabel") : undefined, meta: metaForItem(item), rating: ratingByItem.get(item.id) ?? null };
      })}
    />
  ) : null;


  return (
    <main className="mx-auto max-w-7xl overflow-x-clip px-4 py-6 pb-28 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <BackButton onClick={onBack} label={backLabel ?? t("back")} />
        <div className="flex items-center gap-2">
          {!preview && challenge.result?.shareToken && challenge.scope !== "personal" ? <SharePublicButton token={challenge.result.shareToken} /> : null}
          {previewActions ?? (onAdmin ? <Button variant="secondary" onClick={onAdmin}>{t("manage")}</Button> : null)}
        </div>
      </div>
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--spotlight)] p-6 text-[var(--spotlight-ink)] sm:p-9">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3">{livingList ? <span /> : <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />}<span className="text-xs text-white/65">{livingList ? t("livingListMeta", { count: sortedItems.length }) : f.dateRange(challenge.startsOn, challenge.endsOn)}</span></div>
          <h1 className="mt-10 max-w-3xl text-4xl font-medium leading-none tracking-[-0.055em] sm:text-6xl">{challenge.title}</h1>
          {challenge.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{challenge.description}</p> : null}
          {!preview && sortedItems.length ? <div className="mt-8 max-w-2xl"><div className="mb-2 flex justify-between text-xs text-white/70"><span>{t.rich("entriesProgress", { done: doneCount, total: sortedItems.length, b: (chunks) => <strong className="text-white">{chunks}</strong> })}</span><span>{completion}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--main-2)]" style={{ width: `${Math.min(100, completion)}%` }} /></div></div> : null}
        </div>
        <span className="absolute -right-28 -top-36 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
      </section>

      {scheduled ? <section className="mt-5 rounded-2xl border border-[var(--main-line)] bg-[var(--paper)] px-5 py-4"><strong className="text-[var(--main-strong)]">{t("scheduledTitle", { date: f.date(challenge.startsOn, longDate) })}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("scheduledBody")}</p></section> : null}
      <RuleSectionsView rules={ruleSections} />
      {/* The Cronograma grid only matters where a checkpoint drives what's on
          screen — Today (picking one to log), or a template preview (which
          collapses everything to "results" but still wants the schedule as
          read-only context). Grupo already lists the same checkpoints as
          table columns, and a real Results tab doesn't act on one at all. */}
      {activeTab === "today" || preview ? <CheckpointSchedule challenge={challenge} /> : null}

      {/* Shared across Today and Grupo — whichever item/session is picked here
          is what both tabs act on, so it lives above the tab selector itself,
          not inside either tab's own body. */}
      {checkpointPicker && activeTab !== "results" ? <div className="mt-5">{checkpointPicker}</div> : null}

      {tabs.length > 1 ? (
        <nav className="mt-5 hidden gap-1 rounded-2xl bg-[var(--wash-strong)]/70 p-1 sm:flex" aria-label={t("navAria")}>
          {tabs.map((item) => <button className={cx("min-h-11 flex-1 rounded-xl px-3 text-sm font-light", activeTab === item.id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{t(`tabs.${item.id}`)}</button>)}
        </nav>
      ) : null}

      <div className="mt-5">
        {activeTab === "today" ? (
          challenge.status === "closed" ? (
            <EmptyState title={t("closedTitle")} />
          ) : challenge.submissionMode !== "free" && !selectedItem && !undatedDaily ? (
            <EmptyState title={t("noCheckpointTitle")} />
          ) : (
            <div>
              <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
                <div className="mb-5 flex flex-col gap-3 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-light tracking-[-0.04em]">
                      {selectedItem
                        ? `${selectedItem.title}${selectedItem.catalogItem?.year ? ` (${selectedItem.catalogItem.year})` : ""}`
                        : (undatedDaily ? t("checkInOf", { date: f.date(effectiveOccurredOn, longDate) }) : t("newEntry"))}
                    </h2>
                    {selectedItem?.catalogItem?.scheduledAt ? <p className="mt-1.5 text-sm font-light text-[var(--muted)]">{f.eventWhen(selectedItem.catalogItem.scheduledAt)}</p> : null}
                  </div>
                  {selectedItem?.dueAt
                    ? <span className={cx("flex-none rounded-full px-3 py-2 text-xs font-medium", selectedItem.status === "past_due" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--wash)] text-[var(--muted)]")}>
                        {t("dueBy", { date: f.itemDeadline(selectedItem, timeZone) ?? "" })}
                      </span>
                    : null
                  }
                </div>
                {/* When more than one form is stacked (ItemEntryPanel), "Sua
                    resposta" introduces the whole group and each form gets
                    its own heading below. A single form instead takes the
                    label itself, in the same row as its own lock icon —
                    otherwise the icon sits in its own row with nothing next
                    to it, an orphaned control with a visible gap above it. */}
                {useItemPanel && individualFormCount > 1 ? <p className={cx("mb-3", sectionLabelClass)}>{t("yourResponseTitle")}</p> : null}
                {dateRequired ? <label className="mb-5 block"><span className={labelClass}>{t("occurredOnLabel")}</span><input className={inputClass} type="date" max={today} value={effectiveOccurredOn} disabled={Boolean(unavailableMessage)} onChange={(event) => setOccurredOn(event.target.value || today)} /><small className="mt-1 block text-[var(--muted)]">{t("occurredOnHint")}</small></label> : !useItemPanel && currentEntry?.occurredOn ? <p className="mb-5 text-xs text-[var(--muted)]">{t("occurredOn", { date: f.date(currentEntry.occurredOn, longDate) })}</p> : null}
                {useItemPanel && selectedItem ? (
                  <ItemEntryPanel key={`${selectedItem.id}-${selectedSession?.id ?? "no-session"}`} challenge={challenge} item={selectedItem} entries={entries} ownEntries={ownEntries} timeZone={timeZone} onReload={onReload} occurredOn={occurredOn} onOccurredOnChange={setOccurredOn} offerOptionalDate={!perDayItem && !sessionMode && collectsEntryDate} today={today} unavailableMessage={unavailableMessage} canEdit={!unavailableMessage} checkpointId={selectedSession?.id ?? null} onSaveEntry={onSaveEntry!} onDeleteEntry={canDeleteEntry} />
                ) : (
                  <DynamicEntryForm key={`${selectedItem?.id ?? "free"}-${undatedDaily ? effectiveOccurredOn : "fixed"}-${currentEntry?.id ?? "new"}`} timeZone={timeZone} heading={t("yourResponseTitle")} sectioned={false} alwaysEditable={!challenge.fields.some((field) => field.required)} fields={challenge.fields} item={selectedItem ?? null} entry={currentEntry} canEdit={!unavailableMessage} unavailableMessage={unavailableMessage} onSave={(values, entry) => onSaveEntry!(selectedItem?.id ?? null, values, entry, undatedDaily ? effectiveOccurredOn : undefined)} onDelete={currentEntry && canDeleteEntry ? () => canDeleteEntry(currentEntry.id) : undefined} />
                )}
              </section>
            </div>
          )
        ) : null}

        {activeTab === "grupo" ? (
          <div>
            <section className={cx(cardClass, "min-w-0 p-5 sm:p-7")}>
              {selectedItem
                ? <h2 className="text-2xl font-light tracking-[-0.04em] mb-5 pb-5 border-b border-[var(--line)]">
                    {selectedItem.title}
                    {selectedItem.catalogItem?.year ? ` (${selectedItem.catalogItem.year})` : ""}
                  </h2>
                : null
              }
              
              {selectedItem && sharedTypes.length ? <SharedAnswersSummary types={sharedTypes} entries={entries} itemId={selectedItem.id} /> : null}
              <div className="divide-y divide-[var(--line)]">
                {[...challenge.participants].sort((a, b) => Number(b.userId === user?.id) - Number(a.userId === user?.id)).map((participant) => {
                  const isSelf = participant.userId === user?.id;
                  const initial = participant.name.split(/\s+/).slice(0, 1).map((part) => part[0]).join("");
                  const rating = selectedItem && hasRatingType ? ratingForParticipant(participant.userId, selectedItem.id) : null;
                  const daysAgo = lastEntryDaysAgo(participant.userId);
                  const completed = sortedItems.length > 1 ? completedCountForParticipant(participant.userId) : null;
                  const caption = [
                    completed !== null ? t("groupCompletion", { done: completed, total: sortedItems.length }) : null,
                    daysAgo === null ? t("groupLastRegisterNone") : t("groupLastRegister", { days: daysAgo }),
                  ].filter(Boolean).join(" · ");
                  return (
                    <div key={participant.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)] text-xs font-black" aria-hidden="true">{initial}</span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm">{participant.name} {isSelf && `(${t("youLabel")})`}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{caption}</span>
                      </div>
                      <div className="flex-none">
                        {rating !== null ? (
                          <RatingBar value={rating} />
                        ) : (
                          <span className="text-sm text-[var(--muted)]"></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "results" ? (
          <ResultView challenge={challenge} hideCompletionRate live={!preview} />
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <nav className={cx("safe-area-bottom fixed inset-x-0 bottom-0 z-40 grid h-[72px] border-t border-[var(--line)] bg-[var(--paper)]/95 px-2 backdrop-blur-xl sm:hidden", tabs.length === 3 ? "grid-cols-3" : "grid-cols-2")} aria-label={t("navMobileAria")}>
          {tabs.map((item) => <button className={cx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-light", activeTab === item.id ? "text-[var(--main-strong)]" : "text-[var(--muted)]")} type="button" onClick={() => onTab(item.id)} key={item.id}><span className="text-base" aria-hidden="true">{item.id === "today" ? "◉" : item.id === "grupo" ? "◎" : "〇"}</span>{t(`tabs.${item.id}`)}</button>)}
        </nav>
      ) : null}
    </main>
  );
}
