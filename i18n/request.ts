import { getRequestConfig } from "next-intl/server";

import en from "../messages/en.json";
import es from "../messages/es.json";
import ptBR from "../messages/pt-BR.json";
import { defaultLocale, isLocale, type Locale } from "./config";
import { getUserLocale } from "./locale";

const messagesByLocale = { en, es, "pt-BR": ptBR } satisfies Record<Locale, unknown>;

export default getRequestConfig(async () => {
  const requested = await getUserLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: messagesByLocale[locale],
    // The product treats São Paulo as "the" wall clock (daily checkpoints, "hoje"),
    // so format dates there regardless of where the function runs.
    timeZone: "America/Sao_Paulo",
  };
});
