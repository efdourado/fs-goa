/**
 * `npm run db:seed-local` — a big, varied set of challenges for @dudupizzas on a LOCAL database, to see the
 * app with real-looking data: rounds that are done, running and still in draft; group and personal; films,
 * books, places, habits, workouts and a living list. Four demo friends (demo_*) fill the groups.
 *
 * Everything goes through the same domain services the API uses. It refuses any non-local DATABASE_URL —
 * there is no flag to override that. `--reset` removes only what this seed made (by group name / title).
 */
import process from "node:process";

import { registerAccount, type SessionContext } from "../../lib/auth";
import { getPool, oneOrNull, withClient } from "../../lib/db";
import { createChallenge, createGroup, createPersonalChallenge, requestGroupMember, respondToMemberRequest } from "../../lib/goa-domain";
import {
  assignCheckpointItems, curateResults, publishResults, saveCheckpoints, saveEntry, transitionChallenge,
} from "../../lib/goa-challenges";
import { createGroupLibrary, createPersonalLibrary, listPersonalLibraries } from "../../lib/goa/catalog";
import { purgeChallengeRows, purgeGroupRows } from "../../lib/goa/purge";
import { ApiError } from "../../lib/http";

import { addDays, backdateLifecycle, fail, isSeedError, looksRemote, readShape, resolveAccount, sessionFor } from "../seed-reading/helpers";
import {
  BOOK_CLUB_DONE, BOOK_CLUB_NOW, BOOK_COMMENTS, DEMO_PASSWORD, EXERCISES, FILM_COMMENTS, FRIENDS, GROUPS,
  MEDITATION_NOTES, PLACES, random, ROUND_01, ROUND_02, ROUND_03, score, SHELF, SUGAR_NOTES,
  type Book, type Film, type FriendKey, type PersonKey,
} from "./data";

const ORIGIN = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const PERSONAL_TITLES = ["Meditar todo dia", "30 dias sem açúcar", "Correr 5 km", "Treino de força", "Estante da vida"];
const EXERCISE_LIBRARY = "Exercícios";

type Person = { id: string; name: string; session: SessionContext };
type People = Record<PersonKey, Person>;

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const day = (offset: number) => addDays(today, offset);
const created: Array<{ label: string; id: string; share?: string | null }> = [];

function log(text: string): void {
  console.log(`  · ${text}`);
}

async function friend(key: FriendKey): Promise<Person> {
  const spec = FRIENDS.find((row) => row.key === key)!;
  const existing = await withClient((client) => oneOrNull<{ id: string; display_name: string; email: string | null }>(
    client, "SELECT id, display_name, email FROM users WHERE username_normalized = $1 AND deleted_at IS NULL", [spec.username],
  ));
  const user = existing
    ? { id: existing.id, name: existing.display_name, username: spec.username, email: existing.email }
    : (await registerAccount({ name: spec.name, username: spec.username, password: DEMO_PASSWORD })).user;
  return { id: user.id, name: user.name, session: sessionFor({ id: user.id, name: user.name, username: spec.username, email: user.email ?? null, platformAdmin: false }) };
}

async function groupWith(me: Person, people: People, spec: (typeof GROUPS)[keyof typeof GROUPS]): Promise<string> {
  const group = await createGroup(me.session, { name: spec.name, description: spec.description });
  for (const key of spec.members) {
    await requestGroupMember(me.session, group.id, { username: FRIENDS.find((row) => row.key === key)!.username });
    const request = await withClient((client) => oneOrNull<{ id: string }>(
      client, "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'", [group.id, people[key].id],
    ));
    if (request) await respondToMemberRequest(people[key].session, request.id, "accept");
  }
  return group.id;
}

async function entry(person: Person, challengeId: string, body: Record<string, unknown>): Promise<void> {
  await saveEntry(person.session, challengeId, { participantId: person.id, ...body });
}

async function closeAndPublish(me: Person, challengeId: string, startsOn: string, endsOn: string): Promise<string | null> {
  await transitionChallenge(me.session, challengeId, { status: "closed" });
  await backdateLifecycle(challengeId, startsOn, endsOn);
  await curateResults(me.session, challengeId, { regenerate: true });
  const published = await publishResults(me.session, challengeId, {});
  return published.shareToken ?? null;
}

