import type { AdminTab, ParticipantTab, Screen } from "./types";

const PARTICIPANT_TABS = new Set<ParticipantTab>(["today", "grupo", "results"]);
const ADMIN_TABS = new Set<AdminTab>([
  "overview",
  "participants",
  "fields",
  "items",
  "checkpoints",
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
  if (parts[0] === "sobre" && parts.length === 1) return { kind: "about" };
  if (parts[0] === "personal" && parts.length === 1) return { kind: "personal-space" };
  if (parts[0] === "personal" && parts[1] === "trash" && parts.length === 2) return { kind: "personal-trash" };
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
  if (parts[0] === "groups" && parts[2] === "catalog" && parts.length === 3) {
    const groupId = decoded(parts[1]);
    return groupId ? { kind: "group-catalog", groupId } : null;
  }
  if (parts[0] === "groups" && parts[2] === "catalog" && parts.length === 4) {
    const groupId = decoded(parts[1]);
    const itemId = decoded(parts[3]);
    return groupId && itemId ? { kind: "catalog-item", groupId, itemId } : null;
  }
  if (parts[0] === "groups" && parts[2] === "trash" && parts.length === 3) {
    const groupId = decoded(parts[1]);
    return groupId ? { kind: "group-trash", groupId } : null;
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

/**
 * True when `next` is the *same view* as `prev`, differing only by a tab (or
 * nothing). A tab switch should `replaceState` so the browser/app "Back"
 * lands on the view the user came from, not the previous tab.
 */
export function isSameView(prev: Screen | null | undefined, next: Screen): boolean {
  if (!prev || prev.kind !== next.kind) return false;
  const id = (screen: Screen): string | null =>
    "challengeId" in screen ? screen.challengeId
      : "groupId" in screen ? screen.groupId
        : "itemId" in screen ? screen.itemId
          : "token" in screen ? screen.token
            : null;
  return id(prev) === id(next);
}

export function urlForScreen(screen: Screen): string | null {
  switch (screen.kind) {
    case "dashboard":
      return "/";
    case "group":
      return `/groups/${encodeURIComponent(screen.groupId)}`;
    case "group-catalog":
      return `/groups/${encodeURIComponent(screen.groupId)}/catalog`;
    case "catalog-item":
      return `/groups/${encodeURIComponent(screen.groupId)}/catalog/${encodeURIComponent(screen.itemId)}`;
    case "personal-space":
      return "/personal";
    case "personal-catalog":
      return "/catalog";
    case "personal-catalog-item":
      return `/catalog/${encodeURIComponent(screen.itemId)}`;
    case "personal-trash":
      return "/personal/trash";
    case "group-trash":
      return `/groups/${encodeURIComponent(screen.groupId)}/trash`;
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
    case "about":
      return "/sobre";
    case "invite":
      return `/invites/${encodeURIComponent(screen.token)}`;
    case "invite-success":
      return screen.invitation.challengeId
        ? `/challenges/${encodeURIComponent(screen.invitation.challengeId)}`
        : `/groups/${encodeURIComponent(screen.invitation.groupId)}`;
    case "account":
    case "account-deactivated":
    case "auth":
    case "loading":
      // Transient shells that should not rewrite the address bar; a refresh
      // resolves them from the session, not the URL.
      return null;
  }
}

// --- "Back" is "up": every screen has one parent, and its button says which -------------------------

/** What a Back button reads: a fixed name, or the name of the group / challenge it leads to. */
export type BackLabel =
  | { kind: "home" | "signIn" | "templates" | "mySpace" | "myCatalogue" | "catalogue" | "challenge" }
  | { kind: "named"; name: string };

export interface BackTarget {
  screen: Screen;
  label: BackLabel;
}

/** What `backTargetFor` needs to know about the viewer's data to name and reach a screen's parent. */
export interface BackLookup {
  loggedIn: boolean;
  groupName(groupId: string): string | null;
  /** `personal` challenges live in the viewer's own space rather than a group. */
  challenge(challengeId: string): { groupId: string | null; personal: boolean } | null;
}

const HOME: BackTarget = { screen: { kind: "dashboard" }, label: { kind: "home" } };

/**
 * The screen "Back" leads to — always the parent in the app's hierarchy, never "wherever you were":
 * Manage → its challenge → its group (or My space) → Home. Going Back therefore can't bounce between
 * two screens that link to each other. `null` for a screen with nowhere to go up to.
 */
export function backTargetFor(screen: Screen, lookup: BackLookup): BackTarget | null {
  const toGroup = (groupId: string): BackTarget => {
    const name = lookup.groupName(groupId);
    return name ? { screen: { kind: "group", groupId }, label: { kind: "named", name } } : HOME;
  };
  const signedOut: BackTarget = { screen: { kind: "auth", mode: "login" }, label: { kind: "signIn" } };
  switch (screen.kind) {
    case "loading":
    case "dashboard":
    case "auth":
    case "account-deactivated":
    case "invite-success":
      return null;
    case "account":
    case "group":
    case "personal-space":
      return HOME;
    case "about":
    case "templates":
    case "invite":
      return lookup.loggedIn ? HOME : signedOut;
    case "template":
      return { screen: { kind: "templates" }, label: { kind: "templates" } };
    case "group-catalog":
    case "group-trash":
    case "create-challenge":
      return toGroup(screen.groupId);
    case "catalog-item":
      return { screen: { kind: "group-catalog", groupId: screen.groupId }, label: { kind: "catalogue" } };
    case "personal-catalog":
    case "personal-trash":
    case "create-personal-challenge":
      return { screen: { kind: "personal-space" }, label: { kind: "mySpace" } };
    case "personal-catalog-item":
      return { screen: { kind: "personal-catalog" }, label: { kind: "myCatalogue" } };
    case "challenge": {
      const challenge = lookup.challenge(screen.challengeId);
      if (challenge?.groupId) return toGroup(challenge.groupId);
      if (challenge?.personal) return { screen: { kind: "personal-space" }, label: { kind: "mySpace" } };
      return HOME;
    }
    case "admin":
      return { screen: { kind: "challenge", challengeId: screen.challengeId, tab: "results" }, label: { kind: "challenge" } };
  }
}
