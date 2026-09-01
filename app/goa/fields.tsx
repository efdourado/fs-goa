"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import type { ChallengeField, FieldConfig, FieldType, RecipeKey } from "./types";
import { Button, EmptyState, inputClass, labelClass } from "./ui";
import { slugify } from "./utils";

export const FIELD_TYPES: FieldType[] = ["text", "number", "rating", "select", "boolean", "date"];

type PresetLabels = (key: string) => string;

/**
 * The starting fields for a recipe's *primary* entry type (Avaliação / Progresso
 * / Registro). Secondary types — expectation, book completion — are seeded by the
 * server from the recipe and tuned later in the admin Fields tab.
 */
export function presetFields(recipe: RecipeKey, label: PresetLabels): ChallengeField[] {
  if (recipe === "cine_free" || recipe === "cine_curated") {
    return [
      { key: "nota", label: label("nota"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
      { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 280 } },
    ];
  }
  if (recipe === "reading_club") {
    return [
      { key: "paginas_lidas", label: label("paginasLidas"), type: "number", required: true, config: { min: 0, step: 1 } },
    ];
  }
  return [
    { key: "livro_atual", label: label("livroAtual"), type: "text", required: true },
    { key: "paginas_lidas", label: label("paginasLidas"), type: "number", required: true, config: { min: 0, step: 1 } },
    { key: "livro_concluido", label: label("livroConcluido"), type: "boolean", required: false },
    { key: "nota_do_livro", label: label("notaDoLivro"), type: "rating", required: false, config: { min: 0, max: 5, step: 0.5 } },
    { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 280 } },
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
      options: field.config?.options?.filter((option) => option.label.trim()).map((option) => ({ ...option, label: option.label.trim(), value: option.value || slugify(option.label) })),
    },
  }));
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

  function updateConfig(index: number, patch: Partial<FieldConfig>) {
    const field = fields[index];
    update(index, { config: { ...field.config, ...patch } });
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
    const base = slugify(cleanLabel);
    let key = base;
    let suffix = 2;
    while (fields.some((field) => field.key === key)) key = `${base}_${suffix++}`;
    const config: FieldConfig | undefined =
      type === "rating" ? { min: 0, max: 5, step: 0.5 }
        : type === "select" ? { options: [] }
          : type === "number" ? { step: 1 }
            : type === "text" ? { maxLength: 280 }
              : undefined;
    onChange([...fields, { key, label: cleanLabel, type, required, config }]);
    setLabel("");
    setType("text");
    setRequired(true);
  }

  return (
    <div className="space-y-4">
      {fields.length ? (
        <ol className="space-y-3">
          {fields.map((field, index) => (
            <li className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4" key={field.id ?? field.key}>
              <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]">
                <label><span className={labelClass}>{t("labelLabel")}</span><input className={inputClass} value={field.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} /></label>
                <label><span className={labelClass}>{t("typeLabel")}</span><select className={inputClass} value={field.type} disabled={lockPersistedTypes && Boolean(field.id)} onChange={(event) => update(index, { type: event.target.value as FieldType })}>{FIELD_TYPES.map((value) => <option value={value} key={value}>{t(`type.${value}`)}</option>)}</select></label>
                <label className="flex min-h-12 items-center gap-2 self-end rounded-xl border border-[var(--line)] px-3 text-sm font-medium"><input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />{t("required")}</label>
              </div>

              {field.type === "rating" || field.type === "number" ? (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label><span className={labelClass}>{t("min")}</span><input className={inputClass} type="number" step="any" value={field.config?.min ?? ""} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                  <label><span className={labelClass}>{t("max")}</span><input className={inputClass} type="number" step="any" value={field.config?.max ?? ""} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                  <label><span className={labelClass}>{t("step")}</span><input className={inputClass} type="number" step="any" min="0.01" value={field.config?.step ?? 1} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { step: Number(event.target.value) || 1 })} /></label>
                </div>
              ) : null}
              {field.type === "select" ? (
                <label className="mt-3 block"><span className={labelClass}>{t("optionsLabel")}</span><input className={inputClass} value={(field.config?.options ?? []).map((option) => option.label).join(", ")} onChange={(event) => updateConfig(index, { options: event.target.value.split(",").map((option) => ({ label: option.trim(), value: slugify(option) })) })} placeholder={t("optionsPlaceholder")} /></label>
              ) : null}
              {field.type === "text" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-sm font-medium"><input type="checkbox" checked={field.config?.multiline ?? false} onChange={(event) => updateConfig(index, { multiline: event.target.checked })} />{t("multiline")}</label><label><span className={labelClass}>{t("maxLength")}</span><input className={inputClass} type="number" min={1} max={5000} value={field.config?.maxLength ?? 280} onChange={(event) => updateConfig(index, { maxLength: Number(event.target.value) || 280 })} /></label></div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <code className="rounded bg-[var(--wash)] px-2 py-1 text-[11px] text-[var(--muted)]">{field.key}</code>
                <div className="flex gap-1"><Button variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} className="px-3" >↑<span className="sr-only">{t("moveUp")}</span></Button><Button variant="ghost" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="px-3">↓<span className="sr-only">{t("moveDown")}</span></Button><Button variant="danger" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>{t("remove")}</Button></div>
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptyState title={t("noFieldsTitle")} description={t("noFieldsBody")} />}

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
