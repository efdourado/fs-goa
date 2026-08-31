import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";

import ptBR from "../../messages/pt-BR.json";
import { type Formatter, makeGoaFormat, type Translator } from "../../app/goa/format";

const LOCALE = "pt-BR";
const TIME_ZONE = "America/Sao_Paulo";

/** Renders a component tree with the pt-BR catalog, matching the app's default. */
export function renderWithIntl(element: ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={LOCALE} messages={ptBR} timeZone={TIME_ZONE}>
      {element}
    </NextIntlClientProvider>,
  );
}

/** The shared formatters/status labels, wired to the pt-BR catalog for assertions. */
export const ptFormat = makeGoaFormat(
  createTranslator({ locale: LOCALE, messages: ptBR }) as unknown as Translator,
  createFormatter({ locale: LOCALE, timeZone: TIME_ZONE }) as unknown as Formatter,
);
