import assert from "node:assert/strict";
import test from "node:test";

import { combineParts, normalise, raterPart, scoreTitle, type NormalisedRating, type TitleTraits } from "../app/goa/score";

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
