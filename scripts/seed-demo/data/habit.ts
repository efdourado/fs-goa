import type { Role } from "../scenarios/shared";

/**
 * A 21-day study habit with three deliberately different participation shapes:
 * the owner is steady, the admin starts strong and fades, the participant is
 * erratic (weekends off, then bursts). `null` = a day skipped entirely.
 */

export const HABIT_DAYS = 21;

export interface DemoCheckin {
  /** Minutes studied that day. */
  minutes: number;
  /** Self-rated focus, 1–5. */
  focus: number;
  note?: string;
}

type Pattern = Array<DemoCheckin | null>;

const steady: Pattern = [
  { minutes: 50, focus: 4, note: "Retomei os flashcards de espanhol." },
  { minutes: 45, focus: 4 },
  { minutes: 55, focus: 5, note: "Bloco de foco de manhã cedo funcionou." },
  { minutes: 40, focus: 3 },
  { minutes: 50, focus: 4 },
  { minutes: 30, focus: 3, note: "Dia corrido, mas não zerei." },
  null,
  { minutes: 60, focus: 5 },
  { minutes: 50, focus: 4 },
  { minutes: 45, focus: 4 },
  { minutes: 55, focus: 4 },
  { minutes: 50, focus: 5, note: "Terminei o capítulo de estatística." },
  { minutes: 35, focus: 3 },
  null,
  { minutes: 50, focus: 4 },
  { minutes: 55, focus: 4 },
  { minutes: 45, focus: 4 },
  { minutes: 60, focus: 5 },
  { minutes: 50, focus: 4 },
  { minutes: 40, focus: 3, note: "Cansado, mas mantive o hábito." },
  { minutes: 55, focus: 5, note: "Fechei os 21 dias." },
];

const fadesOut: Pattern = [
  { minutes: 70, focus: 5, note: "Comecei animado — meta de 1h por dia." },
  { minutes: 65, focus: 5 },
  { minutes: 60, focus: 4 },
  { minutes: 55, focus: 4 },
  { minutes: 50, focus: 4, note: "Ritmo bom, sem esforço." },
  { minutes: 45, focus: 3 },
  { minutes: 40, focus: 3 },
  { minutes: 30, focus: 2, note: "Começando a pesar." },
  null,
  { minutes: 25, focus: 2 },
  null,
  null,
  { minutes: 20, focus: 2, note: "Voltei só pra não quebrar de vez." },
  null,
  null,
  null,
  { minutes: 15, focus: 2 },
  null,
  null,
  null,
  { minutes: 30, focus: 3, note: "Último dia, tentando recuperar o embalo." },
];

const erratic: Pattern = [
  { minutes: 90, focus: 4, note: "Domingo livre, fui fundo." },
  { minutes: 20, focus: 2 },
  null,
  { minutes: 25, focus: 3 },
  null,
  null,
  { minutes: 120, focus: 5, note: "Maratona de fim de semana." },
  null,
  { minutes: 15, focus: 2 },
  { minutes: 40, focus: 3 },
  null,
  null,
  null,
  { minutes: 100, focus: 4, note: "De novo o fim de semana salvando a semana." },
  { minutes: 30, focus: 3 },
  null,
  { minutes: 20, focus: 2 },
  null,
  null,
  { minutes: 80, focus: 4 },
  { minutes: 45, focus: 3, note: "Fechei irregular, mas fechei." },
];

export const PATTERNS: Record<Role, Pattern> = {
  owner: steady,
  admin: fadesOut,
  participant: erratic,
};

export const HABIT_TITLE = "Estudo — Demo";
export const HABIT_HEADLINE = "21 dias de estudo, 3 formas de (não) manter a régua";
export const HABIT_SUMMARY = "Um hábito de estudo de 21 dias, com minutos, foco e uma observação por dia. Sem catálogo, sem item.";
