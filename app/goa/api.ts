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

function searchParams(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return params.toString();
}

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
  },
  account: "/api/account",
  accountDeactivate: "/api/account/deactivate",
  accountReactivate: "/api/account/reactivate",
  accountDelete: "/api/account/delete",
  accountDeletionPreview: "/api/account/deletion-preview",
  personalTrash: "/api/personal/trash",
  groupTrash: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/trash`,
  challengeArchive: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/archive`,
  trashPreview: (scope: "personal" | { groupId: Id } | { challengeId: Id }) =>
    typeof scope === "object" && "groupId" in scope
      ? `/api/groups/${encodeURIComponent(scope.groupId)}/trash/preview`
      : typeof scope === "object" && "challengeId" in scope
        ? `/api/challenges/${encodeURIComponent(scope.challengeId)}/trash/preview`
        : "/api/personal/trash/preview",
  trashRestore: (scope: "personal" | { groupId: Id } | { challengeId: Id }) =>
    typeof scope === "object" && "groupId" in scope
      ? `/api/groups/${encodeURIComponent(scope.groupId)}/trash/restore`
      : typeof scope === "object" && "challengeId" in scope
        ? `/api/challenges/${encodeURIComponent(scope.challengeId)}/trash/restore`
        : "/api/personal/trash/restore",
  trashPurge: (scope: "personal" | { groupId: Id } | { challengeId: Id }) =>
    typeof scope === "object" && "groupId" in scope
      ? `/api/groups/${encodeURIComponent(scope.groupId)}/trash/purge`
      : typeof scope === "object" && "challengeId" in scope
        ? `/api/challenges/${encodeURIComponent(scope.challengeId)}/trash/purge`
        : "/api/personal/trash/purge",
  trashEmpty: (scope: "personal" | { groupId: Id }) =>
    typeof scope === "object" && "groupId" in scope
      ? `/api/groups/${encodeURIComponent(scope.groupId)}/trash/empty`
      : "/api/personal/trash/empty",
  templates: "/api/templates",
  template: (challengeId: Id) => `/api/templates/${encodeURIComponent(challengeId)}`,
  templateDuplicate: (challengeId: Id) => `/api/templates/${encodeURIComponent(challengeId)}/duplicate`,
  challengeTemplate: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/template`,
  challengeTemplateFeatured: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/template/featured`,
  groups: "/api/groups",
  group: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}`,
  groupCatalog: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/catalog`,
  groupCatalogItem: (groupId: Id, itemId: Id) =>
    `/api/groups/${encodeURIComponent(groupId)}/catalog/${encodeURIComponent(itemId)}`,
  personalCatalogItem: (itemId: Id) => `/api/personal/catalog/${encodeURIComponent(itemId)}`,
  catalogItem: (itemId: Id) => `/api/catalog/${encodeURIComponent(itemId)}`,
  catalogLibrary: (libraryId: Id) => `/api/catalog/libraries/${encodeURIComponent(libraryId)}`,
  libraryProperties: (libraryId: Id) => `/api/catalog/libraries/${encodeURIComponent(libraryId)}/properties`,
  libraryProperty: (libraryId: Id, key: string) =>
    `/api/catalog/libraries/${encodeURIComponent(libraryId)}/properties/${encodeURIComponent(key)}`,
  catalogWorkspace: (scope: "personal" | { groupId: Id }) => ({
    items: scope === "personal" ? "/api/personal/catalog/items" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/items`,
    remove: scope === "personal" ? "/api/personal/catalog/remove" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/remove`,
    list: scope === "personal" ? "/api/personal/catalog" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog`,
    libraries: scope === "personal" ? "/api/personal/catalog/libraries" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/libraries`,
    /** The libraries, their item counts and the newest few items of each — all a page's shelf needs, in one request. */
    shelf: scope === "personal" ? "/api/personal/catalog/shelf" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/shelf`,
    recommenders: scope === "personal" ? "/api/personal/catalog/recommenders" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/recommenders`,
    attributes: scope === "personal" ? "/api/personal/catalog-attributes" : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog-attributes`,
    search: (query: { libraryId?: Id; kind?: string; title: string }) =>
      scope === "personal"
        ? `/api/personal/catalog/search?${searchParams(query)}`
        : `/api/groups/${encodeURIComponent(scope.groupId)}/catalog/search?${searchParams(query)}`,
    item: (itemId: Id) => scope === "personal" ? `/api/personal/catalog/${encodeURIComponent(itemId)}` : `/api/catalog/${encodeURIComponent(itemId)}`,
  }),
  groupCatalogAttribute: (groupId: Id, attributeId: Id) =>
    `/api/groups/${encodeURIComponent(groupId)}/catalog-attributes/${encodeURIComponent(attributeId)}`,
  personalCatalogAttribute: (attributeId: Id) => `/api/personal/catalog-attributes/${encodeURIComponent(attributeId)}`,
  groupMembers: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/members`,
  groupMember: (groupId: Id, userId: Id) =>
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
  groupLeave: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/leave`,
  groupInvites: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/invites`,
  groupTaste: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/taste`,
  memberRequestAccept: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/accept`,
  memberRequestDecline: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/decline`,
  memberRequestCancel: (id: Id) => `/api/member-requests/${encodeURIComponent(id)}/cancel`,
  invite: (token: string) => `/api/invites/${encodeURIComponent(token)}`,
  groupChallenges: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/challenges`,
  personalChallenges: "/api/personal/challenges",
  challenge: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}`,
  participants: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/participants`,
  fields: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/fields`,
  challengeLibraries: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/libraries`,
  challengeLibrary: (challengeId: Id, libraryId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/libraries/${encodeURIComponent(libraryId)}`,
  entryTypes: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/entry-types`,
  entryType: (challengeId: Id, entryTypeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/entry-types/${encodeURIComponent(entryTypeId)}`,
  expectation: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/expectation`,
  pageCount: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/page-count`,
  nameConsent: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/consent`,
  items: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/items`,
  item: (challengeId: Id, itemId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/${encodeURIComponent(itemId)}`,
  itemReveal: (challengeId: Id, itemId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/${encodeURIComponent(itemId)}/reveal`,
  itemsPreview: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/preview`,
  itemsAssign: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/assign`,
  checkpoints: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/checkpoints`,
  metrics: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/metrics`,
  metric: (challengeId: Id, metricId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/metrics/${encodeURIComponent(metricId)}`,
  results: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/results`,
  resultsPublish: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/results/publish`,
  entries: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/entries`,
  entry: (entryId: Id) => `/api/entries/${encodeURIComponent(entryId)}`,
  preflight: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/preflight`,
  transition: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/transition`,
  duplicate: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/duplicate`,
  challengePrefs: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/prefs`,
} as const;

export class ApiError extends Error {
  status: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  /** Extra structured facts the server attached — e.g. which metrics block removing a response type. */
  details?: unknown;

  constructor(message: string, status: number, code?: string, fieldErrors?: Record<string, string[]>, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

/**
 * How long a request may take before the app stops waiting. The database stops a statement at 15s and Vercel's
 * function at its own limit; past this, the person is better off with an answer than a spinner.
 */
export const REQUEST_TIMEOUT_MS = 25_000;

/** Writes still on their way; closing the tab while one is pending asks the person to wait. */
let pendingWrites = 0;
let unloadGuardInstalled = false;

function guardUnloadWhileWriting(): void {
  if (unloadGuardInstalled || typeof window === "undefined") return;
  unloadGuardInstalled = true;
  window.addEventListener("beforeunload", (event) => {
    if (pendingWrites === 0) return;
    event.preventDefault();
    // Older browsers only prompt when a return value is set.
    event.returnValue = "";
  });
}

export function pendingWriteCount(): number {
  return pendingWrites;
}

/** Reads the body as JSON when there is one. Empty or malformed is `undefined`, never a thrown parse error. */
async function readBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (!text.trim()) return undefined;
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Every call to the API. Whatever goes wrong, the caller gets an `ApiError` with a code the UI can explain:
 * `timeout` (no answer in time; for a write it may still have gone through), `network` (offline or the server
 * unreachable), `bad_response` (a success with no usable body) or the server's own code. Only the caller's own
 * abort comes through as the native `AbortError`, so cancelled screens stay quiet.
 */
export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);

  // One signal that fires on the caller's abort or on the timeout, whichever comes first.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  const isWrite = method !== "GET";
  if (isWrite) {
    guardUnloadWhileWriting();
    pendingWrites += 1;
  }

  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: "same-origin",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw failure(cause, timedOut, isWrite);
    }

    let body: unknown;
    try {
      body = await readBody(response);
    } catch (cause) {
      throw failure(cause, timedOut, isWrite);
    }
    // The body can be cut off by the timeout too; that's a timeout, not a bad response.
    if (timedOut) throw failure(null, true, isWrite);

    if (!response.ok) {
      const errorBody = (body && typeof body === "object" ? body : null) as ApiErrorBody | null;
      throw new ApiError(
        errorBody?.message ?? errorBody?.error ?? "",
        response.status,
        errorBody?.error,
        errorBody?.errors,
        errorBody?.details,
      );
    }

    // Every endpoint answers with a JSON object; an empty or non-JSON success means something in between (a
    // proxy, a cut connection) swallowed it, and callers would crash reading fields off `null`.
    if (!body || typeof body !== "object") {
      throw new ApiError("", response.status, isWrite ? "bad_response_write" : "bad_response");
    }
    if ("data" in body && (body as { data?: T }).data !== undefined) {
      return (body as { data: T }).data;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
    if (isWrite) pendingWrites -= 1;
  }
}

function failure(cause: unknown, timedOut: boolean, isWrite: boolean): unknown {
  if (timedOut) return new ApiError("", 0, isWrite ? "timeout_write" : "timeout");
  // The caller's own abort: pass it through untouched.
  if (cause instanceof DOMException && cause.name === "AbortError") return cause;
  if (cause instanceof ApiError) return cause;
  return new ApiError("", 0, isWrite ? "network_write" : "network");
}

export function normalizeBootstrap(raw: BootstrapData | { bootstrap: BootstrapData }): BootstrapData {
  const data = "bootstrap" in raw ? raw.bootstrap : raw;
  return {
    csrfToken: data.csrfToken ?? "",
    user: data.user ?? null,
    limits: { ...DEFAULT_LIMITS, ...data.limits },
    personalWorkspaceId: data.personalWorkspaceId ?? null,
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
    items: aliases.items ?? aliases.challengeItems ?? [],
    checkpoints: aliases.checkpoints ?? [],
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