// ── Films ────────────────────────────────────────────────────────────────────

function filmItems(films: Film[], people: People) {
  return films.map((film) => ({
    title: film.title, year: film.year, runtimeMinutes: film.runtime, mainGenre: film.genre,
    recommendedByUserId: people[film.by].id,
  }));
}

async function cinemaRounds(me: Person, people: People, groupId: string): Promise<void> {
  const next = random(11);
  const pair = [people.me, people.vivi];

  // Rodada 01 — done: three blocks, expectations before, ratings after, the showcase published.
  const r1Start = day(-110);
  const r1End = day(-20);
  const films1 = ROUND_01.blocks.flatMap((block) => block.films);
  const r1 = await createChallenge(me.session, groupId, {
    recipe: "cinema", title: ROUND_01.title, description: ROUND_01.description, startsOn: r1Start, endsOn: r1End, expectation: true,
    ruleSections: [
      { title: "A ordem tem lógica.", description: "Cada filme conversa com o anterior e prepara o próximo." },
      { title: "Cada um dá uma nota de 0 a 5 no fim,", description: "sem consultar o outro, só depois revelam.", topics: [{ title: "Expectativa", description: "Antes do play, um palpite de 0 a 5." }] },
      { title: "Pular não invalida a rodada.", description: "Filme pesado demais? Fica pra outra hora." },
    ],
    participantIds: pair.map((person) => person.id),
    items: filmItems(films1, people),
  });
  const saved = await saveCheckpoints(me.session, r1.challengeId, {
    checkpoints: ROUND_01.blocks.map((block, index) => ({
      title: block.title, description: block.description, kind: "session" as const,
      startsAt: addDays(r1Start, index * 30), dueAt: addDays(r1Start, index * 30 + 29),
    })),
  });
  const shape1 = await readShape(r1.challengeId);
  await assignCheckpointItems(me.session, r1.challengeId, {
    assignments: ROUND_01.blocks.flatMap((block, blockIndex) => block.films.map((film, index) => ({
      itemId: shape1.itemId(film.title), checkpointId: saved.checkpoints[blockIndex].id, position: blockIndex * 10 + index,
    }))),
  });
  await transitionChallenge(me.session, r1.challengeId, { status: "active" });
  for (const [index, film] of films1.entries()) {
    const watched = addDays(r1Start, 3 + index * 7);
    const skippedByMe = film.title === "Pobres Criaturas";
    for (const person of pair) {
      if (skippedByMe && person === people.me) continue;
      const center = 2.8 + next() * 2;
      await entry(person, r1.challengeId, { itemId: shape1.itemId(film.title), entryTypeId: shape1.typeByPurpose.get("expectation"), occurredOn: addDays(watched, -1), values: { expectativa: score(next, 3.5) } });
      await entry(person, r1.challengeId, {
        itemId: shape1.itemId(film.title), entryTypeId: shape1.typeByPurpose.get("rating"), occurredOn: watched,
        values: { nota: score(next, center, 0.6), ...(next() > 0.45 ? { comentario: FILM_COMMENTS[(index + (person === people.me ? 0 : 5)) % FILM_COMMENTS.length] } : {}) },
      });
    }
  }
  const share1 = await closeAndPublish(me, r1.challengeId, r1Start, r1End);
  created.push({ label: `${ROUND_01.title} (encerrada, vitrine publicada)`, id: r1.challengeId, share: share1 });
  log(ROUND_01.title);

  // Rodada 02 — running: half watched, one only by Vivi.
  const r2Start = day(-18);
  const r2 = await createChallenge(me.session, groupId, {
    recipe: "cinema", title: ROUND_02.title, description: ROUND_02.description, startsOn: r2Start, endsOn: day(40),
    participantIds: pair.map((person) => person.id), items: filmItems(ROUND_02.films, people),
  });
  const shape2 = await readShape(r2.challengeId);
  await transitionChallenge(me.session, r2.challengeId, { status: "active" });
  for (const [index, film] of ROUND_02.films.slice(0, 5).entries()) {
    for (const person of pair) {
      if (index === 4 && person === people.me) continue;
      await entry(person, r2.challengeId, {
        itemId: shape2.itemId(film.title), occurredOn: addDays(r2Start, 2 + index * 3),
        values: { nota: score(next, 3.8), ...(next() > 0.5 ? { comentario: FILM_COMMENTS[(index * 3 + 1) % FILM_COMMENTS.length] } : {}) },
      });
    }
  }
  created.push({ label: `${ROUND_02.title} (em andamento)`, id: r2.challengeId });
  log(ROUND_02.title);

  // Rodada 03 — a draft that starts later.
  const r3 = await createChallenge(me.session, groupId, {
    recipe: "cinema", title: ROUND_03.title, description: ROUND_03.description, startsOn: day(45), endsOn: day(120),
    participantIds: pair.map((person) => person.id), items: filmItems(ROUND_03.films, people),
  });
  created.push({ label: `${ROUND_03.title} (rascunho, começa em 45 dias)`, id: r3.challengeId });
  log(ROUND_03.title);
}

