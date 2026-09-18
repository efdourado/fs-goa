"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { ActionMenu, ActionMenuItem } from "./action-menu";
import { useCsrf } from "./csrf";
import { Dialog, FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { type CatalogScope, LibraryGlyph, useLibraryName } from "./libraries";
import type { CatalogAttributeDef, CatalogLibrary, LibraryProperty } from "./types";
import { Button, cx, EmptyState, Field, inputClass, SelectableCards, StatusMessage, Toggle } from "./ui";

type PropertyType = LibraryProperty["type"];
const PROPERTY_TYPES: PropertyType[] = ["text", "number", "date", "boolean"];

/** Create a library: a Tables preset with starter properties, or a blank one shaped entirely by its owner. */
export function NewLibraryDialog({
  scope,
  onCancel,
  onCreated,
}: {
  scope: CatalogScope;
  onCancel: () => void;
  onCreated: (library: CatalogLibrary) => void;
}) {
  const t = useTranslations("libraries");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const [source, setSource] = useState<"tables" | "custom">("custom");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const name = label.trim() || (source === "tables" ? t("source.tables") : "");
    if (!name) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await apiRequest<CatalogLibrary>(API_PATHS.catalogWorkspace(scope).libraries, {
        method: "POST", body: { label: name, source }, csrfToken: csrf,
      });
      onCreated(made);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={t("newTitle")}
      dirty={Boolean(label.trim())}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={t("create")}
      busyLabel={tc("saving")}
    >
      <p className="text-sm leading-6 text-[var(--muted)]">{t("newBody")}</p>
      <Field label={t("startFrom")} plain>
        <SelectableCards
          value={source}
          onChange={setSource}
          options={[
            { value: "custom", label: t("blank"), hint: t("blankHint") },
            { value: "tables", label: t("tablesPreset"), hint: t("tablesPresetHint") },
          ]}
        />
      </Field>
      <Field label={t("nameLabel")} hint={t("nameHint")}>
        <input
          className={inputClass}
          value={label}
          maxLength={80}
          placeholder={source === "tables" ? t("source.tables") : t("namePlaceholder")}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function RenameLibraryDialog({
  library,
  onCancel,
  onRenamed,
}: {
  library: CatalogLibrary;
  onCancel: () => void;
  onRenamed: (label: string) => void;
}) {
  const t = useTranslations("libraries");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const libraryName = useLibraryName();
  const initial = libraryName(library);
  const [label, setLabel] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const name = label.trim();
    if (!name) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(API_PATHS.catalogLibrary(library.id), { method: "PATCH", body: { label: name }, csrfToken: csrf });
      onRenamed(name);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={t("renameTitle")}
      dirty={label.trim() !== initial}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={t("rename")}
    >
      <Field label={t("nameLabel")} hint={t("renameHint")}>
        <input className={inputClass} value={label} maxLength={80} required onChange={(event) => setLabel(event.target.value)} />
      </Field>
    </FormDialog>
  );
}

function ArrowButton({ dir, disabled, onClick, label }: { dir: "up" | "down"; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-25"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d={dir === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * One editor for every property of a library — a built-in column (year, pages…)
 * or one someone added (cuisine, neighbourhood…) look and behave the same:
 * rename, hide, reorder. Nothing here moves or deletes a saved value; a hidden
 * property simply stops appearing on forms and lists, and can come back.
 */
export function LibraryPropertiesDialog({
  scope,
  library,
  canEdit,
  onClose,
  onChanged,
}: {
  scope: CatalogScope;
  library: CatalogLibrary;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("libraries");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const libraryName = useLibraryName();
  const [properties, setProperties] = useState<LibraryProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<PropertyType>("text");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ properties: LibraryProperty[] }>(API_PATHS.libraryProperties(library.id));
      setProperties(response.properties);
    } catch (cause) {
      setError(f.error(cause));
      setProperties([]);
    }
  }, [library.id, f]);
  useEffect(() => { void load(); }, [load]);

  const nativeName = (key: string) => (t.has(`native.${key}`) ? t(`native.${key}`) : key);
  const nameOf = (property: LibraryProperty) => property.label?.trim() || (property.storage === "native" ? nativeName(property.key) : property.key);

  async function patch(property: LibraryProperty, body: Record<string, unknown>, message?: string): Promise<boolean> {
    setBusyKey(property.key);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(API_PATHS.libraryProperty(library.id, property.key), { method: "PATCH", body, csrfToken: csrf });
      await load();
      onChanged();
      if (message) setSuccess(message);
      return true;
    } catch (cause) {
      setError(f.error(cause));
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function commitLabel(property: LibraryProperty) {
    const draft = drafts[property.key];
    if (draft === undefined) return;
    const next = draft.trim();
    setDrafts((current) => { const { [property.key]: _dropped, ...rest } = current; void _dropped; return rest; });
    if (next === (property.label ?? "")) return;
    if (!next) {
      // A built-in falls back to its default name; a custom one must keep a name.
      if (property.storage === "native") await patch(property, { label: null }, t("propertySaved"));
      return;
    }
    await patch(property, { label: next }, t("propertySaved"));
  }

  async function move(index: number, delta: -1 | 1) {
    if (!properties) return;
    const target = index + delta;
    if (target < 0 || target >= properties.length) return;
    const next = [...properties];
    [next[index], next[target]] = [next[target], next[index]];
    setBusyKey("__order__");
    setError(null);
    setSuccess(null);
    try {
      // Built-in columns keep their own position scale and custom ones sit 10
      // above theirs, so one explicit slot per property keeps the order exact.
      for (let position = 0; position < next.length; position += 1) {
        const property = next[position];
        const slot = property.storage === "native" ? (position + 1) * 10 : position * 10;
        if (property.position === (property.storage === "native" ? slot : slot + 10)) continue;
        await apiRequest(API_PATHS.libraryProperty(library.id, property.key), { method: "PATCH", body: { position: slot }, csrfToken: csrf });
      }
      await load();
      onChanged();
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeCustom(property: LibraryProperty) {
    setBusyKey(property.key);
    setError(null);
    setSuccess(null);
    try {
      const path = scope === "personal"
        ? API_PATHS.personalCatalogAttribute(property.key)
        : API_PATHS.groupCatalogAttribute(scope.groupId, property.key);
      await apiRequest(path, { method: "DELETE", csrfToken: csrf });
      await load();
      onChanged();
      setSuccess(t("propertyRemoved"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusyKey(null);
    }
  }

  async function addProperty() {
    const label = newLabel.trim();
    if (!label) { setError(t("propertyNameRequired")); return; }
    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<CatalogAttributeDef>(API_PATHS.catalogWorkspace(scope).attributes, {
        method: "POST", body: { libraryId: library.id, label, type: newType }, csrfToken: csrf,
      });
      setNewLabel("");
      setNewType("text");
      await load();
      onChanged();
      setSuccess(t("propertyAdded"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog title={t("propertiesTitle", { name: libraryName(library) })} onClose={onClose} busy={busyKey !== null || adding}>
      <p className="text-sm leading-6 text-[var(--muted)]">{canEdit ? t("propertiesBody") : t("propertiesReadOnly")}</p>

      <div className="mt-4"><StatusMessage error={error} success={success} /></div>

      {properties === null ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
          {properties.map((property, index) => (
            <li key={property.key} className={cx("flex items-center gap-3 px-3.5 py-3", property.hidden && "bg-[var(--wash)]/60")}>
              <span
                className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--wash)] text-[11px] font-medium text-[var(--muted)]"
                title={t(`type.${property.type}`)}
                aria-hidden="true"
              >
                {property.type === "number" ? "123" : property.type === "date" ? "31" : property.type === "boolean" ? "✓" : "Aa"}
              </span>
              <div className="min-w-0 flex-1">
                {canEdit ? (
                  <input
                    className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none transition hover:border-[var(--line)] focus:border-[var(--main)] focus:bg-[var(--paper)] disabled:opacity-60"
                    value={drafts[property.key] ?? property.label ?? ""}
                    placeholder={nameOf(property)}
                    aria-label={t("propertyNameAria", { name: nameOf(property) })}
                    maxLength={80}
                    disabled={busyKey !== null}
                    onChange={(event) => setDrafts((current) => ({ ...current, [property.key]: event.target.value }))}
                    onBlur={() => void commitLabel(property)}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  />
                ) : (
                  <strong className="block px-2 py-1 text-sm font-medium">{nameOf(property)}</strong>
                )}
                <span className="block px-2 text-[11px] text-[var(--muted)]">
                  {t(`type.${property.type}`)}
                  {property.storage === "native" ? ` · ${t("builtIn")}` : ""}
                  {property.hidden ? ` · ${t("hidden")}` : ""}
                </span>
              </div>
              {canEdit ? (
                <div className="flex flex-none items-center gap-1">
                  <ArrowButton dir="up" label={t("moveUp")} disabled={index === 0 || busyKey !== null} onClick={() => void move(index, -1)} />
                  <ArrowButton dir="down" label={t("moveDown")} disabled={index === properties.length - 1 || busyKey !== null} onClick={() => void move(index, 1)} />
                  <Toggle
                    checked={!property.hidden}
                    disabled={!property.canHide || busyKey !== null}
                    onChange={(show) => void patch(property, { hidden: !show }, show ? t("propertyShown") : t("propertyHiddenSaved"))}
                    className="mx-1"
                  />
                  {property.storage === "attribute" ? (
                    <ActionMenu label={t("moreActions")} iconOnly>
                      <ActionMenuItem danger onClick={() => void removeCustom(property)}>{t("removeProperty")}</ActionMenuItem>
                    </ActionMenu>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          className="mt-5 rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--main-soft)]/40 p-4"
          onSubmit={(event) => { event.preventDefault(); void addProperty(); }}
        >
          <h3 className="text-sm font-medium">{t("addPropertyTitle")}</h3>
          <p className="mb-3 mt-0.5 text-xs leading-5 text-[var(--muted)]">{t("addPropertyHint")}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
            <input className={inputClass} value={newLabel} maxLength={80} placeholder={t("propertyNamePlaceholder")} aria-label={t("propertyNameLabel")} onChange={(event) => setNewLabel(event.target.value)} />
            <select className={inputClass} value={newType} aria-label={t("propertyTypeLabel")} onChange={(event) => setNewType(event.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{t(`type.${type}`)}</option>)}
            </select>
            <Button type="submit" disabled={adding}>{adding ? tc("saving") : t("addProperty")}</Button>
          </div>
        </form>
      ) : null}

      {properties && !properties.length ? <div className="mt-4"><EmptyState title={t("noProperties")} /></div> : null}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]"><LibraryGlyph source={library.source} />{libraryName(library)}</span>
        <Button variant="secondary" onClick={onClose}>{tc("close")}</Button>
      </div>
    </Dialog>
  );
}
