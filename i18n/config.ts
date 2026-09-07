export const locales = ["pt-BR", "en", "es"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "pt-BR";

export const LOCALE_COOKIE = "goa-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Picks a supported locale from an `Accept-Language` header. A short list, so a
 * full negotiator is overkill: a `pt` tag wins pt-BR, `es` wins Spanish, `en`
 * wins English, anything else falls back to the default.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0]?.toLowerCase() ?? "";
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return defaultLocale;
}