// ── Books ────────────────────────────────────────────────────────────────────

function bookItems(books: Book[]) {
  return books.map((book) => ({ title: book.title, author: book.author, year: book.year, pageCount: book.pages, mainGenre: book.genre }));
}

/** Reads a book over `days` from `from`, most days, in uneven chunks; returns the last day read. */
async function readBook(person: Person, challengeId: string, itemId: string, typeId: string | undefined, book: Book, from: string, days: number, share: number, next: () => number): Promise<string> {
  let left = Math.round(book.pages * share);
  let last = from;
  for (let offset = 0; offset < days && left > 0; offset += 1) {
    if (next() < 0.25) continue;
    const date = addDays(from, offset);
    if (date > today) break;
    const pages = Math.min(left, Math.max(5, Math.round((book.pages / days) * (0.6 + next() * 1.4))));
    await entry(person, challengeId, { itemId, entryTypeId: typeId, occurredOn: date, values: { paginas: pages } });
    left -= pages;
    last = date;
  }
  return last;
}

async function bookClubs(me: Person, people: People, groupId: string): Promise<void> {
  const next = random(23);
  const readers: Person[] = [people.me, people.vivi, people.rafa, people.lu];

  // 1º semestre — done, everyone finished, the showcase published.
  const doneStart = day(-200);
  const doneEnd = day(-40);
  const done = await createChallenge(me.session, groupId, {
    recipe: "library", title: BOOK_CLUB_DONE.title, description: "Quatro livros, quatro encontros, uma discussão que ninguém esqueceu.",
    startsOn: doneStart, endsOn: doneEnd, participantIds: readers.map((person) => person.id), items: bookItems(BOOK_CLUB_DONE.books),
  });
  const doneShape = await readShape(done.challengeId);
  await transitionChallenge(me.session, done.challengeId, { status: "active" });
  for (const [index, book] of BOOK_CLUB_DONE.books.entries()) {
    const from = addDays(doneStart, index * 40);
    for (const [readerIndex, person] of readers.entries()) {
      const itemId = doneShape.itemId(book.title);
      const last = await readBook(person, done.challengeId, itemId, doneShape.typeByPurpose.get("progress"), book, from, 34, 1, next);
      await entry(person, done.challengeId, {
        itemId, entryTypeId: doneShape.typeByPurpose.get("completion"), occurredOn: last,
        values: { nota: score(next, 3.6 + (index % 2) * 0.8), ...(next() > 0.4 ? { comentario: BOOK_COMMENTS[(index + readerIndex) % BOOK_COMMENTS.length] } : {}) },
      });
    }
  }
  const share = await closeAndPublish(me, done.challengeId, doneStart, doneEnd);
  created.push({ label: `${BOOK_CLUB_DONE.title} (encerrado, vitrine publicada)`, id: done.challengeId, share });
  log(BOOK_CLUB_DONE.title);

  // 2º semestre — running: the first book done by most, the second under way, the rest ahead.
  const nowStart = day(-38);
  const running = await createChallenge(me.session, groupId, {
    recipe: "library", title: BOOK_CLUB_NOW.title, description: "Um livro por mês. Spoiler só depois da quinta.",
    startsOn: nowStart, endsOn: day(120), participantIds: readers.map((person) => person.id), items: bookItems(BOOK_CLUB_NOW.books),
  });
  const shape = await readShape(running.challengeId);
  await transitionChallenge(me.session, running.challengeId, { status: "active" });
  for (const [readerIndex, person] of readers.entries()) {
    const first = BOOK_CLUB_NOW.books[0];
    const finished = readerIndex !== 2;
    const last = await readBook(person, running.challengeId, shape.itemId(first.title), shape.typeByPurpose.get("progress"), first, nowStart, 26, finished ? 1 : 0.7, next);
    if (finished) {
      await entry(person, running.challengeId, {
        itemId: shape.itemId(first.title), entryTypeId: shape.typeByPurpose.get("completion"), occurredOn: last,
        values: { nota: score(next, 4.2), comentario: BOOK_COMMENTS[readerIndex % BOOK_COMMENTS.length] },
      });
    }
    const second = BOOK_CLUB_NOW.books[1];
    await readBook(person, running.challengeId, shape.itemId(second.title), shape.typeByPurpose.get("progress"), second, day(-10), 10, 0.3 + readerIndex * 0.12, next);
  }
  created.push({ label: `${BOOK_CLUB_NOW.title} (em andamento)`, id: running.challengeId });
  log(BOOK_CLUB_NOW.title);
}

