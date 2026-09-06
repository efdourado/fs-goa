import { withClient } from "../../../lib/db";
import { createChallenge } from "../../../lib/goa/domain/challenges";
import { saveCheckpoints, assignCheckpointItems } from "../../../lib/goa/challenges/checkpoints";
import { transitionChallenge } from "../../../lib/goa/challenges/lifecycle";
import { saveEntry } from "../../../lib/goa/challenges/entries";
import { addMetric, curateResults, publishResults } from "../../../lib/goa/challenges/results";
import { setChallengeTemplate } from "../../../lib/goa/challenges/templates";

import {
  CINEMA_HEADLINE, CINEMA_SUMMARY, CINEMA_TITLE, FILMS, OPINIONS,
} from "../data/cinema";
import type { SeedContext } from "../runtime";
import type { Scenario, ScenarioResult } from "./types";

const ROLES = ["owner", "admin", "participant"] as const;
const WEEKS = 6;

/** `n` days after an ISO date, back to `YYYY-MM-DD`. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A finished six-week window: ends a few days ago, 42 days inclusive. */
function roundWindow(): { startsOn: string; endsOn: string } {
  const today = new Date();
  const endsOn = addDays(today.toISOString().slice(0, 10), -3);
  return { startsOn: addDays(endsOn, -(WEEKS * 7 - 1)), endsOn };
}

