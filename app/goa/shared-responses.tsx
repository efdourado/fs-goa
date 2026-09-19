"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ApiError } from "./api";
import { ConfirmDialog, FormDialog } from "./dialog";
import { cleanFields, FIELD_TYPES, FieldConfigInputs, newFieldConfig } from "./fields";
import { useGoaFormat } from "./format";
import type { ChallengeField, EntryTypeView, SharedEditPolicy } from "./types";
import { Field, inputClass, SelectableCards, StatusMessage, Toggle } from "./ui";

/** Two ends of a small "people" glyph — the mark for an answer that belongs to the whole group. */
export function SharedGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className ?? "h-3.5 w-3.5"} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="5.6" cy="5.6" r="2.2" />
      <circle cx="11" cy="6.4" r="1.7" />
      <path d="M1.8 13c.3-2.2 1.8-3.4 3.8-3.4S9.1 10.8 9.4 13M10 9.8c1.9-.2 3.6.7 4.1 3.2" strokeLinecap="round" />
    </svg>
  );
}

const POLICIES: SharedEditPolicy[] = ["members_fill_admin_corrects", "members_can_edit"];

/**
 * Add a response that has one answer for the whole group — a final score, say —
 * next to the individual ones (ratings, comments) that stay per person.
 */
export function AddSharedResponseDialog({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (payload: { name: string; sharedEditPolicy: SharedEditPolicy; field: ChallengeField }) => Promise<void>;
}) {
  const t = useTranslations("sharedResponses");
  const tf = useTranslations("fields");
  const f = useGoaFormat();
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<SharedEditPolicy>("members_fill_admin_corrects");
  const [field, setField] = useState<ChallengeField>({ key: "", label: "", type: "number", required: true, config: newFieldConfig("number") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasConfig = ["number", "select", "text"].includes(field.type);

  async function submit() {
    const responseName = name.trim();
    if (!responseName) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      // The value's own label is optional: left empty it takes the response's name.
      const [clean] = cleanFields([{ ...field, label: field.label.trim() || responseName }]);
      await onAdd({ name: responseName, sharedEditPolicy: policy, field: { ...clean, key: "" } });
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={t("addTitle")}
      dirty={Boolean(name.trim() || field.label.trim())}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={t("add")}
    >
      <p className="text-sm leading-6 text-[var(--muted)]">{t("addBody")}</p>
      <Field label={t("nameLabel")} hint={t("nameHint")}>
        <input className={inputClass} value={name} maxLength={120} required placeholder={t("namePlaceholder")} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t("policyLabel")} plain>
        <SelectableCards
          value={policy}
          onChange={setPolicy}
          columns={1}
          options={POLICIES.map((value) => ({ value, label: t(`policy.${value}`), hint: t(`policyHint.${value}`) }))}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("fieldLabel")}>
          <input className={inputClass} value={field.label} maxLength={100} placeholder={name.trim() || t("fieldPlaceholder")} onChange={(event) => setField((current) => ({ ...current, label: event.target.value }))} />
        </Field>
        <Field label={tf("typeLabel")}>
          <select
            className={inputClass}
            value={field.type}
            onChange={(event) => { const type = event.target.value as ChallengeField["type"]; setField((current) => ({ ...current, type, config: newFieldConfig(type) })); }}
          >
            {FIELD_TYPES.map((value) => <option value={value} key={value}>{tf(`type.${value}`)}</option>)}
          </select>
        </Field>
      </div>
      {hasConfig ? <FieldConfigInputs field={field} onChange={(patch) => setField((current) => ({ ...current, ...patch }))} /> : null}
      <Toggle checked={field.required} onChange={(next) => setField((current) => ({ ...current, required: next }))} label={t("requiredLabel")} hint={t("requiredHint")} />
    </FormDialog>
  );
}

