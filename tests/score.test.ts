import assert from "node:assert/strict";
import test from "node:test";

import { combineParts, normalise, raterPart, scoreTitle, type NormalisedRating, type TitleTraits } from "../app/goa/score";
import { buildStory, type RatedStory, type StoryInput } from "../app/goa/story/model";
import { CATALOG_SCALE, catalogScores, roundKey, visibleTo } from "../lib/goa/challenges/goa-score";

const on5 = (value: number) => normalise(value, 0, 5);
const to5 = (value: number | null) => (value === null ? null : Math.round(value * 5 * 100) / 100);
const noTraits = () => ({}) as TitleTraits;

/** One person, n titles in the context averaging `usual` (on /5), as normalised history rows. */
function history(personId: string, n: number, usual: number, prefix = "h"): NormalisedRating[] {
  return Array.from({ length: n }, (_, index) => ({ personId, titleKey: `${prefix}${index}`, value: on5(usual) }));
}

test("três notas 5 deixam de empatar: o gosto de quem avaliou desempata", () => {
  // Usual 4.0 over 40 titles; taste for each title 4.53 / 4.44 / 4.00.
  const part = (taste: number) => ({ rating: 1, weight: 1, alpha: 40 / 48, usual: on5(4), taste: on5(taste) });
  assert.equal(to5(combineParts([part(4.53)])), 4.74);
  assert.equal(to5(combineParts([part(4.44)])), 4.72);
  assert.equal(to5(combineParts([part(4.0)])), 4.61);
});

test("o gosto vem dos atributos do histórico, ponderado pela evidência", () => {
  const traits: Record<string, TitleTraits> = { a: { genre: "fantasy" }, b: { genre: "fantasy" }, c: { genre: "drama" }, d: { genre: "drama" } };
  const past = new Map([["a", 1], ["b", 1], ["c", 0.4], ["d", 0.4]]);
  const part = raterPart(1, 1, past, (key) => traits[key] ?? {}, { genre: "fantasy" });
  assert.equal(part.usual, 0.7);
  assert.ok(Math.abs(part.alpha - 4 / 12) < 1e-9);
  // lift = (1 − 0.7) × 2/5 = 0.12, weighted .4 of the 1.0 total.
  assert.ok(Math.abs((part.taste ?? 0) - (0.7 + 0.4 * 0.12)) < 1e-9);
  // An unknown trait teaches nothing.
  assert.equal(raterPart(1, 1, past, (key) => traits[key] ?? {}, {}).taste, 0.7);
});

test("o score nunca sai da escala", () => {
  const rows = [{ personId: "p", titleKey: "x", value: 1 }];
  const top = scoreTitle(rows, history("p", 200, 0.2), noTraits)!;
  assert.ok(top <= 1 && top > 0.5);
  const bottom = scoreTitle([{ personId: "p", titleKey: "x", value: 0 }], history("p", 200, 5), noTraits)!;
  assert.ok(bottom >= 0 && bottom < 0.5);
});

test("títulos idênticos empatam", () => {
  const past = history("p", 20, 4);
  const one = scoreTitle([{ personId: "p", titleKey: "x", value: 1 }], past, noTraits);
  const two = scoreTitle([{ personId: "p", titleKey: "y", value: 1 }], past, noTraits);
  assert.equal(one, two);
});

test("sem histórico é a média simples; sem nota é null", () => {
  const rows = [{ personId: "a", titleKey: "x", value: 0.8 }, { personId: "b", titleKey: "x", value: 0.6 }];
  assert.ok(Math.abs(scoreTitle(rows, [], noTraits)! - 0.7) < 1e-9);
  assert.equal(scoreTitle([], history("a", 10, 4), noTraits), null);
});

