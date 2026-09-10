import process from "node:process";

import { getPool, oneOrNull, withClient } from "../../lib/db";
import { createPersonalChallenge } from "../../lib/goa-domain";
import {
  addMetric, archiveMetric, assignCheckpointItems, curateResults, publishResults,
  saveCheckpoints, saveEntry, setChallengeTemplate, transitionChallenge,
} from "../../lib/goa-challenges";
import { purgeChallengeRows } from "../../lib/goa/purge";
import { ApiError } from "../../lib/http";

import {
  BOOKS, readingLog, SEED_DESCRIPTION, SEED_HEADLINE, SEED_SUMMARY, SEED_TITLE,
  WEEKS, WINDOW_DAYS,
} from "./data";
import {
  addDays, backdateLifecycle, confirmRemote, fail, findSeedChallenge, isSeedError,
  looksRemote, parseArgs, pastWindow, readShape, resolveAccount, sessionFor,
} from "./helpers";

const ORIGIN = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function listMetrics(challengeId: string): Promise<Array<{ id: string; label: string }>> {
  return withClient(async (client) => {
    const rows = await client.query<{ id: string; label: string }>(
      "SELECT id, label FROM challenge_metrics WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position",
      [challengeId],
    );
    return rows.rows;
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  heading("db:seed-reading");
  console.log(`banco: ${looksRemote() ? "REMOTO (Neon?)" : "local"}${options.dryRun ? "  (dry-run)" : ""}${options.reset ? "  --reset" : ""}`);

  const account = await resolveAccount();
  const session = sessionFor(account);
  console.log(`conta: @${account.username} (${account.name})${account.platformAdmin ? "  · admin da plataforma" : ""}`);

  const existing = await findSeedChallenge(account.id);

  if (options.dryRun) {
    const { startsOn, endsOn } = pastWindow(WINDOW_DAYS);
    const totalPages = BOOKS.reduce((sum, book) => sum + book.pageCount, 0);
    const totalEntries = BOOKS.reduce((sum, book) => sum + readingLog(book).length, 0);
    heading("Plano");
    console.log(`Desafio pessoal "${SEED_TITLE}" (receita library), ${startsOn} → ${endsOn}.`);
    console.log(`  · ${BOOKS.length} livros, ${totalPages} páginas, ${WEEKS} semanas.`);
    console.log(`  · ${totalEntries} registros de página, ${BOOKS.length} conclusões com nota e comentário.`);
    console.log("  · métricas: páginas lidas, ritmo acumulado, páginas por semana, média por dia,");
    console.log("    páginas por gênero, ranking pelas minhas notas, nota média, taxa de conclusão.");
    console.log("  · encerra, gera o Wrapped, publica o resultado" + (account.platformAdmin ? " e publica como modelo." : "."));
    if (existing) console.log(`\n(já existe um desafio "${existing.title}" nesta conta — rode com --reset para recriá-lo.)`);
    await getPool().end();
    return;
  }

  if (existing && !options.reset) {
    fail(`Já existe um desafio "${existing.title}" (${existing.status}) nesta conta. Rode com --reset para recriá-lo.`);
  }

  if (existing && options.reset) {
    await confirmRemote(`APAGAR o desafio "${existing.title}" e recriá-lo`);
    console.log(`removendo o desafio anterior "${existing.title}"`);
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const guard = await oneOrNull<{ id: string }>(
          client,
          "SELECT id FROM challenges WHERE id = $1 AND deleted_at IS NULL AND title = $2 FOR UPDATE",
          [existing.id, existing.title],
        );
        if (!guard) fail("O desafio mudou entre a checagem e o reset. Rode de novo.");
        await purgeChallengeRows(client, existing.id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  } else {
    await confirmRemote(`criar o desafio "${SEED_TITLE}" para @${account.username}`);
  }

  const { startsOn, endsOn } = pastWindow(WINDOW_DAYS);

  console.log(`criando o desafio e os ${BOOKS.length} livros`);
  const created = await createPersonalChallenge(session, {
    recipe: "library",
    title: SEED_TITLE,
    description: SEED_DESCRIPTION,
    startsOn,
    endsOn,
    generateDaily: false,
    participantIds: [account.id],
    items: BOOKS.map((book) => ({
      title: book.title,
      author: book.author,
      year: book.year,
      pageCount: book.pageCount,
      mainGenre: book.mainGenre,
    })),
  });
  const challengeId = created.challengeId;

  console.log(`organizando ${WEEKS} semanas`);
  const saved = await saveCheckpoints(session, challengeId, {
    checkpoints: Array.from({ length: WEEKS }, (_, index) => ({
      title: `Semana ${index + 1}`,
      kind: "week" as const,
      startsAt: addDays(startsOn, index * 7),
      dueAt: index === WEEKS - 1 ? endsOn : addDays(startsOn, index * 7 + 6),
    })),
  });
  const weekIdForDay = (day: number): string => saved.checkpoints[Math.min(WEEKS - 1, Math.floor(day / 7))].id;
  const shape = await readShape(challengeId);

  console.log("distribuindo os livros pelas semanas em que começaram");
  await assignCheckpointItems(session, challengeId, {
    assignments: BOOKS.map((book, index) => ({
      itemId: shape.itemId(book.title),
      checkpointId: weekIdForDay(book.window[0]),
      position: index,
    })),
  });

  console.log("ajustando as métricas para uma leitura solo");
  for (const metric of await listMetrics(challengeId)) {
    if (metric.label === "Páginas por pessoa" || metric.label === "Ranking dos livros") {
      await archiveMetric(session, challengeId, metric.id);
    }
  }

  const paginasField = shape.fieldId("paginas", "progress");
  const notaField = shape.fieldId("nota", "completion");
  const extraMetrics: Array<Record<string, unknown>> = [
    { label: "Ritmo acumulado", operation: "sum", fieldId: paginasField, groupBy: "checkpoint", cumulative: true },
    { label: "Páginas por semana", operation: "sum", fieldId: paginasField, groupBy: "checkpoint" },
    { label: "Média por dia de leitura", operation: "average", fieldId: paginasField, groupBy: "none" },
    { label: "Páginas por gênero", operation: "sum", fieldId: paginasField, groupBy: "catalog_genre" },
    { label: "Como avaliei cada livro", operation: "average", fieldId: notaField, groupBy: "item", minSample: 1 },
    { label: "Nota média", operation: "average", fieldId: notaField, groupBy: "none" },
  ];
  for (const metric of extraMetrics) await addMetric(session, challengeId, metric);

  console.log("ativando o desafio");
  await transitionChallenge(session, challengeId, { status: "active" });

  const progressType = shape.typeByPurpose.get("progress")!;
  const completionType = shape.typeByPurpose.get("completion")!;
  let pageEntries = 0;
  const commentEntries: Array<{ entryId: string; fieldId: string }> = [];

  console.log("registrando as páginas lidas dia a dia");
  for (const book of BOOKS) {
    const itemId = shape.itemId(book.title);
    for (const [day, pages] of readingLog(book)) {
      await saveEntry(session, challengeId, {
        participantId: account.id,
        itemId,
        entryTypeId: progressType,
        occurredOn: addDays(startsOn, day),
        values: { paginas: pages },
      });
      pageEntries += 1;
    }
  }

  console.log("marcando as conclusões, notas e comentários");
  for (const book of BOOKS) {
    const entry = await saveEntry(session, challengeId, {
      participantId: account.id,
      itemId: shape.itemId(book.title),
      entryTypeId: completionType,
      occurredOn: addDays(startsOn, Math.min(WINDOW_DAYS - 1, book.window[1])),
      values: { nota: book.rating, comentario: book.comment },
    });
    commentEntries.push({ entryId: entry.id, fieldId: shape.fieldId("comentario", "completion") });
  }

  console.log("encerrando e gerando o Wrapped");
  await transitionChallenge(session, challengeId, { status: "closed" });
  await backdateLifecycle(challengeId, startsOn, endsOn);
  await curateResults(session, challengeId, { regenerate: true });

  const metrics = await listMetrics(challengeId);
  const pick = (label: string) => metrics.find((metric) => metric.label === label)?.id;
  const highlighted = [
    "Páginas lidas", "Ritmo acumulado", "Páginas por semana", "Média por dia de leitura",
    "Páginas por gênero", "Como avaliei cada livro", "Nota média", "Taxa de conclusão",
  ].map(pick).filter((id): id is string => Boolean(id));

  await curateResults(session, challengeId, {
    headline: SEED_HEADLINE,
    summary: SEED_SUMMARY,
    metricIds: highlighted,
    includeRankings: false,
    includeAffinity: false,
    comments: commentEntries.slice(0, 4),
  });

  console.log("publicando o resultado");
  const published = await publishResults(session, challengeId, {});

  let templatePath: string | null = null;
  if (account.platformAdmin) {
    console.log("publicando como modelo na galeria");
    await setChallengeTemplate(session, challengeId);
    templatePath = `/modelos/${challengeId}`;
  }

  heading("Pronto");
  console.log(`Desafio:   ${ORIGIN}/challenges/${challengeId}`);
  console.log(`Gerenciar: ${ORIGIN}/challenges/${challengeId}/manage`);
  if (published.shareToken) console.log(`Resultado: ${ORIGIN}/results/${published.shareToken}`);
  if (templatePath) console.log(`Modelo:    ${ORIGIN}${templatePath}`);
  console.log(`\nLivros: ${BOOKS.length}  ·  páginas: ${BOOKS.reduce((s, b) => s + b.pageCount, 0)}  ·  registros de página: ${pageEntries}  ·  semanas: ${WEEKS}`);
  console.log("Todos os dados acima são sintéticos.");

  await getPool().end();
}

main().catch(async (error: unknown) => {
  if (isSeedError(error) || error instanceof ApiError) {
    console.error(`\n\x1b[31m${(error as Error).message}\x1b[0m`);
  } else {
    console.error(error);
  }
  await getPool().end().catch(() => undefined);
  process.exitCode = 1;
});
