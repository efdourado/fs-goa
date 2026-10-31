import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { ChallengeCoverRules, rulesScrollShadows } from "../app/goa/rules";
import { MAX_CHALLENGE_RULES } from "../lib/goa/domain/rule-limits";
import { renderWithIntl } from "./helpers/intl";

import { parseRuleSections, rulesCompatibilityText } from "../lib/goa/domain/rules";

test("valida e normaliza regras tituladas preservando a ordem", () => {
  const sections = parseRuleSections([
    { title: "  Meta diária ", description: " Ler vinte páginas. " },
    { title: "Registro", description: "Preencher até o fim do dia." },
  ]);
  assert.deepEqual(sections, [
    { title: "Meta diária", description: "Ler vinte páginas." },
    { title: "Registro", description: "Preencher até o fim do dia." },
  ]);
  assert.equal(
    rulesCompatibilityText(sections),
    "Meta diária\nLer vinte páginas.\n\nRegistro\nPreencher até o fim do dia.",
  );
});

test("guarda os tópicos aninhados da regra e os numera no texto de compatibilidade", () => {
  const sections = parseRuleSections([
    {
      title: "Indicações",
      description: "Faremos rodadas de indicação.",
      topics: [
        { title: "qualquer coisa", description: "vale tudo" },
        { title: "  segunda rodada  ", description: "  depois organizamos  " },
      ],
    },
    { title: "Registro", description: "Preencher até o fim do dia." },
  ]);
  assert.deepEqual(sections, [
    {
      title: "Indicações",
      description: "Faremos rodadas de indicação.",
      topics: [
        { title: "qualquer coisa", description: "vale tudo" },
        { title: "segunda rodada", description: "depois organizamos" },
      ],
    },
    { title: "Registro", description: "Preencher até o fim do dia." },
  ]);
  assert.equal(
    rulesCompatibilityText(sections),
    "Indicações\nFaremos rodadas de indicação.\n1.1 qualquer coisa\nvale tudo\n1.2 segunda rodada\ndepois organizamos\n\nRegistro\nPreencher até o fim do dia.",
  );
});

test("rejeita tópico incompleto e passa do limite por regra", () => {
  assert.throws(() => parseRuleSections([
    { title: "R", description: "D", topics: [{ title: "", description: "x" }] },
  ]));
  assert.throws(() => parseRuleSections([
    { title: "R", description: "D", topics: Array.from({ length: 13 }, (_, i) => ({ title: `t${i}`, description: "d" })) },
  ]));
});

test("converte o texto legado sem perder conteúdo", () => {
  assert.deepEqual(parseRuleSections(undefined, "  Respeitar os prazos.  "), [
    { title: "Regras do desafio", description: "Respeitar os prazos." },
  ]);
  assert.deepEqual(parseRuleSections(undefined, null), []);
  assert.throws(() => parseRuleSections(undefined, 42));
  assert.equal(parseRuleSections(undefined, "x".repeat(10_000))[0]?.description.length, 10_000);
});

test("rejeita regras incompletas, formatos inválidos e limites excessivos", () => {
  assert.throws(() => parseRuleSections({ title: "Não é lista" }));
  assert.throws(() => parseRuleSections([{ title: "", description: "Texto" }]));
  assert.throws(() => parseRuleSections([{ title: "Título", description: "" }]));
  assert.throws(() => parseRuleSections(Array.from({ length: 21 }, (_, index) => ({
    title: `Regra ${index + 1}`,
    description: "Descrição",
  }))));
  assert.throws(() => parseRuleSections(Array.from({ length: 6 }, (_, index) => ({
    title: `Regra ${index + 1}`,
    description: "x".repeat(2_000),
  }))));
});

test("new challenges allow ten rules and existing challenges can still load twenty", () => {
  const rules = Array.from({ length: 20 }, (_, index) => ({ title: `Rule ${index + 1}`, description: "Description" }));
  assert.equal(parseRuleSections(rules.slice(0, MAX_CHALLENGE_RULES), undefined, MAX_CHALLENGE_RULES).length, 10);
  assert.throws(() => parseRuleSections(rules.slice(0, 11), undefined, MAX_CHALLENGE_RULES), /10 regras/);
  assert.equal(parseRuleSections(rules).length, 20);
});

test("cover rules start folded in a bounded scroll region and retain the ticket waist when empty", () => {
  const html = renderWithIntl(createElement(ChallengeCoverRules, { rules: [{ title: "Respect deadlines", description: "Submit before midnight." }] }));
  assert.match(html, /challenge-ticket-bottom/);
  assert.match(html, /challenge-ticket-waist-lower/);
  assert.ok(html.indexOf("challenge-ticket-waist-lower") > html.indexOf("</summary>"));
  assert.ok(html.indexOf("challenge-ticket-waist-lower") < html.indexOf("</details>"));
  assert.match(html, /<details[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/);
  assert.match(html, /<summary/);
  assert.match(html, /max-h-\[min\(20rem,50dvh\)\] overflow-x-hidden overflow-y-auto/);
  assert.doesNotMatch(html, /class="h-80/);
  const summary = html.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? "";
  assert.match(summary, /<svg/);
  assert.match(summary, /<span[^>]*challenge-ticket-waist/);
  assert.equal(summary.replace(/<[^>]*>/g, "").trim(), "", "the toggle remains icon-only");
  assert.match(html, /Respect deadlines/);
  const empty = renderWithIntl(createElement(ChallengeCoverRules, { rules: [] }));
  assert.match(empty, /challenge-ticket-waist/);
  assert.doesNotMatch(empty, /<summary|<details|role="region"/);
});


test("rules scroll shadows disappear at either end, including iOS overscroll and content that fits", () => {
  const viewport = { scrollHeight: 700, clientHeight: 300 };
  assert.deepEqual(rulesScrollShadows({ ...viewport, scrollTop: 0 }), { above: 0, below: 1 });
  assert.deepEqual(rulesScrollShadows({ ...viewport, scrollTop: 200 }), { above: 1, below: 1 });
  assert.deepEqual(rulesScrollShadows({ ...viewport, scrollTop: 400 }), { above: 1, below: 0 });
  assert.deepEqual(rulesScrollShadows({ ...viewport, scrollTop: -30 }), { above: 0, below: 1 });
  assert.deepEqual(rulesScrollShadows({ ...viewport, scrollTop: 430 }), { above: 1, below: 0 });
  assert.deepEqual(rulesScrollShadows({ scrollHeight: 200, clientHeight: 300, scrollTop: 0 }), { above: 0, below: 0 });
  assert.ok(rulesScrollShadows({ ...viewport, scrollTop: 390 }).below < 1, "the bottom shadow fades as the end approaches");
});
