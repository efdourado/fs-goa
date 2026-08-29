import type { Entry, Id, Role } from "./types";

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

export function valuesAsRecord(values: Entry["values"]): Record<Id, unknown> {
  if (Array.isArray(values)) {
    return Object.fromEntries(values.map((item) => [item.fieldId, item.value]));
  }
  return values ?? {};
}

export function itemIdForEntry(entry: Entry): Id | null {
  return entry.itemId ?? entry.checkpointId ?? null;
}

export function inviteTokenFromText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, window.location.origin);
    const queryToken = url.searchParams.get("invite");
    if (queryToken) return queryToken;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? trimmed;
  } catch {
    return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  }
}
