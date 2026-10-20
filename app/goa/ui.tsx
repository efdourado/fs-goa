"use client";

import { useTranslations } from "next-intl";
import { createContext, Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, useContext, useEffect, useId, useRef, useState } from "react";

import { useGoaFormat } from "./format";
import { SettingsMenu } from "./SettingsMenu";
import type { ChallengeStatus, Id, MemberRequest, SubmissionMode, User } from "./types";
import {
  dateKeyInSaoPaulo,
  inclusiveDayCount,
  isChallengeScheduled,
  parseCommentBlocks,
  shiftDateKey,
} from "./utils";

export const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--elevate-1)]";
export const inputClass =
  "min-h-11 w-full rounded-xl border border-[var(--line)] bg-transparent px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--main)] focus:ring-4 focus:ring-[var(--main)]/18 disabled:cursor-not-allowed disabled:text-[var(--muted)]";
export const labelClass = "mb-1.5 block text-[13px] font-medium text-[var(--ink)]";
/**
 * A section title one step down from `PageHeading`'s `<h1>` — sentence case,
 * full-contrast ink, the same `font-light` voice as the rest of the app's
 * headings (matches the admin tabs' fieldset legends). No uppercase/tracking
 * treatment; named and exported so every new section title converges on it
 * instead of a slightly different one-off.
 */
export const sectionLabelClass = "text-base font-light";
/** Legacy plain back-link style; new screens use `<BackButton>`. */
export const backLinkClass =
  "min-h-11 cursor-pointer text-sm font-light text-[var(--muted)] hover:text-[var(--ink)]";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** The one "← Back" control at the top of every screen — a chevron plus a label. */
export function BackButton({ onClick, label, className, labelClassName }: { onClick: () => void; label: string; className?: string; labelClassName?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]",
        className,
        // Under the phone dock its ‹ does this job (GoaApp marks the page `has-dock`); on a computer the
        // header and the browser's own Back do, so it's a phone-only link.
        "max-sm:[.has-dock_&]:hidden sm:hidden",
      )}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* The label names the parent screen — a group or challenge title can be long. */}
      <span className={cx("min-w-0 max-w-[12rem] truncate sm:max-w-xs", labelClassName)}>{label}</span>
    </button>
  );
}

/** Set by a modal (dialog, bottom sheet): its buttons are pills. */
export const InModal = createContext(false);

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const inModal = useContext(InModal);
  const tones = {
    primary: "border-transparent bg-[var(--main)] font-medium text-white shadow-[var(--elevate-1)] hover:opacity-90",
    secondary: "border-[var(--line)] bg-transparent font-light text-[var(--ink)] hover:bg-[var(--hover)]",
    ghost: "border-transparent bg-transparent font-light text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
    danger: "border-[var(--danger-line)] bg-transparent font-light text-[var(--danger)] hover:bg-[var(--danger-soft)]",
  };
  return (
    <button
      className={cx(
        "cursor-pointer inline-flex min-h-10 items-center justify-center gap-2 border px-4 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55",
        inModal ? "rounded-full" : "rounded-xl",
        tones[variant],
        className,
      )}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CircleCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.4 8.2 7.2 10l3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CircleExclamationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.6v4" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CircleMinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.2 8h5.6" strokeLinecap="round" />
    </svg>
  );
}

/** Pin state as a circle — filled disc when pinned, plain ring when not. No pushpin. */
export function CirclePinIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="6" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}

/** Circled chevron for "move up" / "move down". */
export function CircleChevronIcon({ className, dir }: { className?: string; dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d={dir === "up" ? "M7 11l3-3 3 3" : "M7 9l3 3 3-3"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Edit / settings — the header's sliders glyph. */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </svg>
  );
}

/**
 * A loupe that opens into a quiet search pill: it grows out sideways (nudging whatever sits beside it), and a
 * click on the loupe again, or anywhere outside, folds it back. `keepWhileFiltering` leaves it open while it still holds words, for a
 * filter you read through rather than pick from. Escape empties it and folds it.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  open,
  onOpenChange,
  onEnter,
  keepWhileFiltering = false,
  openClassName = "w-64",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnter?: () => void;
  keepWhileFiltering?: boolean;
  /** The width it opens to, e.g. "w-64" or "w-full sm:w-72". */
  openClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  const holding = keepWhileFiltering && Boolean(value.trim());
  useEffect(() => {
    if (!open || holding) return;
    const away = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      onChange("");
      onOpenChange(false);
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [open, holding, onChange, onOpenChange]);
  return (
    <div
      ref={wrapRef}
      className={cx(
        "relative h-9 flex-none overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none",
        open ? openClassName : "w-9",
      )}
    >
      <button
        type="button"
        aria-label={placeholder}
        aria-expanded={open}
        title={open ? undefined : placeholder}
        onClick={() => { if (open) onChange(""); onOpenChange(!open); }}
        className={cx("absolute inset-y-0 left-0 z-10 grid w-9 cursor-pointer place-items-center rounded-full transition-colors hover:text-[var(--ink)]", open || value ? "text-[var(--ink)]" : "text-[var(--muted)]")}
      >
        <SearchIcon className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { onChange(""); onOpenChange(false); }
            if (event.key === "Enter") onEnter?.();
          }}
          className="h-full w-full min-w-0 bg-transparent pl-9 pr-4 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
        />
      ) : null}
    </div>
  );
}