// ── Places ───────────────────────────────────────────────────────────────────

async function places(me: Person, people: People, groupId: string): Promise<void> {
  const next = random(37);
  await createGroupLibrary(me.session, groupId, { source: "tables" });
  const eaters = [people.me, people.theo, people.lu];
  const challenge = await createChallenge(me.session, groupId, {
    recipe: "tables", title: "Onde comer em SP", description: "Cada um dá três notas. Quem sugeriu paga a sobremesa se a média ficar abaixo de 3.",
    participantIds: eaters.map((person) => person.id), items: PLACES.map((place) => ({ title: place.title })),
  });
  const shape = await readShape(challenge.challengeId);
  await transitionChallenge(me.session, challenge.challengeId, { status: "active" });
  for (const [index, place] of PLACES.entries()) {
    for (const [eaterIndex, person] of eaters.entries()) {
      if ((index + eaterIndex) % 5 === 4) continue;
      const center = 2.8 + ((index * 7) % 5) * 0.45;
      await entry(person, challenge.challengeId, {
        itemId: shape.itemId(place.title),
        values: {
          comida: score(next, center), ambiente_atendimento: score(next, center - 0.3), custo_beneficio: score(next, center - 0.2),
          ...(eaterIndex === 0 || next() > 0.6 ? { comentario: place.comment } : {}),
        },
      });
    }
  }
  created.push({ label: "Onde comer em SP (Tables, em andamento)", id: challenge.challengeId });
  log("Onde comer em SP");
}

// ── Personal ─────────────────────────────────────────────────────────────────

