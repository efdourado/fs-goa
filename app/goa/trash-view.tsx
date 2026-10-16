"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { ConfirmDialog, Dialog } from "./dialog";
import type { Id, TrashActionPreview, TrashItem } from "./types";
import { Button, cardClass, cx, EmptyState, LoadingView, PageHeading, StatusMessage } from "./ui";

type Scope = "personal" | { groupId: Id } | { challengeId: Id };

type TrashResponse = { items?: TrashItem[]; structure?: TrashItem[]; entries?: TrashItem[] };

export function trashRows(scope: "personal" | "group" | "challenge", data: TrashResponse): TrashItem[] {
  if (scope !== "challenge") return data.items ?? [];
  return [...(data.structure ?? []), ...(data.entries ?? [])];
}

export function TrashLoadState({ loading, error, onRetry }: {
  loading: boolean; error: string | null; onRetry: () => void;
}) {
  const t = useTranslations("trash");
  const tc = useTranslations("common");
  if (error) return <div className="space-y-3"><StatusMessage error={error} /><Button variant="secondary" onClick={onRetry}>{tc("retry")}</Button></div>;
  if (loading) return <LoadingView label={t("loading")} />;
  return <EmptyState title={t("emptyTitle")} />;
}

function scopeListPath(scope: Scope): string {
  if (scope === "personal") return API_PATHS.personalTrash;
  if ("groupId" in scope) return API_PATHS.groupTrash(scope.groupId);
  return API_PATHS.challengeArchive(scope.challengeId);
}

function dependencySentence(item: TrashItem, t: ReturnType<typeof useTranslations>): string {
  if (!item.dependencies.length) return "";
  return item.dependencies
    .map((dep) => t(`dependency.${dep.type}`, { count: dep.count }))
    .join(" · ");
}

