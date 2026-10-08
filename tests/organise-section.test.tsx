import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { AdminItemsSection } from "../app/goa/screens/admin";
import type { ChallengeDetail } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const book = (id: string, year: number, author: string) => ({ id, title: id, position: 0, catalogItem: { id: `c-${id}`, kind: "book", title: id, year, author } });
const challenge = (items: ReturnType<typeof book>[], status = "active") => ({
  id: "c", status, submissionMode: "item", libraries: [{ id: "lib", kind: "book", source: "pages", label: null }], items,
} as unknown as ChallengeDetail);

test("Geral mostra Organizar quando há 3 itens ainda não registrados com algum detalhe para espalhar", () => {
  const html = renderWithIntl(createElement(AdminItemsSection, {
    challenge: challenge([book("a", 2001, "X"), book("b", 2010, "Y"), book("c", 2020, "X")]), entries: [], onReorder: async () => undefined,
  }));
  assert.match(html, /Organizar itens/);
});

test("sem itens livres suficientes (os registrados ficam no lugar), Organizar não aparece", () => {
  const items = [book("a", 2001, "X"), book("b", 2010, "Y"), book("c", 2020, "X")];
  const html = renderWithIntl(createElement(AdminItemsSection, {
    challenge: challenge(items), entries: [{ id: "e", itemId: "a", values: {} }] as never, onReorder: async () => undefined,
  }));
  assert.equal(html, "", "dois itens livres não bastam");
});
