"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ApiError } from "./api";
import { FormDialog } from "./dialog";
import { cleanFields, FieldConfigInputs, newFieldConfig, useFieldTypeOptions } from "./fields";
import { useGoaFormat } from "./format";
import type { ChallengeField, EntryTypeView, SharedEditPolicy } from "./types";
import { cx, Field, inputClass, Select, Toggle } from "./ui";

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
  const typeOptions = useFieldTypeOptions();
  const f = useGoaFormat();
  const [name, setName] = useState("");
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
      await onAdd({ name: responseName, sharedEditPolicy: "members_fill_admin_corrects", field: { ...clean, key: "" } });
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("fieldLabel")}>
          <input className={inputClass} value={field.label} maxLength={100} placeholder={name.trim() || t("fieldPlaceholder")} onChange={(event) => setField((current) => ({ ...current, label: event.target.value }))} />
        </Field>
        <Field label={tf("typeLabel")}>
          <Select
            ariaLabel={tf("typeLabel")}
            value={field.type}
            onChange={(type) => setField((current) => ({ ...current, type, config: newFieldConfig(type) }))}
            options={typeOptions}
          />
        </Field>
      </div>
      {/* Two switches side by side (a rating's "counts for the ranking" and "required") wherever there's room. */}
      <div className={cx("grid gap-4", field.type === "rating" && "sm:grid-cols-2")}>
        {hasConfig ? <FieldConfigInputs field={field} onChange={(patch) => setField((current) => ({ ...current, ...patch }))} /> : null}
        <Toggle checked={field.required} onChange={(next) => setField((current) => ({ ...current, required: next }))} label={tf("requiredToggle")} />
      </div>
    </FormDialog>
  );
}
/**
 * One response's own settings: its name, and (when it isn't the only one) removing it. Removing is confirmed
 * right here: the server says what else would go (answers already given, metrics that read them), that is
 * shown, and a second confirmation takes it all.
 */
export function ResponseSettingsDialog({
  type,
  onCancel,
  onRename,
  onRemove,
}: {
  type: EntryTypeView;
  onCancel: () => void;
  onRename: (name: string) => Promise<void>;
  onRemove?: (confirmed: { archiveMetrics: boolean; deleteAnswers: boolean }) => Promise<void>;
}) {
  const t = useTranslations("sharedResponses");
  const f = useGoaFormat();
  const [name, setName] = useState(type.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filled in once the server says what else would go: answers already given, and metrics that read them.
  const [warning, setWarning] = useState<{ answers: number; metrics: string[] } | null>(null);
  const names = (details: unknown): string[] => {
    const listed = (details as { metrics?: unknown } | undefined)?.metrics;
    return Array.isArray(listed) ? listed.filter((label): label is string => typeof label === "string") : [];
  };

  async function submit() {
    const next = name.trim();
    if (!next) return;
    if (next === type.name) { onCancel(); return; }
    setBusy(true);
    setError(null);
    try {
      await onRename(next);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={type.name}
      dirty={name.trim() !== type.name}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitDisabled={!name.trim()}
      onDelete={onRemove ? {
        body: warning ? (
          <>
            {warning.answers ? <p className="font-medium text-[var(--danger)]">{t("removeAnswersBody", { count: warning.answers })}</p> : null}
            {warning.metrics.length ? (
              <>
                <p className={warning.answers ? "mt-3" : undefined}>{t("removeMetricsBody")}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">{warning.metrics.map((label) => <li key={label}>{label}</li>)}</ul>
              </>
            ) : null}
          </>
        ) : t("removeBody"),
        onConfirm: async () => {
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
        },
      } : undefined}
    >
      <Field label={t("nameLabel")}>
        <input className={inputClass} value={name} maxLength={60} required onChange={(event) => setName(event.target.value)} />
      </Field>
    </FormDialog>
  );
}
