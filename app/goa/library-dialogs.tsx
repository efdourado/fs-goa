"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { API_PATHS, ApiError, apiRequest } from "./api";
import { useCsrf } from "./csrf";
import { DeleteButton, DeleteConfirm, Dialog, FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { type CatalogScope, useLibraryName } from "./libraries";
import { RecipeIcon } from "./recipe-icons";
import type { CatalogAttributeDef, CatalogLibrary, LibraryProperty } from "./types";
import { ArrowField, Button, CircleMinusIcon, Field, inputClass, Select, StatusMessage, Toggle } from "./ui";

type PropertyType = LibraryProperty["type"];
const PROPERTY_TYPES: PropertyType[] = ["text", "number", "date", "boolean"];
const propertySelectClass = "max-w-[55%] rounded-full border border-[var(--line)] py-1.5 pl-3 pr-2 text-xs text-[var(--ink)] transition hover:border-[var(--muted)] focus-visible:border-[var(--main)]";
/** How many properties the settings dialog lists before "show all". */
const VISIBLE_PROPERTIES = 4;

/** Create a library: just a name — what each item can hold is shaped afterwards, in its properties. */
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
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const name = label.trim();
    if (!name) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await apiRequest<CatalogLibrary>(API_PATHS.catalogWorkspace(scope).libraries, {
        method: "POST", body: { label: name }, csrfToken: csrf,
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
      <Field label={t("nameLabel")}>
        <input
          className={inputClass}
          value={label}
          maxLength={80}
          placeholder={t("namePlaceholder")}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

/**
 * Where a Tables challenge needs its library and the space has none: says what it is and lets the
 * person create it. Nothing is created for them — and it points at making more libraries later.
 */
export function TablesLibraryPrompt({ scope, onCreated }: { scope: CatalogScope; onCreated: () => void }) {
  const t = useTranslations("libraries");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(API_PATHS.catalogWorkspace(scope).libraries, { method: "POST", body: { source: "tables" }, csrfToken: csrf });
      onCreated();
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--paper)] p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[var(--main)] text-white" aria-hidden="true">
          <RecipeIcon name="tables" className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-lg font-medium tracking-[-0.02em]">{t("tablesPromptTitle")}</strong>
          <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{t("tablesPromptBody")}</p>
          <Button className="mt-4" disabled={busy} onClick={() => void create()}>{busy ? t("tablesPromptCreating") : t("tablesPromptCreate")}</Button>
          <StatusMessage error={error} />
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{t("tablesPromptMore")}</p>
        </div>
      </div>
    </div>
  );
}

/** Delete a library. Its items go to the bin with it; a running challenge that still holds one stops it. */
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
 * click to edit, reorder or remove. Removal erases saved values after a
 * confirmation that says how many items are affected.
 */
