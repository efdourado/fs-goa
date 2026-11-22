"use client";

import { StateButton } from "./state-button";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { ConfirmDialog, Dialog, ModalActions } from "./dialog";
import type { Id, TrashActionPreview, TrashItem } from "./types";
import { Button, cardClass, CircleMinusIcon, cx, FaceEmptyState, Field, inputClass, LoadingView, PageHeading, StatusMessage } from "./ui";

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
  return <FaceEmptyState title={t("emptyTitle")} />;
}

/**
 * Each kind of thing in the bin gets its own solid badge: a group in the ink colour (dark on light, white on dark),
 * a challenge in the app's green, a catalogue item in blue, a record in amber. The tag tokens lighten in dark mode,
 * so their text takes the canvas colour to stay readable in both.
 */
const KIND_BADGE: Partial<Record<TrashItem["kind"], string>> = {
  group: "bg-[var(--ink)] text-[var(--canvas)]",
  challenge: "bg-[var(--main)] text-white",
  catalog_item: "bg-[var(--tag-blue)] text-[var(--canvas)]",
  entry: "bg-[var(--tag-amber)] text-[var(--canvas)]",
};

/** An arrow circling back to where it started: the same 16-unit frame and stroke as CircleMinusIcon. */
function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 5.5A6 6 0 1 1 2.6 10.5" />
      <path d="M2.2 2.4v3.4h3.4" />
    </svg>
  );
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
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const entries = preview.dependencies.find((dep) => dep.type === "entries")?.count ?? 0;
  // Challenges still using a catalogue item: deleting it disconnects it from them, so say so first.
  const connected = preview.kind === "catalog_item" ? preview.dependencies.find((dep) => dep.type === "challengesUsing")?.count ?? 0 : 0;
  const needsReason = preview.kind === "entry";
  const asksName = preview.confirmation === "name";
  const asksCount = preview.confirmation === "count" && entries > 0;
  const typed = !(asksName || asksCount) || Boolean(confirmation.trim());

  return (
    <Dialog title={t("purgeTitle", { label: preview.label })} busy={busy} onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--muted)]">{t("purgeBody")}</p>
        {preview.blocked ? (
          <p className="text-sm text-[var(--muted)]">{preview.blocked.message}</p>
        ) : (
          <>
            {connected ? <p className="text-sm leading-6 text-[var(--danger)]">{t("purgeConnected", { count: connected })}</p> : null}
            {/* What goes with it, one line each (each line already says how many). */}
            {preview.dependencies.length ? (
              <div className="rounded-2xl border border-[var(--line)] px-4 py-3">
                <p className="mb-1.5 text-xs text-[var(--muted)]">{t("purgeAlso")}</p>
                <ul className="space-y-1 text-sm">
                  {preview.dependencies.map((dep) => <li key={dep.type}>{t(`dependency.${dep.type}`, { count: dep.count })}</li>)}
                </ul>
              </div>
            ) : null}
            {asksName || asksCount ? (
              <Field label={asksName ? t("confirmName", { name: preview.label }) : t("confirmCount", { count: entries })}>
                <input
                  className={inputClass}
                  value={confirmation}
                  inputMode={asksCount ? "numeric" : undefined}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
            ) : null}
            {needsReason ? (
              <Field label={t("reasonLabel")}>
                <input className={inputClass} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
              </Field>
            ) : null}
          </>
        )}
        <StatusMessage error={error} />
      </div>
      {!preview.blocked && (
        <ModalActions className="mt-6 border-t border-[var(--line)] pt-4">
          <Button variant="danger" onClick={() => onConfirm(preview.confirmation === "count" && entries === 0 ? "0" : confirmation.trim(), reason.trim())} disabled={busy || !typed}>
            {busy ? t("purging") : t("purgeAction")}
          </Button>
        </ModalActions>
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
  // Which row is working, and on what: the pressed button shows it, the page stays put.
  const [busy, setBusy] = useState<{ id: string; action: "restore" | "purge" } | null>(null);
  const busyId = busy?.id ?? null;
  const [dialog, setDialog] = useState<{ preview: TrashActionPreview } | null>(null);
  const [connectedLeft, setConnectedLeft] = useState<number | null>(null);
  const [forcing, setForcing] = useState(false);
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

  // `quiet`: refresh what's on screen without blanking it into "loading" (after a restore or a delete).
  const load = useCallback((quiet = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    if (!quiet) setItems(null);
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
  useEffect(() => load(), [load]);

  const rows = items ?? [];
  // A restored or deleted row leaves the list at once; the quiet reload then catches whatever went with it.
  const drop = (item: Pick<TrashItem, "kind" | "id">) =>
    setItems((current) => current?.filter((row) => !(row.kind === item.kind && row.id === item.id)) ?? current);

  async function restore(item: TrashItem) {
    setBusy({ id: item.id, action: "restore" });
    setError(null);
    try {
      await apiRequest(API_PATHS.trashRestore(scope), { method: "POST", csrfToken, body: { kind: item.kind, id: item.id } });
      drop(item);
      load(true);
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message || t("restoreError"));
    } finally {
      setBusy(null);
    }
  }

  async function openPurge(item: TrashItem) {
    setBusy({ id: item.id, action: "purge" });
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
      setBusy(null);
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
      drop(dialog.preview);
      setDialog(null);
      load(true);
      onChanged?.();
    } catch (cause) {
      setDialogError((cause as Error).message || t("purgeError"));
    } finally {
      setDialogBusy(false);
    }
  }

  // Two steps: the first empties what nothing else uses and says how many items stayed because a challenge
  // still uses them; "Excluir também" (force) then deletes those, disconnecting them from their challenges.
  async function emptyBin(force = false) {
    if (!emptyScope) return;
    const result = await apiRequest<{ purged: number; skipped: number; connected?: number }>(
      API_PATHS.trashEmpty(emptyScope), { method: "POST", csrfToken, body: force ? { force: true } : {} },
    );
    setEmptyOpen(false);
    setKept(result.skipped > 0 ? result.skipped : null);
    setConnectedLeft(result.connected ? result.connected : null);
    setError(null);
    load(true);
    onChanged?.();
  }

  // "Empty the bin" on the title's line, only when there's something to empty.
  const heading = (
    <PageHeading
      title={title}
      description={description}
      action={emptyScope && rows.length ? (
        <Button variant="danger" className="!rounded-full" onClick={() => setEmptyOpen(true)} disabled={busyId !== null}>
          {t("empty")}
        </Button>
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
      {connectedLeft != null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--danger-line)] px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-[var(--muted)]">{t("emptyConnected", { count: connectedLeft })}</p>
          <Button variant="danger" disabled={forcing} onClick={() => { setForcing(true); void emptyBin(true).finally(() => setForcing(false)); }}>
            {forcing ? t("emptying") : t("emptyConnectedAction")}
          </Button>
        </div>
      ) : null}
      <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
        {rows.map((item) => {
          const sentence = dependencySentence(item, t);
          return (
            <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:items-center sm:px-5">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className={cx("mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium", KIND_BADGE[item.kind] ?? "bg-[var(--wash)] text-[var(--muted)]")}>{t(`kind.${item.kind}`)}</span>
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
              {/* Two round icons of one size: restore (an arrow turning back) and delete (the red circle-minus used for
                  removing everywhere else). The pressed one spins while it works. */}
              <div className="flex w-full flex-none items-center justify-end gap-1 sm:w-auto">
                <StateButton
                  type="button"
                  onClick={() => restore(item)}
                  disabled={busyId === item.id || item.parentTrashed}
                  aria-label={t("restoreAria", { label: item.label })}
                  title={t("restore")}
                  className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy?.id === item.id && busy.action === "restore"
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--muted)]" aria-hidden="true" />
                    : <RestoreIcon className="h-5 w-5" />}
                </StateButton>
                <StateButton
                  type="button"
                  onClick={() => openPurge(item)}
                  disabled={busyId === item.id}
                  aria-label={t("purgeAria", { label: item.label })}
                  title={t("purge")}
                  className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full text-[var(--danger)] transition hover:bg-[var(--danger-soft)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--danger)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy?.id === item.id && busy.action === "purge"
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--danger-line)] border-t-[var(--danger)]" aria-hidden="true" />
                    : <CircleMinusIcon className="h-5 w-5" />}
                </StateButton>
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
          confirmLabel={t("emptyAction")}
          busyLabel={t("emptying")}
          danger
          onConfirm={() => emptyBin()}
          onClose={() => setEmptyOpen(false)}
        />
      ) : null}
    </div>
  );
}
