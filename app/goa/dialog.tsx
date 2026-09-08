"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useGoaFormat } from "./format";
import { Button, StatusMessage } from "./ui";

/** Native modal supplies background inertness, focus containment and restoration. */
export function Dialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
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
      <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
        <h2 id={titleId} className="text-xl font-medium tracking-tight">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
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
