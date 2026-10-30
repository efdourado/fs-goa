"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, useLibraryProperties, valuesFromItem } from "./property-inputs";
import type { CatalogItem, Id, LibraryProperty } from "./types";
import { Field, inputClass } from "./ui";

export type ItemEditorPayload = { title: string } & Record<string, unknown>;
type EditorItem = Omit<CatalogItem, "id" | "kind">;
const VISIBLE_PROPERTIES = 6;
const EMPTY_PROPERTIES: LibraryProperty[] = [];

/** One item editor for both catalogue and challenge views. Callers supply only their save/removal actions. */
export function ItemEditorDialog({ item, library, maxTitleLength, requireAuthor = false, onCancel, onSave, onRemove }: {
  item: EditorItem;
  library: { id: Id | null; kind: string } | null;
  maxTitleLength: number;
  requireAuthor?: boolean;
  onCancel: () => void;
  onSave: (payload: ItemEditorPayload) => Promise<void>;
  onRemove?: { body: string; onConfirm: () => Promise<void> };
}) {
  const t = useTranslations("catalogAdd");
  const tCine = useTranslations("cineItems");
  const tFields = useTranslations("entryForm");
  const f = useGoaFormat();
  const { properties: loadedProperties, error: propertiesError } = useLibraryProperties(library);
  const properties = library ? loadedProperties : EMPTY_PROPERTIES;
  const [title, setTitle] = useState(item.title);
  const initialValues = useMemo(() => properties ? valuesFromItem(properties, item) : {}, [properties, item]);
  const [edited, setEdited] = useState<PropertyValues | null>(null);
  const values = edited ?? initialValues;
  const [expanded, setExpanded] = useState(false);
  const visible = editableProperties(properties ?? []);
  const shown = expanded ? visible : visible.slice(0, VISIBLE_PROPERTIES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title.trim() !== item.title || edited !== null;

  async function submit() {
    const name = title.trim();
    if (!name) { setError(t("titleRequired")); return; }
    if (!properties || propertiesError) return;
    if (requireAuthor && library?.kind === "book" && properties.some((property) => property.key === "author" && !property.hidden) && !(values.author ?? "").trim()) {
      setExpanded(true);
      setError(tCine("authorRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const facts = edited ? bodyFromValues(properties, values, "update") : null;
      await onSave({
        title: name,
        ...(facts ? { ...facts.native, ...(Object.keys(facts.attributes).length ? { attributes: facts.attributes } : {}) } : {}),
      });
    } catch (cause) { setError(f.error(cause)); setBusy(false); }
  }

  return (
    <FormDialog title={t("editTitle")} dirty={dirty} busy={busy} error={error ?? propertiesError} onCancel={onCancel} onSubmit={submit} submitDisabled={!properties || Boolean(propertiesError)} onDelete={onRemove}>
      <Field label={t("titleLabel")}>
        <input className={inputClass} value={title} maxLength={maxTitleLength} required onChange={(event) => setTitle(event.target.value)} />
      </Field>
      {properties ? <PropertyInputs properties={shown} values={values} onChange={(key, value) => setEdited({ ...values, [key]: value })} /> : <p className="text-sm text-[var(--muted)]">{t("loadingProperties")}</p>}
      {visible.length > VISIBLE_PROPERTIES ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--wash)] px-3 text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">
          <span aria-hidden="true">…</span>
          {expanded ? tFields("showLess") : tFields("showMore", { count: visible.length - VISIBLE_PROPERTIES })}
        </button>
      ) : null}
    </FormDialog>
  );
}
