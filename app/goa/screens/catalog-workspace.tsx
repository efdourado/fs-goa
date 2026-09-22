"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { AddCatalogItemDialog } from "../catalog-item-dialogs";
import { KebabMenu, menuRowClass } from "../card-menu";
import { AddItemTile, CatalogRow, CatalogTile, type CatalogGroupBy, groupCatalogItems, LayoutToggle, resolveCoverTop } from "../catalog-views";
import { useCsrf } from "../csrf";
import { ConfirmDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { DeleteLibraryDialog, NewLibraryDialog, LibraryPropertiesDialog, RenameLibraryDialog } from "../library-dialogs";
import {
  type CatalogScope,
  LibraryGlyph,
  useCatalogLibraries,
  useLibraryName,
} from "../libraries";
import { useLibraryProperties } from "../property-inputs";
import { recommenderLine, useRecommenderSource } from "../recommender-picker";
import { Segmented } from "../Segmented";
import { Rail, useShelfRail } from "../shelf";
import type { CatalogItem, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, StatusMessage } from "../ui";
import { formatRuntime } from "../utils";

type Layout = "covers" | "list";
type Sort = "recent" | "title" | "rating" | "date";

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const GridIcon = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></svg>;
const ListIcon = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><path d="M3 4h10M3 8h10M3 12h10" /></svg>;

/** A native select dressed as a chip; it lights up once it narrows the list. */
function ChipSelect({ label, value, onChange, active, children }: { label: string; value: string; onChange: (value: string) => void; active: boolean; children: ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cx(
          "min-h-10 max-w-48 cursor-pointer rounded-full border px-4 text-sm outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
          active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--main-line)]",
        )}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * The catalogue of one space — a person's own or a group's — as a set of
 * libraries. Same screen for both; the group version just gates editing on the
 * viewer being able to manage it.
 */
