"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useGoaFormat } from "./format";
import type { CatalogItem, Id, LibraryProperty } from "./types";
import { Field, inputClass } from "./ui";

/** Values typed into a library's property fields, by `LibraryProperty.key`. Booleans are `"true"` / `"false"` / `""`. */
export type PropertyValues = Record<string, string>;

const NATIVE_FIELD: Record<string, { field: keyof CatalogItem; body: string; integer: boolean }> = {
  author: { field: "author", body: "author", integer: false },
  year: { field: "year", body: "year", integer: true },
  main_genre: { field: "mainGenre", body: "mainGenre", integer: false },
  page_count: { field: "pageCount", body: "pageCount", integer: true },
  runtime_minutes: { field: "runtimeMinutes", body: "runtimeMinutes", integer: true },
};

/** What a film/book library offers before it has ever been saved — the built-in columns, in their usual order. */
export function builtInProperties(kind: string): LibraryProperty[] {
  const keys = kind === "film"
    ? [["title", "text"], ["year", "number"], ["main_genre", "text"], ["runtime_minutes", "number"]]
    : kind === "book"
      ? [["title", "text"], ["author", "text"], ["year", "number"], ["main_genre", "text"], ["page_count", "number"]]
      : [["title", "text"]];
  return keys.map(([key, type], position) => ({
    key, type: type as LibraryProperty["type"], storage: "native" as const, label: null, hidden: false, position, canHide: key !== "title",
  }));
}

/**
 * What a Tables library starts with. The server seeds these three under these
 * exact keys the first time a Tables library is created, so a challenge can send
 * values for them before that library exists; once it does, the real (possibly
 * renamed or hidden) properties are read from it instead.
 */
export const TABLES_STARTER_KEYS = ["cozinha", "bairro", "endereco"] as const;

export function tablesStarterProperties(label: (key: (typeof TABLES_STARTER_KEYS)[number]) => string): LibraryProperty[] {
  return TABLES_STARTER_KEYS.map((key, position) => ({
    key, attributeKey: key, storage: "attribute" as const, label: label(key), type: "text" as const, hidden: false, position: position + 10, canHide: true,
  }));
}

/**
 * A library's properties as saved — or, for a built-in library nobody has used
 * yet (no row to read), its known columns. `properties` is `null` while loading.
 */