export const cinema: Scenario = {
  key: "cinema",
  title: "Cinema — 12 filmes, 6 semanas, expectativa + avaliação",

  plan(context: SeedContext): string {
    const { startsOn, endsOn } = roundWindow();
    const perRecommender = ROLES.map(
      (role) => `${context.accounts[role].username}: ${FILMS.filter((f) => f.recommender === role).length}`,
    ).join(", ");
    return [
      `Desafio "${CINEMA_TITLE}" (receita cinema), ${startsOn} → ${endsOn}.`,
      `  · 3 participantes: ${ROLES.map((r) => context.accounts[r].username).join(", ")} (${context.accounts.admin.username} vira admin do grupo).`,
      `  · 12 filmes reais com ano, gênero e duração; indicações — ${perRecommender}.`,
      `  · ${WEEKS} semanas, 2 filmes por semana.`,
      "  · expectativa ligada; 36 expectativas + 36 avaliações (com comentários fictícios).",
      "  · métricas: média, ranking bayesiano, polarização, viés do indicador, conclusão (da receita) + mediana e surpresa/decepção.",
      "  · encerra pelo fluxo normal, gera o Wrapped, publica o resultado anônimo e publica como modelo.",
    ].join("\n");
  },

  async run(context: SeedContext): Promise<ScenarioResult> {
    const { options, accounts, session, groupId, log } = context;
    const { startsOn, endsOn } = roundWindow();

    // --- challenge + structure ---------------------------------------------
    log("criando o desafio e os 12 filmes");
    const created = await createChallenge(session.owner, groupId, {
      recipe: "cinema",
      title: CINEMA_TITLE,
      description: "Rodada de demonstração — opiniões fictícias.",
      startsOn,
      endsOn,
      expectation: true,
      participantIds: ROLES.map((role) => accounts[role].id),
      items: FILMS.map((film) => ({
        title: film.title,
        year: film.year,
        mainGenre: film.mainGenre,
        runtimeMinutes: film.runtimeMinutes,
        recommendedByUserId: accounts[film.recommender].id,
      })),
    });
    const challengeId = created.challengeId;

    log(`organizando ${WEEKS} semanas`);
    const savedCheckpoints = await saveCheckpoints(session.owner, challengeId, {
      checkpoints: Array.from({ length: WEEKS }, (_, index) => ({
        title: `Semana ${index + 1}`,
        kind: "week" as const,
        startsAt: addDays(startsOn, index * 7),
        dueAt: index === WEEKS - 1 ? endsOn : addDays(startsOn, index * 7 + 6),
      })),
    });
    const weekIdByNumber = new Map(
      savedCheckpoints.checkpoints.map((checkpoint, index) => [index + 1, checkpoint.id]),
    );

    // Read back the ids the domain generated: item ids and the two entry types.
    const { items, ratingTypeId, expectationTypeId, notaFieldId, commentFieldId } = await withClient(
      async (client) => {
        const itemRows = await client.query<{ id: string; title: string }>(
          "SELECT id, title FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position",
          [challengeId],
        );
        const typeRows = await client.query<{
          id: string; purpose: string; field_id: string | null; field_key: string | null;
        }>(
          `SELECT et.id, et.purpose, cf.id AS field_id, cf.semantic_key AS field_key
             FROM entry_types et
             LEFT JOIN challenge_fields cf ON cf.entry_type_id = et.id AND cf.archived_at IS NULL
            WHERE et.challenge_id = $1 AND et.archived_at IS NULL`,
          [challengeId],
        );
        const rating = typeRows.rows.find((row) => row.purpose === "rating");
        const expectation = typeRows.rows.find((row) => row.purpose === "expectation");
        return {
          items: new Map(itemRows.rows.map((row) => [row.title, row.id])),
          ratingTypeId: rating?.id ?? null,
          expectationTypeId: expectation?.id ?? null,
          notaFieldId: typeRows.rows.find((r) => r.purpose === "rating" && r.field_key === "nota")?.field_id ?? null,
          commentFieldId:
            typeRows.rows.find((r) => r.purpose === "rating" && r.field_key === "comentario")?.field_id ?? null,
        };
      },
    );
    if (!ratingTypeId || !expectationTypeId || !notaFieldId || !commentFieldId) {
      throw new Error("A receita cinema não abriu os tipos de registro esperados.");
    }

    log("distribuindo os filmes pelas semanas");
    await assignCheckpointItems(session.owner, challengeId, {
      assignments: FILMS.map((film, index) => ({
        itemId: items.get(film.title)!,
        checkpointId: weekIdByNumber.get(film.week)!,
        position: index,
      })),
    });

    log("adicionando mediana e surpresa/decepção às métricas da receita");
    await addMetric(session.owner, challengeId, {
      label: "Nota mediana", operation: "median", fieldId: notaFieldId, groupBy: "none",
    });
    await addMetric(session.owner, challengeId, {
      label: "Surpresa e decepção", operation: "surprise", fieldId: notaFieldId, groupBy: "item",
    });

    // --- run it ----------------------------------------------------------
    log("ativando o desafio");
    await transitionChallenge(session.owner, challengeId, { status: "active" });

    log("registrando 36 expectativas");
    for (const [filmIndex, film] of FILMS.entries()) {
      for (const role of ROLES) {
        await saveEntry(session.owner, challengeId, {
          participantId: accounts[role].id,
          itemId: items.get(film.title)!,
          entryTypeId: expectationTypeId,
          values: { expectativa: OPINIONS[filmIndex][role].expectation },
        });
      }
    }

    log("registrando 36 avaliações");
    const commentEntries: Array<{ entryId: string; fieldId: string }> = [];
    for (const [filmIndex, film] of FILMS.entries()) {
      for (const role of ROLES) {
        const opinion = OPINIONS[filmIndex][role];
        const entry = await saveEntry(session.owner, challengeId, {
          participantId: accounts[role].id,
          itemId: items.get(film.title)!,
          entryTypeId: ratingTypeId,
          values: {
            nota: opinion.rating,
            ...(opinion.comment ? { comentario: opinion.comment } : {}),
          },
        });
        if (opinion.comment) commentEntries.push({ entryId: entry.id, fieldId: commentFieldId });
      }
    }

    log("encerrando e gerando o Wrapped");
    await transitionChallenge(session.owner, challengeId, { status: "closed" });
    await curateResults(session.owner, challengeId, { regenerate: true, anonymizeParticipants: true });
    await curateResults(session.owner, challengeId, {
      headline: CINEMA_HEADLINE,
      summary: CINEMA_SUMMARY,
      anonymizeParticipants: true,
      includeRankings: true,
      includeAffinity: true,
      comments: commentEntries.slice(0, 6),
    });

    log("publicando o resultado anônimo");
    const published = await publishResults(session.owner, challengeId, {});

    log(`publicando como modelo (por ${accounts.admin.username})`);
    await setChallengeTemplate(session.admin, challengeId, {
      summary: "Cine clube fechado, com expectativa antes da sessão e avaliação depois. Seis semanas, doze filmes.",
    });

    void options;
    return {
      label: "Cinema",
      challengeId,
      adminPath: `/challenges/${challengeId}/manage`,
      participantPath: `/challenges/${challengeId}`,
      templatePath: `/modelos/${challengeId}`,
      publicResultToken: published.shareToken ?? null,
      counts: {
        filmes: FILMS.length,
        semanas: WEEKS,
        expectativas: FILMS.length * ROLES.length,
        avaliações: FILMS.length * ROLES.length,
        comentários: commentEntries.length,
      },
    };
  },
};
