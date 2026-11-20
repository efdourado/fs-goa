"use client";

import type { ComponentPropsWithRef } from "react";

type Props = ComponentPropsWithRef<"button"> & {
  readiness?: boolean;
};

/** Primary confirmation actions can opt into the shared disabled styling. */
export function StateButton({ className = "", readiness, ...props }: Props) {
  const choice = ["switch", "radio", "option", "slider", "tab", "menuitemradio", "menuitemcheckbox"].includes(String(props.role))
    || props["aria-pressed"] !== undefined || props["aria-selected"] !== undefined || Boolean(props["aria-haspopup"]);
  return <button {...props} className={`goa-state-button ${className}`} data-readiness={readiness && !choice ? "true" : undefined} data-choice={choice ? "true" : undefined} />;
}
