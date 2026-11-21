"use client";

import { StateButton } from "./state-button";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useCatalogPropertyText } from "./catalog-views";
import { Dialog, FormDialog, ModalActions } from "./dialog";
import { canOrganise, OrganiseDialog, organiseFromRows } from "./organize-panel";
import { MAX_CHALLENGE_ITEM_BATCH } from "../../lib/goa/domain/item-limits";
import { type CatalogScope, useCatalogShelf } from "./libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, useLibrariesProperties, useNativePropertyName, valuesFromItem } from "./property-inputs";
import type { CatalogItem, ChallengeItemInput, ChallengeLibraryRef, Id, LibraryProperty, Member } from "./types";
import { ArrowField, Button, CatalogIcon, ChevronIcon, CircleMinusIcon, cx, FaceEmptyState, inputClass, labelClass, rowIconClass, Field, Select, SlidersIcon } from "./ui";
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
  /** Saved custom values when the row reuses an existing catalog item. */
  catalogAttributes?: CatalogItem["attributes"];
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

function rowValues(row: CineRow, properties: LibraryProperty[]): PropertyValues {
  return {
    author: row.author, year: row.year, main_genre: row.mainGenre, page_count: row.pages, runtime_minutes: row.runtimeMinutes,
    ...(row.catalogItemId ? valuesFromItem(properties.filter((property) => property.storage === "attribute"), { attributes: row.catalogAttributes }) : {}),
    ...row.extra,
  };
}

type EditorLibrary = Pick<ChallengeLibraryRef, "id" | "kind" | "source" | "label">;

/** A row for a catalogue item being put into a challenge, carrying what the catalogue already knows about it. */
function rowFromCatalog(item: CatalogItem): CineRow {
  return newCineRow(item.title, {
    catalogItemId: item.id,
    catalogAttributes: item.attributes,
    author: item.author ?? "",
    year: item.year ? String(item.year) : "",
    pages: item.pageCount ? String(item.pageCount) : "",
    runtimeMinutes: item.runtimeMinutes ? String(item.runtimeMinutes) : "",
    mainGenre: item.mainGenre ?? "",
  });
}

