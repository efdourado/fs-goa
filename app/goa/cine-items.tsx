"use client";

import { StateButton } from "./state-button";

import { useTranslations } from "next-intl";
import { type ComponentProps, useEffect, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { Dialog, FormDialog, ModalActions } from "./dialog";
import { canOrganise, OrganiseDialog, organiseFromRows } from "./organize-panel";
import { type CatalogScope, useCatalogShelf } from "./libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, useLibrariesProperties, useNativePropertyName } from "./property-inputs";
import type { CatalogItem, ChallengeItemInput, ChallengeLibraryRef, Id, LibraryProperty, Member } from "./types";
import { Button, ChevronIcon, CircleMinusIcon, cx, FaceEmptyState, inputClass, labelClass, rowIconClass, Field, Select, SlidersIcon } from "./ui";
import { formatRuntime } from "./utils";
import { useGoaFormat } from "./format";

export interface CineRow {
  key: string;
  title: string;
  catalogItemId?: Id;
  /** The library the item belongs to (`libraryId` is null for a built-in that has no row yet). */
  libraryKind: string;
  libraryId: Id | null;
  author: string;
  year: string;
  pages: string;
  /** Films/series only, in minutes. */
  runtimeMinutes: string;
  mainGenre: string;
  /** The item's own date and time (a match's kickoff), as the event inputs hold it — blank when it has none. */
  /** What was typed into a custom library's own properties, by `LibraryProperty.key`. */
  extra: PropertyValues;
  /** The same values as the request wants them, by the property's storage key — kept in step with `extra` by the editor. */
  attributes: Record<string, string | number | boolean>;
}

function newCineRow(title = "", extra: Partial<CineRow> = {}): CineRow {
  return {
    key: crypto.randomUUID(),
    title,
    libraryKind: "",
    libraryId: null,
    author: "",
    year: "",
    pages: "",
    runtimeMinutes: "",
    mainGenre: "",
    extra: {},
    attributes: {},
    ...extra,
  };
}

export function cineRowsToInput(rows: CineRow[]): ChallengeItemInput[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.title.trim())
    .map(({ row, index }) => {
      const year = Number(row.year);
      const pages = Number(row.pages);
      const runtimeMinutes = Number(row.runtimeMinutes);
      return {
        title: row.title.trim(),
        position: index,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.libraryId ? { libraryId: row.libraryId } : row.libraryKind ? { libraryKind: row.libraryKind } : {}),
        ...(row.author.trim() ? { author: row.author.trim() } : {}),
        ...(Number.isInteger(year) && year > 1800 ? { year } : {}),
        ...(Number.isInteger(pages) && pages > 0 ? { pageCount: pages } : {}),
        ...(Number.isInteger(runtimeMinutes) && runtimeMinutes > 0 ? { runtimeMinutes } : {}),
        ...(row.mainGenre.trim() ? { mainGenre: row.mainGenre.trim() } : {}),
        ...(Object.keys(row.attributes).length ? { attributes: row.attributes } : {}),
      };
    });
}

/** The row fields that back a library's built-in properties, by the property's key. */
const NATIVE_ROW_FIELD = {
  author: "author", year: "year", main_genre: "mainGenre", page_count: "pages", runtime_minutes: "runtimeMinutes",
} as const;

function rowValues(row: CineRow): PropertyValues {
  return {
    author: row.author, year: row.year, main_genre: row.mainGenre, page_count: row.pages, runtime_minutes: row.runtimeMinutes,
    ...row.extra,
  };
}

/** Whether a book row is still missing the author its library asks for. */
function authorMissing(row: CineRow, properties: LibraryProperty[] | undefined): boolean {
  if (row.libraryKind !== "book" || !row.title.trim() || row.author.trim()) return false;
  return properties?.find((property) => property.key === "author")?.hidden !== true;
}

type EditorLibrary = Pick<ChallengeLibraryRef, "id" | "kind" | "source" | "label">;

