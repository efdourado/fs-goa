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

test("each criterion shows who leads it on the rankings page", () => {
  const places: StoryInput = {
    title: "Bars", noun: "place", people: [{ id: "me", name: "Me" }],
    items: [{ id: "cantina", title: "Cantina" }, { id: "boteco", title: "Boteco" }],
    ratings: [
      { personId: "me", itemId: "cantina", value: 3.5, parts: { food: 5, vibe: 2 } },
      { personId: "me", itemId: "boteco", value: 3.5, parts: { food: 2, vibe: 5 } },
    ],
    dimensions: [{ id: "food", label: "Food", min: 0, max: 5 }, { id: "vibe", label: "Vibe", min: 0, max: 5 }],
    expectations: [], scale: { min: 0, max: 5 }, days: [], records: [], today: "2026-10-02",
  };
  function Page() {
    const page = useAlmanacPages(buildStory(places), places, []).find((row) => row.id === "rankings")!;
    return <div>{page.body}</div>;
  }
  const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Page /></NextIntlClientProvider>);
  assert.ok(html.includes("Food: Cantina leads"));
  assert.ok(html.includes("Vibe: Boteco leads"));
});

test("interactive words pages have fixed-height comments while downloadable pages keep the full text", () => {
  const withComments: StoryInput = {
    ...input,
    ratings: input.ratings.map((rating, index) => ({
      ...rating,
      comment: `A complete opinion ${index + 1} with enough words to belong on the words page.`,
    })),
  };
  function Words({ full = false }: { full?: boolean }) {
    const page = useAlmanacPages(buildStory(withComments), withComments, [], full).find((row) => row.id === "words")!;
    return <div>{page.body}</div>;
  }

  const interactive = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Words /></NextIntlClientProvider>);
  assert.ok(interactive.includes('data-collapsible-comment="true"'));
  assert.ok(interactive.includes("min-height:232px;max-height:232px"));

  const downloadable = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Words full /></NextIntlClientProvider>);
  assert.ok(!downloadable.includes("data-collapsible-comment"));
  assert.ok(downloadable.includes("A complete opinion 1"));
});

test("a long run of years stays readable instead of squeezing every column", () => {
  const items = Array.from({ length: 16 }, (_, index) => ({
    id: `film-${index}`,
    title: `Film ${index + 1}`,
    year: 1995 + index,
  }));
  const longRange: StoryInput = {
    ...input,
    items,
    ratings: items.map((item, index) => ({ personId: "me", itemId: item.id, value: 2.5 + (index % 5) * 0.5 })),
    scores: undefined,
  };
  function Page() {
    const page = useAlmanacPages(buildStory(longRange), longRange, []).find((row) => row.id === "rankings")!;
    return <div>{page.body}</div>;
  }

  const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Page /></NextIntlClientProvider>);
  assert.ok(html.includes('data-scrollable-year-chart="true"'));
  assert.ok(html.includes("min-width:704px"), "each of the sixteen years keeps a readable 44px column");
  assert.ok(html.includes("Show all 16"));
  assert.ok(!html.includes("text-[var(--main-strong)]"), "the ranking action uses the same quiet treatment as comment actions");
});
