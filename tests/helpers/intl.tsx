import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import ptBR from "../../messages/pt-BR.json";
import { type Formatter, makeGoaFormat, type Translator } from "../../app/goa/format";

const LOCALE = "pt-BR";
const TIME_ZONE = "America/Sao_Paulo";

// Enough of an app-router for components that call useRouter() during render.
const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]["value"];

/** Renders a component tree with the pt-BR catalog, matching the app's default. */
export function renderWithIntl(element: ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={stubRouter}>
      <NextIntlClientProvider locale={LOCALE} messages={ptBR} timeZone={TIME_ZONE}>
        {element}
      </NextIntlClientProvider>
    </AppRouterContext.Provider>,
  );
}

/** The shared formatters/status labels, wired to the pt-BR catalog for assertions. */
export const ptFormat = makeGoaFormat(
  createTranslator({ locale: LOCALE, messages: ptBR }) as unknown as Translator,
  createFormatter({ locale: LOCALE, timeZone: TIME_ZONE }) as unknown as Formatter,
);
