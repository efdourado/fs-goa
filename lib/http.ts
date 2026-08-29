import { requestHasExactOrigin } from "./security";

const MAX_JSON_BYTES = 128 * 1024;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("referrer-policy", "no-referrer");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("x-frame-options", "DENY");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "content_type", "Envie o corpo como application/json.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "payload_too_large", "O corpo da requisição é grande demais.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "payload_too_large", "O corpo da requisição é grande demais.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "JSON inválido.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "O corpo precisa ser um objeto JSON.");
  }
  return body as Record<string, unknown>;
}

export function stringValue(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): string | undefined {
  const value = body[key];
  if ((value === undefined || value === null || value === "") && options.optional) return undefined;
  if (typeof value !== "string") throw new ApiError(400, "invalid_field", `${key} precisa ser texto.`);
  const clean = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 5_000;
  if (Array.from(clean).length < min || Array.from(clean).length > max) {
    throw new ApiError(400, "invalid_field", `${key} precisa ter entre ${min} e ${max} caracteres.`);
  }
  return clean;
}

export function expectedOrigin(request: Request): string {
  const configured = typeof process !== "undefined" ? process.env.APP_ORIGIN : undefined;
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

export function requireMutationOrigin(request: Request): void {
  if (!requestHasExactOrigin(request, expectedOrigin(request))) {
    throw new ApiError(403, "invalid_origin", "Origem da requisição não autorizada.");
  }
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function notFound(): never {
  throw new ApiError(404, "not_found", "Recurso não encontrado.");
}

export async function handleApi(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.code, message: error.message, details: error.details }, error.status);
    }

    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError?.code === "23505") {
      return json({ error: "conflict", message: "Já existe um registro com esses dados." }, 409);
    }
    if (databaseError?.code === "23503" || databaseError?.code === "23514") {
      return json({ error: "invalid_relation", message: "A operação viola uma regra do domínio." }, 400);
    }

    console.error("Unhandled Goa API error", { name: error instanceof Error ? error.name : "unknown" });
    return json({ error: "internal_error", message: "Não foi possível concluir a operação." }, 500);
  }
}