export function CatalogWorkspaceScreen({
  scope,
  title,
  subtitle,
  backLabel,
  canManage,
  members,
  recommendationsEnabled,
  onBack,
  onOpenItem,
}: {
  scope: CatalogScope;
  title: string;
  subtitle: string;
  backLabel: string;
  canManage: boolean;
  members: Member[];
  recommendationsEnabled: boolean;
  onBack: () => void;
  onOpenItem: (itemId: Id) => void;
}) {
  const t = useTranslations("personalCatalog");
  const tItem = useTranslations("catalog");
  const tl = useTranslations("libraries");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const { data: libraries, error: librariesError, reload: reloadLibraries } = useCatalogLibraries(scope);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsNonce, setItemsNonce] = useState(0);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [recommenderFilter, setRecommenderFilter] = useState("");
  const [layout, setLayout] = useState<Layout>("covers");
  const [sort, setSort] = useState<Sort>("recent");
  const [groupBy, setGroupBy] = useState<CatalogGroupBy>("none");
  const [dialog, setDialog] = useState<"add" | "new" | "rename" | "delete" | "properties" | null>(null);
  // The library a rename / properties / delete dialog is about — not always the one on screen.
  const [dialogKind, setDialogKind] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Tidying up: show only what no challenge holds, tick items, remove them together.
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const { railRef: libraryRailRef, showFade: libraryShowFade, onScroll: onLibraryScroll } = useShelfRail();
  const csrf = useCsrf();
  const source = useRecommenderSource(scope, recommendationsEnabled);
  const scopeId = scope === "personal" ? "personal" : scope.groupId;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.catalogWorkspace(scope).list, { signal: controller.signal })
      .then((response) => { setItems(response.items); setItemsError(null); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems((current) => current ?? []);
        setItemsError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, itemsNonce]);

  const reloadAll = () => { reloadLibraries(); setItemsNonce((value) => value + 1); };

  // Libraries a person can see as cards: the real ones. A built-in (Screens/Pages) shows up once it has an item.
  const tabs: CatalogLibrary[] = useMemo(() => libraries ?? [], [libraries]);
  const isUnused = (item: CatalogItem) => (item.challengeCount ?? item.roundCount ?? 0) === 0;
  const countByKind = useMemo(() => {
    const counts = new Map<string, { total: number; unused: number }>();
    for (const item of items ?? []) {
      const entry = counts.get(item.kind) ?? { total: 0, unused: 0 };
      entry.total += 1;
      if ((item.challengeCount ?? item.roundCount ?? 0) === 0) entry.unused += 1;
      counts.set(item.kind, entry);
    }
    return counts;
  }, [items]);
  const fallbackKind = tabs.length
    ? [...tabs].sort((a, b) => (countByKind.get(b.kind)?.total ?? 0) - (countByKind.get(a.kind)?.total ?? 0))[0].kind
    : null;
  const kind = activeKind && tabs.some((library) => library.kind === activeKind) ? activeKind : fallbackKind;
  const library = tabs.find((entry) => entry.kind === kind) ?? null;
  const dialogLibrary = tabs.find((entry) => entry.kind === dialogKind) ?? null;
  const scoped = useMemo(() => (items ?? []).filter((item) => item.kind === kind), [items, kind]);
  const isBuiltIn = kind === "film" || kind === "book";
  const loading = items === null || libraries === null;
  // A property someone hid stops showing on lists too — the values stay saved.
  const { properties: libraryProperties } = useLibraryProperties(library ? { id: library.id, kind: library.kind } : null, itemsNonce);
  const hidden = useMemo(() => new Set((libraryProperties ?? []).filter((property) => property.hidden).map((property) => property.key)), [libraryProperties]);

  function openLibraryDialog(entry: CatalogLibrary, which: "rename" | "delete" | "properties") {
    setNotice(null);
    setDialogKind(entry.kind);
    setDialog(which);
  }

  function chooseLibrary(next: string) {
    setActiveKind(next);
    setRecommenderFilter("");
    setGroupBy("none");
    setUnusedOnly(false);
  }

  // Who brought things into this library, for the "recommended by" filter.
  const recommenders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of scoped) if (item.recommendedBy) seen.set(`${item.recommendedBy.kind}:${item.recommendedBy.id}`, item.recommendedBy.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped]);
  const activeFilter = recommenderFilter && (recommenderFilter === "none" || recommenders.some(([key]) => key === recommenderFilter)) ? recommenderFilter : "";
  const unusedCount = countByKind.get(kind ?? "")?.unused ?? 0;
  // Once the last unused item is gone the chip goes with it, so the filter can't be left stuck on.
  const onlyUnused = unusedOnly && unusedCount > 0;
  const filtered = useMemo(() => scoped.filter((item) => {
    if (onlyUnused && (item.challengeCount ?? item.roundCount ?? 0) !== 0) return false;
    if (!activeFilter) return true;
    if (activeFilter === "none") return !item.recommendedBy && !item.originNote;
    return item.recommendedBy ? `${item.recommendedBy.kind}:${item.recommendedBy.id}` === activeFilter : false;
  }), [scoped, activeFilter, onlyUnused]);
  // Only offered where the library keeps an event date (a match's kickoff) on its items.
  const hasDates = scoped.some((item) => item.scheduledAt);
  const activeSort: Sort = sort === "date" && !hasDates ? "recent" : sort;
  const startOf = (item: CatalogItem) => (item.scheduledAt ? new Date(item.scheduledAt.startsAt).getTime() : Infinity);
  const addedAt = (item: CatalogItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = useMemo(() => [...filtered].sort((left, right) =>
    activeSort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1) || left.title.localeCompare(right.title)
      : activeSort === "date"
        ? startOf(left) - startOf(right) || left.title.localeCompare(right.title)
        : activeSort === "recent"
          ? addedAt(right) - addedAt(left) || left.title.localeCompare(right.title)
          : left.title.localeCompare(right.title),
  ), [filtered, activeSort]);
  const groups = useMemo(() => groupCatalogItems(sorted, groupBy), [sorted, groupBy]);

  const rated = scoped.filter((item) => item.ratingAvg !== null && item.ratingAvg !== undefined);
  const average = rated.length ? Math.round((rated.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / rated.length) * 100) / 100 : null;

  /** What sets an item apart, minus whatever the cover's top slot already carries (year by default) and who recommended it. */
  function detailsFor(item: CatalogItem): string[] {
    const topSlot = library?.coverTopProperty ?? "year";
    const custom = (item.attributes ?? [])
      .filter((attribute) => attribute.key !== topSlot)
      .map((attribute) => attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
    return [
      topSlot === "scheduled_at" ? null : item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
      hidden.has("author") || topSlot === "author" ? null : item.author,
      hidden.has("main_genre") || topSlot === "main_genre" ? null : item.mainGenre,
      hidden.has("runtime_minutes") || topSlot === "runtime_minutes" ? null : formatRuntime(item.runtimeMinutes),
      ...custom,
    ].filter((part): part is string => Boolean(part));
  }
  const challengesOf = (item: CatalogItem) => item.challengeCount ?? item.roundCount ?? 0;
  const ratingLabel = (item: CatalogItem) => (item.ratingAvg === null || item.ratingAvg === undefined ? tItem("notRated") : tItem("ratedAria", { value: item.ratingAvg }));
  const yearOf = (item: CatalogItem) => (hidden.has("year") ? null : item.year);
  /** The library's own choice for the cover's top slot — falls back to `yearOf` (hidden-aware) when it hasn't picked one. */
  const topOf = (item: CatalogItem) => (library?.coverTopProperty ? resolveCoverTop(item, library.coverTopProperty, f) : yearOf(item));
  function metaFor(item: CatalogItem): string {
    return [
      ...detailsFor(item),
      recommendationsEnabled ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text })) : null,
      isUnused(item) ? t("notInChallenge") : t("rounds", { count: challengesOf(item) }),
    ].filter(Boolean).join(" · ");
  }

  function togglePicked(ids: Id[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) if (on) next.add(id); else next.delete(id);
      return next;
    });
  }
  function stopSelecting() { setSelecting(false); setPicked(new Set()); }
  const pickedHere = sorted.filter((item) => picked.has(item.id));
  const allHerePicked = sorted.length > 0 && pickedHere.length === sorted.length;

  async function removePicked() {
    const ids = pickedHere.map((item) => item.id);
    const result = await apiRequest<{ removed: number; skipped: Array<{ id: Id; title: string | null; reason: string }> }>(API_PATHS.catalogWorkspace(scope).remove, {
      method: "POST", body: { itemIds: ids }, csrfToken: csrf,
    });
    setConfirmingRemoval(false);
    // Tidying often goes in rounds: stay in selection while more unused items are waiting.
    if (onlyUnused && unusedCount - result.removed > 0) setPicked(new Set());
    else stopSelecting();
    setNotice(result.skipped.length ? t("removedSome", { removed: result.removed, skipped: result.skipped.length }) : t("removedMany", { count: result.removed }));
    reloadAll();
  }

  const groupLabel = (label: string) => label || (groupBy === "genre" ? t("noGenre") : t("undated"));
  const narrowed = Boolean(activeFilter || onlyUnused);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel} className="mb-6" />

      <div className="mb-8">
        <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
      </div>

      <StatusMessage error={librariesError ?? itemsError} success={notice} />

      {!loading && tabs.length ? (
        // -mx-1 / px-1 (and scroll-px-1, so snapping keeps it): room for a focus ring at the ends of the rail without moving the first card.
        <nav className="-mx-1 mb-4" aria-label={tl("tabsLabel")}>
          <Rail railRef={libraryRailRef} showFade={libraryShowFade} onScroll={onLibraryScroll} className="scroll-px-1 px-1">
            {tabs.map((entry) => {
              const active = entry.kind === kind;
              const counts = countByKind.get(entry.kind) ?? { total: 0, unused: 0 };
              return (
                <div key={entry.id} className="group relative w-64 flex-none snap-start">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseLibrary(entry.kind)}
                    className={cx(
                      "relative flex min-h-[4.75rem] w-full cursor-pointer items-center gap-3.5 overflow-hidden rounded-[20px] border px-4 text-left shadow-[var(--elevate-card)] transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
                      active ? "border-[var(--main)] bg-[var(--main-soft)] ring-1 ring-inset ring-[var(--main)]" : "border-[var(--line)] bg-[var(--paper)] hover:-translate-y-0.5 hover:border-[var(--main-line)]",
                    )}
                  >
                    <span aria-hidden="true" className={cx("pointer-events-none absolute -bottom-10 -right-10 h-24 w-24 rounded-full border-[14px]", active ? "border-[var(--main)]/[0.13]" : "border-[var(--main)]/[0.07]")} />
                    <span className={cx("relative grid h-11 w-11 flex-none place-items-center rounded-full", active ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-[var(--elevate-1)]" : "bg-[var(--wash)] text-[var(--muted)] ring-1 ring-inset ring-[var(--line)]")} aria-hidden="true">
                      <LibraryGlyph source={entry.source} className="h-6 w-6" />
                    </span>
                    <span className="relative min-w-0">
                      <strong className={cx("block truncate pr-6 text-base font-medium tracking-[-0.02em]", active && "text-[var(--main-strong)]")}>{libraryName(entry)}</strong>
                      <small className={cx("mt-0.5 block truncate text-xs", active ? "text-[var(--main-strong)]/85" : "text-[var(--muted)]")}>
                        {t("libraryStats", { count: counts.total })}
                        {canManage && counts.unused > 0 ? <span className="text-[var(--warn)]"> · {t("libraryUnused", { count: counts.unused })}</span> : null}
                      </small>
                    </span>
                  </button>
                  <div className="absolute right-2.5 top-2.5">
                    <KebabMenu label={tl("libraryActions")}>
                      {(close) => (
                        <>
                          <button type="button" className={menuRowClass} onClick={() => { openLibraryDialog(entry, "properties"); close(); }}>{canManage ? tl("editProperties") : tl("viewProperties")}</button>
                          {canManage ? <button type="button" className={menuRowClass} onClick={() => { openLibraryDialog(entry, "rename"); close(); }}>{tl("renameLibrary")}</button> : null}
                          {canManage && entry.source !== "screens" && entry.source !== "pages" ? <button type="button" className={cx(menuRowClass, "text-[var(--danger)]")} onClick={() => { openLibraryDialog(entry, "delete"); close(); }}>{tl("deleteLibrary")}</button> : null}
                        </>
                      )}
                    </KebabMenu>
                  </div>
                </div>
              );
            })}
            {canManage ? (
              <button
                type="button"
                onClick={() => setDialog("new")}
                className="flex min-h-[4.75rem] w-64 flex-none cursor-pointer snap-start items-center justify-center gap-2 rounded-[20px] border border-dashed border-[var(--muted)] px-4 text-sm font-light text-[var(--muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
              >
                ＋ {tl("newLibrary")}
              </button>
            ) : null}
          </Rail>
        </nav>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : !tabs.length ? (
        <EmptyState
          title={t("emptyTitle")}
          hint={canManage ? t("emptyHint") : undefined}
          action={canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setDialog("add")}>＋ {t("addItem")}</Button>
              <Button variant="secondary" onClick={() => setDialog("new")}>{tl("newLibrary")}</Button>
            </div>
          ) : undefined}
        />
      ) : library ? (
        <section aria-label={libraryName(library)}>
          <div className="flex flex-wrap items-center gap-2.5">
            {scoped.length ? (
              <LayoutToggle<Layout>
                label={t("viewLabel")}
                value={layout}
                onChange={setLayout}
                options={[
                  { value: "covers", label: t("viewCovers"), icon: <GridIcon /> },
                  { value: "list", label: t("viewList"), icon: <ListIcon /> },
                ]}
              />
            ) : null}
            {recommendationsEnabled && recommenders.length ? (
              <ChipSelect label={t("recommenderFilterLabel")} value={activeFilter} onChange={setRecommenderFilter} active={Boolean(activeFilter)}>
                <option value="">{t("recommenderAll")}</option>
                {recommenders.map(([key, name]) => <option key={key} value={key}>{t("recommendedBy", { name })}</option>)}
                <option value="none">{t("recommenderNone")}</option>
              </ChipSelect>
            ) : null}
            {canManage && unusedCount > 0 ? (
              <button
                type="button"
                aria-pressed={onlyUnused}
                onClick={() => { const next = !onlyUnused; setUnusedOnly(next); if (next) setSelecting(true); }}
                className={cx(
                  "min-h-10 cursor-pointer rounded-full border border-dashed px-4 text-sm transition",
                  onlyUnused ? "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]" : "border-[var(--warn-line)] bg-[var(--warn-soft)]/60 text-[var(--warn)] hover:bg-[var(--warn-soft)]",
                )}
              >
                {t("unusedFilter", { count: unusedCount })}
              </button>
            ) : null}
            <span className="flex-1" />
            {canManage && scoped.length ? (
              <button
                type="button"
                aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                className={cx(
                  "min-h-10 cursor-pointer rounded-full border px-4 text-sm transition",
                  selecting ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--main-line)]",
                )}
              >
                {selecting ? t("doneSelecting") : t("select")}
              </button>
            ) : null}
          </div>

          {scoped.length ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--muted)]" aria-live="polite">
                <strong className="font-medium text-[var(--ink)]">{narrowed ? t("resultOf", { shown: sorted.length, total: scoped.length }) : t("resultCount", { count: scoped.length })}</strong>
                {average !== null ? ` · ${t("averageRating", { value: average })}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {isBuiltIn ? (
                  <div className="flex items-center gap-2.5 text-xs text-[var(--muted)]">
                    {t("groupByLabel")}
                    <Segmented<CatalogGroupBy>
                      className="w-64"
                      ariaLabel={t("groupByLabel")}
                      value={groupBy}
                      onChange={setGroupBy}
                      options={[
                        { value: "none", label: t("group.none") },
                        { value: "genre", label: t("group.genre") },
                        { value: "decade", label: t("group.decade") },
                        { value: "year", label: t("group.year") },
                      ]}
                    />
                  </div>
                ) : null}
                <div className="flex items-center gap-2.5 text-xs text-[var(--muted)]">
                  {t("sortLabel")}
                  <Segmented<Sort>
                    className={hasDates ? "w-64" : "w-48"}
                    ariaLabel={t("sortLabel")}
                    value={activeSort}
                    onChange={setSort}
                    options={[
                      { value: "recent", label: t("sortRecent") },
                      { value: "title", label: t("sortTitle") },
                      { value: "rating", label: t("sortRating") },
                      ...(hasDates ? [{ value: "date" as const, label: t("sortDate") }] : []),
                    ]}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {selecting ? (
            <div className="sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)] p-3 shadow-[var(--elevate-1)]" role="region" aria-label={t("selectionBar")}>
              <Button variant="secondary" disabled={!sorted.length} onClick={() => togglePicked(sorted.map((item) => item.id), !allHerePicked)}>
                {allHerePicked ? t("clearSelection") : t("selectAll", { count: sorted.length })}
              </Button>
              <strong className="text-sm font-medium">{t("pickedTally", { count: pickedHere.length })}</strong>
              <span className="flex-1" />
              <Button variant="danger" disabled={!pickedHere.length} onClick={() => setConfirmingRemoval(true)}>{t("removePicked", { count: pickedHere.length })}</Button>
            </div>
          ) : null}

          <div className="mt-5">
            {!scoped.length ? (
              <EmptyState
                title={tl("emptyLibrary", { name: libraryName(library) })}
                onClick={canManage ? () => setDialog("add") : undefined}
              />
            ) : !sorted.length ? (
              <EmptyState title={t("noMatches")} />
            ) : (
              <div className="space-y-10">
                {groups.map((group, index) => (
                  <section key={group.key} aria-label={groupBy === "none" ? undefined : groupLabel(group.label)}>
                    {groupBy !== "none" ? (
                      <h2 className="mb-4 flex items-baseline gap-2.5 text-lg font-light tracking-[-0.02em]">
                        {groupLabel(group.label)}
                        <span className="text-xs text-[var(--muted)]">{group.items.length}</span>
                      </h2>
                    ) : null}
                    {layout === "covers" ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
                        {canManage && !selecting && index === 0 ? <AddItemTile label={t("addItem")} onClick={() => { setNotice(null); setDialog("add"); }} /> : null}
                        {group.items.map((item) => {
                          const unused = isUnused(item);
                          return (
                            <CatalogTile
                              key={item.id}
                              title={item.title}
                              year={topOf(item)}
                              avg={item.ratingAvg}
                              badgeHidden={library?.coverBadgeHidden}
                              ratingLabel={ratingLabel(item)}
                              caption={detailsFor(item).slice(0, 2).join(" · ")}
                              note={unused ? t("notInChallenge") : t("rounds", { count: challengesOf(item) })}
                              noteTone={unused ? "warn" : "muted"}
                              selecting={selecting}
                              picked={picked.has(item.id)}
                              onPick={(on) => togglePicked([item.id], on)}
                              onOpen={() => onOpenItem(item.id)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
                        {group.items.map((item) => (
                          <li key={item.id}>
                            <CatalogRow
                              title={item.title}
                              year={topOf(item)}
                              avg={item.ratingAvg}
                              badgeHidden={library?.coverBadgeHidden}
                              ratingLabel={ratingLabel(item)}
                              meta={metaFor(item)}
                              selecting={selecting}
                              picked={picked.has(item.id)}
                              onPick={(on) => togglePicked([item.id], on)}
                              onOpen={() => onOpenItem(item.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {dialog === "add" ? (
        <AddCatalogItemDialog
          scope={scope}
          libraries={libraries ?? []}
          initialKind={kind}
          members={members}
          recommendationsEnabled={recommendationsEnabled}
          source={source}
          onCancel={() => setDialog(null)}
          onAdded={({ reused }) => {
            setDialog(null);
            setNotice(reused ? t("reusedNotice") : t("addedNotice"));
            reloadAll();
          }}
        />
      ) : null}
      {dialog === "new" ? (
        <NewLibraryDialog
          scope={scope}
          onCancel={() => setDialog(null)}
          onCreated={(made) => { setDialog(null); chooseLibrary(made.kind); reloadAll(); }}
        />
      ) : null}
      {dialog === "rename" && dialogLibrary ? (
        <RenameLibraryDialog library={dialogLibrary} onCancel={() => setDialog(null)} onRenamed={() => { setDialog(null); reloadLibraries(); }} />
      ) : null}
      {dialog === "delete" && dialogLibrary ? (
        <DeleteLibraryDialog
          library={dialogLibrary}
          itemCount={countByKind.get(dialogLibrary.kind)?.total ?? 0}
          onCancel={() => setDialog(null)}
          onDeleted={(name) => {
            setDialog(null);
            if (dialogLibrary.kind === kind) { chooseLibrary(""); stopSelecting(); }
            setNotice(tl("deleted", { name }));
            reloadAll();
          }}
        />
      ) : null}
      {dialog === "properties" && dialogLibrary ? (
        <LibraryPropertiesDialog scope={scope} library={dialogLibrary} canEdit={canManage} onClose={() => setDialog(null)} onChanged={reloadAll} />
      ) : null}
      {confirmingRemoval ? (
        <ConfirmDialog
          title={t("removeManyTitle", { count: pickedHere.length })}
          body={t("removeManyBody")}
          confirmLabel={t("removeManyConfirm", { count: pickedHere.length })}
          busyLabel={tc("saving")}
          danger
          onClose={() => setConfirmingRemoval(false)}
          onConfirm={removePicked}
        />
      ) : null}
    </main>
  );
}