/**
 * Copy that answers: the two sheets spin away, a ring draws itself and a check is written inside it (`done`),
 * then it all eases back. The motion lives in globals.css (`.copy-check`); reduced motion just swaps them.
 */
export function CopyCheckIcon({ done, className }: { done: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("copy-check", className)} data-done={done ? "" : undefined} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="copy-check__sheets" strokeWidth="1.5">
        <rect x="7" y="7" width="9.5" height="9.5" rx="2.2" />
        <path d="M13 7V5.6a2.1 2.1 0 0 0-2.1-2.1H5.6a2.1 2.1 0 0 0-2.1 2.1v5.3A2.1 2.1 0 0 0 5.6 13H7" />
      </g>
      {/* Drawn with fixed dash lengths (ring ≈ 47.8, tick ≈ 9.9), not pathLength, which some browsers ignore on shapes. */}
      <circle className="copy-check__ring" cx="10" cy="10" r="7.6" strokeWidth="1.6" transform="rotate(-90 10 10)" />
      <path className="copy-check__tick" d="m6.7 10.3 2.3 2.3 4.5-4.8" strokeWidth="1.8" />
    </svg>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Options sharing a group sit under its name, like an `<optgroup>`. */
  group?: string;
}

const selectLooks = {
  field: inputClass,
  pill: "min-h-10 rounded-full border border-[var(--line)] bg-transparent px-4 text-sm text-[var(--ink)] transition hover:border-[var(--muted)] focus-visible:border-[var(--main)] focus-visible:ring-4 focus-visible:ring-[var(--main)]/15 disabled:cursor-not-allowed disabled:opacity-55",
  bare: "",
};