function focusCatalogSearch(input: HTMLInputElement | null) {
  input?.focus();
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
  const tCatalog = useTranslations("personalCatalog");
  const propertyText = useCatalogPropertyText();
  const [query, setQuery] = useState("");
  if (items === null) return <p role="status" className="px-3 py-2 text-sm text-[var(--muted)]">{t("loadingCatalog")}</p>;
  if (!items.length) return <FaceEmptyState title={tCatalog("emptyTitle")} compact />;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => [item.title, item.author, item.mainGenre].some((text) => text?.toLowerCase().includes(needle)))
    : items;
  const selectable = visible.filter((item) => !used.has(item.id));
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));

  return (
    <>
      <div className="space-y-2 border-b border-[var(--line)] p-2">
        <input
          ref={focusCatalogSearch}
          className={cx(inputClass, "min-h-10 focus:border-[color-mix(in_srgb,var(--control-line),var(--muted)_45%)]! focus:ring-0!")}
          type="search"
          value={query}
          placeholder={t("catalogSearch")}
          aria-label={t("catalogSearch")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
        />
        {selectable.length > 1 ? (
          <label className="flex min-h-9 cursor-pointer items-center gap-3 pl-1 pr-2 text-sm text-[var(--muted)]">
            <input type="checkbox" className="h-4 w-4 flex-none" checked={allSelected} onChange={(event) => onSelect(selectable, event.target.checked)} />
            {t("selectAll", { count: selectable.length })}
          </label>
        ) : null}
      </div>
      <ul className="max-h-52 overflow-y-auto p-1">
        {visible.length ? visible.map((item) => {
          const taken = used.has(item.id);
          const count = item.challengeCount ?? item.roundCount ?? 0;
          const note = taken ? t("alreadyAdded") : t("roundsCount", { count });
          return (
            <li key={item.id}>
              <label className={cx("grid min-h-10 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--wash)]", taken && "cursor-not-allowed opacity-40")}>
                <input type="checkbox" className="row-span-2 h-4 w-4" checked={taken || selected.has(item.id)} disabled={taken} onChange={(event) => onSelect([item], event.target.checked)} />
                <span className="truncate">{item.title}</span>
                <span className="truncate text-xs text-[var(--muted)]">{[...propertyText(item), note].join(" · ")}</span>
              </label>
            </li>
          );
        }) : <li className="p-2 text-xs text-[var(--muted)]">{t("catalogNoMatch")}</li>}
      </ul>
    </>
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

const VISIBLE_CARD_PROPERTIES = 3;

/** Item cards show the title and a preview of the library's editable properties. */
function RowCards({ rows, onChange, onRemove, shared, openByDefault = false, unboxed = false }: {
  rows: CineRow[];
  onChange: (row: CineRow) => void;
  onRemove?: (key: string) => void;
  shared: EditorShared;
  /** Show every property straight away (editing one item), instead of behind "details". */
  openByDefault?: boolean;
  /** A single-item editing modal already provides its own container. */
  unboxed?: boolean;
}) {
  const t = useTranslations("cineItems");
  const propertiesByKind = useLibrariesProperties(shared.libraries, shared.refreshKey);
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
    const custom = (propertiesByKind.get(row.libraryKind) ?? []).filter((property) => property.storage === "attribute" && !property.hidden);
    const extra = { ...row.extra, [propertyKey]: propertyValue };
    update(row, { extra, attributes: bodyFromValues(custom, extra, "create").attributes as CineRow["attributes"] });
  }
  if (!target || !rows.length) return null;
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const open = openByDefault || expanded.has(row.key);
        const properties = propertiesByKind.get(row.libraryKind || target.kind);
        const detailProperties = editableProperties(properties ?? []);
        const shown = open ? detailProperties : detailProperties.slice(0, VISIBLE_CARD_PROPERTIES);
        const extraCount = detailProperties.length - VISIBLE_CARD_PROPERTIES;
        const titleProperty = properties?.find((property) => property.key === "title");
        return (
          <li className={unboxed ? undefined : "rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3"} key={row.key}>
            {onRemove && !row.catalogItemId ? (
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--ink)]">{t("itemNumber", { number: index + 1 })}</span>
                <StateButton type="button" className={cx(rowIconClass, "text-[var(--danger)] hover:text-[var(--danger)]")} aria-label={t("remove")} title={t("remove")} onClick={() => onRemove(row.key)}><CircleMinusIcon className="h-[18px] w-[18px]" /></StateButton>
              </div>
            ) : null}
            <label className="block min-w-0">
              <span className={labelClass}>{titleProperty ? propertyName(titleProperty) : t("nameLabel")}</span>
              <input className={inputClass} value={row.title} maxLength={200} placeholder={t("titlePlaceholder")} onChange={(event) => update(row, { title: event.target.value, catalogItemId: undefined })} />
            </label>
            {shown.length > 0 ? (
              <div className="mt-2">
                <PropertyInputs properties={shown} values={rowValues(row, shown)} onChange={(propertyKey, propertyValue) => setRowProperty(row, propertyKey, propertyValue)} />
              </div>
            ) : null}
            {!openByDefault && extraCount > 0 ? (
              <StateButton type="button" className="mt-2 min-h-9 cursor-pointer rounded-full px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>
                {open ? t("hideDetails") : t("moreProperties", { count: extraCount })}
              </StateButton>
            ) : null}
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
  const tCatalogAdd = useTranslations("catalogAdd");
  const tErrors = useTranslations("errors.byCode");
  const format = useFormatter();
  const f = useGoaFormat();
  const catalogPanelId = useId();
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
  const manualRows = draft.filter((row) => !row.catalogItemId);
  const rows = hasTitle ? [...draft, pending] : draft;
  const missingTitle = draft.some((row) => !row.title.trim());
  const exceedsBatch = existing.length + rows.length > MAX_CHALLENGE_ITEM_BATCH;
  const canSave = Boolean(target && rows.length && !duplicate && !missingTitle && !exceedsBatch);

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
      dirty={draft.length > 0 || hasTitle}
      busy={busy}
      error={error ?? (missingTitle ? tCatalogAdd("titleRequired") : duplicate ? t("duplicateTitle") : null)}
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
      {exceedsBatch ? <p role="alert" className="text-sm text-[var(--danger)]">{tErrors("challenge_item_batch_limit")}</p> : null}
      {target ? <>
        <div className="min-w-0">
          <span className={labelClass}>{t("typeLabel")}</span>
          <ArrowField
            value={pending.title}
            onChange={(title) => setPending((row) => ({ ...row, title }))}
            label={t("typeLabel")}
            submitLabel={t("addItemRow")}
            submitDisabled={duplicate}
            placeholder={t("typePlaceholder")}
            maxLength={160}
            aria-invalid={duplicate || undefined}
            onAction={() => {
              setDraft((current) => [...current, pending]);
              setPending(newCineRow("", library));
            }}
            onPaste={(event) => {
              const titles = event.clipboardData.getData("text").split(/\r?\n/).map((title) => title.trim()).filter(Boolean);
              if (titles.length < 2) return;
              event.preventDefault();
              pasteTitles(titles);
            }}
          />
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
          <StateButton
            type="button"
            aria-expanded={showCatalog}
            aria-controls={catalogPanelId}
            aria-label={collectionCount ? t("fromCatalogCount", { count: collectionCount }) : undefined}
            onClick={() => { if (!showCatalog) setCatalog(null); setShowCatalog(!showCatalog); }}
            className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)] aria-expanded:bg-[var(--wash)]"
          >
            <CatalogIcon className="size-[17px] flex-none" />
            <span className="min-w-0 flex-1 font-medium">{t("fromCatalog")}</span>
            {collectionCount ? <span aria-hidden="true" className="shrink-0 rounded-full bg-[var(--wash-strong)] px-2 py-0.5 text-xs tabular-nums">{format.number(collectionCount)}</span> : null}
            <ChevronIcon dir={showCatalog ? "up" : "down"} className="size-4 flex-none" />
          </StateButton>
          <div id={catalogPanelId} hidden={!showCatalog} className="border-t border-[var(--line)]">
            {showCatalog ? catalog === "error" ? <p role="alert" className="px-3 py-2 text-sm text-[var(--danger)]">{t("catalogLoadError")}</p> : (
              <CatalogPicker items={catalog?.filter((item) => item.kind === target.kind) ?? null} used={used} selected={selected} onSelect={selectCatalog} />
            ) : null}
          </div>
        </div>
        {skipped ? <p className="text-xs text-[var(--muted)]" aria-live="polite">{t("skippedDuplicates", { count: skipped })}</p> : null}
        {manualRows.length ? (
          <RowCards
            rows={manualRows}
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
  addDialogOpen,
  onAddDialogOpenChange,
  showAddButton = true,
  ...shared
}: EditorShared & {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  /** Lets a surrounding heading own the add button while this editor still owns the dialog. */
  addDialogOpen?: boolean;
  onAddDialogOpenChange?: (open: boolean) => void;
  /** False when the surrounding page heading already provides the + control. */
  showAddButton?: boolean;
}) {
  const t = useTranslations("cineItems");
  const propertiesByKind = useLibrariesProperties(shared.libraries, shared.refreshKey);
  const tOrganise = useTranslations("organise");
  const propertyName = useNativePropertyName();
  const summary = useRowSummary();
  const [organising, setOrganising] = useState(false);
  const organiseInput = organiseFromRows(value, propertiesByKind, shared.libraries[0]?.kind ?? "", propertyName, rowValues);
  const [localAdding, setLocalAdding] = useState(false);
  const adding = addDialogOpen ?? localAdding;
  const setAdding = onAddDialogOpenChange ?? setLocalAdding;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = value.find((row) => row.key === editingKey) ?? null;
  if (!shared.libraries[0]) return null;

  return (
    <div>
      {value.length || showAddButton ? (
        <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
          {value.length ? <p className="text-sm font-medium">{t("listCount", { count: value.length })}</p> : <span />}
          <div className="ml-auto flex items-center gap-2">
            {canOrganise(organiseInput) ? <Button variant="secondary" onClick={() => setOrganising(true)}>{tOrganise("button")}</Button> : null}
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