export function useLibraryProperties(choice: { id: Id | null; kind: string } | null, refreshKey = 0): { properties: LibraryProperty[] | null; error: string | null } {
  const f = useGoaFormat();
  const [loaded, setLoaded] = useState<{ id: Id; properties: LibraryProperty[]; error: string | null } | null>(null);
  const id = choice?.id ?? null;
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiRequest<{ properties: LibraryProperty[] }>(API_PATHS.libraryProperties(id), { signal: controller.signal })
      .then((response) => setLoaded({ id, properties: response.properties, error: null }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLoaded({ id, properties: [], error: f.error(cause) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refreshKey]);
  if (!choice) return { properties: null, error: null };
  // A built-in library nobody has used yet has no row to read — its columns are known up front.
  if (!id) return { properties: builtInProperties(choice.kind), error: null };
  return loaded?.id === id ? { properties: loaded.properties, error: loaded.error } : { properties: null, error: null };
}

/**
 * The properties of several libraries at once, by library kind — what a challenge
 * that combines libraries needs so each row can offer its own library's fields. A
 * library with no row yet (a built-in nobody has used) gets its known columns; one
 * still loading is simply absent from the map.
 */
export function useLibrariesProperties(
  libraries: ReadonlyArray<{ id: Id | null; kind: string }>,
  refreshKey = 0,
): Map<string, LibraryProperty[]> {
  const [loaded, setLoaded] = useState<{ refreshKey: number; byId: Record<Id, LibraryProperty[]> }>({ refreshKey, byId: {} });
  const ids = libraries.flatMap((library) => (library.id ? [library.id] : [])).join(",");
  useEffect(() => {
    const controller = new AbortController();
    for (const id of ids ? ids.split(",") : []) {
      apiRequest<{ properties: LibraryProperty[] }>(API_PATHS.libraryProperties(id), { signal: controller.signal })
        .then((response) => setLoaded((current) => ({
          refreshKey, byId: { ...(current.refreshKey === refreshKey ? current.byId : {}), [id]: response.properties },
        })))
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [ids, refreshKey]);
  const map = new Map<string, LibraryProperty[]>();
  for (const library of libraries) {
    if (!library.id) map.set(library.kind, builtInProperties(library.kind));
    else if (loaded.byId[library.id]) map.set(library.kind, loaded.byId[library.id]);
  }
  return map;
}

/** A property's name as shown: whatever the library renamed it to, else its default. */
export function useNativePropertyName(): (property: Pick<LibraryProperty, "key" | "label" | "storage">) => string {
  const t = useTranslations("libraries");
  return (property) => property.label?.trim() || (property.storage === "native" && t.has(`native.${property.key}`) ? t(`native.${property.key}`) : property.key);
}

/** The editable, visible properties of a library — everything except the title, which has its own field. */
export function editableProperties(properties: LibraryProperty[]): LibraryProperty[] {
  return properties.filter((property) => !property.hidden && property.key !== "title");
}

export function valuesFromItem(properties: LibraryProperty[], item: Pick<CatalogItem, "author" | "year" | "mainGenre" | "pageCount" | "runtimeMinutes" | "attributes">): PropertyValues {
  const values: PropertyValues = {};
  for (const property of properties) {
    if (property.storage === "native") {
      const native = NATIVE_FIELD[property.key];
      const raw = native ? item[native.field as "year"] : undefined;
      values[property.key] = raw === null || raw === undefined ? "" : String(raw);
    } else {
      const saved = item.attributes?.find((attribute) => attribute.key === property.attributeKey);
      values[property.key] = saved === undefined ? "" : String(saved.value);
    }
  }
  return values;
}

/**
 * The request body for a set of property values. For a brand-new item a blank is
 * simply left out; for an edit it is sent as an explicit clear, because a
 * missing key means "leave it alone".
 */
export function bodyFromValues(
  properties: LibraryProperty[],
  values: PropertyValues,
  mode: "create" | "update",
): { native: Record<string, string | number | null>; attributes: Record<string, string | number | boolean | null> } {
  const native: Record<string, string | number | null> = {};
  const attributes: Record<string, string | number | boolean | null> = {};
  for (const property of properties) {
    if (property.hidden || property.key === "title") continue;
    const raw = (values[property.key] ?? "").trim();
    if (property.storage === "native") {
      const spec = NATIVE_FIELD[property.key];
      if (!spec) continue;
      if (!raw) { if (mode === "update") native[spec.body] = spec.integer ? null : ""; continue; }
      native[spec.body] = spec.integer ? Number(raw) : raw;
      continue;
    }
    const key = property.attributeKey ?? property.key;
    if (!raw) { if (mode === "update") attributes[key] = ""; continue; }
    attributes[key] = property.type === "number" ? Number(raw) : property.type === "boolean" ? raw === "true" : raw;
  }
  return { native, attributes };
}

export function PropertyInputs({
  properties,
  values,
  onChange,
  disabled = false,
}: {
  properties: LibraryProperty[];
  values: PropertyValues;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const tc = useTranslations("common");
  const name = useNativePropertyName();
  const visible = editableProperties(properties);
  if (!visible.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visible.map((property) => {
        const value = values[property.key] ?? "";
        const label = name(property);
        return (
          <Field key={property.key} label={label} optional>
            {property.type === "boolean" ? (
              <select className={inputClass} value={value} disabled={disabled} onChange={(event) => onChange(property.key, event.target.value)}>
                <option value="" />
                <option value="true">{tc("yes")}</option>
                <option value="false">{tc("no")}</option>
              </select>
            ) : (
              <input
                className={inputClass}
                type={property.type === "number" ? "number" : property.type === "date" ? "date" : "text"}
                inputMode={property.type === "number" ? "numeric" : undefined}
                value={value}
                disabled={disabled}
                maxLength={property.type === "text" ? 500 : undefined}
                onChange={(event) => onChange(property.key, event.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
