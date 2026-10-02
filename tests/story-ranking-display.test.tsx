import assert from "node:assert/strict";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import messages from "../messages/en.json";
import { useAlmanacPages } from "../app/goa/story/almanac";
import { buildStory, type StoryInput } from "../app/goa/story/model";

const input: StoryInput = {
  title: "Just me", noun: "film", people: [{ id: "me", name: "Me" }],
  items: ["lotr", "hobbit", "romance", "meh"].map((id) => ({ id, title: id.toUpperCase() })),
  ratings: [5, 5, 5, 2].map((value, index) => ({ personId: "me", itemId: ["lotr", "hobbit", "romance", "meh"][index], value })),
  expectations: [], scale: { min: 0, max: 5 }, days: [], records: [], today: "2026-10-01",
  scores: { lotr: { value: 4.74, count: 1 }, hobbit: { value: 4.72, count: 1 }, romance: { value: 4.61, count: 1 }, meh: { value: 2.2, count: 1 } },
};

function Rankings() {
  const pages = useAlmanacPages(buildStory(input), input, []);
  const page = pages.find((row) => row.id === "rankings")!;
  return <div><p>{page.headline}</p>{page.body}</div>;
}

test("the ranking shows the Goa score, two places, labelled — not three fives", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Rankings /></NextIntlClientProvider>,
  );
  for (const value of ["4.74", "4.72", "4.61", "2.2"]) assert.ok(html.includes(value), `shows ${value}`);
  assert.ok(html.includes("Goa score"), "the podium says what the number is");
  assert.ok(!html.includes(">5<"), "no plain five on the podium or the bars");
  assert.ok(html.indexOf("4.74") < html.indexOf("4.72") || html.includes("LOTR took it, at 4.74"), "LOTR leads");
});
