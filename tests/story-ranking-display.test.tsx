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

test("the podium shows Goa scores to two places without repeating a label", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Rankings /></NextIntlClientProvider>,
  );
  for (const value of ["4.74", "4.72", "4.61", "2.2"]) assert.ok(html.includes(value), `shows ${value}`);
  assert.ok(!html.includes("Goa score"), "the podium does not repeat a label under every score");
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

test("long genre and year charts stay paired, horizontal and independently expandable", () => {
  const genres = ["Suspense", "Drama", "Comedy", "Sci-Fi", "Action", "Romance", "Horror"];
  const items = Array.from({ length: 19 }, (_, index) => ({
    id: `film-${index}`,
    title: `Film ${index + 1}`,
    year: 2001 + index,
    genre: genres[Math.min(Math.floor(index / 3), genres.length - 1)],
  }));
  const longRange: StoryInput = {
    ...input,
    items,
    ratings: items.map((item, index) => ({ personId: "me", itemId: item.id, value: 5 - index * 0.15 })),
    scores: undefined,
  };
  function Page() {
    const page = useAlmanacPages(buildStory(longRange), longRange, []).find((row) => row.id === "rankings")!;
    return <div>{page.body}</div>;
  }

  const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={messages} timeZone="America/Sao_Paulo"><Page /></NextIntlClientProvider>);
  assert.ok(html.includes('data-podium-mode="compact" data-podium-size="3"'));
  assert.ok(html.includes('data-podium-mode="full" data-podium-size="5"'));
  assert.deepEqual([...html.matchAll(/data-podium-place="(\d+)"/g)].map((match) => match[1]), ["2", "1", "3", "4", "2", "1", "3", "5"]);
  assert.ok(!html.includes('data-podium-place="04"') && !html.includes('data-podium-place="05"'), "podium places are never zero-padded");
  assert.ok(html.includes('data-ranking-layout="podium-with-rest"'));
  assert.ok(html.includes('data-ranking-rest="inline"'), "the remaining titles share the podium card instead of getting another white box");
  assert.deepEqual([...html.matchAll(/data-rank="(\d+)"/g)].map((match) => match[1]), ["04", "05", "06", "07", "08", "06", "07", "08", "09", "10"]);
  assert.ok(html.indexOf("Film 5") < html.indexOf("The rest of the ranking"));
  assert.ok(html.indexOf("The rest of the ranking") < html.indexOf("Film 6"), "the remaining ranking starts with number six");
  assert.ok(html.indexOf("Suspense wins") < html.indexOf("From 2001 to 2019"), "genre and year cards are consecutive grid columns");
  assert.ok(html.includes('data-chart-pair="genres-years"'));
  assert.ok(html.includes('data-horizontal-chart="genres" data-chart-rows="5"'));
  assert.ok(html.includes('data-horizontal-chart="years" data-chart-rows="5"'));
  assert.ok(html.includes("2001–03"));
  assert.equal(html.match(/Show 2 more/g)?.length, 2, "both long horizontal charts get their own show-more action");
  assert.ok(!html.includes("See every year") && !html.includes("data-scrollable-year-chart"));
  assert.ok(html.includes("Show all 19"));
  assert.ok(!html.includes("text-[var(--main-strong)]"), "the ranking action uses the same quiet treatment as comment actions");
});
