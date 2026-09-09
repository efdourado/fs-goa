"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useGoaFormat } from "./format";
import { Button, cx, StatusMessage } from "./ui";

/** Native modal supplies background inertness, focus containment and restoration. */
export function Dialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const tc = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);
  // Light dismiss: a press that both starts and ends on the backdrop (the dialog
  // element itself, never its content) closes it. The mousedown guard keeps a
  // text drag that slips past the edge from counting as a backdrop click.
  // Escape is already handled by onCancel, so the keyboard path is covered.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onMouseDown={(event) => { downOnBackdrop.current = event.target === ref.current; }}
      onClick={(event) => { if (!busy && downOnBackdrop.current && event.target === ref.current) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-6 py-4">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
        <button
          type="button"
          onClick={() => { if (!busy) onClose(); }}
          disabled={busy}
          aria-label={tc("close")}
          className={cx("-mr-1.5 grid h-8 w-8 flex-none place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40")}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
}

/**
 * The shared shell for every editing modal (field, item, metric, correction, …):
 * a `Dialog`, the "unsaved changes" guard, a `<form>` with a disabled-while-busy
 * `<fieldset>`, an inline error, and a right-aligned Cancel · Save footer. A
 * caller passes only the fields and the save action.
 */
export function FormDialog({
  title,
  dirty,
  busy,
  error,
  onCancel,
  onSubmit,
  submitLabel,
  busyLabel,
  danger = false,
  submitDisabled = false,
  children,
}: {
  title: string;
  dirty: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  busyLabel?: string;
  danger?: boolean;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const tc = useTranslations("common");
  const [discard, setDiscard] = useState(false);
  const close = () => { if (dirty) setDiscard(true); else onCancel(); };
  return (
    <Dialog title={title} busy={busy} onClose={close}>
      {discard ? (
        <div role="alert" className="mb-5 flex flex-col gap-3 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3.5">
          <p className="text-sm text-[var(--warn)]">{tc("unsavedChanges")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-9" disabled={busy} onClick={() => setDiscard(false)}>{tc("keepEditing")}</Button>
            <Button variant="danger" className="min-h-9" disabled={busy} onClick={onCancel}>{tc("discardChanges")}</Button>
          </div>
        </div>
      ) : null}
      <form onSubmit={(event) => { event.preventDefault(); void onSubmit(); }} className="space-y-6">
        <fieldset disabled={busy} className="min-w-0 space-y-5">{children}</fieldset>
        <StatusMessage error={error} />
        <div className="flex justify-end gap-3 border-t border-[var(--line)] pt-4">
          <Button variant="secondary" disabled={busy} onClick={close}>{tc("cancel")}</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy || submitDisabled}>
            {busy ? busyLabel ?? tc("saving") : submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A styled replacement for `window.confirm` — a `Dialog` with an explanation and
 * a Cancel / Confirm footer. Owns its own busy + error so callers only pass the
 * action. Matches the "remove" dialog in the metrics editor.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} busy={busy} onClose={onClose}>
      <p className="text-sm leading-6">{body}</p>
      <StatusMessage error={error} />
      <div className="mt-6 flex justify-end gap-3 border-t border-[var(--line)] pt-4">
        <Button variant="secondary" disabled={busy} onClick={onClose}>{tc("cancel")}</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
            } catch (cause) {
              setError(f.error(cause));
              setBusy(false);
            }
          }}
        >
          {busy ? busyLabel ?? tc("saving") : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