/** Remove a response type. Metrics that read it are named first and only go with it once the person agrees. */
export function RemoveResponseDialog({
  type,
  onClose,
  onRemove,
}: {
  type: EntryTypeView;
  onClose: () => void;
  onRemove: (confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
}) {
  const t = useTranslations("sharedResponses");
  // Filled in once the server says what else would go: answers already given, and metrics that read them.
  const [warning, setWarning] = useState<{ answers: number; metrics: string[] } | null>(null);
  const names = (details: unknown): string[] => {
    const listed = (details as { metrics?: unknown } | undefined)?.metrics;
    return Array.isArray(listed) ? listed.filter((label): label is string => typeof label === "string") : [];
  };

  return (
    <ConfirmDialog
      title={t("removeTitle", { name: type.name })}
      body={warning ? (
        <>
          {warning.answers ? <p className="font-medium text-[var(--danger)]">{t("removeAnswersBody", { count: warning.answers })}</p> : null}
          {warning.metrics.length ? (
            <>
              <p className={warning.answers ? "mt-3" : undefined}>{t("removeMetricsBody")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{warning.metrics.map((label) => <li key={label}>{label}</li>)}</ul>
            </>
          ) : null}
        </>
      ) : t("removeBody")}
      confirmLabel={warning ? (warning.answers ? t("removeWithAnswers") : t("removeWithMetrics")) : t("remove")}
      danger
      onClose={onClose}
      onConfirm={async () => {
        try {
          await onRemove({ archiveMetrics: Boolean(warning?.metrics.length), deleteAnswers: Boolean(warning?.answers) });
        } catch (cause) {
          // The server says what would be deleted with it; show that and ask again.
          if (cause instanceof ApiError && cause.code === "entry_type_has_entries") {
            const count = (cause.details as { count?: unknown } | undefined)?.count;
            setWarning({ answers: typeof count === "number" ? count : 1, metrics: names(cause.details) });
            throw new Error(t("removeAnswersPrompt"));
          }
          if (cause instanceof ApiError && cause.code === "entry_type_has_metrics") {
            setWarning({ answers: warning?.answers ?? 0, metrics: names(cause.details) });
            throw new Error(t("removeMetricsPrompt"));
          }
          throw cause;
        }
      }}
    />
  );
}

/** The panel under a shared response's fields: who can change it, and how to take it away. */
export function SharedResponsePanel({
  type,
  locked,
  onChangePolicy,
  onRemove,
  removable,
}: {
  type: EntryTypeView;
  locked: boolean;
  onChangePolicy: (policy: SharedEditPolicy) => Promise<void>;
  onRemove: () => void;
  removable: boolean;
}) {
  const t = useTranslations("sharedResponses");
  const f = useGoaFormat();
  const [policy, setPolicy] = useState<SharedEditPolicy>(type.sharedEditPolicy ?? "members_fill_admin_corrects");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function change(next: SharedEditPolicy) {
    const previous = policy;
    setPolicy(next);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onChangePolicy(next);
      setSuccess(t("policySaved"));
    } catch (cause) {
      setPolicy(previous);
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)]/30">
      <div className="flex items-start gap-3 border-b border-[var(--main-line)]/60 px-5 py-4">
        <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--main-soft)] text-[var(--main-strong)]"><SharedGlyph className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-medium">{t("panelTitle")}</h3>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{t("panelBody")}</p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <Field label={t("policyLabel")} plain>
          <SelectableCards value={policy} onChange={(next) => void change(next)} disabled={locked || busy} columns={1}
            options={POLICIES.map((value) => ({ value, label: t(`policy.${value}`), hint: t(`policyHint.${value}`) }))} />
        </Field>
        <StatusMessage error={error} success={success} />
        {!locked ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--main-line)]/60 pt-4">
            <p className="max-w-md text-xs leading-5 text-[var(--muted)]">{removable ? t("removeHint") : t("removeLastHint")}</p>
            <button
              type="button"
              disabled={!removable}
              onClick={onRemove}
              className="min-h-10 cursor-pointer rounded-xl border border-[var(--danger-line)] px-4 text-sm text-[var(--danger)] transition hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t("remove")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
