"use server";

import { cookies, headers } from "next/headers";

import { isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "./config";

/**
 * Resolves the active locale: an explicit cookie choice wins; otherwise the
 * visitor's `Accept-Language` is negotiated on first load; the default is the
 * last resort. Read by `i18n/request.ts` and the root layout.
 */
export async function getUserLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const requestHeaders = await headers();
  return localeFromAcceptLanguage(requestHeaders.get("accept-language"));
}

/** Server action behind the in-app language switch. */
export async function setUserLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
  });
}
