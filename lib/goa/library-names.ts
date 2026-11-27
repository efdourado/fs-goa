import { cookies, headers } from "next/headers";

import { defaultLocale, isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "@/i18n/config";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import ptBR from "@/messages/pt-BR.json";

type LibrarySource = "screens" | "pages" | "tables" | "custom";
const NAMES: Record<Locale, Record<LibrarySource, string>> = {
  "pt-BR": ptBR.libraries.source,
  en: en.libraries.source,
  es: es.libraries.source,
};

/** The language of the request being served, or the default outside one (a script, a test). */
async function requestLocale(): Promise<Locale> {
  try {
    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(fromCookie)) return fromCookie;
    return localeFromAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    return defaultLocale;
  }
}

/**
 * The name a library is born with when nobody typed one ("Filmes e séries", "Lugares"), in the language of
 * whoever creates it. Saved once: from then on it is the library's own name and never translated again.
 */
export async function defaultLibraryName(source: LibrarySource): Promise<string> {
  return NAMES[await requestLocale()][source];
}