/**
 * The app's own drop-down, in place of a native `<select>` (whose list the browser draws its own way). The list opens
 * in the top layer as a popover, so a modal dialog neither clips nor blocks it: under the trigger (above it near the
 * bottom of the screen) on a wide screen, as a sheet from the bottom on a phone. The chosen option carries an ink
 * circle check. Keys: arrows, Home/End, a letter to jump, Enter or Space to pick, Escape to close.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  name,
  disabled = false,
  placeholder,
  look = "field",
  chevron = true,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<SelectOption<T>>;
  ariaLabel?: string;
  id?: string;
  /** Sends the value with a native form, through a hidden input. */
  name?: string;
  disabled?: boolean;
  /** Shown when the value matches no option. */
  placeholder?: string;
  look?: keyof typeof selectLooks;
  /** A quiet trigger (a word in a line of text) can drop the chevron. */
  chevron?: boolean;
  className?: string;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const selected = options.find((option) => option.value === value);

  function optionButtons() {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
  }

  // Placed just before it shows: below the trigger, or above it when the room is under it is short.
  function place() {
    const trigger = triggerRef.current, list = listRef.current;
    if (!trigger || !list) return;
    const phone = window.matchMedia("(max-width: 639px)").matches;
    setSheet(phone);
    if (phone) { Object.assign(list.style, { top: "auto", left: "0px", right: "0px", bottom: "0px", minWidth: "", maxHeight: "60dvh" }); return; }
    const box = trigger.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 12, above = box.top - 12;
    const up = below < 220 && above > below;
    const room = Math.min(320, (up ? above : below) - 6);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, 180) - 8));
    Object.assign(list.style, {
      left: `${left}px`, right: "auto", minWidth: `${box.width}px`, maxWidth: `${window.innerWidth - 16}px`, maxHeight: `${room}px`,
      top: up ? "auto" : `${box.bottom + 6}px`, bottom: up ? `${window.innerHeight - box.top + 6}px` : "auto",
    });
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onBeforeToggle = (event: Event) => { if ((event as ToggleEvent).newState === "open") place(); };
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        const buttons = optionButtons();
        (buttons.find((button) => button.dataset.value === value) ?? buttons[0])?.focus({ preventScroll: true });
        listRef.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
      }
    };
    list.addEventListener("beforetoggle", onBeforeToggle);
    list.addEventListener("toggle", onToggle);
    return () => { list.removeEventListener("beforetoggle", onBeforeToggle); list.removeEventListener("toggle", onToggle); };
  });

  // A page that scrolls or resizes under an open list would leave it floating: close it instead.
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!(event.target instanceof Node && listRef.current?.contains(event.target))) listRef.current?.hidePopover(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);

  function pick(next: T) {
    listRef.current?.hidePopover();
    triggerRef.current?.focus();
    if (next !== value) onChange(next);
  }

  function onTriggerKey(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); listRef.current?.showPopover(); }
  }

  function onListKey(event: ReactKeyboardEvent) {
    const buttons = optionButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (event.key === "ArrowDown") to = Math.min(buttons.length - 1, at + 1);
    else if (event.key === "ArrowUp") to = Math.max(0, at - 1);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = buttons.length - 1;
    else if (event.key === "Tab") { listRef.current?.hidePopover(); triggerRef.current?.focus(); return; }
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLocaleLowerCase();
      const order = [...buttons.slice(at + 1), ...buttons.slice(0, at + 1)];
      const hit = order.find((button) => (button.textContent ?? "").trim().toLocaleLowerCase().startsWith(letter));
      to = hit ? buttons.indexOf(hit) : -1;
    }
    if (to < 0) return;
    event.preventDefault();
    buttons[to]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        popoverTarget={listId}
        onKeyDown={onTriggerKey}
        className={cx("flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left outline-none disabled:cursor-not-allowed", selectLooks[look], className)}
      >
        <span className={cx("min-w-0 truncate", !selected && "text-[var(--muted)]")}>{selected?.label ?? placeholder ?? ""}</span>
        {chevron ? <svg viewBox="0 0 16 16" className={cx("h-3.5 w-3.5 flex-none text-[var(--muted)] transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5" /></svg> : null}
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div
        ref={listRef}
        id={listId}
        popover="auto"
        role="listbox"
        tabIndex={-1}
        aria-label={ariaLabel}
        onKeyDown={onListKey}
        className={cx(
          "goa-select-list m-0 overflow-y-auto border border-[var(--line)] bg-[var(--paper)] p-1.5 text-[var(--ink)] shadow-[var(--elevate-2)]",
          sheet ? "w-full rounded-t-3xl px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop:bg-black/30" : "rounded-2xl",
        )}
      >
        {options.map((option, index) => {
          const chosen = option.value === value;
          const heading = option.group && option.group !== options[index - 1]?.group ? option.group : null;
          return (
            <Fragment key={option.value}>
            {heading ? <p className="px-3 pb-1 pt-2.5 text-xs text-[var(--muted)]" role="presentation">{heading}</p> : null}
            <button
              type="button"
              role="option"
              aria-selected={chosen}
              data-value={option.value}
              disabled={option.disabled}
              onClick={() => pick(option.value)}
              className={cx(
                "flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl px-3 text-left text-sm outline-none transition hover:bg-[var(--wash)] focus-visible:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
                sheet ? "min-h-12" : "min-h-9",
                chosen && "font-medium",
              )}
            >
              <span className="min-w-0 truncate">{option.label || "\u00a0"}</span>
              {chosen ? <CircleCheckIcon className="h-4 w-4 flex-none text-[var(--ink)]" /> : null}
            </button>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

/**
 * A link to hand over, in a round outline: copy on its left (the icon answers with a check), the link, and a new link
 * on its right. The group's invite and a challenge's public page both show their link this way.
 */
export function LinkPill({ url, placeholder, copied, busy = false, onCopy, onRenew, copyLabel, copiedLabel, renewLabel, urlLabel, inputRef }: {
  url: string | null;
  /** Said in the link's place while there's none. */
  placeholder?: string;
  copied: boolean;
  busy?: boolean;
  onCopy: () => void;
  onRenew: () => void;
  copyLabel: string;
  copiedLabel: string;
  renewLabel: string;
  urlLabel: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const iconButton = "grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full text-[var(--ink)] transition hover:bg-[var(--wash)] disabled:cursor-default";
  return (
    <div className="flex h-[46px] items-center gap-2 rounded-full border border-[var(--line)] px-2">
      <button type="button" onClick={onCopy} disabled={!url} aria-label={copied ? copiedLabel : copyLabel} title={copied ? copiedLabel : copyLabel} className={iconButton}>
        <CopyCheckIcon done={copied} className="h-[18px] w-[18px]" />
      </button>
      {url ? (
        <input ref={inputRef} className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-[var(--ink)] outline-none" value={url} readOnly aria-label={urlLabel} onFocus={(event) => event.currentTarget.select()} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{placeholder ?? "\u00a0"}</span>
      )}
      <button type="button" onClick={onRenew} disabled={busy} aria-label={renewLabel} title={renewLabel} className={cx(iconButton, "disabled:opacity-55")}>
        <svg viewBox="0 0 16 16" className={cx("h-[18px] w-[18px]", busy && "animate-spin")} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.9h-2.9" /></svg>
      </button>
    </div>
  );
}

/** A box of content, as Manage's tabs lay out their parts: a thin border, its name, an optional line, then its controls. */
export function BoxSection({ title, hint, danger = false, mark, children }: {
  title: string; hint?: string; danger?: boolean;
  /** A small mark before the name (a status dot, say). */
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-[var(--line)] p-5 sm:p-6">
      <h2 className={cx("flex items-center gap-2.5 text-lg font-medium tracking-tight", danger && "text-[var(--danger)]")}>{mark}{title}</h2>
      {hint ? <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** How an empty numbered list (stages, rules) starts: a dotted line to fill, with an ink ＋ at its start and a word. */
export function StartLine({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
  return (
    <div className="relative flex items-center py-1 before:absolute before:left-[22px] before:right-0 before:top-1/2 before:h-px before:bg-[repeating-linear-gradient(90deg,var(--line)_0_6px,transparent_6px_12px)] before:content-['']">
      <button type="button" onClick={onClick} aria-label={ariaLabel} className="relative z-[1] grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full border border-[var(--ink)] bg-[var(--canvas)] text-xl font-light leading-none text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-[var(--canvas)]">＋</button>
      <span className="relative z-[1] ml-3.5 bg-[var(--canvas)] pr-2.5 text-sm text-[var(--muted)]" aria-hidden="true">{label}</span>
    </div>
  );
}

/** One more row for a numbered list: a dashed ＋ circle the size of the numbers, and a word, under the last row. */
export function AddRow({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
  return (
    <div className="flex items-center border-t border-[var(--line)] py-3.5">
      <button type="button" onClick={onClick} aria-label={ariaLabel} className="grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full border border-dashed border-[var(--muted)] text-xs font-light leading-none transition hover:border-solid hover:border-[var(--ink)]">＋</button>
      <span className="ml-3.5 text-sm text-[var(--muted)]" aria-hidden="true">{label}</span>
    </div>
  );
}

/** The small plain icon buttons at the end of a numbered row (up, down, remove). */
export const rowIconClass = "grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

export function ChevronIcon({ dir, className = "h-4 w-4" }: { dir: "up" | "down"; className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === "up" ? "M4.5 9.5 8 6l3.5 3.5" : "M4.5 6.5 8 10l3.5-3.5"} /></svg>;
}

/**
 * The empty state with a face: a little frown (ᴖ̈) in a thin circle over a muted title, centred, no box. The empty
 * bin and an empty notifications menu use it. `compact` fits it in a menu.
 */
export function FaceEmptyState({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div className={cx("grid justify-items-center gap-3 px-4 text-center", compact ? "py-8" : "py-12")}>
      <span className="grid h-[52px] w-[52px] place-items-center rounded-full border border-[var(--line)] font-[system-ui,sans-serif] text-[26px] leading-none text-[var(--ink)]" aria-hidden="true">
        ᴖ̈
      </span>
      <p className="text-[15px] font-light tracking-[-0.01em] text-[var(--muted)]">{title}</p>
    </div>
  );
}

export function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M2 4.5h12M2 11.5h12" />
      <circle cx="11" cy="4.5" r="2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Messages: one stack at the top left, above everything ──────────────────────────────────────────────────
// Every success or error a screen reports goes here instead of a box inside the page: the top-left corner, over
// pages and open windows alike. A success leaves by itself; an error stays until it's closed or its screen goes.

type Toast = { id: number; source: string; kind: "error" | "success"; text: string; leaving?: boolean };
let toastList: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = (next: Toast[]) => { toastList = next; toastListeners.forEach((listener) => listener()); };
const SUCCESS_MS = 3500;
const LEAVE_MS = 260;

/** A message leaves the way it came (sliding back left and fading), then it's gone. */
function dismissToasts(match: (toast: Toast) => boolean) {
  const going = toastList.filter((toast) => match(toast) && !toast.leaving).map((toast) => toast.id);
  if (!going.length) return;
  emitToasts(toastList.map((toast) => going.includes(toast.id) ? { ...toast, leaving: true } : toast));
  window.setTimeout(() => emitToasts(toastList.filter((toast) => !going.includes(toast.id))), LEAVE_MS);
}

// A success's timer, held while the pointer (or focus) is on it: a message being read doesn't leave.
const toastTimers = new Map<number, number>();
function scheduleToast(id: number, ms: number) {
  window.clearTimeout(toastTimers.get(id));
  toastTimers.set(id, window.setTimeout(() => { toastTimers.delete(id); dismissToasts((toast) => toast.id === id); }, ms));
}
function holdToast(id: number) {
  window.clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
}
function releaseToast(toast: Toast) {
  if (toast.kind === "success" && !toast.leaving) scheduleToast(toast.id, SUCCESS_MS / 2);
}

function showToast(source: string, kind: Toast["kind"], text: string) {
  const id = ++toastSeq;
  dismissToasts((toast) => toast.source === source);
  emitToasts([...toastList, { id, source, kind, text }]);
  if (kind === "success") scheduleToast(id, SUCCESS_MS);
}
function dropToasts(source: string, kind?: Toast["kind"]) {
  dismissToasts((toast) => toast.source === source && (!kind || toast.kind === kind));
}

/**
 * A screen's success or error: no longer drawn where it's placed, but raised as a message at the top left
 * (`Toaster`). The props stay the same, so every screen keeps reporting the way it did.
 */
export function StatusMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  const source = useId();
  const message = error ?? success ?? null;
  useEffect(() => {
    if (message) showToast(source, error ? "error" : "success", message);
    else dropToasts(source, "error");
  }, [source, message, error]);
  // A screen that goes takes its error with it; a success finishes its few seconds.
  useEffect(() => () => dropToasts(source, "error"), [source]);
  return null;
}

/** The message stack, once per page (the root layout). A popover, so it sits over an open window too. */
export function Toaster() {
  const tc = useTranslations("common");
  const ref = useRef<HTMLDivElement>(null);
  const [toasts, setToasts] = useState<Toast[]>(toastList);
  useEffect(() => {
    const listener = () => setToasts(toastList);
    toastListeners.add(listener);
    return () => { toastListeners.delete(listener); };
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node?.showPopover) return;
    // Re-opened on every message, so it lands above whatever window opened since.
    if (node.matches(":popover-open")) node.hidePopover();
    if (toasts.length) node.showPopover();
  }, [toasts]);
  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="goa-toaster pointer-events-none m-0 flex w-[min(calc(100vw-2rem),22rem)] flex-col gap-2 overflow-visible border-0 bg-transparent p-0"
      style={{ inset: "auto", top: "max(1rem, env(safe-area-inset-top))", left: "max(1rem, env(safe-area-inset-left))" }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          data-leaving={toast.leaving ? "" : undefined}
          onMouseEnter={() => holdToast(toast.id)}
          onMouseLeave={() => releaseToast(toast)}
          onFocus={() => holdToast(toast.id)}
          onBlur={() => releaseToast(toast)}
          className="goa-toast pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] shadow-[var(--elevate-2)]"
        >
          {toast.kind === "error"
            ? <CircleExclamationIcon className="mt-[3px] h-3.5 w-3.5 flex-none text-[var(--danger)] opacity-70" />
            : <CircleCheckIcon className="mt-[3px] h-3.5 w-3.5 flex-none text-[var(--muted)]" />}
          <span className="min-w-0 flex-1 leading-5">{toast.text}</span>
          <button type="button" onClick={() => dismissToasts((one) => one.id === toast.id)} aria-label={tc("close")} className="mt-[3px] flex-none cursor-pointer rounded-full text-[var(--muted)] opacity-60 transition hover:text-[var(--ink)] hover:opacity-100">
            <CircleMinusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  onClick,
  action,
  hint,
}: {
  title: string;
  /** When set, the whole card is a button (e.g. tap to create). Mutually exclusive with `action`. */
  onClick?: () => void;
  /** A nested control for error/retry/back states. */
  action?: ReactNode;
  /** One short line, only for context the title can't carry (a limit reached, an error message). */
  hint?: ReactNode;
}) {
  // Quiet on purpose: one short line in a thin dashed frame. No icon, no paragraph.
  const shell = "w-full rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-center";
  const body = (
    <>
      <h3 className="text-sm font-light text-[var(--muted)]">{onClick ? <span aria-hidden="true" className="mr-1.5">＋</span> : null}{title}</h3>
      {hint ? <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--muted)]">{hint}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cx(shell, "group block cursor-pointer transition hover:border-[var(--main-line)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/20 [&_h3]:transition hover:[&_h3]:text-[var(--ink-strong)]")}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={shell}>
      {body}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingView({ label }: { label?: string }) {
  const t = useTranslations("common");
  return (
    <div className="grid min-h-screen place-items-center px-6" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-[var(--main-line)] border-t-[var(--main)]" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--muted)]">{label ?? t("loadingApp")}</p>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Goa">
      <img src="/logo.png" alt="" aria-hidden="true" draggable={false} className="h-9 w-9 object-contain" />
      <strong className="text-xl tracking-[-0.06em]">goa</strong>
    </span>
  );
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * One field: a label (optionally marked optional), an optional hint above the
 * control, the control itself, and an inline error below. The single rhythm
 * every form in the app uses — pass `label=""` for a control that carries its
 * own labelling.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  plain = false,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  /** Render as a plain `<div>` instead of a `<label>` — for a group of controls (a card picker, a sub-widget) that shouldn't all bind to one caption. */
  plain?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={cx("flex flex-col gap-1.5", className)}>
      {label ? (
        <span className="text-[13px] font-medium text-[var(--ink)]">
          {label}{optional ? <span className="font-normal text-[var(--muted)]"> · {t("optional")}</span> : null}
        </span>
      ) : null}
      {hint ? <span className="-mt-0.5 block text-xs leading-5 text-[var(--muted)]">{hint}</span> : null}
      {children}
      {error ? (
        <span className="flex items-center gap-1.5 text-xs text-[var(--danger-strong)]">
          <CircleExclamationIcon className="h-3.5 w-3.5 flex-none" />
          {error}
        </span>
      ) : null}
    </Wrapper>
  );
}

/**
 * Renders a comment as quote/opinion/divider blocks instead of one flat
 * paragraph — a line starting with "> " (see `parseCommentBlocks`) gets a
 * left border, Notion-style, so a quoted line and the person's own opinion
 * read as visibly different things with no extra label needed; a "---" line
 * becomes a plain horizontal rule, for separating distinct thoughts.
 */
export function CommentText({ text, className }: { text: string; className?: string }) {
  const blocks = parseCommentBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className={cx("space-y-2.5", className)}>
      {blocks.map((block, index) => block.kind === "divider" ? (
        <hr key={index} className="border-t border-[var(--line)] mt-6 pb-3" />
      ) : block.kind === "quote" ? (
        // A quoted passage: no rule beside it, a rounded panel on the page tone, a big opening quote mark over its corner.
        <blockquote key={index} className="relative !mt-5 whitespace-pre-wrap rounded-xl bg-[var(--canvas)] px-4 pb-3 pt-5 leading-6 text-[color-mix(in_srgb,var(--ink)_78%,transparent)]">
          <span aria-hidden="true" className="pointer-events-none absolute -top-[15px] left-2.5 select-none font-serif text-[72px] leading-none text-[var(--ink)] opacity-35">“</span>
          {/* The mark is drawn: quotation marks typed around the passage would say it twice. */}
          {block.text.replace(/^["“”]\s*/, "").replace(/\s*["“”]$/, "")}
        </blockquote>
      ) : (
        <p key={index} className="whitespace-pre-wrap leading-6">{block.text}</p>
      ))}
    </div>
  );
}

/** A `role="switch"` toggle — a single on/off preference, with an optional label + hint beside it. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
  ariaLabel,
  bare = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** No frame of its own — for a switch that already sits in a bordered box. */
  bare?: boolean;
  /** The switch's name when its words sit outside it (no `label`). */
  ariaLabel?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 flex-none cursor-pointer items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-[var(--main)]" : "bg-[var(--wash-strong)]",
      )}
    >
      <span className={cx("h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
  if (!label && !hint) return <span className={className}>{control}</span>;
  return (
    <div className={cx("flex items-start gap-3", !bare && "rounded-xl border border-[var(--line)] px-4 py-3.5", className)}>
      <span className="min-w-0 flex-1">
        {label ? <strong className="block text-sm font-medium">{label}</strong> : null}
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{hint}</span> : null}
      </span>
      <span className="mt-0.5">{control}</span>
    </div>
  );
}

/** A "pick one" group of bordered cards — a friendlier radio for 2–4 choices. */
export function SelectableCards<T extends string>({
  value,
  onChange,
  options,
  disabled,
  columns = 2,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; hint?: string }>;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div className={cx("grid gap-2.5", columns === 1 ? "" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "border-[var(--main)] bg-[var(--main-soft)] ring-[3px] ring-[var(--main)]/12"
                : "border-[var(--line)] hover:border-[var(--main-line)]",
            )}
          >
            <strong className={cx("text-[13.5px] font-medium", active && "text-[var(--main-strong)]")}>{option.label}</strong>
            {option.hint ? <span className="text-[11.5px] text-[var(--muted)]">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A consistent "More options" disclosure: a chevron summary, an optional preview of the current value, a top border. */
export function Disclosure({
  summary,
  preview,
  defaultOpen = false,
  children,
}: {
  summary: string;
  preview?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-[var(--line)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3.5 text-[13px] font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {summary}
        {preview ? <span className="truncate font-normal text-[var(--muted)]/80">· {preview}</span> : null}
      </summary>
      <div className="pb-1 pt-1">{children}</div>
    </details>
  );
}

const DURATION_PRESETS: Array<{ key: "d30" | "d60" | "d90" | "m6" | "y1"; shift: { days?: number; months?: number } }> = [
  { key: "d30", shift: { days: 29 } },
  { key: "d60", shift: { days: 59 } },
  { key: "d90", shift: { days: 89 } },
  { key: "m6", shift: { months: 6, days: -1 } },
  { key: "y1", shift: { months: 12, days: -1 } },
];

/**
 * How long a challenge runs: one tap on a duration ("90 days") and the end date follows the start — no
 * calendar counting. The exact dates (and a free number of days) sit one fold below for the rare case that
 * needs them. The start can sit in the past, so a challenge run before the app can be rebuilt.
 */
export function SchedulePeriodFields({
  startsOn,
  endsOn,
  onStartsOn,
  onEndsOn,
  disabled = false,
}: {
  startsOn: string;
  endsOn: string;
  onStartsOn: (value: string) => void;
  onEndsOn: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("schedule");
  const f = useGoaFormat();
  const today = dateKeyInSaoPaulo(new Date());
  const anchor = startsOn || today;
  const duration = inclusiveDayCount(startsOn, endsOn);
  const matchesPreset = (preset: (typeof DURATION_PRESETS)[number]) => Boolean(startsOn && endsOn) && shiftDateKey(anchor, preset.shift) === endsOn;
  // Dates that no shortcut produces are already the "exact" kind: show them open. Decided once, so the fold
  // never jumps shut under someone typing a day count that happens to equal a shortcut.
  const [openExact] = useState(() => Boolean(startsOn && endsOn) && !DURATION_PRESETS.some(matchesPreset));

  function applyShift(shift: { days?: number; months?: number }) {
    if (!startsOn) onStartsOn(anchor);
    onEndsOn(shiftDateKey(anchor, shift));
  }

  return (
    <div className="sm:col-span-2">
      <span className={labelClass}>{t("duration")}</span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {DURATION_PRESETS.map((preset) => {
          const active = matchesPreset(preset);
          return (
            <button
              key={preset.key}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => applyShift(preset.shift)}
              className={cx(
                "min-h-10 rounded-full border px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-60",
                active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)]",
              )}
            >
              {t(`preset.${preset.key}`)}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {duration ? t("span", { count: duration, range: f.dateRange(startsOn, endsOn) }) : t("durationHint")}
      </p>
      <div className="mt-2">
        <Disclosure summary={t("exactDates")} defaultOpen={openExact}>
          <div className="grid gap-4 pt-1 sm:grid-cols-2">
            <label>
              <span className={labelClass}>{t("start")}</span>
              <input className={inputClass} type="date" value={startsOn} onChange={(event) => onStartsOn(event.target.value)} disabled={disabled} />
            </label>
            <label>
              <span className={labelClass}>{t("end")}</span>
              <input className={inputClass} type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => onEndsOn(event.target.value)} disabled={disabled} />
            </label>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-[var(--muted)]">
              <span>{t("durationDaysAria")}</span>
              <input
                type="number"
                min={1}
                max={3660}
                inputMode="numeric"
                disabled={disabled}
                value={duration ?? ""}
                onChange={(event) => {
                  const days = Number(event.target.value);
                  if (Number.isInteger(days) && days >= 1 && days <= 3660) applyShift({ days: days - 1 });
                }}
                className="w-20 rounded-lg border border-[var(--line)] bg-transparent px-2 py-1.5 text-center text-sm text-[var(--ink)] outline-none focus:border-[var(--main)] disabled:cursor-not-allowed disabled:text-[var(--muted)]"
              />
              {t("days")}
            </label>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

/** The person's initial in a soft disc — the header's avatar; `large` is the same disc on the You page. */
/**
 * goa's mark, for now the face of every profile: wherever a person used to be a circle with their initial,
 * the circle holds this picture instead. It fills whatever circle it is put in; where a colour is what tells
 * people apart (the thread, the scales), the circle keeps a thin ring of it around the picture.
 */
export function AvatarMark() {
  // A fixed little file from /public, drawn at a few dozen pixels: next/image would add nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/fb.jpg" alt="" aria-hidden="true" draggable={false} className="h-full w-full rounded-full object-cover" />;
}

export function UserAvatar({ large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={cx(
        "grid flex-none place-items-center overflow-hidden rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)]",
        large ? "h-14 w-14" : "h-9 w-9",
      )}
      aria-hidden="true"
    >
      <AvatarMark />
    </span>
  );
}

export function AppHeader({
  user,
  notifications,
  onHome,
  onOpenYou,
  onOpenCatalog,
  onOpenAbout,
  onLogout,
  onAcceptRequest,
  onDeclineRequest,
}: {
  user: User;
  notifications: MemberRequest[];
  onHome: () => void;
  onOpenYou: () => void;
  onOpenCatalog: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void>;
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("nav");
  const [busy, setBusy] = useState(false);
  const navLink = "min-h-11 cursor-pointer rounded-xl px-2 text-xs text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:cursor-not-allowed sm:px-3";
  return (
    // A phone navigates by the dock, so it has no header at all (the logo lives on the About page).
    <header className="sticky top-0 z-30 hidden border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl sm:block">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
        <button className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25" type="button" onClick={onHome}><Brand /></button>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-2">
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onHome}>{t("home")}</button>
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onOpenCatalog}>{t("catalogue")}</button>
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onOpenAbout}>{t("about")}</button>
          <button
            className="hidden shrink-0 cursor-pointer items-center gap-2.5 rounded-xl p-1 pr-2 text-left hover:bg-[var(--wash)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 sm:flex"
            type="button"
            onClick={onOpenYou}
            aria-label={t("you")}
          >
            <UserAvatar name={user.name} />
            <span className="hidden leading-tight sm:block">
              <strong className="block text-sm">{user.name}</strong>
              <span className="block text-xs text-[var(--muted)]">@{user.username}</span>
            </span>
          </button>
          <div className="hidden items-center gap-0.5 sm:flex sm:gap-2">
            <NotificationsMenu
              notifications={notifications}
              onAcceptRequest={onAcceptRequest}
              onDeclineRequest={onDeclineRequest}
            />
            <SettingsMenu />
          </div>
          <button
            className={cx(navLink, "hidden shrink-0 disabled:opacity-50 sm:inline-flex sm:items-center")}
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onLogout(); } finally { setBusy(false); } }}
          >
            {busy ? t("signingOut") : t("signOut")}
          </button>
        </div>
      </div>
    </header>
  );
}

/** Bell glyph with the unread badge — shared by the desktop dropdown and the phone sheet. */
export function NotificationBell({ count }: { count: number }) {
  return (
    <>
      <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6c0 2.6-1 4-1.6 4.65h10.4C12.6 9.6 11.6 8.2 11.6 5.6A3.6 3.6 0 0 0 8 2Z" strokeLinejoin="round" />
        <path d="M6.4 12.25a1.6 1.6 0 0 0 3.2 0" strokeLinecap="round" />
      </svg>
      {count ? (
        <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--main)] px-1 text-[10px] font-black leading-none text-white">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </>
  );
}

/** The member-request inbox body: the list (with accept/decline) or an empty note. */
export function NotificationList({
  notifications,
  onAcceptRequest,
  onDeclineRequest,
}: {
  notifications: MemberRequest[];
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("notifications");
  const f = useGoaFormat();
  const [pendingId, setPendingId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inbox = notifications ?? [];

  async function respond(id: Id, action: "accept" | "decline") {
    setPendingId(id);
    setError(null);
    try {
      await (action === "accept" ? onAcceptRequest(id) : onDeclineRequest(id));
    } catch {
      setError(t("error"));
    } finally {
      setPendingId(null);
    }
  }

  if (!inbox.length) {
    return <FaceEmptyState title={t("empty")} compact />;
  }
  return (
    <>
      {error ? <p className="border-b border-[var(--line)] bg-[var(--danger-soft)] px-4 py-2 text-xs text-[var(--danger)]">{error}</p> : null}
      <ul className="divide-y divide-[var(--line)]">
        {inbox.map((request) => (
          <li className="px-4 py-3" key={request.id}>
            <p className="text-sm leading-5">
              {t.rich("invited", {
                invitedBy: request.invitedBy ?? t("someone"),
                groupName: request.groupName,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{f.dateTime(request.createdAt)}</p>
            {/* Two halves of the row: Accept, the invite page's green pill in small; Decline, quiet. */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={pendingId === request.id} onClick={() => void respond(request.id, "accept")}
                className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center rounded-full bg-[var(--main)] px-3 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_var(--main)] transition hover:-translate-y-px hover:shadow-[0_12px_24px_-10px_var(--main)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0">
                {pendingId === request.id ? "…" : t("accept")}
              </button>
              <button type="button" disabled={pendingId === request.id} onClick={() => void respond(request.id, "decline")}
                className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center rounded-full px-3 text-xs font-light text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55">
                {t("decline")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function NotificationsMenu({
  notifications,
  onAcceptRequest,
  onDeclineRequest,
}: {
  notifications: MemberRequest[];
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  const inbox = notifications ?? [];
  const count = inbox.length;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={count ? t("labelCount", { count }) : t("label")}
        aria-expanded={open}
      >
        <NotificationBell count={count} />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[var(--elevate-2)]" role="dialog" aria-label={t("title")}>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <strong className="text-sm">{t("title")}</strong>
            {count ? <span className="text-xs text-[var(--muted)]">{t("pending", { count })}</span> : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <NotificationList notifications={inbox} onAcceptRequest={onAcceptRequest} onDeclineRequest={onDeclineRequest} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CHALLENGE_STATUS_TONE: Record<
  "draft" | "scheduled" | "active" | "closed",
  { dot: string; border: string; solid: string }
> = {
  draft: { dot: "bg-[var(--warn-line)]", border: "border-[var(--warn-line)]", solid: "bg-[var(--warn-line)]" },
  scheduled: { dot: "bg-[var(--main-line)]", border: "border-[var(--main-line)]", solid: "bg-[var(--main-line)]" },
  active: { dot: "bg-[var(--ok-line)]", border: "border-[var(--ok-line)]", solid: "bg-[var(--ok-line)]" },
  closed: { dot: "bg-[var(--line)]", border: "border-[var(--line)]", solid: "bg-[var(--line)]" },
};

export function challengeStatusTone(status: ChallengeStatus, startsOn?: string | null, submissionMode?: SubmissionMode) {
  return CHALLENGE_STATUS_TONE[isChallengeScheduled(status, startsOn, submissionMode) ? "scheduled" : status];
}

export function ChallengeStatusBadge({ status, startsOn, submissionMode }: { status: ChallengeStatus; startsOn?: string | null; submissionMode?: SubmissionMode }) {
  const t = useTranslations("challengeStatus");
  const f = useGoaFormat();
  const tone = challengeStatusTone(status, startsOn, submissionMode);
  const label = f.challengeStatusLabel(status, startsOn, submissionMode);
  return (
    <span
      className={cx("inline-block h-2.5 w-2.5 flex-none rounded-full ring-1 ring-inset ring-[var(--edge)]", tone.dot)}
      role="img"
      aria-label={t("srLabel", { label })}
      title={label}
    />
  );
}