/** A row for a catalogue item being put into a challenge, carrying what the catalogue already knows about it. */
function rowFromCatalog(item: CatalogItem): CineRow {
  return newCineRow(item.title, {
    catalogItemId: item.id,
    author: item.author ?? "",
    year: item.year ? String(item.year) : "",
    pages: item.pageCount ? String(item.pageCount) : "",
    runtimeMinutes: item.runtimeMinutes ? String(item.runtimeMinutes) : "",
    mainGenre: item.mainGenre ?? "",
  });
}

/**
 * Checking an item places it directly in the dialog's draft.
 */
function CatalogPicker({ items, used, selected, onSelect }: {
  items: CatalogItem[] | null;
  used: ReadonlySet<Id | undefined>;
  selected: ReadonlySet<Id | undefined>;
  onSelect: (items: CatalogItem[], checked: boolean) => void;
}) {
  const t = useTranslations("cineItems");
  const [query, setQuery] = useState("");
  if (items === null) return <p role="status" className="px-3 py-2 text-sm text-[var(--muted)]">{t("loadingCatalog")}</p>;
  if (!items.length) return <p className="px-3 py-2 text-sm text-[var(--muted)]">{t("emptyCatalog")}</p>;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => [item.title, item.author, item.mainGenre].some((text) => text?.toLowerCase().includes(needle)))
    : items;
  const selectable = visible.filter((item) => !used.has(item.id));
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)]">
      <div className="space-y-2 border-b border-[var(--line)] p-2">
        <input
          className={cx(inputClass, "min-h-10")}
          type="search"
          value={query}
          placeholder={t("catalogSearch")}
          aria-label={t("catalogSearch")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
        />
        {selectable.length > 1 ? (
          <label className="flex min-h-9 cursor-pointer items-center gap-3 px-2 text-sm text-[var(--muted)]">
            <input type="checkbox" className="h-4 w-4 flex-none" checked={allSelected} onChange={(event) => onSelect(selectable, event.target.checked)} />
            {t("selectAll", { count: selectable.length })}
          </label>
        ) : null}
      </div>
      <ul className="max-h-52 overflow-y-auto p-1">
        {visible.length ? visible.map((item) => {
          const taken = used.has(item.id);
          return (
            <li key={item.id}>
              <label className={cx("flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--wash)]", taken && "cursor-not-allowed opacity-40")}>
                <input type="checkbox" className="h-4 w-4 flex-none" checked={taken || selected.has(item.id)} disabled={taken} onChange={(event) => onSelect([item], event.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{[item.year, item.author, item.mainGenre, formatRuntime(item.runtimeMinutes)].filter((value) => value !== null && value !== undefined && value !== "").join(" · ")}</span>
                </span>
                <span className="flex-none text-xs text-[var(--muted)]">{taken ? t("alreadyAdded") : t("roundsCount", { count: item.roundCount ?? 0 })}</span>
              </label>
            </li>
          );
        }) : <li className="p-2 text-xs text-[var(--muted)]">{t("catalogNoMatch")}</li>}
      </ul>
    </div>
  );
}

interface EditorShared {
  members: Member[];
  /** Whose catalogue the "from catalogue" picker reads — a group's or the caller's own. */
  scope: CatalogScope;
  /** The challenge's library (one per challenge); the first entry is used. */
  libraries: readonly EditorLibrary[];
  /** Bump to re-read the library's properties after they were edited elsewhere. */
  refreshKey?: number;
  /** The zone a new event date starts in — the browser's when left out. */
  timeZone?: string;
}

/** The library's properties as the editor offers them, and what would block saving a set of rows. */
function useEditorProperties({ libraries, refreshKey = 0 }: Pick<EditorShared, "libraries" | "refreshKey">) {
  const loaded = useLibrariesProperties(libraries, refreshKey);
  const propertiesFor = (library: Pick<EditorLibrary, "id" | "kind">): LibraryProperty[] | undefined => loaded.get(library.kind);
  const problemOf = (rows: CineRow[]): "author" | null => rows.some((row) => authorMissing(row, loaded.get(row.libraryKind))) ? "author" : null;
  return { loaded, propertiesFor, problemOf };
}

/**
 * Every property of the given rows, one card each: the name and the library properties (each with its
 * label), and the rest folded under "+N more" at the bottom of the card.
 */
function RowCards({ rows, onChange, onRemove, shared, openByDefault = false, unboxed = false, titleInput }: {
  rows: CineRow[];
  onChange: (row: CineRow) => void;
  onRemove?: (key: string) => void;
  shared: EditorShared;
  /** Show every property straight away (editing one item), instead of behind "details". */
  openByDefault?: boolean;
  /** A single-item editing modal already provides its own container. */
  unboxed?: boolean;
  /** The blank row in the add dialog also accepts a pasted list of titles. */
  titleInput?: Pick<ComponentProps<"input">, "ref" | "onPaste" | "maxLength" | "placeholder" | "aria-invalid"> & { label: string };
}) {
  const t = useTranslations("cineItems");
  const { propertiesFor } = useEditorProperties(shared);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const propertyName = useNativePropertyName();
  const target = shared.libraries[0];
  const update = (row: CineRow, patch: Partial<CineRow>) => onChange({ ...row, ...patch });
  function setRowProperty(row: CineRow, propertyKey: string, propertyValue: string) {
    const nativeField = NATIVE_ROW_FIELD[propertyKey as keyof typeof NATIVE_ROW_FIELD];
    if (nativeField) {
      update(row, { [nativeField]: propertyValue });
      return;
    }
    const custom = (propertiesFor({ id: row.libraryId, kind: row.libraryKind }) ?? []).filter((property) => property.storage === "attribute" && !property.hidden);
    const extra = { ...row.extra, [propertyKey]: propertyValue };
    update(row, { extra, attributes: bodyFromValues(custom, extra, "create").attributes as CineRow["attributes"] });
  }
  if (!target || !rows.length) return null;
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const open = openByDefault || expanded.has(row.key);
        const properties = propertiesFor({ id: row.libraryId, kind: row.libraryKind || target.kind });
        const authorInline = row.libraryKind === "book" && properties?.find((property) => property.key === "author")?.hidden !== true;
        const detailProperties = editableProperties(properties ?? []).filter((property) => !(authorInline && property.key === "author"));
        const hiddenCount = detailProperties.length;
        const hasDetails = !openByDefault && hiddenCount > 0 && (!titleInput || row.title.trim());
        // A property's name as the library calls it (it may have been renamed), or the usual one.
        const nameOf = (key: string, fallback: string) => {
          const property = properties?.find((entry) => entry.key === key);
          return property ? propertyName(property) : fallback;
        };
        const topRight = authorInline ? (
          <label className="block">
            <span className={labelClass}>{nameOf("author", t("author"))}</span>
            <input className={cx(inputClass, authorMissing(row, properties) ? "border-[var(--danger)]" : "")} value={row.author} maxLength={200} placeholder={t("authorPlaceholder")} onChange={(event) => update(row, { author: event.target.value })} />
          </label>
        ) : null;
        return (
          <li className={unboxed ? undefined : "rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3"} key={row.key}>
            <div className={cx("grid items-end gap-2", topRight ? (onRemove ? "sm:grid-cols-[1.6fr_1fr_auto]" : "sm:grid-cols-[1.6fr_1fr]") : onRemove ? "grid-cols-[1fr_auto]" : "")}>
              <label className="block min-w-0">
                <span className={labelClass}>{titleInput?.label ?? nameOf("title", t("nameLabel"))}</span>
                <input className={inputClass} value={row.title} maxLength={titleInput?.maxLength ?? 200} placeholder={titleInput?.placeholder ?? t("titlePlaceholder")} ref={titleInput?.ref} onPaste={titleInput?.onPaste} aria-invalid={titleInput?.["aria-invalid"]} onChange={(event) => update(row, { title: event.target.value, catalogItemId: undefined })} />
              </label>
              {topRight}
              {onRemove ? (
                <StateButton type="button" className={cx(rowIconClass, "mb-1.5 text-[var(--danger)] hover:text-[var(--danger)]")} aria-label={t("remove")} title={t("remove")} onClick={() => onRemove(row.key)}><CircleMinusIcon className="h-[18px] w-[18px]" /></StateButton>
              ) : null}
            </div>
            {open ? (
              <div className="mt-2 space-y-3">
                {detailProperties.length ? (
                  <PropertyInputs properties={detailProperties} values={rowValues(row)} onChange={(propertyKey, propertyValue) => setRowProperty(row, propertyKey, propertyValue)} />
                ) : null}
              </div>
            ) : null}
            {/* The rest of the item's properties, folded at the foot of the card: "+3 mais". */}
            {hasDetails ? (
              <StateButton type="button" className="mt-2 min-h-9 cursor-pointer rounded-full px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>
                {open ? t("hideDetails") : t("moreDetails", { count: hiddenCount })}
              </StateButton>
            ) : null}
            <span className="sr-only">{index + 1}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** One line about an item under its title in the list: author, year, length, genre. */
function useRowSummary() {
  const t = useTranslations("cineItems");
  return (row: CineRow): string => {
    const bits: string[] = [];
    if (row.author) bits.push(row.author);
    if (row.year) bits.push(row.year);
    const runtime = formatRuntime(Number(row.runtimeMinutes) || null);
    if (runtime) bits.push(runtime);
    if (row.pages) bits.push(t("pagesCount", { count: Number(row.pages) }));
    if (row.mainGenre) bits.push(row.mainGenre);
    return bits.join(" · ");
  };
}

/** The add dialog used while creating a challenge and when adding to a saved challenge. */
function ItemsDraftDialog({ existing = [], onSave, onClose, note, checkpoints, ...shared }: EditorShared & {
  existing?: CineRow[];
  onSave: (rows: CineRow[], stageId: Id | null) => void | Promise<void>;
  onClose: () => void;
  note?: string;
  checkpoints?: Array<{ id: Id; title: string }>;
}) {
  const t = useTranslations("cineItems");
  const tStages = useTranslations("checkpointPlanner");
  const f = useGoaFormat();
  const target = shared.libraries[0];
  const library = { libraryId: target?.id ?? null, libraryKind: target?.kind ?? "" };
  const [pending, setPending] = useState(() => newCineRow("", library));
  const [draft, setDraft] = useState<CineRow[]>([]);
  const [stageId, setStageId] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[] | "error" | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const { problemOf } = useEditorProperties(shared);
  const shelf = useCatalogShelf(shared.scope);
  const collectionCount = target ? shelf?.counts?.[target.kind] : undefined;
  const catalogPath = API_PATHS.catalogWorkspace(shared.scope).list;

  useEffect(() => {
    if (!showCatalog) return;
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(catalogPath, { signal: controller.signal })
      .then(({ items }) => { if (!controller.signal.aborted) setCatalog(items); })
      .catch(() => { if (!controller.signal.aborted) setCatalog("error"); });
    return () => controller.abort();
  }, [showCatalog, catalogPath]);

  const hasTitle = Boolean(pending.title.trim());
  const titleKey = (title: string) => title.trim().toLowerCase();
  const knownTitles = new Set([...existing, ...draft].map((row) => titleKey(row.title)));
  const duplicate = hasTitle && knownTitles.has(titleKey(pending.title));
  const used = new Set(existing.map((row) => row.catalogItemId));
  const selected = new Set(draft.map((row) => row.catalogItemId));
  const rows = (hasTitle ? [...draft, pending] : draft).filter((row) => row.title.trim());
  const problem = problemOf(rows);
  const canSave = Boolean(target && rows.length && !problem && !duplicate);

  function pasteTitles(titles: string[]) {
    const seen = new Set(knownTitles);
    if (hasTitle) seen.add(titleKey(pending.title));
    const fresh = titles.filter((title) => {
      const key = titleKey(title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setSkipped(titles.length - fresh.length);
    setDraft((current) => [...current, ...fresh.map((title) => newCineRow(title, library))]);
  }

  function selectCatalog(items: CatalogItem[], checked: boolean) {
    const ids = new Set(items.map((item) => item.id));
    setDraft((current) => {
      if (!checked) return current.filter((row) => !row.catalogItemId || !ids.has(row.catalogItemId));
      const currentIds = new Set(current.map((row) => row.catalogItemId));
      return [...current, ...items.filter((item) => !currentIds.has(item.id)).map((item) => ({ ...rowFromCatalog(item), ...library }))];
    });
  }

  return (
    <FormDialog
      title={t("addItems")}
      stickyActions
      dirty={draft.length > 0 || hasTitle || Boolean(pending.author.trim())}
      busy={busy}
      error={error ?? (duplicate ? t("duplicateTitle") : problem === "author" ? t("authorRequired") : null)}
      onCancel={onClose}
      submitDisabled={!canSave}
      submitLabel={t("addCount", { count: rows.length })}
      onSubmit={async () => {
        if (!canSave || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onSave(rows, stageId || null);
        } catch (cause) {
          setError(f.error(cause));
          setBusy(false);
        }
      }}
    >
      {target ? <>
        <RowCards
          rows={[pending]}
          shared={shared}
          unboxed
          onChange={setPending}
          titleInput={{
            label: t("typeLabel"),
            placeholder: t("typePlaceholder"),
            maxLength: 160,
            ref: titleRef,
            "aria-invalid": duplicate || undefined,
            onPaste: (event) => {
              const titles = event.clipboardData.getData("text").split(/\r?\n/).map((title) => title.trim()).filter(Boolean);
              if (titles.length < 2) return;
              event.preventDefault();
              pasteTitles(titles);
            },
          }}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StateButton
            type="button"
            aria-expanded={showCatalog}
            onClick={() => { if (!showCatalog) setCatalog(null); setShowCatalog(!showCatalog); }}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-[var(--main-strong)] hover:underline"
          >
            {collectionCount ? t("fromCatalogCount", { count: collectionCount }) : t("fromCatalog")}
            <ChevronIcon dir={showCatalog ? "up" : "down"} />
          </StateButton>
          {hasTitle ? <StateButton type="button" disabled={duplicate} className="min-h-9 cursor-pointer rounded-lg text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:underline disabled:cursor-not-allowed disabled:opacity-60" onClick={() => {
            setDraft((current) => [...current, pending]);
            setPending(newCineRow("", library));
            titleRef.current?.focus();
          }}>{t("addAnotherTitle")}</StateButton> : null}
        </div>
        {showCatalog ? catalog === "error" ? <p role="alert" className="text-sm text-[var(--danger)]">{t("catalogLoadError")}</p> : (
          <CatalogPicker items={catalog?.filter((item) => item.kind === target.kind) ?? null} used={used} selected={selected} onSelect={selectCatalog} />
        ) : null}
        {skipped ? <p className="text-xs text-[var(--muted)]" aria-live="polite">{t("skippedDuplicates", { count: skipped })}</p> : null}
        {draft.length ? (
          <RowCards
            rows={draft}
            shared={shared}
            onChange={(row) => setDraft((current) => current.map((candidate) => candidate.key === row.key ? row : candidate))}
            onRemove={(key) => setDraft((current) => current.filter((row) => row.key !== key))}
          />
        ) : null}
      </> : null}
      {checkpoints?.length ? <Field label={tStages("stageWord")}><Select ariaLabel={tStages("stageWord")} value={stageId} onChange={setStageId} options={[{ value: "", label: tStages("unassigned") }, ...checkpoints.map((stage) => ({ value: stage.id, label: stage.title }))]} /></Field> : null}
      {note ? <p className="text-xs leading-5 text-[var(--muted)]">{note}</p> : null}
    </FormDialog>
  );
}

export function AddItemsDialog({ onAdd, checkpoints, ...props }: EditorShared & {
  onAdd: (items: ChallengeItemInput[]) => Promise<void>;
  onClose: () => void;
  note?: string;
  checkpoints?: Array<{ id: Id; title: string }>;
}) {
  return <ItemsDraftDialog {...props} checkpoints={checkpoints} onSave={(rows, stageId) => {
    const items = cineRowsToInput(rows);
    return onAdd(checkpoints?.length ? items.map((item) => ({ ...item, checkpointId: stageId })) : items);
  }} />;
}

export function CineItemsEditor({
  value,
  onChange,
  onProblem,
  addDialogOpen,
  onAddDialogOpenChange,
  showAddButton = true,
  ...shared
}: EditorShared & {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  /** Reports whether a book is missing its required author. */
  onProblem?: (problem: "author" | null) => void;
  /** Lets a surrounding heading own the add button while this editor still owns the dialog. */
  addDialogOpen?: boolean;
  onAddDialogOpenChange?: (open: boolean) => void;
  /** False when the surrounding page heading already provides the + control. */
  showAddButton?: boolean;
}) {
  const t = useTranslations("cineItems");
  const { problemOf, loaded } = useEditorProperties(shared);
  const tOrganise = useTranslations("organise");
  const summary = useRowSummary();
  const [organising, setOrganising] = useState(false);
  const organiseInput = organiseFromRows(value, loaded.get(shared.libraries[0]?.kind ?? "") ?? [], (key) => tOrganise(`property.${key}`));
  const problem = problemOf(value);
  useEffect(() => { onProblem?.(problem); }, [problem, onProblem]);
  const [localAdding, setLocalAdding] = useState(false);
  const adding = addDialogOpen ?? localAdding;
  const setAdding = onAddDialogOpenChange ?? setLocalAdding;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = value.find((row) => row.key === editingKey) ?? null;
  const flagged = (row: CineRow) => problemOf([row]) !== null;
  if (!shared.libraries[0]) return null;

  return (
    <div>
      {value.length || showAddButton ? (
        <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
          {value.length ? <p className="text-sm font-medium">{t("listCount", { count: value.length })}</p> : <span />}
          <div className="ml-auto flex items-center gap-2">
            {canOrganise(organiseInput) ? <Button variant="secondary" className="min-h-9" onClick={() => setOrganising(true)}>{tOrganise("button")}</Button> : null}
            {showAddButton ? <StateButton
              type="button"
              onClick={() => setAdding(true)}
              aria-label={t("addItems")}
              title={t("addItems")}
              className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            </StateButton> : null}
          </div>
        </div>
      ) : null}
      {value.length ? (
        <ol className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
          {value.map((row, index) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 flex-none text-right text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{row.title || t("untitled")}</span>
                {summary(row) ? <span className="block truncate text-xs text-[var(--muted)]">{summary(row)}</span> : null}
                {flagged(row) ? <span className="block text-xs text-[var(--danger)]">{t("needsAttention")}</span> : null}
              </span>
              <StateButton type="button" className={rowIconClass} aria-label={t("edit")} title={t("edit")} onClick={() => setEditingKey(row.key)}><SlidersIcon className="h-[18px] w-[18px]" /></StateButton>
              <StateButton type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} aria-label={t("remove")} title={t("remove")} onClick={() => onChange(value.filter((candidate) => candidate.key !== row.key))}><CircleMinusIcon className="h-[18px] w-[18px]" /></StateButton>
            </li>
          ))}
        </ol>
      ) : (
        <div className="grid justify-items-center pb-3">
          <FaceEmptyState title={t("emptyList")} compact />
        </div>
      )}

      {adding ? (
        <ItemsDraftDialog
          {...shared}
          existing={value}
          onClose={() => setAdding(false)}
          onSave={(rows) => { onChange([...value, ...rows]); setAdding(false); }}
        />
      ) : null}

      {organising ? (
        <OrganiseDialog
          input={organiseInput}
          onClose={() => setOrganising(false)}
          onApply={(order) => {
            const byKey = new Map(value.map((row) => [row.key, row]));
            onChange(order.map((key) => byKey.get(key)!).filter(Boolean));
            setOrganising(false);
          }}
        />
      ) : null}

      {editing ? (
        <Dialog title={editing.title || t("untitled")} onClose={() => setEditingKey(null)}>
          <RowCards rows={[editing]} shared={shared} openByDefault unboxed onChange={(row) => onChange(value.map((candidate) => (candidate.key === row.key ? row : candidate)))} />
          <ModalActions className="mt-4"><Button onClick={() => setEditingKey(null)}>{t("doneEditing")}</Button></ModalActions>
        </Dialog>
      ) : null}
    </div>
  );
}
