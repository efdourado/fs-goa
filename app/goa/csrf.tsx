"use client";

import { createContext, type ReactNode, useContext } from "react";

const CsrfContext = createContext("");

/** The signed-in session's CSRF token, so a deeply nested control can save without every screen passing it down. */
export function CsrfProvider({ token, children }: { token: string; children: ReactNode }) {
  return <CsrfContext.Provider value={token}>{children}</CsrfContext.Provider>;
}

export function useCsrf(): string {
  return useContext(CsrfContext);
}
