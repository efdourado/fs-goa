/**
 * `npm run db:seed-showcase` — the showcase era's story on @dudupizzas's LOCAL account, so every new
 * piece can be seen for real: a movie club ("Cineclube de Sexta") with the four demo friends where
 *
 *   · Temporada 1 is over — 8 films, blind ratings, expectations, comments → Results has the recap;
 *   · Temporada 2 is running with "reveal together" — Oppenheimer already revealed, Pobres Criaturas
 *     sealed with every friend's rating in and yours missing (rate it, then tap Reveal), one film ahead;
 *   · the group page's taste map is filled from both seasons.
 *
 * The ratings are written to tell a story (scripts/seed-showcase/data.ts). You play "Ana".
 * Goes through the domain services; refuses any non-local database; `--reset` removes only this group.
 */
import process from "node:process";

import { registerAccount, type SessionContext } from "../../lib/auth";
import { getPool, oneOrNull, withClient } from "../../lib/db";
import { createChallenge, createGroup, createPersonalChallenge, requestGroupMember, respondToMemberRequest } from "../../lib/goa-domain";
import { revealItem, saveEntry, transitionChallenge } from "../../lib/goa-challenges";
import { purgeChallengeRows, purgeGroupRows } from "../../lib/goa/purge";
import { ApiError } from "../../lib/http";
import { COMMENTS_PT, demoFilmInput, demoReadingInput, NOTES_PT } from "./data";

import { addDays, backdateLifecycle, fail, isSeedError, looksRemote, readShape, resolveAccount, sessionFor } from "../seed-reading/helpers";
import { DEMO_PASSWORD, FRIENDS } from "../seed-local/data";

const ORIGIN = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const GROUP_NAME = "Cineclube de Sexta";
const PERSONAL_TITLES = ["Só eu", "Correr"];
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const day = (offset: number) => addDays(today, offset);

type Person = { id: string; name: string; session: SessionContext };

async function friend(key: (typeof FRIENDS)[number]["key"]): Promise<Person> {
  const spec = FRIENDS.find((row) => row.key === key)!;
  const existing = await withClient((client) => oneOrNull<{ id: string; display_name: string; email: string | null }>(
    client, "SELECT id, display_name, email FROM users WHERE username_normalized = $1 AND deleted_at IS NULL", [spec.username],
  ));
  const user = existing
    ? { id: existing.id, name: existing.display_name, email: existing.email }
    : (await registerAccount({ name: spec.name, username: spec.username, password: DEMO_PASSWORD })).user;
  return { id: user.id, name: user.name, session: sessionFor({ id: user.id, name: user.name, username: spec.username, email: user.email ?? null, platformAdmin: false }) };
}

