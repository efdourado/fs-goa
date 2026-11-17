"use client";

import { Children, createContext, useContext, isValidElement, type ComponentPropsWithRef } from "react";

/** CSS follows the real :disabled state, including an enclosing disabled fieldset. */
export function LockStateIcon({ locked }: { locked: boolean }) {
  return <svg viewBox="0 0 24 24" className="goa-readiness-icon h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-lock-state={locked ? "locked" : "unlocked"}>
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path className="goa-lock-closed" d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path className="goa-lock-open" d="M8 10V7a4 4 0 0 1 7.5-2" />
    <path d="M12 15v2" />
  </svg>;
}

const ReadinessScope = createContext(false);

/** Preserve native fieldset disabling while making its action readiness explicit to descendants. */
export function StateFieldset(props: ComponentPropsWithRef<"fieldset">) {
  const inherited = useContext(ReadinessScope);
  return <ReadinessScope.Provider value={inherited || Object.hasOwn(props, "disabled")}><fieldset {...props} /></ReadinessScope.Provider>;
}

type Props = ComponentPropsWithRef<"button"> & {
  readiness?: boolean;
  tone?: "primary" | "secondary" | "ghost" | "danger";
};

/** One native button contract for action readiness. Choice controls retain their selected-state styling. */
export function StateButton({ children, className = "", readiness, tone, ...props }: Props) {
  const inherited = useContext(ReadinessScope);
  const availableState = inherited || (readiness ?? (Object.hasOwn(props, "disabled") || props.type === "submit"));
  const choice = ["switch", "radio", "option", "slider"].includes(String(props.role))
    || props["aria-pressed"] !== undefined || props["aria-selected"] !== undefined || Boolean(props["aria-haspopup"]);
  const parts = Children.toArray(children).filter((child) => typeof child !== "string" || child.trim());
  const iconOnly = parts.length === 1 && (isValidElement(parts[0])
    ? typeof parts[0].type !== "string" || parts[0].type === "svg"
    : typeof parts[0] === "string" && /^[＋+−–‹›↻×✕]$/.test(parts[0].trim()));
  const replaceIcon = iconOnly && (props.type === "submit" || className.includes("bg-[var(--main)]"));
  return <button {...props} className={`goa-state-button ${className}`} data-readiness={availableState ? "true" : undefined} data-choice={choice ? "true" : undefined} data-button-tone={tone} data-compact={iconOnly || choice ? "true" : undefined} data-replace-icon={replaceIcon ? "true" : undefined}>
    {iconOnly ? <span className="goa-button-content">{children}</span> : children}
    <span className="goa-readiness-marker" aria-hidden="true"><LockStateIcon locked={Boolean(props.disabled)} /></span>
  </button>;
}
