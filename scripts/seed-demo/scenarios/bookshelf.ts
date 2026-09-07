import { createChallenge } from "../../../lib/goa/domain/challenges";
import { transitionChallenge } from "../../../lib/goa/challenges/lifecycle";
import { saveEntry } from "../../../lib/goa/challenges/entries";
import { curateResults, publishResults } from "../../../lib/goa/challenges/results";
import { setChallengeTemplate } from "../../../lib/goa/challenges/templates";

import { BOOKSHELF_HEADLINE, BOOKSHELF_SUMMARY, BOOKSHELF_TITLE, RATINGS, SHELF } from "../data/bookshelf";
import type { SeedContext } from "../runtime";
import { readShape, ROLES } from "./shared";
import type { Scenario, ScenarioResult } from "./types";

export const bookshelf: Scenario = {
  key: "bookshelf",
  title: "Estante — 10 livros, sem período, perfil de gosto",

  plan(context: SeedContext): string {
    return [
      `Desafio "${BOOKSHELF_TITLE}" (receita bookshelf), sem período.`,
      `  · 3 participantes: ${ROLES.map((r) => context.accounts[r].username).join(", ")}.`,
      `  · ${SHELF.length} livros reais (autor, ano, páginas, gênero); 30 avaliações com comentários curtos.`,
      "  · gostos deliberadamente distantes entre as três contas.",
      "  · métricas da receita: nota média, ranking, polarização, viés do indicador, conclusão.",
      "  · encerra, gera o Wrapped (com perfil de gosto por pessoa), publica anônimo e publica como modelo.",
    ].join("\n");
  },

  async run(context: SeedContext): Promise<ScenarioResult> {
    const { accounts, session, groupId, log } = context;

    log(`criando a estante e os ${SHELF.length} livros`);
    const created = await createChallenge(session.owner, groupId, {
      recipe: "bookshelf",
      title: BOOKSHELF_TITLE,
      description: "Estante de demonstração — opiniões fictícias.",
      participantIds: ROLES.map((role) => accounts[role].id),
      items: SHELF.map((book) => ({
        title: book.title,
        author: book.author,
        // The catalogue only accepts years from 1870; pre-1870 classics keep the
        // rest of their metadata and just carry no year.
        ...(book.year >= 1870 ? { year: book.year } : {}),
        pageCount: book.pageCount,
        mainGenre: book.mainGenre,
        recommendedByUserId: accounts[book.recommender].id,
      })),
    });
    const challengeId = created.challengeId;
    const shape = await readShape(challengeId);
    const ratingType = shape.typeByPurpose.get("rating")!;

    log("ativando a estante");
    await transitionChallenge(session.owner, challengeId, { status: "active" });

    log(`registrando ${SHELF.length * ROLES.length} avaliações`);
    const commentEntries: Array<{ entryId: string; fieldId: string }> = [];
    for (const [bookIndex, book] of SHELF.entries()) {
      for (const role of ROLES) {
        const opinion = RATINGS[bookIndex][role];
        const entry = await saveEntry(session.owner, challengeId, {
          participantId: accounts[role].id,
          itemId: shape.itemId(book.title),
          entryTypeId: ratingType,
          values: {
            nota: opinion.rating,
            ...(opinion.comment ? { comentario: opinion.comment } : {}),
          },
        });
        if (opinion.comment) commentEntries.push({ entryId: entry.id, fieldId: shape.fieldId("comentario", "rating") });
      }
    }

    log("encerrando e gerando o Wrapped");
    await transitionChallenge(session.owner, challengeId, { status: "closed" });
    await curateResults(session.owner, challengeId, { regenerate: true, anonymizeParticipants: true });
    await curateResults(session.owner, challengeId, {
      headline: BOOKSHELF_HEADLINE,
      summary: BOOKSHELF_SUMMARY,
      anonymizeParticipants: true,
      includeRankings: true,
      includeAffinity: true,
      comments: commentEntries.slice(0, 6),
    });

    log("publicando o resultado anônimo");
    const published = await publishResults(session.owner, challengeId, {});

    log(`publicando como modelo (por ${accounts.admin.username})`);
    await setChallengeTemplate(session.admin, challengeId, {
      summary: "Estante sem prazo: cada livro ganha uma nota e um comentário, e o resultado mostra o gosto de cada pessoa.",
    });

    return {
      label: "Estante",
      challengeId,
      adminPath: `/challenges/${challengeId}/manage`,
      participantPath: `/challenges/${challengeId}`,
      templatePath: `/modelos/${challengeId}`,
      publicResultToken: published.shareToken ?? null,
      counts: {
        livros: SHELF.length,
        avaliações: SHELF.length * ROLES.length,
        comentários: commentEntries.length,
      },
    };
  },
};
