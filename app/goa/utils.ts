import type { ChallengeField, ChallengeItem, ChallengeStatus, Entry, Id, RecipeKey, Role, SubmissionMode } from "./types";

export function canManage(role?: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Mirrors `recipeCatalogKind` on the server — which acervo (filme/livro) a recipe tracks, if any. */
export function recipeCatalogKind(recipeKey?: RecipeKey | null): "film" | "book" | null {
  if (recipeKey === "cinema" || recipeKey === "cine_free" || recipeKey === "cine_curated") return "film";
  if (recipeKey === "library" || recipeKey === "bookshelf" || recipeKey === "reading_club") return "book";
  return null;
}

/** A metric worth rendering: a real scalar, or a series with ≥1 non-thin row. */
export function metricHasData(metric: { value?: unknown; series?: Array<{ value: number | null }> }): boolean {
  if (metric.series?.length) return metric.series.some((row) => row.value !== null);
  return metric.value !== null && metric.value !== undefined && metric.value !== "";
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e Caio", "Ana, Bruno e mais 4". */
export function participantsSentence(names: string[], andMore: (count: number) => string): string {
  const list = new Intl.ListFormat(undefined, { style: "long", type: "conjunction" });
  if (names.length <= 3) return list.format(names);
  return list.format([...names.slice(0, 2), andMore(names.length - 2)]);
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "campo";
}

export function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "Sem data";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", options ?? { day: "2-digit", month: "short" }).format(
    date,
  );
}

export function formatDateTime(value?: string | null): string {
  return formatDate(value, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateRange(startsOn?: string | null, endsOn?: string | null): string {
  if (startsOn && endsOn) return `${formatDate(startsOn)} — ${formatDate(endsOn)}`;
  if (startsOn) return `Desde ${formatDate(startsOn)}`;
  if (endsOn) return `Até ${formatDate(endsOn)}`;
  return "Sem datas";
}

/**
 * Shifts a `YYYY-MM-DD` key by a number of days and/or whole months. Month steps
 * clamp overflow, so "31/01 + 1 mês" lands on the last day of February instead of
 * spilling into March. Used to turn "começa aqui, dura 90 dias" into an end date.
 */
export function shiftDateKey(dateKey: string, shift: { days?: number; months?: number }): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const months = shift.months ?? 0;
  const target = new Date(Date.UTC(year, month - 1 + months, day));
  if (months && target.getUTCDate() !== day) target.setUTCDate(0);
  target.setUTCDate(target.getUTCDate() + (shift.days ?? 0));
  return target.toISOString().slice(0, 10);
}

/** Inclusive day span of a period, matching how daily checkpoints are counted. */
export function inclusiveDayCount(startsOn?: string | null, endsOn?: string | null): number | null {
  if (!startsOn || !endsOn) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function inviteTokenFromText(value: string, baseUrl = "https://goa.invalid"): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed, baseUrl);
    const queryToken = url.searchParams.get("invite")?.trim();
    if (queryToken) return queryToken;
    const pathToken = url.pathname.split("/").filter(Boolean).at(-1);
    if (pathToken) {
      try {
        return decodeURIComponent(pathToken);
      } catch {
        return pathToken;
      }
    }
  } catch {
    // Mantém compatibilidade com um código bruto ou texto parcialmente colado.
  }

  return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
}

export function dateKeyInSaoPaulo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * "Agendado" só faz sentido no diário: os checkpoints ainda não foram alcançados.
 * Uma rodada de cine (item/free) com início futuro é simplesmente `active` — o
 * formulário e a API já aceitam avaliações.
 */
export function isChallengeScheduled(
  status: ChallengeStatus,
  startsOn?: string | null,
  submissionMode?: SubmissionMode,
  now = new Date(),
): boolean {
  return status === "active"
    && submissionMode === "daily"
    && Boolean(startsOn && startsOn > dateKeyInSaoPaulo(now));
}

/**
 * A living list ("films I've seen") is `challenges.kind === "list"` — a real
 * category decided once at creation (personal + no start/end), not a condition
 * re-derived from today's dates. It is born active and never closes, so the
 * whole draft/activate/close lifecycle (and its UI) is hidden. Falls back to the
 * old derivation for any payload that predates the `kind` column.
 */
export function isLivingList(challenge: {
  kind?: "round" | "list";
  scope?: "personal" | "group";
  startsOn?: string | null;
  endsOn?: string | null;
  status: ChallengeStatus;
}): boolean {
  if (challenge.kind) return challenge.kind === "list";
  return challenge.scope === "personal"
    && !challenge.startsOn
    && !challenge.endsOn
    && challenge.status !== "closed";
}

/** The first required field still blank, or undefined once every required field has a value. */
export function findMissingRequiredField(fields: ChallengeField[], values: Record<Id, unknown>): ChallengeField | undefined {
  return fields.find((field) => {
    if (!field.required || !field.id) return false;
    const value = values[field.id];
    return value === undefined || value === null || value === "";
  });
}

/**
 * There is no delete button on an entry form: clearing the required answer
 * (e.g. tapping an already-picked rating again) and submitting is the delete
 * gesture instead, but only for an entry that already exists and can be
 * removed — a first-time submission with a blank required field is still
 * just an incomplete entry, not a request to delete something.
 */
export function isEmptySaveADelete(missingField: ChallengeField | undefined, hasEntry: boolean, canDelete: boolean): boolean {
  return Boolean(missingField) && hasEntry && canDelete;
}

export function entryUnavailableMessage({
  challengeStatus,
  isParticipant,
  itemStatus,
  opensAt,
}: {
  challengeStatus: ChallengeStatus;
  isParticipant?: boolean;
  itemStatus?: ChallengeItem["status"];
  opensAt?: string | null;
}): string | null {
  if (challengeStatus === "closed") return "Este desafio foi encerrado. O registro está disponível somente para leitura.";
  if (challengeStatus === "draft") return "Este desafio ainda é um rascunho. Ative-o para liberar os registros.";
  if (isParticipant === false) return "Você pode acompanhar este desafio, mas não está entre as pessoas selecionadas para registrar.";
  if (itemStatus === "scheduled") {
    return opensAt
      ? `Este checkpoint ainda não começou. O registro será liberado em ${formatDateTime(opensAt)}.`
      : "Este checkpoint ainda não começou. O registro será liberado na data programada.";
  }
  if (itemStatus === "closed") return "Este checkpoint foi encerrado. O registro está disponível somente para leitura.";
  return null;
}

export function itemStatusLabel(status?: ChallengeItem["status"]): string {
  return status === "scheduled" ? "Programado"
    : status === "open" ? "Disponível"
      : status === "past_due" ? "Prazo encerrado"
        : status === "closed" ? "Encerrado"
          : "Planejado";
}

export function valuesAsRecord(values: Entry["values"]): Record<Id, unknown> {
  if (Array.isArray(values)) {
    return Object.fromEntries(values.map((item) => [item.fieldId, item.value]));
  }
  return values ?? {};
}

export function itemIdForEntry(entry: Entry): Id | null {
  return entry.itemId ?? entry.checkpointId ?? null;
}
