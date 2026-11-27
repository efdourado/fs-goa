"use client";

import { StateButton } from "./state-button";

import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { API_PATHS, ApiError, apiRequest } from "./api";
import { useCsrf } from "./csrf";
import { DeleteButton, DeleteConfirm, Dialog, FormDialog } from "./dialog";
import { useGoaFormat } from "./format";
import { type CatalogScope, type CatalogShelfData, useLibraryName } from "./libraries";
import { RecipeIcon } from "./recipe-icons";
import type { CatalogAttributeDef, CatalogLibrary, LibraryProperty } from "./types";
import { Button, CircleCheckIcon, CircleMinusIcon, Field, inputClass, ListMoreButton, Select, StatusMessage } from "./ui";

type PropertyType = LibraryProperty["type"];
const PROPERTY_TYPES: PropertyType[] = ["text", "number", "minutes", "date", "boolean"];
/** What the property form edits: a name, a type and, for a number, the unit it is counted in. */
interface PropertyDraft { label: string; type: PropertyType; unit: string }
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
  const name = label.trim();

  async function submit() {
    if (busy) return;
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
      dirty={Boolean(name)}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitDisabled={!name}
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
    <StateButton
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-25"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d={dir === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </StateButton>
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
  itemCount,
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
  /** Present where the library can be deleted from here. */
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
  // The property open in the form, by key; `addOpen` opens the same form empty.
  const [editing, setEditing] = useState<string | null>(null);
  // Its name, edited in place like a property's: saved on blur or Enter.
  const currentName = libraryName(library);
  const [name, setName] = useState(currentName);
  const [nameBusy, setNameBusy] = useState(false);
  // Four properties are enough to recognise a library by; the rest unfold on demand.
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [loadedItemCount, setLoadedItemCount] = useState<number | null>(null);
  const deleteCount = itemCount ?? loadedItemCount;
  const shelfPath = API_PATHS.catalogWorkspace(scope).shelf;

  useEffect(() => {
    if (!deleting || itemCount !== undefined) return;
    const controller = new AbortController();
    apiRequest<Pick<CatalogShelfData, "counts">>(shelfPath, { signal: controller.signal })
      .then(({ counts }) => {
        if (!controller.signal.aborted) setLoadedItemCount(counts[library.kind] ?? 0);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDeleting(false);
        setError(f.error(cause));
      });
    return () => controller.abort();
  }, [deleting, itemCount, shelfPath, library.kind, f]);

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
    setDeleteBusy(true);
    try {
      await apiRequest(`${API_PATHS.catalogLibrary(library.id)}?deleteItems=1`, { method: "DELETE", csrfToken: csrf });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "library_busy") {
        const listed = (cause.details as { challenges?: unknown } | undefined)?.challenges;
        const names = Array.isArray(listed) ? listed.filter((title): title is string => typeof title === "string") : [];
        if (names.length) throw new Error(t("deleteBusy", { names: names.join(", ") }));
      }
      throw cause;
    } finally {
      setDeleteBusy(false);
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

  async function saveProperty(property: LibraryProperty, draft: PropertyDraft) {
    const unit = draft.type === "number" ? draft.unit.trim() || null : null;
    await apiRequest(API_PATHS.libraryProperty(library.id, property.key), {
      method: "PATCH",
      csrfToken: csrf,
      body: {
        label: draft.label.trim(),
        ...(draft.type !== property.type ? { type: draft.type } : {}),
        ...(property.storage === "native" || unit === (property.unit ?? null) ? {} : { unit }),
      },
    });
    setEditing(null);
    await load();
    onChanged();
    setSuccess(t("propertySaved"));
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

  async function addProperty(draft: PropertyDraft) {
    await apiRequest<CatalogAttributeDef>(API_PATHS.catalogWorkspace(scope).attributes, {
      method: "POST",
      csrfToken: csrf,
      body: { libraryId: library.id, label: draft.label.trim(), type: draft.type, ...(draft.type === "number" && draft.unit.trim() ? { unit: draft.unit.trim() } : {}) },
    });
    setAddOpen(false);
    await load();
    onChanged();
    setSuccess(t("propertyAdded"));
  }


  const sectionTitle = "mb-2.5 text-[13px] font-medium text-[var(--ink)]";
  const shown = properties ? (showAll ? properties : properties.slice(0, VISIBLE_PROPERTIES)) : [];
  const more = properties ? properties.length - shown.length : 0;
  const typeIcon = (type: PropertyType) => (
    type === "boolean" ? (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="5.8" /><path d="M5.6 8.2l1.7 1.700 3.200-3.500" />
      </svg>
    ) : type === "number" ? "123" : type === "minutes" ? "h" : type === "date" ? "31" : "Aa"
  );

  return (
    <Dialog title={currentName} onClose={onClose} busy={busyKey !== null || nameBusy || deleteBusy}>
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
          {!canEdit ? <span className="text-xs text-[var(--muted)]">{t("propertiesReadOnly")}</span> : null}
        </div>
        {properties === null ? (
          <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)]">
            {shown.map((property, index) => (
              <li key={property.key} className="px-3 py-2.5 transition-colors hover:bg-[var(--wash)] focus-within:bg-[var(--wash)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--wash)] text-[11px] font-medium text-[var(--muted)]" aria-hidden="true">{typeIcon(property.type)}</span>
                  <StateButton type="button" disabled={!canEdit || busyKey !== null} aria-expanded={editing === property.key} onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setAddOpen(false);
                    setEditing((current) => current === property.key ? null : property.key);
                  }} className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 text-left text-sm font-medium disabled:cursor-default">
                    <span className="block truncate">{nameOf(property)}</span>
                    {property.unit ? <span className="block truncate text-xs font-normal text-[var(--muted)]">{property.unit}</span> : null}
                  </StateButton>
                  {canEdit ? (
                    <div className="flex flex-none items-center">
                      <ArrowButton dir="up" label={t("moveUp")} disabled={index === 0 || busyKey !== null} onClick={() => void move(index, -1)} />
                      <ArrowButton dir="down" label={t("moveDown")} disabled={index === (properties?.length ?? 0) - 1 || busyKey !== null} onClick={() => void move(index, 1)} />
                      {property.canHide ? <StateButton type="button" aria-label={t("removeProperty")} title={t("removeProperty")} disabled={busyKey !== null} onClick={() => askRemove(property)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-25"><CircleMinusIcon className="h-4 w-4" /></StateButton> : null}
                    </div>
                  ) : null}
                </div>
                {editing === property.key ? (
                  <div className="pb-1 pt-3">
                    <PropertyForm
                      key={property.key}
                      title={t("propertyFormEdit")}
                      submitLabel={tc("save")}
                      initial={{ label: nameOf(property), type: property.type, unit: property.unit ?? "" }}
                      typeLock={property.storage === "native" ? t("propertyTypeBuiltIn") : (property.filled ?? 0) > 0 ? t("propertyTypeHasValues") : null}
                      onCancel={() => setEditing(null)}
                      onSubmit={(draft) => saveProperty(property, draft)}
                    />
                  </div>
                ) : null}
                {erasing === property.key ? <div className="mt-3"><DeleteConfirm body={t("eraseBody", { name: nameOf(property), count: property.filled ?? 0 })} onConfirm={async () => { setErasing(null); await removeProperty(property); }} /></div> : null}
              </li>
            ))}
            {more > 0 || (showAll && (properties?.length ?? 0) > VISIBLE_PROPERTIES) ? (
              <li>
                <ListMoreButton onClick={() => setShowAll((open) => !open)}>
                  {showAll ? t("showFewer") : t("showAll", { count: more })}
                </ListMoreButton>
              </li>
            ) : null}
            {canEdit ? (
              <li>
                {addOpen ? (
                  <div className="p-3">
                    <PropertyForm
                      title={t("propertyFormAdd")}
                      submitLabel={t("addProperty")}
                      initial={{ label: "", type: "text", unit: "" }}
                      onCancel={() => setAddOpen(false)}
                      onSubmit={addProperty}
                    />
                  </div>
                ) : (
                  <StateButton type="button" onClick={() => { setError(null); setSuccess(null); setEditing(null); setAddOpen(true); }} className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-sm text-[var(--muted)] transition hover:text-[var(--ink-strong)]">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-dashed border-[var(--line)]" aria-hidden="true">＋</span>
                    {t("addPropertyTitle")}
                  </StateButton>
                )}
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {canEdit && onDeleted ? (
        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <div className="flex"><DeleteButton open={deleting} disabled={deleteBusy} onClick={() => {
            setLoadedItemCount(null);
            setError(null);
            setDeleting(!deleting);
          }} /></div>
          {deleting ? (
            <div className="mt-3">
              {deleteCount === null ? <p role="status" className="text-sm text-[var(--muted)]">{t("loading")}</p> : (
                <DeleteConfirm body={deleteCount ? t("deleteBodyItems", { count: deleteCount }) : t("deleteBodyEmpty")} onConfirm={deleteLibrary} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

    </Dialog>
  );
}

/**
 * Add or edit one property right inside the library's modal, in the same little form a challenge adds a field
 * with: a name and a type side by side and, for a number, the unit it is counted in ("km"), only shown beside
 * each value. Minutes are typed as minutes and shown in hours ("2h12"). A built-in column keeps its type, and a
 * property that already holds values keeps its type.
 */
function PropertyForm({ title, submitLabel, initial, typeLock = null, onCancel, onSubmit }: {
  title: string;
  submitLabel: string;
  initial: PropertyDraft;
  /** Why the type can't change here, or `null` when it can. */
  typeLock?: string | null;
  onCancel: () => void;
  onSubmit: (draft: PropertyDraft) => Promise<void>;
}) {
  const t = useTranslations("libraries");
  const tf = useTranslations("fields");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picking minutes names a nameless property "Duração"; it renames it back while the name is still that suggestion.
  const minutesName = t("minutesName");
  function pickType(type: PropertyType) {
    const label = draft.label.trim();
    const next = type === "minutes" && !label ? minutesName : type !== "minutes" && label === minutesName && initial.label !== minutesName ? "" : draft.label;
    setDraft({ ...draft, type, label: next });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.label.trim()) { setError(t("propertyNameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <form className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-4" onSubmit={(event) => void submit(event)}>
      <p className="mb-3 text-sm font-light text-[var(--ink)]">{title}</p>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label><span className="sr-only">{t("propertyNameLabel")}</span><input className={inputClass} value={draft.label} maxLength={80} required placeholder={t("propertyNamePlaceholder")} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <Select ariaLabel={t("propertyTypeLabel")} value={draft.type} disabled={Boolean(typeLock)} onChange={(type) => pickType(type as PropertyType)} options={PROPERTY_TYPES.map((type) => ({ value: type, label: t(`type.${type}`) }))} />
        {typeLock ? <p className="text-xs text-[var(--muted)] sm:col-span-2">{typeLock}</p> : null}
        {draft.type === "number" ? (
          <Field className="sm:col-span-2" label={tf("unit")} optional>
            <input className={inputClass} value={draft.unit} maxLength={12} placeholder={t("unitPlaceholder")} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
          </Field>
        ) : null}
        {error ? <div className="sm:col-span-2"><StatusMessage error={error} /></div> : null}
        <div className="flex items-center justify-end gap-1 sm:col-span-2">
          <StateButton type="button" onClick={onCancel} className="h-9 cursor-pointer rounded-full px-3.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]">{tc("cancel")}</StateButton>
          <StateButton type="submit" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--ink)] pl-3 pr-4 text-sm font-medium text-[var(--canvas)] transition hover:opacity-90 disabled:opacity-40">
            <CircleCheckIcon className="h-4 w-4" />
            {busy ? tc("saving") : submitLabel}
          </StateButton>
        </div>
      </fieldset>
    </form>
  );
}
