import { createChallenge } from "../../../lib/goa/domain/challenges";
import { saveCheckpoints, assignCheckpointItems } from "../../../lib/goa/challenges/checkpoints";
import { transitionChallenge } from "../../../lib/goa/challenges/lifecycle";
import { saveEntry } from "../../../lib/goa/challenges/entries";
import { addMetric, curateResults, publishResults } from "../../../lib/goa/challenges/results";
import { setChallengeTemplate } from "../../../lib/goa/challenges/templates";

import { BOOKS, LIBRARY_HEADLINE, LIBRARY_SUMMARY, LIBRARY_TITLE, READING } from "../data/library";
import type { SeedContext } from "../runtime";
import { addDays, pastWindow, readShape, ROLES } from "./shared";
import type { Scenario, ScenarioResult } from "./types";

const WEEKS = 6;

export const library: Scenario = {
  key: "library",
  title: "Clube de leitura — 3 livros, 6 semanas, páginas dia a dia",

  plan(context: SeedContext): string {
    const { startsOn, endsOn } = pastWindow(WEEKS * 7);
    return [
      `Desafio "${LIBRARY_TITLE}" (receita library), ${startsOn} → ${endsOn}.`,
      `  · 3 participantes: ${ROLES.map((r) => context.accounts[r].username).join(", ")}.`,
      `  · ${BOOKS.length} livros reais (autor, ano, páginas, gênero); ${WEEKS} semanas, 2 vazias (pausas).`,
      "  · páginas registradas em vários dias; conclusão + nota ao terminar cada livro.",
      "  · métricas da receita: páginas lidas, páginas por pessoa, ranking dos livros, taxa de conclusão + páginas por semana.",
      "  · encerra, gera o Wrapped, publica o resultado anônimo e publica como modelo.",
    ].join("\n");
  },

  async run(context: SeedContext): Promise<ScenarioResult> {
    const { accounts, session, groupId, log } = context;
    const { startsOn, endsOn } = pastWindow(WEEKS * 7);

    log(`criando o clube e os ${BOOKS.length} livros`);
    const created = await createChallenge(session.owner, groupId, {
      recipe: "library",
      title: LIBRARY_TITLE,
      description: LIBRARY_HEADLINE,
      startsOn,
      endsOn,
      generateDaily: false,
      participantIds: ROLES.map((role) => accounts[role].id),
      items: BOOKS.map((book) => ({
        title: book.title,
        author: book.author,
        year: book.year,
        pageCount: book.pageCount,
        mainGenre: book.mainGenre,
      })),
    });
    const challengeId = created.challengeId;

    log(`organizando ${WEEKS} semanas (3 e 5 ficam vazias)`);
    const saved = await saveCheckpoints(session.owner, challengeId, {
      checkpoints: Array.from({ length: WEEKS }, (_, index) => ({
        title: `Semana ${index + 1}`,
        kind: "week" as const,
        startsAt: addDays(startsOn, index * 7),
        dueAt: index === WEEKS - 1 ? endsOn : addDays(startsOn, index * 7 + 6),
      })),
    });
    const weekId = new Map(saved.checkpoints.map((cp, index) => [index + 1, cp.id]));
    const shape = await readShape(challengeId);

    log("distribuindo os livros pelas semanas");
    await assignCheckpointItems(session.owner, challengeId, {
      assignments: BOOKS.map((book, index) => ({
        itemId: shape.itemId(book.title),
        checkpointId: weekId.get(book.week)!,
        position: index,
      })),
    });

    log("página por semana entra nas métricas");
    await addMetric(session.owner, challengeId, {
      label: "Páginas por semana", operation: "sum", fieldId: shape.fieldId("paginas", "progress"), groupBy: "checkpoint",
    });

    log("ativando o clube");
    await transitionChallenge(session.owner, challengeId, { status: "active" });

    const progressType = shape.typeByPurpose.get("progress")!;
    const completionType = shape.typeByPurpose.get("completion")!;
    let progressCount = 0;
    let finishedCount = 0;
    const commentEntries: Array<{ entryId: string; fieldId: string }> = [];

    log("registrando as páginas lidas dia a dia");
    for (const [bookIndex, book] of BOOKS.entries()) {
      for (const role of ROLES) {
        const readLog = READING[bookIndex][role];
        for (const [dayOffset, pages] of readLog.pages) {
          await saveEntry(session.owner, challengeId, {
            participantId: accounts[role].id,
            itemId: shape.itemId(book.title),
            entryTypeId: progressType,
            occurredOn: addDays(startsOn, dayOffset),
            values: { paginas: pages },
          });
          progressCount += 1;
        }
      }
    }

    log("marcando conclusões e notas");
    for (const [bookIndex, book] of BOOKS.entries()) {
      for (const role of ROLES) {
        const readLog = READING[bookIndex][role];
        if (!readLog.finished) continue;
        const entry = await saveEntry(session.owner, challengeId, {
          participantId: accounts[role].id,
          itemId: shape.itemId(book.title),
          entryTypeId: completionType,
          occurredOn: endsOn,
          values: {
            ...(readLog.rating !== undefined ? { nota: readLog.rating } : {}),
            ...(readLog.comment ? { comentario: readLog.comment } : {}),
          },
        });
        finishedCount += 1;
        if (readLog.comment) commentEntries.push({ entryId: entry.id, fieldId: shape.fieldId("comentario", "completion") });
      }
    }

    log("encerrando e gerando o Wrapped");
    await transitionChallenge(session.owner, challengeId, { status: "closed" });
    await curateResults(session.owner, challengeId, { regenerate: true, anonymizeParticipants: true });
    await curateResults(session.owner, challengeId, {
      headline: LIBRARY_HEADLINE,
      summary: LIBRARY_SUMMARY,
      anonymizeParticipants: true,
      includeRankings: true,
      includeAffinity: true,
      comments: commentEntries.slice(0, 4),
    });

    log("publicando o resultado anônimo");
    const published = await publishResults(session.owner, challengeId, {});

    log(`publicando como modelo (por ${accounts.admin.username})`);
    await setChallengeTemplate(session.admin, challengeId, {
      summary: "Clube de leitura com progresso diário por livro, conclusão e nota. Seis semanas.",
    });

    return {
      label: "Clube de leitura",
      challengeId,
      adminPath: `/challenges/${challengeId}/manage`,
      participantPath: `/challenges/${challengeId}`,
      templatePath: `/modelos/${challengeId}`,
      publicResultToken: published.shareToken ?? null,
      counts: {
        livros: BOOKS.length,
        semanas: WEEKS,
        "registros de página": progressCount,
        conclusões: finishedCount,
        comentários: commentEntries.length,
      },
    };
  },
};