test("/5 e /10 entram na mesma escala", () => {
  assert.equal(normalise(8, 0, 10), normalise(4, 0, 5));
  assert.equal(normalise(3, 1, 5), 0.5);
  const fives = history("p", 10, 4);
  const tens = fives.map((row) => ({ ...row, value: normalise(8, 0, 10) }));
  const rows = [{ personId: "p", titleKey: "x", value: 1 }];
  assert.equal(scoreTitle(rows, fives, noTraits), scoreTitle(rows, tens, noTraits));
});

test("o próprio título fica fora do histórico, e repetições contam uma vez", () => {
  const rows = [{ personId: "p", titleKey: "x", value: 1 }];
  const past = history("p", 10, 3);
  const withSelf = [...past, { personId: "p", titleKey: "x", value: 1 }, { personId: "p", titleKey: "x", value: 1 }];
  assert.equal(scoreTitle(rows, withSelf, noTraits), scoreTitle(rows, past, noTraits));
  // Three entries on one past title are one title, not three.
  const repeated = [...past, ...Array.from({ length: 3 }, () => ({ personId: "p", titleKey: "h0", value: on5(3) }))];
  assert.equal(scoreTitle(rows, repeated, noTraits), scoreTitle(rows, past, noTraits));
});

test("quem indicou pesa 0,8 — sozinho, pesa 1", () => {
  const rows = [{ personId: "a", titleKey: "x", value: 1, nominated: true }, { personId: "b", titleKey: "x", value: 0.5 }];
  assert.ok(Math.abs(scoreTitle(rows, [], noTraits)! - (0.8 + 0.5) / 1.8) < 1e-9);
  assert.equal(scoreTitle([rows[0]], [], noTraits), 1);
  // Two entries by one person on the title count once, as their average.
  assert.equal(scoreTitle([{ personId: "a", titleKey: "x", value: 1 }, { personId: "a", titleKey: "x", value: 0.5 }], [], noTraits), 0.75);
});

// ── The recap and the catalogue read the score without losing what people actually gave ──

const soloInput = (scores: StoryInput["scores"]): StoryInput => ({
  title: "Só eu", noun: "film", people: [{ id: "me", name: "Eu" }],
  items: [{ id: "lotr", title: "LOTR" }, { id: "hobbit", title: "Hobbit" }, { id: "romance", title: "Romance" }, { id: "meh", title: "Meh" }],
  ratings: [{ personId: "me", itemId: "lotr", value: 5 }, { personId: "me", itemId: "hobbit", value: 5 }, { personId: "me", itemId: "romance", value: 5 }, { personId: "me", itemId: "meh", value: 2 }],
  expectations: [], scale: { min: 0, max: 5 }, scores, days: [], records: [], today: "2026-10-01",
});

test("o recap ordena pela pontuação inteira, não pela arredondada — e mostra a média de verdade", () => {
  // Hobbit first in the item list, LOTR ahead by two hundredths: both would read 4.7 rounded.
  const input = soloInput({ hobbit: { value: 4.72, count: 1 }, lotr: { value: 4.74, count: 1 }, romance: { value: 4.61, count: 1 }, meh: { value: 2.2, count: 1 } });
  input.items = [input.items[1], input.items[0], input.items[2], input.items[3]];
  const story = buildStory(input) as RatedStory;
  assert.deepEqual(story.ranking.map((station) => station.item.id), ["lotr", "hobbit", "romance", "meh"]);
  assert.deepEqual(story.ranking.map((station) => station.average), [5, 5, 5, 2], "\"média\" continua sendo a média do que se deu");
  assert.equal(story.ranking[0].score, 4.74);
});

test("as notas máximas do recap solo são as que a pessoa deu, não a pontuação", () => {
  const story = buildStory(soloInput({ lotr: { value: 4.74, count: 1 }, hobbit: { value: 4.72, count: 1 }, romance: { value: 4.61, count: 1 }, meh: { value: 2.2, count: 1 } })) as RatedStory;
  assert.deepEqual(story.solo!.perfect.map((station) => station.item.id).sort(), ["hobbit", "lotr", "romance"]);
  assert.equal(story.solo!.lowest?.item.id, "meh");
});

