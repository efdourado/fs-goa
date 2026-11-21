"use client";

import { StateButton } from "./state-button";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useGoaFormat } from "./format";
import { Button, cx, InModal, StatusMessage } from "./ui";

/** Native modal supplies background inertness, focus containment and restoration. */
export function Dialog({ title, children, onClose, busy = false, wide = false, stickyActions = false, storyWidth }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; stickyActions?: boolean; storyWidth?: number | string;
}) {
  const story = storyWidth !== undefined;
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
      className={cx(
        "fixed inset-0 m-auto bg-[var(--paper)] p-0 text-[var(--ink)] shadow-[var(--elevate-2)] backdrop:bg-[var(--scrim)]",
        story
          ? "h-dvh max-h-none w-full max-w-none overflow-hidden open:flex open:flex-col sm:h-[850px] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[440px] sm:rounded-3xl sm:border sm:border-[var(--line)]"
          : cx("max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl border border-[var(--line)] [scrollbar-color:var(--control-line)_var(--paper)] [scrollbar-width:thin]", wide ? "max-w-3xl" : "max-w-xl", stickyActions && "scroll-pb-20"),
      )}
    >
      <div
        className={cx("flex items-center justify-between gap-4 border-b border-[var(--line)]", story ? "mx-auto shrink-0 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]" : "px-6 py-4")}
        style={{ width: storyWidth }}
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
        <StateButton
          type="button"
          onClick={() => { if (!busy) onClose(); }}
          disabled={busy}
          aria-label={tc("close")}
          className={cx("grid flex-none items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40", story ? "size-11 justify-items-end" : "-mr-1.5 size-8 justify-items-center")}
        >
          {/* Every modal closes with the circled minus. */}
          <svg viewBox="0 0 20 20" className={cx("size-5", story && "translate-x-0.5")} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M6.75 10h6.5" strokeLinecap="round" /></svg>
        </StateButton>
      </div>
      <div className={story ? "flex min-h-0 flex-1 flex-col" : "p-6"}><InModal.Provider value>{children}</InModal.Provider></div>
    </dialog>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
}

/** Modal actions fill one row, with an equal-width column for every action. */
export function ModalActions({ children, className, sticky = false }: { children: ReactNode; className?: string; sticky?: boolean }) {
  return <div className={cx("grid w-full auto-cols-fr grid-flow-col gap-3 [&>*]:min-w-0 [&>*]:w-full", className, sticky && "sticky bottom-0 z-10 -mb-3 bg-[var(--paper)] pb-3")}>{children}</div>;
}

/**
 * The shared shell for every editing modal (field, item, metric, correction, …):
 * a `Dialog`, the "unsaved changes" guard, a `<form>` with a disabled-while-busy
 * `<fieldset>`, an inline error, and equal-width actions (Save plus an optional
 * `footerStart` action or Delete). No Cancel: the circled
 * minus in the corner closes every modal. A caller passes only the fields and
 * the save action.
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
  stickyActions = false,
  footerStart,
  onDelete,
  children,
}: {
  title: string;
  dirty: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  /** "Save" unless the action is something else (adding, applying). */
  submitLabel?: string;
  busyLabel?: string;
  danger?: boolean;
  submitDisabled?: boolean;
  stickyActions?: boolean;
  /** Compact action immediately before Save. */
  footerStart?: ReactNode;
  /** A Delete action sharing the footer with Save, confirmed in a panel below (see `DeleteConfirm`). */
  onDelete?: { body: ReactNode; onConfirm: () => Promise<void> | void; busyLabel?: string };
  children: ReactNode;
}) {
  const tc = useTranslations("common");
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const close = () => { if (dirty) setDiscard(true); else onCancel(); };
  const submit = (
    <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy || submitDisabled} className={footerStart ? "min-w-0 flex-1" : undefined}>
      {busy ? busyLabel ?? tc("saving") : submitLabel ?? tc("save")}
    </Button>
  );
  return (
    <Dialog title={title} busy={busy} onClose={close} stickyActions={stickyActions}>
      {discard ? (
        <div role="alert" className="mb-5 flex flex-col gap-3 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3.5">
          <p className="text-sm text-[var(--warn)]">{tc("unsavedChanges")}</p>
          <ModalActions>
            <Button variant="secondary" className="min-h-9" disabled={busy} onClick={() => setDiscard(false)}>{tc("keepEditing")}</Button>
            <Button variant="danger" className="min-h-9" disabled={busy} onClick={onCancel}>{tc("discardChanges")}</Button>
          </ModalActions>
        </div>
      ) : null}
      <form onSubmit={(event) => { event.preventDefault(); void onSubmit(); }} className="space-y-6">
        <fieldset disabled={busy} className="min-w-0 space-y-5">{children}</fieldset>
        <StatusMessage error={error} />
        <ModalActions className="border-t border-[var(--line)] pt-4" sticky={stickyActions}>
          {onDelete ? <DeleteButton open={deleting} disabled={busy} onClick={() => setDeleting((open) => !open)} /> : null}
          {footerStart ? <div className="flex items-center gap-2">{footerStart}{submit}</div> : submit}
        </ModalActions>
        {onDelete && deleting ? <DeleteConfirm {...onDelete} /> : null}
      </form>
    </Dialog>
  );
}

/** The Delete button of a modal's footer: it opens (and closes again) the `DeleteConfirm` panel. */
export function DeleteButton({ open, disabled, onClick }: { open: boolean; disabled?: boolean; onClick: () => void }) {
  const tc = useTranslations("common");
  return (
    <Button variant="danger" className="w-full" aria-expanded={open} disabled={disabled} onClick={onClick}>{tc("delete")}</Button>
  );
}

export function InlineConfirmation({ body, label, busy, danger, onConfirm }: {
  body: ReactNode;
  label: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, []);
  return (
    <div ref={panelRef} className={cx("space-y-3 rounded-2xl border p-4", danger ? "border-[var(--danger-line)]" : "border-[var(--line)]")}>
      <div className="text-sm leading-6">{body}</div>
      <Button variant={danger ? "danger" : "primary"} className="w-full" disabled={busy} onClick={onConfirm}>{label}</Button>
    </div>
  );
}

/** The Delete action's inline panel owns its request and feedback. */
export function DeleteConfirm({ body, onConfirm, busyLabel }: {
  body: ReactNode;
  onConfirm: () => Promise<void> | void;
  busyLabel?: string;
}) {
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <StatusMessage error={error} />
      <InlineConfirmation body={body} danger busy={busy} label={busy ? busyLabel ?? tc("deleting") : tc("confirmDelete")} onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await onConfirm();
        } catch (cause) {
          setError(f.error(cause));
          setBusy(false);
        }
      }} />
    </>
  );
}

/**
 * A styled replacement for `window.confirm` — a `Dialog` with an explanation and
 * one Confirm button (the circled minus is the way out). Owns its own busy + error so callers only pass the
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
  /** "Delete" for a destructive dialog unless given; the title and body say what goes. */
  confirmLabel?: string;
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
      <ModalActions className="mt-6 border-t border-[var(--line)] pt-4">
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
          {busy ? busyLabel ?? tc("saving") : confirmLabel ?? tc("delete")}
        </Button>
      </ModalActions>
    </Dialog>
  );
}
