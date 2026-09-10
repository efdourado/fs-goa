"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import type { ChallengeField, CreatableRecipeKey, FieldConfig, FieldType } from "./types";
import { Button, EmptyState, Field, inputClass, labelClass, Toggle } from "./ui";
import { slugify } from "./utils";

export const FIELD_TYPES: FieldType[] = ["text", "number", "rating", "select", "boolean", "date"];

type PresetLabels = (key: string) => string;

/**
 * The starting fields for a recipe's *primary* entry type: Cinema's per-film
 * rating, Library's per-day progress. Library's "Terminei" completion type is
 * seeded by the server from the recipe and tuned later in the admin Fields tab.
 * The wizard pre-fills these so a template arrives with exactly its fields —
 * nothing the participant will never touch.
 */
export function presetFields(recipe: CreatableRecipeKey, label: PresetLabels): ChallengeField[] {
  if (recipe === "library") {
    return [
      { key: "paginas", label: label("paginasLidas"), type: "number", required: true, config: { min: 0, step: 1 } },
    ];
  }
  if (recipe === "habit") {
    // Deliberately just a note — no rating, no preset numeric field. Add
    // whatever the habit actually needs (minutes, a subject, a mood scale) and
    // build a metric on it afterwards in the admin Metrics tab.
    return [
      { key: "nota_dia", label: label("comoFoi"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ];
  }
  return [
    { key: "nota", label: label("nota"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
    { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ];
}

export function cleanFields(fields: ChallengeField[]): ChallengeField[] {
  return fields.map((field, index) => ({
    ...(field.id ? { id: field.id } : {}),
    key: field.key,
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    position: index,
    config: {
      ...field.config,
      // Archived options only ride along to render a historical answer — they are
      // never sent back as an editable option.
      options: field.config?.options?.filter((option) => option.label.trim() && !option.archived).map((option) => ({ ...option, label: option.label.trim(), value: option.value || slugify(option.label) })),
    },
  }));
}

/** The default `config` for a fresh field of `type`. */
export function newFieldConfig(type: FieldType): FieldConfig | undefined {
  return type === "rating" ? { min: 0, max: 5, step: 0.5 }
    : type === "select" ? { options: [] }
      : type === "number" ? { step: 1 }
        : type === "text" ? { maxLength: 280 }
          : undefined;
}

/** A `slugify`d key for `label`, suffixed until it doesn't collide with `taken`. */
export function uniqueFieldKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(label);
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}_${suffix++}`;
  return key;
}

/**
 * The type-specific config controls for one field (number/rating bounds, select
 * options, text length). Shared by the wizard's inline `FieldBuilder` and the
 * admin's `FieldEditorDialog`. `onChange` merges a `ChallengeField` patch.
 */
export function FieldConfigInputs({
  field,
  onChange,
}: {
  field: ChallengeField;
  onChange: (patch: Partial<ChallengeField>) => void;
}) {
  const t = useTranslations("fields");
  const patchConfig = (patch: Partial<FieldConfig>) => onChange({ config: { ...field.config, ...patch } });
  if (field.type === "rating") {
    // A rating's bounds are fixed (0–5, half steps) — nothing to configure.
    return <p className="text-xs leading-5 text-[var(--muted)]">{t("ratingFixed")}</p>;
  }
  if (field.type === "number") {
    return (
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("min")}><input className={inputClass} type="number" step="any" value={field.config?.min ?? ""} onChange={(event) => patchConfig({ min: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
        <Field label={t("max")}><input className={inputClass} type="number" step="any" value={field.config?.max ?? ""} onChange={(event) => patchConfig({ max: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
        <Field label={t("step")}><input className={inputClass} type="number" step="any" min="0.01" value={field.config?.step ?? 1} onChange={(event) => patchConfig({ step: Number(event.target.value) || 1 })} /></Field>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={t("optionsLabel")} hint={t("optionsPlaceholder")}>
        <input className={inputClass} value={(field.config?.options ?? []).filter((option) => !option.archived).map((option) => option.label).join(", ")} onChange={(event) => patchConfig({ options: event.target.value.split(",").map((option) => ({ label: option.trim(), value: slugify(option) })) })} placeholder={t("optionsPlaceholder")} />
      </Field>
    );
  }
  if (field.type === "text") {
    return (
      <div className="space-y-3">
        <Toggle checked={field.config?.multiline ?? false} onChange={(next) => patchConfig({ multiline: next })} label={t("multiline")} />
        <Field label={t("maxLength")}><input className={inputClass} type="number" min={1} max={5000} value={field.config?.maxLength ?? 280} onChange={(event) => patchConfig({ maxLength: Number(event.target.value) || 280 })} /></Field>
      </div>
    );
  }
  return null;
}

export function FieldBuilder({
  fields,
  onChange,
  lockPersistedTypes = false,
}: {
  fields: ChallengeField[];
  onChange: (fields: ChallengeField[]) => void;
  lockPersistedTypes?: boolean;
}) {
  const t = useTranslations("fields");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [required, setRequired] = useState(true);

  function update(index: number, patch: Partial<ChallengeField>) {
    onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    onChange([...fields, { key: uniqueFieldKey(cleanLabel, fields.map((field) => field.key)), label: cleanLabel, type, required, config: newFieldConfig(type) }]);
    setLabel("");
    setType("text");
    setRequired(true);
  }

  return (
    <div className="space-y-4">
      {fields.length ? (
        <ol className="divide-y divide-[var(--line)]">
          {fields.map((field, index) => (
            <li className="py-5 first:pt-0" key={field.id ?? field.key}>
              <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]">
                <label><span className={labelClass}>{t("labelLabel")}</span><input className={inputClass} value={field.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} /></label>
                <label><span className={labelClass}>{t("typeLabel")}</span><select className={inputClass} value={field.type} disabled={lockPersistedTypes && Boolean(field.id)} onChange={(event) => update(index, { type: event.target.value as FieldType })}>{FIELD_TYPES.map((value) => <option value={value} key={value}>{t(`type.${value}`)}</option>)}</select></label>
                <label className="flex min-h-12 items-center gap-2 self-end rounded-xl border border-[var(--line)] px-3 text-sm font-medium"><input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />{t("required")}</label>
              </div>
              <div className="mt-3">
                <FieldConfigInputs field={field} onChange={(patch) => update(index, patch)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <code className="rounded bg-[var(--wash)] px-2 py-1 text-[11px] text-[var(--muted)]">{field.key}</code>
                <div className="flex gap-1"><Button variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} className="px-3">↑<span className="sr-only">{t("moveUp")}</span></Button><Button variant="ghost" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="px-3">↓<span className="sr-only">{t("moveDown")}</span></Button><button type="button" className="min-h-11 px-2 text-sm text-[var(--danger)] hover:underline" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>{t("remove")}</button></div>
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptyState title={t("noFieldsTitle")} />}

      <form className="rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--main-soft)]/60 p-4" onSubmit={addField}>
        <p className="mb-3 text-sm font-light text-[var(--main-strong)]">{t("addFieldTitle")}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto_auto]">
          <label><span className="sr-only">{t("fieldNameSr")}</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("fieldNamePlaceholder")} maxLength={100} required /></label>
          <label><span className="sr-only">{t("fieldTypeSr")}</span><select className={inputClass} value={type} onChange={(event) => setType(event.target.value as FieldType)}>{FIELD_TYPES.map((value) => <option value={value} key={value}>{t(`type.${value}`)}</option>)}</select></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl bg-[var(--paper)] px-3 text-sm font-medium"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />{t("required")}</label>
          <Button type="submit">{t("add")}</Button>
        </div>
      </form>
    </div>
  );
}
