import {
  DEFAULT_LIMITS,
  type ApiErrorBody,
  type BootstrapData,
  type ChallengeDetail,
  type ChallengeField,
  type ChallengeItem,
  type ChallengeResult,
  type Entry,
  type Id,
  type Metric,
  type Participant,
} from "./types";

/*
 * Este é o único mapa que conhece os caminhos REST. Se o backend mudar uma URL,
 * a adaptação fica concentrada aqui, sem espalhar strings pelos componentes.
 */
export const API_PATHS = {
  bootstrap: "/api/bootstrap",
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    forgot: "/api/auth/forgot",
    reset: "/api/auth/reset",
  },
  account: "/api/account",
  templates: "/api/templates",
  template: (challengeId: Id) => `/api/templates/${encodeURIComponent(challengeId)}`,
  templateDuplicate: (challengeId: Id) => `/api/templates/${encodeURIComponent(challengeId)}/duplicate`,
  challengeTemplate: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/template`,
  groups: "/api/groups",
  group: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}`,
  groupCatalog: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/catalog`,
  groupCatalogItem: (groupId: Id, itemId: Id) =>
    `/api/groups/${encodeURIComponent(groupId)}/catalog/${encodeURIComponent(itemId)}`,
  catalogItem: (itemId: Id) => `/api/catalog/${encodeURIComponent(itemId)}`,
  groupMembers: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/members`,
  groupInvites: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/invites`,
  memberRequestAccept: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/accept`,
  memberRequestDecline: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/decline`,
  memberRequestCancel: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/cancel`,
  invite: (token: string) => `/api/invites/${encodeURIComponent(token)}`,
  groupChallenges: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/challenges`,
  challenge: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}`,
  participants: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/participants`,
  fields: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/fields`,
  items: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/items`,
  item: (challengeId: Id, itemId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/${encodeURIComponent(itemId)}`,
  metrics: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/metrics`,
  results: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/results`,
  entries: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/entries`,
  entry: (entryId: Id) => `/api/entries/${encodeURIComponent(entryId)}`,
  transition: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/transition`,
  duplicate: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/duplicate`,
  exportEntries: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/export.csv`,
} as const;

export class ApiError extends Error {
  status: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;

  constructor(message: string, status: number, code?: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as ApiErrorBody | { data?: T })
    : null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      errorBody?.message ?? errorBody?.error ?? "",
      response.status,
      errorBody?.error,
      errorBody?.errors,
    );
  }

  if (body && typeof body === "object" && "data" in body && body.data !== undefined) {
    return body.data;
  }
  return body as T;
}

export function normalizeBootstrap(raw: BootstrapData | { bootstrap: BootstrapData }): BootstrapData {
  const data = "bootstrap" in raw ? raw.bootstrap : raw;
  return {
    csrfToken: data.csrfToken ?? "",
    user: data.user ?? null,
    limits: { ...DEFAULT_LIMITS, ...data.limits },
    groups: data.groups ?? [],
    challenges: data.challenges ?? [],
    memberRequests: data.memberRequests ?? [],
  };
}

export function normalizeChallenge(
  raw: ChallengeDetail | { challenge: ChallengeDetail },
): ChallengeDetail {
  const value = "challenge" in raw ? raw.challenge : raw;
  const aliases = value as ChallengeDetail & {
    checkpoints?: ChallengeItem[];
    challengeItems?: ChallengeItem[];
    challengeFields?: ChallengeField[];
    challengeParticipants?: Participant[];
    challengeMetrics?: Metric[];
    results?: ChallengeResult;
  };
  return {
    ...value,
    fields: aliases.fields ?? aliases.challengeFields ?? [],
    items: aliases.items ?? aliases.checkpoints ?? aliases.challengeItems ?? [],
    participants: aliases.participants ?? aliases.challengeParticipants ?? [],
    metrics: aliases.metrics ?? aliases.challengeMetrics ?? [],
    result: aliases.result ?? aliases.results ?? null,
  };
}

export function normalizeEntries(raw: Entry[] | { entries: Entry[] }): Entry[] {
  return Array.isArray(raw) ? raw : raw.entries ?? [];
}

export function normalizeCreatedId(raw: unknown): Id | null {
  if (!raw || typeof raw !== "object") return null;
  const object = raw as { id?: string; challengeId?: string; challenge?: { id?: string } };
  return object.id ?? object.challengeId ?? object.challenge?.id ?? null;
}
