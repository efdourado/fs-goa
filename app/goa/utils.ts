import type { ChallengeItem, ChallengeStatus, Entry, Id, Role } from "./types";

export function canManage(role?: Role): boolean {
  return role === "owner" || role === "admin";
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

function dateKeyInSaoPaulo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isChallengeScheduled(
  status: ChallengeStatus,
  startsOn?: string | null,
  now = new Date(),
): boolean {
  return status === "active" && Boolean(startsOn && startsOn > dateKeyInSaoPaulo(now));
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
