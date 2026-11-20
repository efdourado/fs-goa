"use client";

import { NextIntlClientProvider, useLocale, useTranslations, type AbstractIntlMessages } from "next-intl";
import { createContext, type ReactNode, useContext, useState } from "react";

import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { StatusMessage } from "./ui";

const AppLocaleContext = createContext<{
  pendingLocale: Locale | null;
  changeLocale: (locale: Locale) => Promise<void>;
} | null>(null);

export function useAppLocaleSwitch() {
  return useContext(AppLocaleContext);
}

/** Update the app's translations without refreshing its client-managed screens. */
export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const initialLocale = useLocale();
  const [selection, setSelection] = useState<{ locale: Locale; messages: AbstractIntlMessages } | null>(null);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [failed, setFailed] = useState(false);
  const locale = selection?.locale ?? initialLocale;

  async function changeLocale(next: Locale) {
    if (pendingLocale || next === locale) return;
    setPendingLocale(next);
    setFailed(false);
    try {
      const { default: messages } = await import(`../../messages/${next}.json`);
      document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
      document.documentElement.lang = next;
      setSelection({ locale: next, messages });
    } catch {
      setFailed(true);
    } finally {
      setPendingLocale(null);
    }
  }

  return (
    <AppLocaleContext.Provider value={{ pendingLocale, changeLocale }}>
      <NextIntlClientProvider locale={locale} messages={selection?.messages}>
        {children}
        {failed ? <LocaleError /> : null}
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>
  );
}

function LocaleError() {
  const t = useTranslations("errors");
  return <StatusMessage error={t("generic")} />;
}