async function rate(person: Person, challengeId: string, body: Record<string, unknown>): Promise<void> {
  await saveEntry(person.session, challengeId, { participantId: person.id, ...body });
}

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--reset");
  if (unknown.length) fail(`Argumento não reconhecido: ${unknown.join(" ")}`);
  if (looksRemote()) fail("db:seed-showcase só roda num banco local (DATABASE_URL em localhost). Nada foi feito.");

  console.log("\n\x1b[1mdb:seed-showcase\x1b[0m");
  const account = await resolveAccount();
  const me: Person = { id: account.id, name: account.name, session: sessionFor(account) };
  console.log(`conta: @${account.username}`);

  const leftover = await withClient((client) => oneOrNull<{ id: string }>(
    client, "SELECT id FROM groups WHERE owner_user_id = $1 AND kind = 'standard' AND name = $2 AND deleted_at IS NULL", [me.id, GROUP_NAME],
  ));
  const personalLeftovers = await withClient(async (client) => (await client.query<{ id: string }>(
    `SELECT c.id FROM challenges c JOIN groups g ON g.id = c.group_id
      WHERE g.owner_user_id = $1 AND g.kind = 'personal' AND c.title = ANY($2::text[])`,
    [me.id, PERSONAL_TITLES],
  )).rows);
  if (personalLeftovers.length && !reset) fail(`Já existem desafios pessoais desta seed (${PERSONAL_TITLES.join(", ")}). Rode com --reset para recriá-los.`);
  if (personalLeftovers.length) {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try { for (const row of personalLeftovers) await purgeChallengeRows(client, row.id); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  }
  if (leftover) {
    if (!reset) fail(`O grupo "${GROUP_NAME}" já existe. Rode com --reset para recriá-lo.`);
    await withClient(async (client) => {
      await client.query("BEGIN");
      try { await purgeGroupRows(client, leftover.id); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
    console.log("grupo anterior removido");
  }

  // The story's five people, played by you and the four demo friends.
  const friends = [await friend("vivi"), await friend("rafa"), await friend("lu"), await friend("theo")];
  const cast: Record<string, Person> = { ana: me, bruno: friends[0], caio: friends[1], duda: friends[2], lucas: friends[3] };
  const everyone = Object.values(cast);

  const group = await createGroup(me.session, { name: GROUP_NAME, description: "Um filme por semana. Nota às cegas, revelação na sexta." });
  for (const person of friends) {
    const username = FRIENDS.find((row) => row.name === person.name)?.username ?? "";
    await requestGroupMember(me.session, group.id, { username });
    const request = await withClient((client) => oneOrNull<{ id: string }>(
      client, "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'", [group.id, person.id],
    ));
    if (request) await respondToMemberRequest(person.session, request.id, "accept");
  }

  // ── Temporada 1: eight films, over and done ──
  const story = demoFilmInput("Temporada 1", (key) => COMMENTS_PT[key], today);
  const s1Start = day(-63);
  const s1End = day(-4);
  const s1 = await createChallenge(me.session, group.id, {
    recipe: "cinema", title: "Temporada 1", description: "Oito filmes, oito sextas. Palpite antes, nota às cegas depois.",
    startsOn: s1Start, endsOn: s1End, expectation: true, revealTogether: true,
    participantIds: everyone.map((person) => person.id),
    items: story.items.map((item) => ({ title: item.title, year: item.year, mainGenre: item.genre, runtimeMinutes: item.runtime, author: item.properties?.[0]?.value })),
  });
  const shape1 = await readShape(s1.challengeId);
  await transitionChallenge(me.session, s1.challengeId, { status: "active" });
  const titleOf = (id: string) => story.items.find((item) => item.id === id)!.title;
  for (const expectation of story.expectations) {
    await rate(cast[expectation.personId], s1.challengeId, { itemId: shape1.itemId(titleOf(expectation.itemId)), entryTypeId: shape1.typeByPurpose.get("expectation"), values: { expectativa: expectation.value } });
  }
  for (const rating of story.ratings) {
    await rate(cast[rating.personId], s1.challengeId, {
      itemId: shape1.itemId(titleOf(rating.itemId)), entryTypeId: shape1.typeByPurpose.get("rating"),
      values: { nota: rating.value, ...(rating.comment ? { comentario: rating.comment } : {}) },
    });
  }
  await transitionChallenge(me.session, s1.challengeId, { status: "closed" });
  await backdateLifecycle(s1.challengeId, s1Start, s1End);
  console.log("  · Temporada 1 (encerrada, a aba Resultado mostra o fio e o almanaque)");

  // ── Temporada 2: running, reveal together ──
  const s2 = await createChallenge(me.session, group.id, {
    recipe: "cinema", title: "Temporada 2", description: "Três filmes. Ninguém vê a nota de ninguém até alguém revelar.",
    startsOn: day(-6), endsOn: day(30), expectation: true, revealTogether: true,
    participantIds: everyone.map((person) => person.id),
    items: [{ title: "Oppenheimer", year: 2023 }, { title: "Pobres Criaturas", year: 2023 }, { title: "Os Rejeitados", year: 2023 }],
  });
  const shape2 = await readShape(s2.challengeId);
  await transitionChallenge(me.session, s2.challengeId, { status: "active" });
  const s2Rating = (person: Person, title: string, nota: number, comentario?: string) => rate(person, s2.challengeId, {
    itemId: shape2.itemId(title), entryTypeId: shape2.typeByPurpose.get("rating"), values: { nota, ...(comentario ? { comentario } : {}) },
  });
  const s2Guess = (person: Person, title: string, expectativa: number) => rate(person, s2.challengeId, {
    itemId: shape2.itemId(title), entryTypeId: shape2.typeByPurpose.get("expectation"), values: { expectativa },
  });

  // Oppenheimer — everyone rated, already revealed.
  for (const [person, guess, nota, comment] of [
    [cast.ana, 4.5, 4, "Três horas que passaram em duas."],
    [cast.bruno, 5, 5, "Cinema com C maiúsculo."],
    [cast.caio, 4, 3, undefined],
    [cast.duda, 4, 3.5, "O som da explosão ainda está no meu peito."],
    [cast.lucas, 4.5, 4, undefined],
  ] as const) {
    await s2Guess(person, "Oppenheimer", guess);
    await s2Rating(person, "Oppenheimer", nota, comment);
  }
  await revealItem(cast.bruno.session, s2.challengeId, shape2.itemId("Oppenheimer"));

  // Pobres Criaturas — the four friends are in, sealed; yours is the one missing.
  for (const [person, guess, nota, comment] of [
    [cast.bruno, 3.5, 4.5, "Estranho do jeito certo."],
    [cast.caio, 3, 1.5, "Não era para mim. Nada disso era para mim."],
    [cast.duda, 3.5, 4.5, "Emma Stone merece tudo."],
    [cast.lucas, 3, 2, "Bonito de olhar, cansativo de assistir."],
  ] as const) {
    await s2Guess(person, "Pobres Criaturas", guess);
    await s2Rating(person, "Pobres Criaturas", nota, comment);
  }
  console.log("  · Temporada 2 (em andamento, dê a sua nota a Pobres Criaturas e toque em Revelar)");

  // ── 30 dias de leitura: a reading month, as a group habit ──
  const month = demoReadingInput("30 dias de leitura", (key) => NOTES_PT[key], today);
  const habit = await createChallenge(me.session, group.id, {
    recipe: "habit", title: "30 dias de leitura", description: "Um pouco todo dia. Quem para, volta.",
    startsOn: month.startsOn, endsOn: day(1),
    participantIds: [cast.ana, cast.bruno, cast.duda, cast.lucas].map((person) => person.id),
    fields: [
      { key: "paginas", label: "Páginas", type: "number", required: true, config: { min: 0, step: 1 } },
      { key: "nota_dia", label: "Como foi?", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ],
  });
  const habitShape = await readShape(habit.challengeId);
  await transitionChallenge(me.session, habit.challengeId, { status: "active" }).catch(() => undefined);
  for (const row of month.days) {
    await rate(cast[row.personId], habit.challengeId, {
      entryTypeId: habitShape.typeByPurpose.get("checkin"), occurredOn: row.day,
      values: { paginas: row.value ?? 0, ...(row.note ? { nota_dia: row.note } : {}) },
    });
  }
  console.log("  · 30 dias de leitura (hábito em grupo, Resultado mostra o fio dos dias)");

  // ── Nós dois: the same eight films, just you and Rafa (the story's Ana and Caio — opposite tastes) ──
  const duoStart = day(-40);
  const duo = await createChallenge(me.session, group.id, {
    recipe: "cinema", title: "Nós dois", description: "Oito filmes, duas opiniões.", startsOn: duoStart, endsOn: day(-2),
    participantIds: [cast.ana.id, cast.caio.id],
    items: story.items.map((item) => ({ title: item.title, year: item.year, mainGenre: item.genre, runtimeMinutes: item.runtime, author: item.properties?.[0]?.value })),
  });
  const duoShape = await readShape(duo.challengeId);
  await transitionChallenge(me.session, duo.challengeId, { status: "active" });
  for (const rating of story.ratings.filter((row) => row.personId === "ana" || row.personId === "caio")) {
    await rate(cast[rating.personId], duo.challengeId, {
      itemId: duoShape.itemId(titleOf(rating.itemId)), entryTypeId: duoShape.typeByPurpose.get("rating"),
      values: { nota: rating.value, ...(rating.comment ? { comentario: rating.comment } : {}) },
    });
  }
  await transitionChallenge(me.session, duo.challengeId, { status: "closed" });
  await backdateLifecycle(duo.challengeId, duoStart, day(-2));
  console.log("  · Nós dois (dupla encerrada, Resultado mostra a mistura de vocês)");

  // ── Só eu: a solo season with guesses ──
  const solo = await createPersonalChallenge(me.session, {
    recipe: "cinema", title: "Só eu", description: "Oito filmes, só eu, palpite antes.", startsOn: day(-50), endsOn: day(-3), expectation: true,
    participantIds: [me.id],
    items: story.items.map((item) => ({ title: item.title, year: item.year, mainGenre: item.genre, runtimeMinutes: item.runtime, author: item.properties?.[0]?.value })),
  });
  const soloShape = await readShape(solo.challengeId);
  await transitionChallenge(me.session, solo.challengeId, { status: "active" }).catch(() => undefined);
  for (const expectation of story.expectations.filter((row) => row.personId === "ana")) {
    await rate(me, solo.challengeId, { itemId: soloShape.itemId(titleOf(expectation.itemId)), entryTypeId: soloShape.typeByPurpose.get("expectation"), values: { expectativa: expectation.value } });
  }
  for (const rating of story.ratings.filter((row) => row.personId === "ana")) {
    await rate(me, solo.challengeId, { itemId: soloShape.itemId(titleOf(rating.itemId)), entryTypeId: soloShape.typeByPurpose.get("rating"), values: { nota: rating.value, ...(rating.comment ? { comentario: rating.comment } : {}) } });
  }
  await transitionChallenge(me.session, solo.challengeId, { status: "closed" }).catch(() => undefined);
  console.log("  · Só eu (pessoal, Resultado mostra o seu gosto)");

  // ── Correr: two months of running, alone — the calendar ──
  const run = await createPersonalChallenge(me.session, {
    recipe: "habit", title: "Correr", description: "Três vezes por semana, quando der.", startsOn: day(-62), endsOn: day(20), participantIds: [me.id],
    fields: [
      { key: "km", label: "Km", type: "number", required: true, config: { min: 0, step: 0.5, unit: "km" } },
      { key: "nota_dia", label: "Como foi?", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ],
  });
  const runShape = await readShape(run.challengeId);
  await transitionChallenge(me.session, run.challengeId, { status: "active" }).catch(() => undefined);
  for (let offset = -62; offset <= 0; offset += 1) {
    const weekday = new Date(`${day(offset)}T12:00:00Z`).getUTCDay();
    const holiday = offset >= -35 && offset <= -27;
    const streak = offset >= -16 && offset <= -3;
    if (holiday || !(streak || [1, 3, 6].includes(weekday))) continue;
    const km = 4 + ((offset * 7 + 62) % 5) + (weekday === 6 ? 4 : 0);
    await rate(me, run.challengeId, {
      entryTypeId: runShape.typeByPurpose.get("checkin"), occurredOn: day(offset),
      values: { km, ...(offset === -26 ? { nota_dia: "Voltei depois da viagem. As pernas lembraram." } : offset === -3 ? { nota_dia: "Duas semanas sem falhar um dia." } : {}) },
    });
  }
  console.log("  · Correr (hábito pessoal, Resultado mostra o calendário)");

  console.log("\n\x1b[1mPronto\x1b[0m");
  console.log(`Grupo (mapa de gosto):   ${ORIGIN}/groups/${group.id}`);
  console.log(`Temporada 1 (o fio):     ${ORIGIN}/challenges/${s1.challengeId}`);
  console.log(`Temporada 2 (revelação): ${ORIGIN}/challenges/${s2.challengeId}`);
  console.log(`30 dias de leitura:      ${ORIGIN}/challenges/${habit.challengeId}`);
  console.log(`Nós dois (dupla):        ${ORIGIN}/challenges/${duo.challengeId}`);
  console.log(`Só eu (solo):            ${ORIGIN}/challenges/${solo.challengeId}`);
  console.log(`Correr (solo, dias):     ${ORIGIN}/challenges/${run.challengeId}`);
  console.log(`\nAmigos: ${FRIENDS.map((row) => `@${row.username}`).join(", ")}, senha "${DEMO_PASSWORD}". Todos os dados são inventados.`);
  await getPool().end();
}

main().catch(async (error: unknown) => {
  console.error(`\n\x1b[31m${isSeedError(error) || error instanceof ApiError ? (error as Error).message : error instanceof Error ? error.stack : String(error)}\x1b[0m`);
  await getPool().end().catch(() => undefined);
  process.exitCode = 1;
});
