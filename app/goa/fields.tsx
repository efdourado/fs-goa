"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import type { ChallengeField, CreatableRecipeKey, FieldConfig, FieldCount, FieldType, LibraryProperty } from "./types";
import { AddRow, Button, ChevronIcon, CircleMinusIcon, cx, EmptyState, Field, inputClass, labelClass, rowIconClass, Select, Toggle } from "./ui";
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
      {
        key: "paginas",
        label: label("paginasLidas"),
        type: "number",
        required: true,
        config: { min: 0, step: 1, count: { goal: { from: "page_count" }, entry: "position", showDates: true } },
      },
    ];
  }
  if (recipe === "tables") {
    // Three separate 0–5 ratings, no combined score — the recipe's metrics read these keys.
    return [
      { key: "comida", label: label("comida"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5, inRanking: true } },
      { key: "ambiente_atendimento", label: label("ambienteAtendimento"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5, inRanking: true } },
      { key: "custo_beneficio", label: label("custoBeneficio"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5, inRanking: true } },
      { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
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
  if (recipe === "custom") {
    // Your own list starts plain (just a comment); the creator adds the ratings, numbers or dates it needs.
    return [
      { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ];
  }
  return [
    { key: "nota", label: label("nota"), type: "rating", required: true, config: { min: 0, max: 5, step: 0.5, inRanking: true } },
    { key: "comentario", label: label("comentario"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ];
}

/** What each record of a check-in holds to begin with: a workout's weight, there to be renamed or replaced. */
export function sessionPresetFields(label: PresetLabels): ChallengeField[] {
  // One suggested question; its unit lives in the unit, not in the name. "+ Question" adds the rest.
  return [{ key: "carga", label: label("weight"), type: "number", required: true, config: { min: 0, step: 0.5, unit: "kg" } }];
}

/** What a response filled in once for the whole group starts with: one line of text, not a rating each. */
export function sharedPresetFields(label: PresetLabels): ChallengeField[] {
  return [{ key: "resultado", label: label("resposta"), type: "text", required: true, config: { maxLength: 200 } }];
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
    // A rating's bounds are fixed (0–5, half steps, said under its type); what's left is whether it ranks the titles.
    return <Toggle checked={field.config?.inRanking === true} onChange={(inRanking) => patchConfig({ inRanking })} label={t("inRankingLabel")} hint={t("inRankingHint")} />;
  }
  if (field.type === "number") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("min")}><input className={inputClass} type="number" step="any" value={field.config?.min ?? ""} onChange={(event) => patchConfig({ min: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
        <Field label={t("max")}><input className={inputClass} type="number" step="any" value={field.config?.max ?? ""} onChange={(event) => patchConfig({ max: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
        <Field label={t("step")}><input className={inputClass} type="number" step="any" min="0.01" value={field.config?.step ?? 1} onChange={(event) => patchConfig({ step: Number(event.target.value) || 1 })} /></Field>
        <Field label={t("unit")}><input className={inputClass} maxLength={12} placeholder={t("unitPlaceholder")} value={field.config?.unit ?? ""} onChange={(event) => patchConfig({ unit: event.target.value || undefined })} /></Field>
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
      <Field label={t("maxLength")}>
        <input
          className={inputClass}
          type="number"
          min={1}
          max={6160}
          value={field.config?.maxLength ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            patchConfig({ maxLength: value === "" ? undefined : Number(value), multiline: value !== "" });
          }}
        />
      </Field>
    );
  }
  return null;
}

/** The type picker's choices. A rating names its fixed scale right in the option ("Rating (0 to 5, in half points)"). */
export function useFieldTypeOptions(): Array<{ value: FieldType; label: string }> {
  const t = useTranslations("fields");
  return FIELD_TYPES.map((value) => ({ value, label: value === "rating" ? t("ratingOption") : t(`type.${value}`) }));
}

/** A property a count can run up to: an item's number (a book's pages, a route's distance), by the key items carry it under. */
export interface CountGoalOption {
  key: string;
  label: string;
}

/** The number properties of a library that can be a count's goal: a book's pages and any custom number. */
export function countGoalOptions(properties: LibraryProperty[] | null, pageCountLabel: string): CountGoalOption[] {
  return (properties ?? []).flatMap((property) => {
    if (property.type !== "number" || property.hidden) return [];
    if (property.storage === "native") return property.key === "page_count" ? [{ key: "page_count", label: property.label ?? pageCountLabel }] : [];
    return property.attributeKey ? [{ key: property.attributeKey, label: property.label ?? property.attributeKey }] : [];
  });
}

/**
 * "Contagem" for a number field: count it along a road to a goal. Only where a count can be drawn (a form
 * answered day by day). The goal is a number property of each item (`goals`), one number for every item, or none.
 */
export function CountSettings({ field, goals, onChange, alwaysOn = false }: {
  field: ChallengeField;
  goals: CountGoalOption[];
  onChange: (count: FieldCount | undefined) => void;
  /** The field is the count itself (daily progress), so there's no switch to turn it off. */
  alwaysOn?: boolean;
}) {
  const t = useTranslations("countSettings");
  const count = field.config?.count;
  const goal = count?.goal ?? null;
  const goalValue = !goal ? "none" : "value" in goal ? "value" : `from:${goal.from}`;
  // A goal set to a property this list doesn't know (yet) still shows, by its key.
  const options = goal && "from" in goal && !goals.some((option) => option.key === goal.from) ? [...goals, { key: goal.from, label: goal.from }] : goals;
  const set = (patch: Partial<FieldCount>) => onChange({ goal: null, entry: "amount", showDates: true, ...count, ...patch });
  return (
    <div className={cx("space-y-4", !alwaysOn && "rounded-2xl border border-[var(--line)] p-4")}>
      {alwaysOn ? null : (
        <Toggle checked={Boolean(count)} onChange={(on) => onChange(on ? { goal: goals[0] ? { from: goals[0].key } : null, entry: goals[0]?.key === "page_count" ? "position" : "amount", showDates: true } : undefined)} label={t("title")} hint={t("hint")} />
      )}
      {count ? (
        <>
          <Field label={t("goal")}>
            <div className="flex flex-wrap items-center gap-2">
              <Select className="w-auto" ariaLabel={t("goal")} value={goalValue}
                onChange={(next) => set({ goal: next === "none" ? null : next === "value" ? { value: 100 } : { from: next.slice("from:".length) } })}
                options={[
                  { value: "none", label: t("goalNone") },
                  ...options.map((option) => ({ value: `from:${option.key}`, label: t("goalFrom", { name: option.label }) })),
                  { value: "value", label: t("goalValue") },
                ]} />
              {goal && "value" in goal ? (
                <input className={cx(inputClass, "w-32")} type="number" min={1} step="any" aria-label={t("goalValue")} value={goal.value} onChange={(event) => set({ goal: { value: Math.max(1, Number(event.target.value) || 1) } })} />
              ) : null}
            </div>
          </Field>
          <Field label={t("entry")}>
            <Select className="w-auto" ariaLabel={t("entry")} value={count.entry} onChange={(next) => set({ entry: next === "position" ? "position" : "amount" })}
              options={[{ value: "amount", label: t("entryAmount") }, { value: "position", label: t("entryPosition") }]} />
          </Field>
          <Toggle checked={count.showDates} onChange={(on) => set({ showDates: on })} label={t("showDates")} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A form's questions as numbered rows, the same as a challenge's responses and rules: each named after its question
 * with its type underneath, one open at a time to edit, moved with the arrows, removed with the minus, and "+ Question"
 * adds the next. There's always at least one.
 */
export function FieldRows({ fields, onChange, max = 30 }: {
  fields: ChallengeField[];
  onChange: (fields: ChallengeField[]) => void;
  max?: number;
}) {
  const t = useTranslations("fields");
  const [open, setOpen] = useState<string | null>(fields[0]?.key ?? null);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function add() {
    // The key is fixed now, before the question has a name; a neutral one keeps it unique.
    const key = uniqueFieldKey("campo", fields.map((field) => field.key));
    onChange([...fields, { key, label: "", type: "text", required: true, config: newFieldConfig("text") }]);
    setOpen(key);
  }

  return (
    <div>
      <ol>
        {fields.map((field, index) => {
          const isOpen = open === field.key;
          return (
            <li className="border-t border-[var(--line)] first:border-t-0" key={field.id ?? field.key}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : field.key)}
                  className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3.5 py-2.5 text-left"
                >
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--ink)] text-[13px] font-medium tabular-nums">{index + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-medium">{field.label.trim() || t("questionN", { n: index + 1 })}</span>
                    <span className="truncate text-xs text-[var(--muted)]">{t(`type.${field.type}`)}{field.required ? ` · ${t("required")}` : ""}</span>
                  </span>
                </button>
                {fields.length > 1 ? <>
                  <button type="button" className={rowIconClass} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp")} title={t("moveUp")}><ChevronIcon dir="up" /></button>
                  <button type="button" className={rowIconClass} disabled={index === fields.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown")} title={t("moveDown")}><ChevronIcon dir="down" /></button>
                  <button
                    type="button"
                    className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")}
                    onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}
                    aria-label={t("remove")}
                    title={t("remove")}
                  >
                    <CircleMinusIcon className="h-[18px] w-[18px]" />
                  </button>
                </> : null}
              </div>
              {isOpen ? (
                <div className="pb-6 pl-[46px]">
                  <FieldBuilder
                    fields={[field]}
                    allowAdd={false}
                    minimumFields={1}
                    showOrdering={false}
                    onChange={([next]) => onChange(fields.map((current, fieldIndex) => fieldIndex === index ? next : current))}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {fields.length < max ? <AddRow label={t("questionWord")} ariaLabel={t("addQuestion")} onClick={add} /> : null}
    </div>
  );
}

export function FieldBuilder({
  fields,
  onChange,
  lockPersistedTypes = false,
  allowAdd = true,
  minimumFields = 0,
  showOrdering = true,
}: {
  fields: ChallengeField[];
  onChange: (fields: ChallengeField[]) => void;
  lockPersistedTypes?: boolean;
  /** Some editors add a whole response instead, so a second field-level add action would be misleading. */
  allowAdd?: boolean;
  /** Keeps a response from being left without anything to answer. */
  minimumFields?: number;
  /** Response blocks order themselves, so their nested fields must not show a second pair of arrows. */
  showOrdering?: boolean;
}) {
  const t = useTranslations("fields");
  const typeOptions = useFieldTypeOptions();
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
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className={labelClass}>{t("labelLabel")}</span><input className={inputClass} value={field.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} /></label>
                <div><span className={labelClass}>{t("typeLabel")}</span><Select ariaLabel={t("typeLabel")} value={field.type} disabled={lockPersistedTypes && Boolean(field.id)} onChange={(type) => update(index, { type })} options={typeOptions} /></div>
                {/* A rating's own switch sits beside "required"; anything else's settings go on their own row below. */}
                <Toggle className={field.type === "rating" ? undefined : "sm:col-span-2"} checked={field.required} onChange={(required) => update(index, { required })} label={t("requiredToggle")} />
                {field.type === "rating" ? <FieldConfigInputs field={field} onChange={(patch) => update(index, patch)} /> : null}
              </div>
              {field.type === "rating" ? null : (
                <div className="mt-3">
                  <FieldConfigInputs field={field} onChange={(patch) => update(index, patch)} />
                </div>
              )}
              <div className="mt-3 flex justify-end gap-1">
                {showOrdering ? <>
                  <Button variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} className="px-3">↑<span className="sr-only">{t("moveUp")}</span></Button>
                  <Button variant="ghost" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="px-3">↓<span className="sr-only">{t("moveDown")}</span></Button>
                </> : null}
                {fields.length > minimumFields ? <button type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} aria-label={t("remove")} title={t("remove")} onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}><CircleMinusIcon className="h-[18px] w-[18px]" /></button> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptyState title={t("noFieldsTitle")} />}

      {allowAdd ? <form className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-4" onSubmit={addField}>
        <p className="mb-3 text-sm font-light text-[var(--ink)]">{t("addFieldTitle")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="sr-only">{t("fieldNameSr")}</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("fieldNamePlaceholder")} maxLength={100} required /></label>
          <Select ariaLabel={t("fieldTypeSr")} value={type} onChange={setType} options={typeOptions} />
          <Toggle className="sm:col-span-2" checked={required} onChange={setRequired} label={t("requiredToggle")} />
          <Button type="submit" className="w-full sm:col-span-2">{t("add")}</Button>
        </div>
      </form> : null}
    </div>
  );
}
