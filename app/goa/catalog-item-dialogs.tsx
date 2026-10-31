"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useCsrf } from "./csrf";
import { FormDialog } from "./dialog";
import { ItemEditorDialog } from "./item-editor-dialog";
import { useGoaFormat } from "./format";
import { type CatalogScope, LibraryPills, libraryChoices, librarySuggestions } from "./libraries";
import {
  bodyFromValues,
  PropertyInputs,
  type PropertyValues,
  useLibraryProperties,
} from "./property-inputs";
import type { CatalogItemDetail, CatalogLibrary, Id } from "./types";
import { Button, Field, inputClass } from "./ui";

interface PossibleMatch {
  id: Id;
  title: string;
  year: number | null;
  author: string | null;
}

/** Film/book look items up by title and merge on their own; every other library asks first. */
const AUTO_MATCH = new Set(["film", "book"]);

/**
 * Add one item to a library, with the choice made explicit: type a title, see
 * what's already there, and either reuse it or create a new one. Screens and
 * Pages (films and books) keep matching a repeated title on their own, exactly
 * as they always have — for those the list is only a heads-up.
 */
export function AddCatalogItemDialog({
  scope,
  libraries,
  initialKind,
  onCancel,
  onAdded,
}: {
  scope: CatalogScope;
  libraries: CatalogLibrary[];
  initialKind?: string | null;
  onCancel: () => void;
  onAdded: (result: { id: Id; reused: boolean }) => void;
}) {
  const t = useTranslations("catalogAdd");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const choices = useMemo(() => libraryChoices(libraries), [libraries]);
  const suggestions = useMemo(() => librarySuggestions(libraries), [libraries]);
  // Nothing is chosen for someone with no library yet: they pick a suggestion to start one.
  const [kind, setKind] = useState<string | null>(() => (initialKind && choices.some((choice) => choice.kind === initialKind) ? initialKind : choices[0]?.kind ?? null));
  const choice = [...choices, ...suggestions].find((entry) => entry.kind === kind) ?? null;
  const { properties, error: propertiesError } = useLibraryProperties(choice);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<PropertyValues>({});
  // Suggestions are remembered with the query they answer, so a stale list never shows under a newer title.
  const [found, setFound] = useState<{ query: string; libraryKey: string; items: PossibleMatch[] }>({ query: "", libraryKey: "", items: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoMatch = kind !== null && AUTO_MATCH.has(kind);

  // What already looks like this title — refreshed a beat after typing stops.
  const query = title.trim();
  const libraryKey = choice ? `${choice.id ?? ""}:${choice.kind}` : "";
  useEffect(() => {
    if (query.length < 2 || !choice) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const path = API_PATHS.catalogWorkspace(scope).search(choice.id ? { libraryId: choice.id, title: query } : { kind: choice.kind, title: query });
      apiRequest<{ items: PossibleMatch[] }>(path, { signal: controller.signal })
        .then((response) => setFound({ query, libraryKey, items: response.items }))
        .catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, libraryKey, choice, scope]);
  const matches = query.length >= 2 && found.query === query && found.libraryKey === libraryKey ? found.items : [];

  const dirty = Boolean(title.trim()) || Object.values(values).some(Boolean);

  async function submit(useExistingId?: Id) {
    const name = title.trim();
    if (!name && !useExistingId) { setError(t("titleRequired")); return; }
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const { native, attributes } = bodyFromValues(properties ?? [], values, "create");
      const body: Record<string, unknown> = {
        ...(choice.id ? { libraryId: choice.id } : { kind: choice.kind }),
        title: name || matches.find((match) => match.id === useExistingId)?.title,
        ...(useExistingId ? { useExistingId } : { ...native, ...(Object.keys(attributes).length ? { attributes } : {}) }),
      };
      const created = await apiRequest<{ id: Id }>(API_PATHS.catalogWorkspace(scope).items, { method: "POST", body, csrfToken: csrf });
      onAdded({ id: created.id, reused: Boolean(useExistingId) });
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={t("title")}
      dirty={dirty}
      busy={busy}
      error={error ?? propertiesError}
      onCancel={onCancel}
      onSubmit={() => submit()}
      submitLabel={t("add")}
      submitDisabled={!properties || !choice}
    >
      {choices.length + suggestions.length > 1 ? (
        <Field label={t("libraryLabel")} plain>
          <LibraryPills
            choices={choices}
            suggestions={suggestions}
            kind={kind}
            label={t("libraryLabel")}
            onPick={(entry) => { setKind(entry.kind); setValues({}); }}
          />
        </Field>
      ) : null}

      <Field label={t("titleLabel")}>
        <input
          className={inputClass}
          value={title}
          maxLength={300}
          required
          placeholder={t("titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      {matches.length ? (
        <div className="rounded-2xl border border-[var(--warn-line)] bg-[var(--warn-soft)]/60 p-4">
          <h3 className="text-sm font-medium text-[var(--warn)]">{autoMatch ? t("matchesAutoTitle") : t("matchesTitle")}</h3>
          <p className="mb-3 mt-0.5 text-xs leading-5 text-[var(--muted)]">{autoMatch ? t("matchesAutoBody") : t("matchesBody")}</p>
          <ul className="space-y-1.5">
            {matches.map((match) => (
              <li key={match.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--paper)] px-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  <span className="block truncate">{match.title}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{[match.year, match.author].filter((value) => value !== null && value !== undefined && value !== "").join(" · ")}</span>
                </span>
                {autoMatch ? null : (
                  <Button variant="secondary" className="min-h-9 flex-none" disabled={busy} onClick={() => void submit(match.id)}>{t("useThis")}</Button>
                )}
              </li>
            ))}
          </ul>
          {autoMatch ? null : <p className="mt-3 text-xs text-[var(--muted)]">{t("orCreateNew")}</p>}
        </div>
      ) : null}

      {properties ? <PropertyInputs properties={properties} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} /> : (
        <p className="text-sm text-[var(--muted)]">{t("loadingProperties")}</p>
      )}

    </FormDialog>
  );
}

/** Edit an item's title, its library's properties and where it came from — one form whether a property is a built-in column or a custom one. */
export function EditCatalogItemDialog({
  scope,
  item,
  libraries,
  onCancel,
  onSaved,
  onRemove,
}: {
  scope: CatalogScope;
  item: CatalogItemDetail;
  libraries: CatalogLibrary[];
  onCancel: () => void;
  onSaved: () => void;
  /** Takes the item out of the catalogue (to the bin). Offered at the foot of the form, after a second click. */
  onRemove?: () => Promise<void>;
}) {
  const tCat = useTranslations("catalog");
  const csrf = useCsrf();
  const library = libraryChoices(libraries).find((entry) => entry.kind === item.kind) ?? null;
  return (
    <ItemEditorDialog
      item={item}
      library={library}
      maxTitleLength={300}
      onCancel={onCancel}
      onSave={async (body) => {
        await apiRequest(API_PATHS.catalogWorkspace(scope).item(item.id), { method: "PATCH", body, csrfToken: csrf });
        onSaved();
      }}
      onRemove={onRemove ? { body: tCat("removeBody", { title: item.title }), onConfirm: onRemove } : undefined}
    />
  );
}