function PurgeDialog({
  preview,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  preview: TrashActionPreview;
  busy: boolean;
  error: string | null;
  onConfirm: (confirmation: string, reason: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trash");
  const tc = useTranslations("common");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const entries = preview.dependencies.find((dep) => dep.type === "entries")?.count ?? 0;
  const needsReason = preview.kind === "entry";

  return (
    <Dialog title={t("purgeTitle", { label: preview.label })} busy={busy} onClose={onCancel}>
      <p className="text-sm text-[var(--muted)]">{t("purgeBody")}</p>

      {preview.blocked ? (
        <p className="mt-2 text-xs text-[var(--muted)]">{preview.blocked.message}</p>
      ) : (
        <>
          {preview.dependencies.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {preview.dependencies.map((dep) => (
                <li key={dep.type} className="flex justify-between border-b border-[var(--line)] py-1">
                  <span className="text-[var(--muted)]">{t(`dependency.${dep.type}`, { count: dep.count })}</span>
                  <span className="tabular-nums">{dep.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("purgeNoDeps")}</p>
          )}

          {preview.confirmation === "name" ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-sm">{t("confirmName", { name: preview.label })}</span>
              <input className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label={t("confirmName", { name: preview.label })} />
            </label>
          ) : preview.confirmation === "count" && entries > 0 ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-sm">{t("confirmCount", { count: entries })}</span>
              <input className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm" inputMode="numeric" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label={t("confirmCount", { count: entries })} />
            </label>
          ) : null}

          {needsReason ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-sm">{t("reasonLabel")}</span>
              <input className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} aria-label={t("reasonLabel")} />
            </label>
          ) : null}
        </>
      )}

      <div className="mt-4"><StatusMessage error={error} /></div>
      {!preview.blocked && (
        <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-4">
          <Button variant="danger" onClick={() => onConfirm(preview.confirmation === "count" && entries === 0 ? "0" : confirmation.trim(), reason.trim())} disabled={busy}>
            {busy ? t("purging") : tc("delete")}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The recoverable-deletion bin (docs/architecture.md › Lixeira e recuperação). One list, three scopes: the
 * personal workspace, a group, or a challenge's removed structure. Nothing here
 * expires — an item stays until it is restored or permanently deleted.
 */
export function TrashView({
  scope,
  csrfToken,
  onChanged,
  title,
  description,
}: {
  scope: Scope;
  csrfToken: string;
  /** The page's heading: drawn here so "Empty the bin" can sit on its line. */
  title: string;
  description?: string;
  onChanged?: () => void;
}) {
  const t = useTranslations("trash");
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ preview: TrashActionPreview } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [kept, setKept] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const emptyScope = scope === "personal" || "groupId" in scope
    ? (scope as "personal" | { groupId: Id })
    : null;

  const listPath = scopeListPath(scope);
  const listKind = scope === "personal" ? "personal" : "groupId" in scope ? "group" : "challenge";

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setItems(null);
    apiRequest<TrashResponse>(listPath, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(trashRows(listKind, data));
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message || t("loadError"));
      });
    return () => requestRef.current?.abort();
  }, [listPath, listKind, t]);

  // Reset the previous request's state when the remote scope changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(load, [load]);

  const rows = items ?? [];

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await apiRequest(API_PATHS.trashRestore(scope), { method: "POST", csrfToken, body: { kind: item.kind, id: item.id } });
      load();
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message || t("restoreError"));
    } finally {
      setBusyId(null);
    }
  }

  async function openPurge(item: TrashItem) {
    setBusyId(item.id);
    setError(null);
    try {
      const preview = await apiRequest<TrashActionPreview>(API_PATHS.trashPreview(scope), {
        method: "POST", csrfToken, body: { kind: item.kind, id: item.id },
      });
      setDialog({ preview });
      setDialogError(null);
    } catch (cause) {
      setError((cause as Error).message || t("previewError"));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmPurge(confirmation: string, reason: string) {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await apiRequest(API_PATHS.trashPurge(scope), {
        method: "POST", csrfToken,
        body: { kind: dialog.preview.kind, id: dialog.preview.id, confirmation, ...(reason ? { reason } : {}) },
      });
      setDialog(null);
      load();
      onChanged?.();
    } catch (cause) {
      setDialogError((cause as Error).message || t("purgeError"));
    } finally {
      setDialogBusy(false);
    }
  }

  async function emptyBin() {
    if (!emptyScope) return;
    const result = await apiRequest<{ purged: number; skipped: number }>(
      API_PATHS.trashEmpty(emptyScope), { method: "POST", csrfToken, body: {} },
    );
    setEmptyOpen(false);
    setKept(result.skipped > 0 ? result.skipped : null);
    setError(null);
    load();
    onChanged?.();
  }

  const trashGlyph = (size: string) => (
    <svg viewBox="0 0 16 16" className={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 4.2h10.4M6.2 4.2V2.9c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.3M4.2 4.2l.6 8.6c0 .6.5 1 1.1 1h4.2c.6 0 1.1-.4 1.1-1l.6-8.6M6.8 7v4.2M9.2 7v4.2" />
    </svg>
  );
  // "Empty the bin" on the title's line: just red text, only when there's something to empty.
  const heading = (
    <PageHeading
      title={title}
      description={description}
      action={emptyScope && rows.length ? (
        <button type="button" onClick={() => setEmptyOpen(true)} disabled={busyId !== null} className="min-h-10 flex-none cursor-pointer self-start text-sm text-[var(--danger)] transition hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--danger)]/20 sm:self-auto">
          {t("empty")}
        </button>
      ) : undefined}
    />
  );

  if (!rows.length) {
    return (
      <div className="space-y-3">
        {heading}
        {kept != null ? <p className="text-xs text-[var(--muted)]">{t("emptyKept", { count: kept })}</p> : null}
        <TrashLoadState loading={items === null} error={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {heading}
      <StatusMessage error={error} />
      {kept != null ? <p className="text-xs text-[var(--muted)]">{t("emptyKept", { count: kept })}</p> : null}
      <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
        {rows.map((item) => {
          const sentence = dependencySentence(item, t);
          return (
            <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="mr-2 rounded bg-[var(--wash)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{t(`kind.${item.kind}`)}</span>
                  {item.label}
                </p>
                {sentence ? <p className="mt-0.5 text-xs text-[var(--muted)]">{sentence}</p> : null}
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {item.deletedAt ? t("deletedAt", { date: new Date(item.deletedAt).toLocaleDateString() }) : ""}
                  {item.deletedBy ? ` · ${t("deletedBy", { who: item.deletedBy })}` : ""}
                </p>
                {item.reason ? <p className="mt-0.5 text-xs italic text-[var(--muted)]">{t("reasonShown", { reason: item.reason })}</p> : null}
                {item.parentTrashed ? <p className="mt-0.5 text-xs text-[var(--danger)]">{t("parentTrashed")}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" onClick={() => restore(item)} disabled={busyId === item.id || item.parentTrashed}>
                  {t("restore")}
                </Button>
                {/* Permanent delete is a trash icon; its name is for screen readers and the hover tip. */}
                <button type="button" onClick={() => openPurge(item)} disabled={busyId === item.id} aria-label={t("purge")} title={t("purge")} className="grid h-11 w-11 cursor-pointer place-items-center rounded-full text-[var(--danger)] transition hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--danger)]/20">
                  {trashGlyph("h-[22px] w-[22px]")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {dialog ? (
        <PurgeDialog
          preview={dialog.preview}
          busy={dialogBusy}
          error={dialogError}
          onConfirm={confirmPurge}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {emptyOpen ? (
        <ConfirmDialog
          title={t("emptyConfirmTitle")}
          body={t("emptyConfirmBody")}
          busyLabel={t("emptying")}
          danger
          onConfirm={emptyBin}
          onClose={() => setEmptyOpen(false)}
        />
      ) : null}
    </div>
  );
}
