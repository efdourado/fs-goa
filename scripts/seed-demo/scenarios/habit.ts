import { createChallenge } from "../../../lib/goa/domain/challenges";
import { transitionChallenge } from "../../../lib/goa/challenges/lifecycle";
import { saveEntry } from "../../../lib/goa/challenges/entries";
import { addMetric, curateResults, publishResults } from "../../../lib/goa/challenges/results";
import { setChallengeTemplate } from "../../../lib/goa/challenges/templates";

import { HABIT_DAYS, HABIT_HEADLINE, HABIT_SUMMARY, HABIT_TITLE, PATTERNS } from "../data/habit";
import type { SeedContext } from "../runtime";
import { addDays, backdateLifecycle, pastWindow, readShape, ROLES } from "./shared";
import type { Scenario, ScenarioResult } from "./types";

const FIELDS = [
  { key: "minutos", label: "Minutos estudados", type: "number" as const, required: true, config: { min: 0, step: 5 } },
  { key: "foco", label: "Foco (1–5)", type: "rating" as const, required: false, config: { min: 1, max: 5, step: 1 } },
  { key: "observacao", label: "Observação", type: "text" as const, required: false, config: { multiline: true, maxLength: 300 } },
];

export const habit: Scenario = {
  key: "habit",
  title: "Hábito — 21 dias de estudo, três padrões de participação",

  plan(context: SeedContext): string {
    const { startsOn, endsOn } = pastWindow(HABIT_DAYS);
    return [
      `Desafio "${HABIT_TITLE}" (receita habit), ${startsOn} → ${endsOn}.`,
      `  · 3 participantes: ${ROLES.map((r) => context.accounts[r].username).join(", ")}.`,
      "  · sem catálogo; campos: minutos estudados, foco (1–5), observação.",
      "  · três padrões — constante, começa forte e some, irregular (fim de semana).",
      "  · métricas: soma e média de minutos, minutos por pessoa, foco médio, taxa de conclusão.",
      "  · encerra (com datas retroagidas p/ a taxa de conclusão bater), publica anônimo e publica como modelo.",
    ].join("\n");
  },

  async run(context: SeedContext): Promise<ScenarioResult> {
    const { accounts, session, groupId, log } = context;
    const { startsOn, endsOn } = pastWindow(HABIT_DAYS);

    log("criando o hábito e os campos do check-in");
    const created = await createChallenge(session.owner, groupId, {
      recipe: "habit",
      title: HABIT_TITLE,
      description: HABIT_HEADLINE,
      startsOn,
      endsOn,
      participantIds: ROLES.map((role) => accounts[role].id),
      fields: FIELDS,
    });
    const challengeId = created.challengeId;
    const shape = await readShape(challengeId);
    const checkinType = shape.typeByPurpose.get("checkin")!;

    log("montando as métricas de minutos");
    await addMetric(session.owner, challengeId, {
      label: "Minutos no total", operation: "sum", fieldId: shape.fieldId("minutos"), groupBy: "none",
    });
    await addMetric(session.owner, challengeId, {
      label: "Média de minutos por dia", operation: "average", fieldId: shape.fieldId("minutos"), groupBy: "none",
    });
    await addMetric(session.owner, challengeId, {
      label: "Minutos por pessoa", operation: "sum", fieldId: shape.fieldId("minutos"), groupBy: "participant",
    });
    await addMetric(session.owner, challengeId, {
      label: "Foco médio por pessoa", operation: "average", fieldId: shape.fieldId("foco"), groupBy: "participant",
    });

    log("ativando o hábito");
    await transitionChallenge(session.owner, challengeId, { status: "active" });

    log(`registrando os check-ins de ${HABIT_DAYS} dias`);
    let checkins = 0;
    let missed = 0;
    const commentEntries: Array<{ entryId: string; fieldId: string }> = [];
    for (const role of ROLES) {
      const pattern = PATTERNS[role];
      for (let day = 0; day < HABIT_DAYS; day += 1) {
        const checkin = pattern[day];
        if (!checkin) { missed += 1; continue; }
        const entry = await saveEntry(session.owner, challengeId, {
          participantId: accounts[role].id,
          entryTypeId: checkinType,
          occurredOn: addDays(startsOn, day),
          values: {
            minutos: checkin.minutes,
            foco: checkin.focus,
            ...(checkin.note ? { observacao: checkin.note } : {}),
          },
        });
        checkins += 1;
        if (checkin.note) commentEntries.push({ entryId: entry.id, fieldId: shape.fieldId("observacao") });
      }
    }

    log("encerrando e retroagindo as datas do ciclo");
    await transitionChallenge(session.owner, challengeId, { status: "closed" });
    await backdateLifecycle(challengeId, startsOn, endsOn);

    log("gerando o Wrapped");
    await curateResults(session.owner, challengeId, { regenerate: true, anonymizeParticipants: true });
    await curateResults(session.owner, challengeId, {
      headline: HABIT_HEADLINE,
      summary: HABIT_SUMMARY,
      anonymizeParticipants: true,
      includeRankings: true,
      includeAffinity: false,
      comments: commentEntries.slice(0, 5),
    });

    log("publicando o resultado anônimo");
    const published = await publishResults(session.owner, challengeId, {});

    log(`publicando como modelo (por ${accounts.admin.username})`);
    await setChallengeTemplate(session.admin, challengeId, {
      summary: "Hábito diário de 21 dias com minutos, foco e observação. Sem catálogo — só o check-in.",
    });

    return {
      label: "Hábito",
      challengeId,
      adminPath: `/challenges/${challengeId}/manage`,
      participantPath: `/challenges/${challengeId}`,
      templatePath: `/modelos/${challengeId}`,
      publicResultToken: published.shareToken ?? null,
      counts: {
        dias: HABIT_DAYS,
        "check-ins": checkins,
        "dias pulados": missed,
        observações: commentEntries.length,
      },
    };
  },
};
