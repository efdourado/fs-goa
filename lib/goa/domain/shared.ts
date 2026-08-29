import { ApiError } from "../../http";
import { validateDateValue } from "../../validation";

export function publicId(): string {
  return crypto.randomUUID();
}

export function semanticKey(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const key = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return /^[a-z]/u.test(key) ? key : fallback;
}

export function dateString(value: unknown, name: string): string {
  const result = validateDateValue(value);
  if (!result.ok) throw new ApiError(400, "invalid_date", `${name}: ${result.message}`);
  return result.value;
}

export function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ApiError(400, "invalid_number", `Use um número inteiro entre ${min} e ${max}.`);
  }
  return number;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
