import { getRequestConfig } from "next-intl/server";

import { defaultLocale, isLocale } from "./config";
import { getUserLocale } from "./locale";

export default getRequestConfig(async () => {
  const requested = await getUserLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // The product treats São Paulo as "the" wall clock (daily checkpoints, "hoje"),
    // so format dates there regardless of where the function runs.
    timeZone: "America/Sao_Paulo",
  };
});
