import assert from "node:assert/strict";
import test from "node:test";

import { challengeRequestBody } from "../app/goa/challenge-request";
import type { ChallengeCreationInput } from "../app/goa/types";

const base: ChallengeCreationInput = {
  recipe: "custom",
  title: "Treino",
  description: "",
  ruleSections: [],
  startsOn: null,
  endsOn: null,
  fields: [],
  items: [],
  generateDaily: false,
  participantIds: [],
};

test("um check-in com vários itens chega ao servidor com o modo, o nome e o rótulo da nota", () => {
  const body = challengeRequestBody({ ...base, recordingMode: "session", sessionName: "Treino", sessionNoteLabel: "Como foi?" });
  assert.equal(body.recordingMode, "session");
  assert.equal(body.sessionName, "Treino");
  assert.equal(body.sessionNoteLabel, "Como foi?");
});

test("o que o formulário não escolheu não vai no pedido, para o servidor usar o padrão da receita", () => {
  const body = challengeRequestBody(base);
  for (const key of ["recordingMode", "sessionName", "sessionNoteLabel", "collectsEntryDate", "answerScope", "sharedEditPolicy", "itemDates", "libraries"]) {
    assert.ok(!(key in body), `${key} ficou de fora`);
  }
  assert.equal(body.expectation, false);
});

test("toda configuração do formulário é repassada — uma nova que ficar de fora quebra aqui", () => {
  // `Required<…>` obriga este objeto a listar cada campo do tipo; se alguém acrescentar um, o compilador cobra aqui.
  const full: Required<ChallengeCreationInput> = {
    ...base,
    libraries: [{ libraryKind: "film" }],
    expectation: true,
    collectsEntryDate: true,
    answerScope: "shared",
    recordingMode: "session",
    sessionName: "Treino",
    sessionNoteLabel: "Como foi?",
    sharedEditPolicy: "members_can_edit",
    itemDates: true,
  };
  assert.deepEqual(Object.keys(challengeRequestBody(full)).sort(), Object.keys(full).sort());
});