async function habits(me: Person): Promise<void> {
  const next = random(53);

  const meditate = await createPersonalChallenge(me.session, {
    recipe: "habit", title: "Meditar todo dia", description: "Dez minutos por dia, de manhã, antes do celular.",
    startsOn: day(-52), endsOn: day(38), participantIds: [me.id],
  });
  const meditateShape = await readShape(meditate.challengeId);
  await transitionChallenge(me.session, meditate.challengeId, { status: "active" }).catch(() => undefined);
  for (let offset = -52; offset <= 0; offset += 1) {
    if (next() < 0.18) continue;
    const note = next() < 0.35 ? MEDITATION_NOTES[Math.floor(next() * MEDITATION_NOTES.length)] : "";
    await entry(me, meditate.challengeId, { entryTypeId: meditateShape.typeByPurpose.get("checkin"), occurredOn: day(offset), values: note ? { nota_dia: note } : {} });
  }
  created.push({ label: "Meditar todo dia (hábito, em andamento)", id: meditate.challengeId });
  log("Meditar todo dia");

  const sugarStart = day(-75);
  const sugarEnd = day(-45);
  const sugar = await createPersonalChallenge(me.session, {
    recipe: "habit", title: "30 dias sem açúcar", description: "Trinta e um dias sem açúcar adicionado.",
    startsOn: sugarStart, endsOn: sugarEnd, participantIds: [me.id],
  });
  const sugarShape = await readShape(sugar.challengeId);
  await transitionChallenge(me.session, sugar.challengeId, { status: "active" }).catch(() => undefined);
  for (let offset = 0; offset <= 30; offset += 1) {
    if (offset === 12 || offset === 13 || offset === 22) continue;
    const note = offset % 6 === 0 ? SUGAR_NOTES[(offset / 6) % SUGAR_NOTES.length] : "";
    await entry(me, sugar.challengeId, { entryTypeId: sugarShape.typeByPurpose.get("checkin"), occurredOn: addDays(sugarStart, offset), values: note ? { nota_dia: note } : {} });
  }
  await transitionChallenge(me.session, sugar.challengeId, { status: "closed" });
  await backdateLifecycle(sugar.challengeId, sugarStart, sugarEnd);
  created.push({ label: "30 dias sem açúcar (hábito, encerrado)", id: sugar.challengeId });
  log("30 dias sem açúcar");

  const run = await createPersonalChallenge(me.session, {
    recipe: "habit", title: "Correr 5 km", description: "Três vezes por semana, até o fim do ano.",
    startsOn: day(9), endsOn: day(95), participantIds: [me.id],
  });
  await transitionChallenge(me.session, run.challengeId, { status: "active" }).catch(() => undefined);
  created.push({ label: "Correr 5 km (hábito, agendado, começa em 9 dias)", id: run.challengeId });
  log("Correr 5 km");
}

async function workout(me: Person): Promise<void> {
  const next = random(71);
  const libraries = (await listPersonalLibraries(me.session)).libraries as Array<{ id: string; label: string | null }>;
  const library = libraries.find((row) => row.label === EXERCISE_LIBRARY) ?? await createPersonalLibrary(me.session, { label: EXERCISE_LIBRARY });
  const number = (key: string, label: string, step: number) => ({ key, label, type: "number", required: true, config: { min: 0, step } });
  const challenge = await createPersonalChallenge(me.session, {
    recipe: "custom", recordingMode: "session", sessionName: "Treino", sessionNoteLabel: "Como foi?", title: "Treino de força",
    description: "Três treinos por semana. O número que importa é o de hoje.", libraryId: library.id,
    participantIds: [me.id], items: EXERCISES.map((title) => ({ title })),
    fields: [number("carga", "Carga (kg)", 2.5), number("repeticoes", "Repetições", 1)],
  });
  const shape = await readShape(challenge.challengeId);
  await transitionChallenge(me.session, challenge.challengeId, { status: "active" }).catch(() => undefined);
  const base: Record<string, number> = { "Supino reto": 40, "Agachamento livre": 60, "Puxada alta": 40, "Levantamento terra": 70, "Desenvolvimento com halteres": 12.5, "Remada curvada": 35 };
  const plans = [["Supino reto", "Desenvolvimento com halteres", "Remada curvada"], ["Agachamento livre", "Levantamento terra"], ["Puxada alta", "Remada curvada", "Supino reto"]];
  let session = 0;
  for (let offset = -42; offset <= 0; offset += 1) {
    const weekday = new Date(`${day(offset)}T12:00:00Z`).getUTCDay();
    if (![1, 3, 5].includes(weekday) || next() < 0.12) continue;
    const plan = plans[session % plans.length];
    const week = Math.floor((offset + 42) / 7);
    await entry(me, challenge.challengeId, {
      entryTypeId: shape.typeByPurpose.get("checkin"), occurredOn: day(offset),
      values: session % 4 === 0 ? { [shape.fieldId("nota_sessao", "checkin")]: session ? "Pesado hoje, mas saiu." : "Primeiro treino depois das férias." } : {},
      children: plan.map((title) => ({
        itemId: shape.itemId(title),
        values: {
          [shape.fieldId("carga", "progress")]: base[title] + (title.startsWith("Desenvolvimento") ? Math.floor(week / 2) : week) * 2.5 - (next() < 0.15 ? 2.5 : 0),
          [shape.fieldId("repeticoes", "progress")]: next() < 0.3 ? 10 : 8,
        },
      })),
    });
    session += 1;
  }
  created.push({ label: `Treino de força (treinos, ${session} check-ins)`, id: challenge.challengeId });
  log("Treino de força");
}

