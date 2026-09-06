"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { Id, TrashActionPreview, TrashItem } from "./types";
import { Button, cardClass, cx, EmptyState, LoadingView, StatusMessage } from "./ui";

type Scope = "personal" | { groupId: Id } | { challengeId: Id };

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
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const entries = preview.dependencies.find((dep) => dep.type === "entries")?.count ?? 0;
  const needsReason = preview.kind === "entry";

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { onCancel(); return; }
      if (event.key !== "Tab") return;
      // Keep focus inside the dialog.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("purgeTitle")}>
      <div ref={panelRef} className={cx(cardClass, "w-full max-w-md p-5 sm:p-6")}>
        <h2 className="text-lg font-light text-[var(--danger)]">{t("purgeTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{t("purgeBody", { label: preview.label })}</p>

        {preview.blocked ? (
          <p className="mt-3 rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {preview.blocked.message}
          </p>
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
            ) : preview.confirmation === "count" ? (
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
        <div className="mt-4 flex justify-end gap-2">
          <button ref={closeRef} type="button" onClick={onCancel} disabled={busy}
            className="cursor-pointer inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-light text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-55">
            {t("cancel")}
          </button>
          {!preview.blocked && (
            <Button variant="danger" onClick={() => onConfirm(confirmation.trim(), reason.trim())} disabled={busy}>
              {busy ? t("purging") : t("purgeConfirm")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The recoverable-deletion bin (ROADMAP §13). One list, three scopes: the
 * personal workspace, a group, or a challenge's removed structure. Nothing here
 * expires — an item stays until it is restored or permanently deleted.
 */
export function TrashView({
  scope,
  csrfToken,
  onChanged,
}: {
  scope: Scope;
  csrfToken: string;
  onChanged?: () => void;
}) {
  const t = useTranslations("trash");
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [structure, setStructure] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ preview: TrashActionPreview } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const listPath = scopeListPath(scope);

  const load = useCallback(() => {
    const controller = new AbortController();
    apiRequest<{ items?: TrashItem[]; structure?: TrashItem[]; entries?: TrashItem[] }>(listPath, { signal: controller.signal })
      .then((data) => {
        if ("groupId" in (scope as object) || scope === "personal") {
          setItems(data.items ?? []);
        } else {
          setStructure([...(data.structure ?? []), ...(data.entries ?? [])]);
          setItems(null);
        }
      })
      .catch((cause) => {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message || t("loadError"));
      });
    return () => controller.abort();
  }, [listPath, scope, t]);

  useEffect(load, [load]);

  const rows = items ?? structure ?? [];

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

  if (items === null && structure === null && !error) return <LoadingView label={t("loading")} />;
  if (!rows.length) return <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />;

  return (
    <div className="space-y-3">
      <StatusMessage error={error} />
      <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
        {rows.map((item) => {
          const sentence = dependencySentence(item, t);
          return (
            <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="mr-2 rounded bg-[var(--wash)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{t(`kind.${item.kind}`)}</span>
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
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => restore(item)} disabled={busyId === item.id || item.parentTrashed}>
                  {t("restore")}
                </Button>
                <Button variant="danger" onClick={() => openPurge(item)} disabled={busyId === item.id}>
                  {t("purge")}
                </Button>
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
    </div>
  );
}
