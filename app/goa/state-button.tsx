"use client";

import { Children, isValidElement, type ComponentPropsWithRef } from "react";

/** CSS follows the real :disabled state, including an enclosing disabled fieldset. */
export function LockStateIcon({ locked }: { locked: boolean }) {
  return <svg viewBox="0 0 24 24" className="goa-readiness-icon h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-lock-state={locked ? "locked" : "unlocked"}>
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path className="goa-lock-closed" d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path className="goa-lock-open" d="M8 10V7a4 4 0 0 1 7.5-2" />
    <path d="M12 15v2" />
  </svg>;
}

type Props = ComponentPropsWithRef<"button"> & {
  readiness?: boolean;
  tone?: "primary" | "secondary" | "ghost" | "danger";
};

/** Readiness is opt-in for primary confirmation actions, never inferred from disabled. */
export function StateButton({ children, className = "", readiness, tone, ...props }: Props) {
  const choice = ["switch", "radio", "option", "slider", "tab", "menuitemradio", "menuitemcheckbox"].includes(String(props.role))
    || props["aria-pressed"] !== undefined || props["aria-selected"] !== undefined || Boolean(props["aria-haspopup"]);
  const availableState = !choice && (readiness ?? tone === "primary");
  const parts = Children.toArray(children).filter((child) => typeof child !== "string" || child.trim());
  const iconOnly = availableState && parts.length === 1 && (isValidElement(parts[0])
    ? typeof parts[0].type !== "string" || parts[0].type === "svg"
    : typeof parts[0] === "string" && /^[＋+−–‹›↻×✕]$/.test(parts[0].trim()));
  const replaceIcon = iconOnly && (props.type === "submit" || className.includes("bg-[var(--main)]"));
  return <button {...props} className={`goa-state-button ${className}`} data-readiness={availableState ? "true" : undefined} data-choice={choice ? "true" : undefined} data-button-tone={tone} data-compact={iconOnly || choice ? "true" : undefined} data-replace-icon={replaceIcon ? "true" : undefined}>
    {iconOnly ? <span className="goa-button-content">{children}</span> : children}
    {availableState ? <span className="goa-readiness-marker" aria-hidden="true"><LockStateIcon locked={Boolean(props.disabled)} /></span> : null}
  </button>;
}
