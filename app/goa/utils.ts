import type { ChallengeDetail, ChallengeField, ChallengeItem, ChallengeStatus, Entry, Id, Metric, MetricOperation, RecipeKey, Role, SubmissionMode } from "./types";

export function canManage(role?: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Mirrors `recipeCatalogKind` on the server — which acervo (filme/livro) a recipe tracks, if any. */
export function recipeCatalogKind(recipeKey?: RecipeKey | null): "film" | "book" | null {
  if (recipeKey === "cinema" || recipeKey === "cine_free" || recipeKey === "cine_curated") return "film";
  if (recipeKey === "library" || recipeKey === "bookshelf" || recipeKey === "reading_club" || recipeKey === "reading_daily") return "book";
  return null;
}

/** A personal challenge lives in the hidden solo workspace — never a real group. */
export function isPersonalChallenge(
  challenge: { scope?: "personal" | "group"; groupId?: Id | null },
  personalWorkspaceId: Id | null,
): boolean {
  return challenge.scope === "personal"
    || (personalWorkspaceId !== null && challenge.groupId === personalWorkspaceId);
}

type MetricTheme = "ranking" | "people" | "debate";

/**
 * Groups a results-page ranking by theme instead of a flat stack: "by person"
 * (indicator bias, or anything broken down per participant), "what split
 * opinion" (polarisation/surprise), or the ranking itself — items, catalogue
 * years, genres, whatever it's grouped by.
 */
export function metricTheme(metric: { operation: MetricOperation; groupBy?: Metric["groupBy"] }): MetricTheme {
  if (metric.operation === "spread" || metric.operation === "surprise") return "debate";
  if (metric.operation === "indicator_bias" || metric.groupBy === "participant") return "people";
  return "ranking";
}

/** "105" → "1h45"; "45" → "45min"; "120" → "2h". */
export function formatRuntime(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, "0")}`;
}

/** A metric worth rendering: a real scalar, or a series with ≥1 non-thin row. */
export function metricHasData(metric: { value?: unknown; series?: Array<{ value: number | null }> }): boolean {
  if (metric.series?.length) return metric.series.some((row) => row.value !== null);
  return metric.value !== null && metric.value !== undefined && metric.value !== "";
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "campo";
}

function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
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

/**
 * How to read "the rating" an entry gave its item. When a metric is named the challenge's rating
 * (`ratingFieldIds`), it's the average of those fields the entry answered; otherwise the first rating field of a
 * rating-purpose, individually answered type — an expectation uses the same widget but is a different question.
 */
export function entryRatingReader(challenge: Pick<ChallengeDetail, "entryTypes" | "ratingFieldIds">): (entry: Entry) => number | null {
  const numeric = (raw: unknown) => (typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN);
  const named = challenge.ratingFieldIds?.length ? challenge.ratingFieldIds : null;
  if (named) {
    return (entry) => {
      const values = valuesAsRecord(entry.values);
      const answered = named.map((id) => numeric(values[id])).filter((value) => !Number.isNaN(value));
      return answered.length ? answered.reduce((sum, value) => sum + value, 0) / answered.length : null;
    };
  }
  const fieldByType = new Map(
    (challenge.entryTypes ?? [])
      .filter((type) => type.purpose === "rating" && type.answerScope !== "shared")
      .map((type) => [type.id, type.fields.find((field) => field.type === "rating")?.id ?? null]),
  );
  return (entry) => {
    const fieldId = fieldByType.get(entry.entryTypeId ?? "");
    if (!fieldId) return null;
    const value = numeric(valuesAsRecord(entry.values)[fieldId]);
    return Number.isNaN(value) ? null : value;
  };
}

export function itemIdForEntry(entry: Entry): Id | null {
  return entry.itemId ?? entry.checkpointId ?? null;
}

type CommentBlock = { kind: "quote" | "text" | "divider"; text: string };

const OPENS_QUOTE = /^['‘]/;
const CLOSES_QUOTE = /['’]$/;

/**
 * Splits a comment into quote/opinion/divider blocks. A quote is marked by a
 * single-quote mark ('like this'; a curly ‘…’ from autocorrect counts too)
 * at the very start of a line and another at the very end of a line, however
 * many lines — and however many blank lines — sit between them; a pasted
 * multi-paragraph quote stays one block, blank lines and all. Only the two
 * boundary marks are read: a nested 'aside', an ordinary "double-quoted"
 * word, or a mid-sentence contraction never counts, because they're never
 * examined — just the first character of a line (for an opener) and the last
 * (for a closer). That's also why a quote mark buried mid-line, like
 * `Rick: "you're a 'legend'"`, never misfires: that line doesn't start or end
 * with the mark, so it's read as plain opinion text, exactly as typed. A
 * quote opened but never closed falls back to being plain text too — marker
 * included — rather than swallowing the rest of the comment. A line that is
 * just "---" (three or more dashes) is its own divider, read only outside a
 * quote — inside one it's just literal content.
 */
export function parseCommentBlocks(value: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let textLines: string[] = [];
  let quoteLines: string[] = [];
  let openerRawLines: string[] = [];
  let inQuote = false;

  const flushText = () => {
    if (!textLines.length) return;
    blocks.push({ kind: "text", text: textLines.join("\n") });
    textLines = [];
  };

  for (const rawLine of value.trim().split("\n")) {
    const line = rawLine.trim();
    if (!inQuote) {
      if (/^-{3,}$/.test(line)) {
        flushText();
        blocks.push({ kind: "divider", text: "" });
        continue;
      }
      if (line === "") {
        flushText();
        continue;
      }
      if (OPENS_QUOTE.test(line)) {
        const rest = line.slice(1);
        if (rest.length > 0 && CLOSES_QUOTE.test(rest)) {
          // Opens and closes on the very same line — a short quote.
          flushText();
          blocks.push({ kind: "quote", text: rest.slice(0, -1).trim() });
          continue;
        }
        flushText();
        inQuote = true;
        quoteLines = [rest];
        openerRawLines = [rawLine];
        continue;
      }
      textLines.push(rawLine);
    } else {
      openerRawLines.push(rawLine);
      if (CLOSES_QUOTE.test(line)) {
        quoteLines.push(line.slice(0, -1));
        blocks.push({ kind: "quote", text: quoteLines.join("\n").trim() });
        inQuote = false;
        quoteLines = [];
        openerRawLines = [];
      } else {
        quoteLines.push(rawLine);
      }
    }
  }
  if (inQuote) {
    // Never closed — put it back as plain text, opening mark included,
    // instead of losing the rest of the comment to a broken quote.
    textLines.push(...openerRawLines);
  }
  flushText();
  return blocks;
}


/**
 * Whether one item is *done* for one person — the same rule the server counts
 * with. The completion answer has to be in (their own, or the group's one shared
 * answer when that type is shared), and so does every *other* shared answer that
 * has a required field: an item isn't done while the group still owes its final
 * score. With no shared answers this reduces to "you recorded it".
 */
export function isItemDone(
  challenge: Pick<ChallengeDetail, "entryTypes" | "completionEntryTypeId">,
  entries: Entry[],
  userId: Id | undefined | null,
  itemId: Id,
): boolean {
  const forItem = entries.filter((entry) => itemIdForEntry(entry) === itemId);
  const mine = (entry: Entry) => entry.answerScope === "shared" || (userId != null && entry.userId === userId);
  const completionId = challenge.completionEntryTypeId;
  const completionMet = completionId
    ? forItem.some((entry) => entry.entryTypeId === completionId && mine(entry))
    : forItem.some(mine);
  if (!completionMet) return false;
  return challenge.entryTypes
    .filter((type) => type.answerScope === "shared" && type.id !== completionId && type.fields.some((field) => field.required))
    .every((type) => forItem.some((entry) => entry.entryTypeId === type.id));
}

/** A saved answer as text, in the field's own terms — a select shows its option's label, a yes/no its word. */
export function displayAnswer(field: ChallengeField, raw: unknown, words: { yes: string; no: string }): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (field.type === "boolean") return raw === true || raw === "true" ? words.yes : words.no;
  if (field.type === "select") {
    const option = (field.config?.options ?? []).find((candidate) => (candidate.id ?? candidate.value ?? candidate.label) === raw);
    return option?.label ?? String(raw);
  }
  if (field.type === "rating") return String(raw).replace(".", ",");
  return String(raw);
}
