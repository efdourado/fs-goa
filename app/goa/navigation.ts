import type { AdminTab, ParticipantTab, Screen } from "./types";

const PARTICIPANT_TABS = new Set<ParticipantTab>(["today", "results"]);
const ADMIN_TABS = new Set<AdminTab>([
  "overview",
  "participants",
  "fields",
  "items",
  "review",
  "metrics",
  "results",
]);

function decoded(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function screenFromUrl(pathname: string, search = ""): Screen | null {
  const params = new URLSearchParams(search);
  const resetToken = params.get("reset");
  if (resetToken) return { kind: "reset", token: resetToken };

  const queryInvite = params.get("invite");
  if (queryInvite) return { kind: "invite", token: queryInvite };

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "modelos" || parts[0] === "templates") {
    if (parts.length === 1) return { kind: "templates" };
    if (parts.length === 2) {
      const challengeId = decoded(parts[1]);
      return challengeId ? { kind: "template", challengeId } : null;
    }
  }
  if ((parts[0] === "invite" || parts[0] === "invites") && parts.length === 2) {
    const token = decoded(parts[1]);
    return token ? { kind: "invite", token } : null;
  }
  if (parts[0] === "catalog" && parts.length === 1) return { kind: "personal-catalog" };
  if (parts[0] === "catalog" && parts.length === 2) {
    const itemId = decoded(parts[1]);
    return itemId ? { kind: "personal-catalog-item", itemId } : null;
  }
  if (parts[0] === "groups" && parts.length === 2) {
    const groupId = decoded(parts[1]);
    if (!groupId) return null;
    return params.get("create") === "challenge"
      ? { kind: "create-challenge", groupId }
      : { kind: "group", groupId };
  }
  if (parts[0] === "groups" && parts[2] === "catalog" && parts.length === 4) {
    const groupId = decoded(parts[1]);
    const itemId = decoded(parts[3]);
    return groupId && itemId ? { kind: "catalog-item", groupId, itemId } : null;
  }
  if (parts[0] === "challenges" && parts[1] === "new" && parts.length === 2) {
    return { kind: "create-personal-challenge" };
  }
  if (parts[0] === "challenges" && parts.length >= 2) {
    const challengeId = decoded(parts[1]);
    if (!challengeId) return null;
    if (parts[2] === "manage") {
      const requested = params.get("tab") as AdminTab | null;
      return {
        kind: "admin",
        challengeId,
        tab: requested && ADMIN_TABS.has(requested) ? requested : "overview",
      };
    }
    const requested = params.get("tab") as ParticipantTab | null;
    return {
      kind: "challenge",
      challengeId,
      tab: requested && PARTICIPANT_TABS.has(requested) ? requested : "results",
    };
  }
  if (pathname === "/" || pathname === "") return { kind: "dashboard" };
  return null;
}

export function urlForScreen(screen: Screen): string | null {
  switch (screen.kind) {
    case "dashboard":
      return "/";
    case "group":
      return `/groups/${encodeURIComponent(screen.groupId)}`;
    case "catalog-item":
      return `/groups/${encodeURIComponent(screen.groupId)}/catalog/${encodeURIComponent(screen.itemId)}`;
    case "personal-catalog":
      return "/catalog";
    case "personal-catalog-item":
      return `/catalog/${encodeURIComponent(screen.itemId)}`;
    case "create-challenge":
      return `/groups/${encodeURIComponent(screen.groupId)}?create=challenge`;
    case "create-personal-challenge":
      return "/challenges/new";
    case "challenge":
      return `/challenges/${encodeURIComponent(screen.challengeId)}${screen.tab === "results" ? "" : `?tab=${screen.tab}`}`;
    case "admin":
      return `/challenges/${encodeURIComponent(screen.challengeId)}/manage${screen.tab === "overview" ? "" : `?tab=${screen.tab}`}`;
    case "templates":
      return "/modelos";
    case "template":
      return `/modelos/${encodeURIComponent(screen.challengeId)}`;
    case "invite":
      return `/invites/${encodeURIComponent(screen.token)}`;
    case "invite-success":
      return screen.invitation.challengeId
        ? `/challenges/${encodeURIComponent(screen.invitation.challengeId)}`
        : `/groups/${encodeURIComponent(screen.invitation.groupId)}`;
    case "reset":
      return `/?reset=${encodeURIComponent(screen.token)}`;
    case "account":
    case "auth":
    case "loading":
      // Transient shells that should not rewrite the address bar; a refresh
      // resolves them from the session, not the URL.
      return null;
  }
}