async function shelf(me: Person): Promise<void> {
  const challenge = await createPersonalChallenge(me.session, {
    recipe: "bookshelf", title: "Estante da vida", description: "Os livros que me formaram, com a nota de hoje.",
    participantIds: [me.id], items: bookItems(SHELF),
  });
  const shape = await readShape(challenge.challengeId);
  for (const book of SHELF) {
    await entry(me, challenge.challengeId, { itemId: shape.itemId(book.title), values: { nota: book.rating, comentario: book.comment } });
  }
  created.push({ label: "Estante da vida (lista viva)", id: challenge.challengeId });
  log("Estante da vida");
}

// ── Reset / main ─────────────────────────────────────────────────────────────

async function seededLeftovers(ownerId: string): Promise<{ groups: Array<{ id: string; name: string }>; personal: Array<{ id: string; title: string }> }> {
  return withClient(async (client) => {
    const groups = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM groups WHERE owner_user_id = $1 AND kind = 'standard' AND name = ANY($2::text[])",
      [ownerId, Object.values(GROUPS).map((group) => group.name)],
    );
    const personal = await client.query<{ id: string; title: string }>(
      `SELECT c.id, c.title FROM challenges c JOIN groups g ON g.id = c.group_id
        WHERE g.owner_user_id = $1 AND g.kind = 'personal' AND c.title = ANY($2::text[])`,
      [ownerId, PERSONAL_TITLES],
    );
    return { groups: groups.rows, personal: personal.rows };
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--reset");
  if (unknown.length) fail(`Argumento não reconhecido: ${unknown.join(" ")}`);
  // Never against a remote database — production data is not a seed target, with or without a flag.
  if (looksRemote()) fail("db:seed-local só roda num banco local (DATABASE_URL em localhost). Nada foi feito.");

  console.log("\n\x1b[1mdb:seed-local\x1b[0m");
  const account = await resolveAccount();
  const me: Person = { id: account.id, name: account.name, session: sessionFor(account) };
  console.log(`conta: @${account.username}`);

  const leftovers = await seededLeftovers(account.id);
  if (leftovers.groups.length || leftovers.personal.length) {
    if (!reset) fail(`Já existem dados desta seed (${[...leftovers.groups.map((row) => row.name), ...leftovers.personal.map((row) => row.title)].join(", ")}). Rode com --reset para recriá-los.`);
    console.log("removendo a seed anterior");
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        for (const group of leftovers.groups) await purgeGroupRows(client, group.id);
        for (const challenge of leftovers.personal) await purgeChallengeRows(client, challenge.id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  console.log("amigos de demonstração");
  const people = { me } as People;
  for (const row of FRIENDS) {
    people[row.key] = await friend(row.key);
    log(`@${row.username}`);
  }

  console.log("grupos e desafios");
  await cinemaRounds(me, people, await groupWith(me, people, GROUPS.cine));
  await bookClubs(me, people, await groupWith(me, people, GROUPS.books));
  await places(me, people, await groupWith(me, people, GROUPS.food));

  console.log("desafios pessoais");
  await habits(me);
  await workout(me);
  await shelf(me);

  console.log("\n\x1b[1mPronto\x1b[0m");
  for (const row of created) {
    console.log(`${row.label}\n    ${ORIGIN}/challenges/${row.id}${row.share ? `\n    vitrine: ${ORIGIN}/results/${row.share}` : ""}`);
  }
  console.log(`\nAmigos: ${FRIENDS.map((row) => `@${row.username}`).join(", ")}, senha "${DEMO_PASSWORD}". Todos os dados são inventados.`);
  await getPool().end();
}

main().catch(async (error: unknown) => {
  console.error(`\n\x1b[31m${isSeedError(error) || error instanceof ApiError ? (error as Error).message : error instanceof Error ? error.stack : String(error)}\x1b[0m`);
  await getPool().end().catch(() => undefined);
  process.exitCode = 1;
});