export function LibraryPropertiesDialog({
  scope,
  library,
  canEdit,
  itemCount = 0,
  onClose,
  onChanged,
  onDeleted,
}: {
  scope: CatalogScope;
  library: CatalogLibrary;
  canEdit: boolean;
  /** How many items the library holds — what deleting it sends to the bin. */
  itemCount?: number;
  onClose: () => void;
  onChanged: () => void;
  /** Present where the library can be deleted from here (never Screens or Pages). */
  onDeleted?: (name: string) => void;
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
  const [editing, setEditing] = useState<{ key: string; label: string; type: PropertyType } | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<PropertyType>("text");
  const [adding, setAdding] = useState(false);
  const [coverTopEdit, setCoverTopEdit] = useState<{ received: string | null; value: string } | null>(null);
  const coverTop = coverTopEdit?.received === library.coverTopProperty ? coverTopEdit.value : library.coverTopProperty;
  const [coverBadgeHidden, setCoverBadgeHidden] = useState(library.coverBadgeHidden);
  const [coverBusy, setCoverBusy] = useState(false);
  // Its name, edited in place like a property's: saved on blur or Enter.
  const currentName = libraryName(library);
  const [name, setName] = useState(currentName);
  const [nameBusy, setNameBusy] = useState(false);
  // Four properties are enough to recognise a library by; the rest unfold on demand.
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function commitName() {
    const next = name.trim();
    if (!next) { setName(currentName); return; }
    if (next === currentName) return;
    setNameBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(API_PATHS.catalogLibrary(library.id), { method: "PATCH", body: { label: next }, csrfToken: csrf });
      onChanged();
      setSuccess(t("propertySaved"));
    } catch (cause) {
      setError(f.error(cause));
      setName(currentName);
    } finally {
      setNameBusy(false);
    }
  }

  async function deleteLibrary() {
    try {
      await apiRequest(`${API_PATHS.catalogLibrary(library.id)}?deleteItems=1`, { method: "DELETE", csrfToken: csrf });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "library_busy") {
        const listed = (cause.details as { challenges?: unknown } | undefined)?.challenges;
        const names = Array.isArray(listed) ? listed.filter((title): title is string => typeof title === "string") : [];
        if (names.length) throw new Error(t("deleteBusy", { names: names.join(", ") }));
      }
      throw cause;
    }
    onDeleted?.(currentName);
  }

  const load = useCallback((signal?: AbortSignal) =>
    apiRequest<{ properties: LibraryProperty[] }>(API_PATHS.libraryProperties(library.id), { signal })
      .then((response) => setProperties(response.properties.filter((property) => !property.hidden)))
      .catch((cause: unknown) => {
        if (signal?.aborted) return;
        setError(f.error(cause));
        setProperties([]);
      }), [library.id, f]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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

  async function saveProperty(property: LibraryProperty) {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) { setError(t("propertyNameRequired")); return; }
    const saved = await patch(property, { label, ...(editing.type !== property.type ? { type: editing.type } : {}) }, t("propertySaved"));
    if (saved) setEditing(null);
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

  const [erasing, setErasing] = useState<string | null>(null);
  function askRemove(property: LibraryProperty) {
    if ((property.filled ?? 0) > 0) { setErasing(property.key); return; }
    void removeProperty(property);
  }
  async function removeProperty(property: LibraryProperty) {
    if (property.storage === "attribute") await removeCustom(property);
    else await patch(property, { hidden: true }, t("propertyRemoved"));
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
      setAddOpen(false);
      await load();
      onChanged();
      setSuccess(t("propertyAdded"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setAdding(false);
    }
  }

  async function saveCoverTop(next: string) {
    setCoverBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(API_PATHS.catalogLibrary(library.id), { method: "PATCH", body: { coverTopProperty: next }, csrfToken: csrf });
      setCoverTopEdit({ received: library.coverTopProperty, value: next });
      onChanged();
      setSuccess(t("coversSaved"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setCoverBusy(false);
    }
  }

  async function saveCoverBadgeHidden(nextHidden: boolean) {
    setCoverBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(API_PATHS.catalogLibrary(library.id), { method: "PATCH", body: { coverBadgeHidden: nextHidden }, csrfToken: csrf });
      setCoverBadgeHidden(nextHidden);
      onChanged();
      setSuccess(t("coversSaved"));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setCoverBusy(false);
    }
  }

  const coverProperties = (properties ?? []).filter((property) => property.key !== "title");
  const firstNumber = coverProperties.find((property) => property.type === "number");
  const selectedCoverTop = coverTop && coverProperties.some((property) => (property.attributeKey ?? property.key) === coverTop)
    ? coverTop : coverTop === "none" ? "none" : firstNumber ? firstNumber.attributeKey ?? firstNumber.key : "none";
  const sectionTitle = "mb-2.5 text-[13px] font-medium text-[var(--ink)]";
  const shown = properties ? (showAll ? properties : properties.slice(0, VISIBLE_PROPERTIES)) : [];
  const more = properties ? properties.length - shown.length : 0;
  const typeIcon = (type: PropertyType) => (
    type === "boolean" ? (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="5.8" /><path d="M5.6 8.2l1.7 1.700 3.200-3.500" />
      </svg>
    ) : type === "number" ? "123" : type === "date" ? "31" : "Aa"
  );

  return (
    <Dialog title={currentName} onClose={onClose} busy={busyKey !== null || adding || coverBusy || nameBusy}>
      <StatusMessage error={error} success={success} />

      {canEdit ? (
        <section className="mb-6">
          <h3 className={sectionTitle}>{t("nameLabel")}</h3>
          <input
            className={inputClass}
            value={name}
            maxLength={80}
            disabled={nameBusy}
            aria-label={t("nameLabel")}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </section>
      ) : null}

      <section>
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-medium text-[var(--ink)]">{t("propertiesHeading")}</h3>
          <span className="text-xs text-[var(--muted)]">{canEdit ? t("propertiesBody") : t("propertiesReadOnly")}</span>
        </div>
        {properties === null ? (
          <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
            {shown.map((property, index) => (
              <li key={property.key} className="px-3 py-2.5 transition-colors hover:bg-[var(--wash)] focus-within:bg-[var(--wash)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--wash)] text-[11px] font-medium text-[var(--muted)]" aria-hidden="true">{typeIcon(property.type)}</span>
                  <button type="button" disabled={!canEdit || busyKey !== null} aria-expanded={editing?.key === property.key} onClick={() => {
                    setAddOpen(false);
                    setEditing((current) => current?.key === property.key ? null : { key: property.key, label: nameOf(property), type: property.type });
                  }} className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 text-left text-sm font-medium disabled:cursor-default">
                    <span className="block truncate">{nameOf(property)}</span>
                  </button>
                  {canEdit ? (
                    <div className="flex flex-none items-center">
                      <ArrowButton dir="up" label={t("moveUp")} disabled={index === 0 || busyKey !== null} onClick={() => void move(index, -1)} />
                      <ArrowButton dir="down" label={t("moveDown")} disabled={index === (properties?.length ?? 0) - 1 || busyKey !== null} onClick={() => void move(index, 1)} />
                      {property.canHide ? <button type="button" aria-label={t("removeProperty")} title={t("removeProperty")} disabled={busyKey !== null} onClick={() => askRemove(property)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-25"><CircleMinusIcon className="h-4 w-4" /></button> : null}
                    </div>
                  ) : null}
                </div>
                {editing?.key === property.key ? (
                  <form className="space-y-3 pb-1 pt-3" onSubmit={(event) => { event.preventDefault(); void saveProperty(property); }}>
                    <ArrowField key={property.key} value={editing.label} onChange={(label) => setEditing({ ...editing, label })} label={t("propertyNameLabel")} placeholder={t("propertyNamePlaceholder")} submitLabel={tc("save")} maxLength={80} disabled={busyKey !== null} takesCursor />
                    {property.storage === "attribute" && !(property.filled ?? 0) ? (
                      <Select look="bare" className={propertySelectClass} ariaLabel={t("propertyTypeLabel")} value={editing.type} disabled={busyKey !== null} onChange={(type) => setEditing({ ...editing, type: type as PropertyType })} options={PROPERTY_TYPES.map((type) => ({ value: type, label: t(`type.${type}`) }))} />
                    ) : null}
                  </form>
                ) : null}
                {erasing === property.key ? <div className="mt-3"><DeleteConfirm body={t("eraseBody", { name: nameOf(property), count: property.filled ?? 0 })} onConfirm={async () => { setErasing(null); await removeProperty(property); }} /></div> : null}
              </li>
            ))}
            {more > 0 || (showAll && (properties?.length ?? 0) > VISIBLE_PROPERTIES) ? (
              <li>
                <button type="button" onClick={() => setShowAll((open) => !open)} className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--ink-strong)]">
                  {showAll ? t("showFewer") : t("showAll", { count: more })}
                </button>
              </li>
            ) : null}
            {canEdit ? (
              <li>
                {addOpen ? (
                  <form className="space-y-3 px-3 py-3" onSubmit={(event) => { event.preventDefault(); void addProperty(); }}>
                    <ArrowField value={newLabel} onChange={setNewLabel} label={t("propertyNameLabel")} placeholder={t("propertyNamePlaceholder")} submitLabel={t("addProperty")} maxLength={80} disabled={adding} takesCursor />
                    <div className="flex items-center gap-3 px-1">
                      <Select look="bare" className={propertySelectClass} ariaLabel={t("propertyTypeLabel")} value={newType} disabled={adding} onChange={(type) => setNewType(type as PropertyType)} options={PROPERTY_TYPES.map((type) => ({ value: type, label: t(`type.${type}`) }))} />
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setEditing(null); setAddOpen(true); }} className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-sm text-[var(--muted)] transition hover:text-[var(--ink-strong)]">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-dashed border-[var(--line)]" aria-hidden="true">＋</span>
                    {t("addPropertyTitle")}
                  </button>
                )}
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {canEdit && properties && properties.length ? (
        <section className="mt-6">
          <h3 className={sectionTitle}>{t("coversTitle")}</h3>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
            <li className="flex min-h-14 items-center justify-between gap-3 px-3.5">
              <span className="text-sm">{t("coverTopLabel")}</span>
              <Select
                look="bare"
                className={propertySelectClass}
                value={selectedCoverTop}
                disabled={coverBusy}
                ariaLabel={t("coverTopLabel")}
                onChange={(next) => void saveCoverTop(next)}
                options={[
                  { value: "none", label: t("coverTopNone") },
                  ...coverProperties.map((property) => ({ value: property.attributeKey ?? property.key, label: nameOf(property) })),
                ]}
              />
            </li>
            <li className="flex min-h-14 items-center justify-between gap-3 px-3.5">
              <span className="text-sm">{t("coverBadgeLabel")}</span>
              <Toggle checked={!coverBadgeHidden} disabled={coverBusy} onChange={(show) => void saveCoverBadgeHidden(!show)} />
            </li>
          </ul>
        </section>
      ) : null}

      {canEdit && onDeleted ? (
        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <div className="flex"><DeleteButton open={deleting} onClick={() => setDeleting((open) => !open)} /></div>
          {deleting ? (
            <div className="mt-3">
              <DeleteConfirm body={itemCount ? t("deleteBodyItems", { count: itemCount }) : t("deleteBodyEmpty")} onConfirm={deleteLibrary} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