test("uma pontuação que conta notas fora da tela não é usada", () => {
  const story = buildStory(soloInput({ lotr: { value: 1, count: 3 } })) as RatedStory;
  assert.equal(story.stations.find((station) => station.item.id === "lotr")!.score, 5);
});

/** A database stub answering the scoring query with `rows` (already in its column names). */
const stub = (rows: Array<Record<string, unknown>>) => ({ query: async () => ({ rows }) }) as unknown as Parameters<typeof catalogScores>[0];
const ratingRow = (over: Record<string, unknown>) => ({
  challenge_id: "c1", item_id: "i1", entry_type_id: "t1", catalog_item_id: "cat1", kind: "film", person_id: "a", value: 0.8, lo: 0, hi: 5,
  nominated: false, visibility: "group_realtime", closed: true, genre: null, author: null, year: null, runtime: null, pages: null, ...over,
});

test("o acervo mostra tudo de 0 a 5, mesmo com desafios em /5 e /10", async () => {
  // 4/5 and 8/10 are the same rating: the catalogue says 4, not the 6 that averaging the two scales gave.
  const scores = await catalogScores(stub([
    ratingRow({ challenge_id: "c1", item_id: "i1", person_id: "a", value: 0.8, hi: 5 }),
    ratingRow({ challenge_id: "c2", item_id: "i2", person_id: "b", value: 0.8, hi: 10 }),
  ]), "g", "a");
  assert.equal(scores.byCatalogItem.get("cat1")!.score, CATALOG_SCALE * 0.8);
  assert.equal(scores.byRound.get(roundKey("c2", "cat1"))!.score, 4);
});

test("nota oculta não entra nem como alvo nem como histórico de ninguém", async () => {
  const rows = (hidden: number) => [
    ratingRow({ item_id: "i1", catalog_item_id: "cat1", person_id: "b", value: 1 }),
    ...["h1", "h2", "h3"].map((id) => ratingRow({ challenge_id: "c9", item_id: id, catalog_item_id: id, person_id: "b", value: hidden, visibility: "author_only" })),
  ];
  const seenBy = async (viewer: string | null, hidden: number) => (await catalogScores(stub(rows(hidden)), "g", viewer)).byCatalogItem.get("cat1")!.score;
  assert.equal(await seenBy("a", 0), await seenBy("a", 1), "para outra pessoa, o histórico escondido não existe");
  assert.equal(await seenBy(null, 0), await seenBy(null, 1), "nem para uma página pública");
  assert.notEqual(await seenBy("b", 0), await seenBy("b", 1), "o próprio autor vê o seu");
  assert.equal(visibleTo([ratingRow({}), ratingRow({ visibility: "after_close", closed: false })].map(asVisibility), "z").length, 1);
});

const asVisibility = (row: ReturnType<typeof ratingRow>) => ({ personId: row.person_id, itemId: row.item_id, entryTypeId: row.entry_type_id, visibility: row.visibility, closed: row.closed });

test("after_own abre só o mesmo formulário do mesmo item que a pessoa respondeu", () => {
  const rows = [
    ratingRow({ person_id: "z", entry_type_id: "nota" }),
    ratingRow({ person_id: "b", entry_type_id: "nota", visibility: "after_own" }),
    ratingRow({ person_id: "b", entry_type_id: "roteiro", visibility: "after_own" }),
    ratingRow({ person_id: "b", item_id: "i2", entry_type_id: "nota", visibility: "after_own" }),
  ].map(asVisibility);
  const seen = visibleTo(rows, "z").map((row) => `${row.personId}:${row.entryTypeId}:${row.itemId}`);
  assert.deepEqual(seen, ["z:nota:i1", "b:nota:i1"], "responder a nota não abre o outro formulário nem outro item");
});
