import assert from "node:assert/strict";
import test from "node:test";

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
