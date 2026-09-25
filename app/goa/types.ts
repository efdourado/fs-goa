export type Id = string;
export type Role = "owner" | "admin" | "participant";
export type ChallengeStatus = "draft" | "active" | "closed";
export type FieldType = "text" | "number" | "rating" | "select" | "boolean" | "date";
export type SubmissionMode = "item" | "daily" | "free";
export type Template = "cine" | "reading";
/** New challenges use the product templates; the other keys remain readable legacy snapshots. */
export type RecipeKey =
  | "cinema"
  | "library"
  | "bookshelf"
  | "habit"
  | "tables"
  | "custom"
  | "cine_free"
  | "cine_curated"
  | "reading_club"
  | "reading_daily";
export type CreatableRecipeKey = "cinema" | "library" | "bookshelf" | "habit" | "tables" | "custom";
export type EntryPurpose = "progress" | "completion" | "expectation" | "rating" | "checkin";
export type TargetPolicy = "required" | "optional" | "none";
export type Cardinality = "once_per_item" | "once_per_item_day" | "repeatable" | "once_per_day";
export type SchedulePolicy = "free" | "while_active" | "checkpoint";
export type AdminTab =
  | "overview"
  | "participants"
  | "fields"
  | "items"
  | "checkpoints"
  | "metrics"
  | "results";
export type ParticipantTab = "today" | "grupo" | "results";

export interface User {
  id: Id;
  name: string;
  username: string;
  email?: string | null;
  platformAdmin?: boolean;
  /** Reversible "deactivate account" — the SPA shows only the reactivate screen. */
  deactivated?: boolean;
}

export interface TrashDependency {
  type: string;
  count: number;
}

export type TrashKind =
  | "group" | "challenge" | "catalog_item" | "entry"
  | "challenge_item" | "checkpoint" | "entry_type" | "field" | "field_option" | "metric" | "catalog_attribute_def";

export interface TrashItem {
  kind: TrashKind;
  id: Id;
  label: string;
  deletedAt: string | null;
  deletedBy: string | null;
  reason: string | null;
  dependencies: TrashDependency[];
  parentTrashed: boolean;
  blocked: { code: string; message: string } | null;
}

export interface TrashActionPreview {
  kind: TrashKind;
  id: Id;
  label: string;
  dependencies: TrashDependency[];
  blocked: { code: string; message: string } | null;
  confirmation: "simple" | "count" | "name";
}

export interface Member extends User {
  role: Role;
}

export interface PendingGroupRequest {
  id: Id;
  name: string;
  username: string;
  createdAt: string;
}

export interface GroupSummary {
  id: Id;
  name: string;
  description?: string | null;
  /** `personal` is the hidden solo workspace — never shown as a group in the UI. */
  kind?: "standard" | "personal";
  role: Role;
  memberCount?: number;
  members?: Member[];
  /** Outgoing @-invites still awaiting the invitee's approval (only for owners/admins). */
  pendingRequests?: PendingGroupRequest[];
  /** When off, "who recommended it" is hidden and never asked for in this group. */
  recommendationsEnabled?: boolean;
}

interface FieldOption {
  id?: Id;
  label: string;
  value?: string;
  /** Kept in the list only to render a historical answer — never offered for a new entry. */
  archived?: boolean;
}

export interface FieldConfig {
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  multiline?: boolean;
  options?: FieldOption[];
}

export interface ChallengeField {
  id?: Id;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  position?: number;
  config?: FieldConfig;
}

/** A workspace-defined catalog property ("diretor" on films, "cozinha" on tables…). */
export interface CatalogAttributeDef {
  id: Id;
  /** The owning library's opaque kind — `film`/`book` for the two built-in ones. */
  kind: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  position: number;
  hidden?: boolean;
}

/** A workspace's list of things it tracks — Screens, Pages, Tables, or one it made itself. */
export interface CatalogLibrary {
  id: Id;
  /** `film` / `book` for the built-in ones, an opaque `lib_…` key for the rest. Never a label. */
  kind: string;
  source: "screens" | "pages" | "tables" | "custom";
  /** `null` means "show the locale-aware default name for `source`". */
  label: string | null;
  position: number;
  /**
   * The property shown at the top of each cover on this library's shelves —
   * a `LibraryProperty.key`, `"none"`, or `null` for the historical default
   * (native `year` for Screens/Pages, blank otherwise).
   */
  coverTopProperty: string | null;
  /** Turns off the rating ring badge on every cover — the rating itself is still computed and shown elsewhere. */
  coverBadgeHidden: boolean;
}

/** One property of a library — a native column or a custom attribute, edited the same way. */
export interface LibraryProperty {
  /** The native key (`year`, `title`…) or the attribute definition's id — never a label. */
  key: string;
  storage: "native" | "attribute";
  label: string | null;
  /** `schedule` is the built-in "Scheduled date and time" of the thing itself (a match's kickoff). */
  type: "text" | "number" | "date" | "boolean" | "schedule";
  hidden: boolean;
  position: number;
  canHide: boolean;
  /** Custom properties only: the key an item's saved value is stored under. */
  attributeKey?: string;
}

/** A person who recommends things but isn't in the workspace — saved by name, private to it. */
export interface CatalogRecommender {
  id: Id;
  displayName: string;
}

/** Where an item came from: a member, a saved outside name, or nobody in particular. */
export type RecommenderRef =
  | { kind: "member"; id: Id; name: string }
  | { kind: "external"; id: Id; name: string };

export interface CatalogAttributeValue {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  value: string | number | boolean;
}

/**
 * When the thing itself happens — set once on the catalog item and read by every
 * challenge that uses it. A whole day (`precision: "date"`) or a clock time, in the
 * time zone it was entered in; the end is optional.
 */
export interface EventSchedule {
  startsAt: string;
  endsAt: string | null;
  precision: "date" | "datetime";
  timeZone: string;
}

/** What the API takes for an item's date: a whole day, or a clock time with an optional end. */
export type EventBody =
  | { startsOn: string; endsOn?: string; timeZone: string }
  | { startsAt: string; endsAt: string | null; timeZone: string };

export interface CatalogItem {
  id: Id;
  /** The library's kind: `film` / `book`, or an opaque `lib_…` key. */
  kind: string;
  title: string;
  author?: string | null;
  year?: number | null;
  pageCount?: number | null;
  /** Films/series only. */
  runtimeMinutes?: number | null;
  mainGenre?: string | null;
  /** Present only while the library's "Scheduled date and time" property is switched on. */
  scheduledAt?: EventSchedule | null;
  roundCount?: number;
  /** Challenges that still hold this item — zero means it is safe to tidy away. */
  challengeCount?: number;
  /** When it joined the catalogue (ISO) — what "recently added" sorts on. */
  createdAt?: string;
  ratingAvg?: number | null;
  ratingCount?: number;
  /** Custom attributes this group/person defined for this kind — never global. */
  attributes?: CatalogAttributeValue[];
  recommendedBy?: RecommenderRef | null;
  originNote?: string | null;
}

export interface CatalogRoundHistory {
  challengeId: Id;
  title: string;
  status: ChallengeStatus;
  startsOn?: string | null;
  endsOn?: string | null;
  recommendedBy?: string | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface CatalogItemDetail extends CatalogItem {
  rounds: CatalogRoundHistory[];
}

export interface ChallengeItem {
  id: Id;
  /** Set when this round item is bound to a dated session (checkpoint). */
  checkpointId?: Id | null;
  title: string;
  description?: string | null;
  position?: number;
  opensAt?: string | null;
  dueAt?: string | null;
  /** Whether the item's window was set as whole days or as a date and time. */
  schedulePrecision?: "date" | "datetime";
  date?: string | null;
  status?: "scheduled" | "open" | "past_due" | "closed";
  catalogItem?: Pick<CatalogItem, "id" | "kind" | "title" | "author" | "year" | "pageCount" | "runtimeMinutes" | "mainGenre" | "scheduledAt" | "attributes"> | null;
  recommendedBy?: RecommenderRef | null;
  /** Free-text provenance for an item nobody in the group recommended. */
  originNote?: string | null;
  /** On checkpoint rows: how it's presented, plus roll-ups over its items. */
  kind?: CheckpointKind;
  itemCount?: number;
  totalRuntimeMinutes?: number | null;
  timeframe?: "past" | "current" | "future";
}

export interface Participant {
  id: Id;
  userId?: Id;
  name: string;
  username?: string;
  /** Authorised their real name in an external publication of this challenge. */
  nameConsent?: boolean;
}

export interface EntryTypeView {
  id: Id;
  name: string;
  semanticKey: string;
  purpose: EntryPurpose;
  submissionMode: SubmissionMode;
  targetPolicy: TargetPolicy;
  cardinality: Cardinality;
  schedulePolicy: SchedulePolicy;
  isPrimary: boolean;
  /** Its entries are the "done" signal for progress counters and completion rate. */
  countsCompletion?: boolean;
  /** Who sees another participant's answer of this type, and when. */
  visibilityPolicy?: VisibilityPolicy;
  /** `shared`: one answer per item for the whole group; `individual`: one per participant. */
  answerScope?: AnswerScope;
  sharedEditPolicy?: SharedEditPolicy | null;
  /** Set on a type whose entries live inside an entry of another type — a workout's exercise records. */
  parentTypeId?: Id | null;
  fields: ChallengeField[];
}

export type VisibilityPolicy = "group_realtime" | "after_own" | "after_close" | "author_only";
export type AnswerScope = "individual" | "shared";
export type SharedEditPolicy = "members_fill_admin_corrects" | "members_can_edit";

interface EntryValueItem {
  fieldId: Id;
  value: unknown;
}

export interface Entry {
  id: Id;
  itemId?: Id | null;
  checkpointId?: Id | null;
  entryTypeId?: Id;
  /** `shared` answers belong to the item, not a person — `userId` is null. */
  answerScope?: AnswerScope;
  /** Who last touched a shared answer. */
  lastEditedByName?: string | null;
  /** The check-in this record lives inside (a workout's exercise), or null for an ordinary entry. */
  parentEntryId?: Id | null;
  participantId?: Id | null;
  userId?: Id | null;
  participantName?: string | null;
  participantUsername?: string;
  occurredOn?: string | null;
  submittedAt?: string;
  updatedAt?: string;
  isLate?: boolean;
  values: Record<Id, unknown> | EntryValueItem[];
}

export type MetricOperation =
  | "sum" | "average" | "count" | "min" | "max" | "median" | "completion_rate"
  | "bayesian_average" | "spread" | "consensus" | "surprise" | "indicator_bias";

export type MetricGroupBy =
  | "none" | "participant" | "item" | "checkpoint" | "day" | "week"
  | "catalog_year" | "catalog_author" | "catalog_genre";

export interface MetricSeriesEntry {
  key: string;
  label: string;
  value: number | null;
  formattedValue?: string;
  sampleSize: number;
  /** Item-grouped rows only. */
  recommendedBy?: string | null;
  year?: number | null;
  /** Present when `value` is a bayesian-adjusted average — the plain average for comparison. */
  rawValue?: number | null;
  rawFormattedValue?: string;
}

export interface Metric {
  id: Id;
  label: string;
  operation: MetricOperation;
  fieldId?: Id | null;
  /** Present on a combined metric — several fields folded into one number per registro before `operation` runs. */
  fieldIds?: Id[];
  /** Same order as `fieldIds` — their labels, for showing "combines Food, Value, …" without a second lookup. */
  fieldLabels?: string[];
  /** How `fieldIds` fold together — `average` unless set. Meaningless without `fieldIds`. */
  combineOp?: "sum" | "average";
  groupBy?: MetricGroupBy;
  /** `groupBy: "checkpoint"` only — each row folds in every earlier checkpoint. */
  cumulative?: boolean;
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  minSample?: number;
  bayesPriorWeight?: number;
  sampleSize?: number;
  value?: string | number | null;
  formattedValue?: string | null;
  /** Plain-language formula and how the sample was counted (V1 §9). */
  explanation?: string;
  sample?: string;
  /** Present when `groupBy !== "none"` — a ranking or per-person breakdown. */
  series?: MetricSeriesEntry[];
}

export interface PersonalRanking {
  userId: Id;
  name: string;
  entryCount: number;
  completionRate: number | null;
  ratingsMean: number | null;
  ratingsMedian: number | null;
  ratingsMin: number | null;
  ratingsMax: number | null;
  consistency: number | null;
  topItems: Array<{ title: string; value: number }>;
  bottomItems: Array<{ title: string; value: number }>;
  biggestSurprise: { title: string; delta: number } | null;
  biggestDisappointment: { title: string; delta: number } | null;
  indicationPerformance: number | null;
}

export interface AffinityPair {
  a: { userId: Id; name: string };
  b: { userId: Id; name: string };
  sampleSize: number;
  direct: number | null;
  composite: number | null;
  dimensions: Array<{ key: string; value: number; weight: number; sampleSize: number }>;
  skippedDimensions: string[];
}

export interface AffinityBlock {
  minSample: number;
  scale: number;
  pairs: AffinityPair[];
  compositeAvailable: boolean;
}

interface ResultComment {
  id: Id;
  entryId?: Id;
  fieldId?: Id;
  authorName?: string;
  text: string;
  itemTitle?: string;
}

export interface WrappedBlock {
  id: Id;
  kind: "text" | "metric" | "entry_value" | "ranking" | "affinity";
  position: number;
  visible: boolean;
  heading?: string | null;
  text?: string | null;
  metric?: Metric | null;
  comment?: ResultComment;
  ranking?: PersonalRanking[];
  affinity?: AffinityBlock | null;
}

export interface ChallengeResult {
  headline?: string | null;
  summary?: string | null;
  metrics?: Metric[];
  comments?: ResultComment[];
  personalRankings?: PersonalRanking[];
  affinity?: AffinityBlock | null;
  /** The admin-arranged, ordered block list (empty while a draft has no blocks yet). */
  blocks?: WrappedBlock[];
  totalEntries?: number;
  publishedAt?: string | null;
  /** The public showcase token — build `${origin}/results/${shareToken}`. Present
   *  for a published round (null otherwise, or when published before migration
   *  0035 stored the raw token — rotate to mint a fresh one). */
  shareToken?: string | null;
}

export interface RuleTopic {
  title: string;
  description: string;
}

export interface ChallengeRule {
  title: string;
  description: string;
  /** Nested sub-points, auto-numbered as `<ruleNumber>.<n>` in the rule's card. */
  topics?: RuleTopic[];
}

export interface ChallengeSummary {
  id: Id;
  groupId: Id;
  /** "personal" challenges live in a hidden workspace and are never drawn as a group. */
  scope?: "personal" | "group";
  title: string;
  description?: string | null;
  rules?: string | null;
  ruleSections?: ChallengeRule[];
  startsOn?: string | null;
  endsOn?: string | null;
  /** IANA zone the challenge's dates and item schedules are read in. */
  timeZone?: string;
  status: ChallengeStatus;
  /** `list` is a first-class category (see `isLivingList`), decided once at creation. */
  kind?: "round" | "list";
  template?: Template | null;
  recipeKey?: RecipeKey | null;
  resultsAnon?: boolean;
  /** Cosmetic: false hides the read-only checkpoint grid on the challenge / result / template pages. */
  showSchedule?: boolean;
  /** When true, the Vitrine's comments section is every current comment, live — no picking one by one. */
  resultsAllComments?: boolean;
  submissionMode?: SubmissionMode;
  completionEntryTypeId?: Id | null;
  viewerRole?: Role;
  isParticipant?: boolean;
  /** The viewer's own name-in-publication consent for this challenge (V1 §12). */
  viewerNameConsent?: boolean;
  completedCount?: number;
  totalCount?: number | null;
  /** Per-viewer homepage organisation (private; see `challenge_user_prefs`). */
  pinned?: boolean;
  colorTag?: ChallengeColorTag | null;
  sortIndex?: number | null;
}

/** The fixed set of homepage colour tags a viewer can assign to a challenge. */
export type ChallengeColorTag = "green" | "blue" | "violet" | "coral" | "amber" | "rose";

export const CHALLENGE_COLOR_TAGS: readonly ChallengeColorTag[] = [
  "green", "blue", "violet", "coral", "amber", "rose",
];

/** A library a challenge draws items from. `id` is null for a built-in one that has never held an item. */
export interface ChallengeLibraryRef {
  id: Id | null;
  kind: string;
  source: CatalogLibrary["source"];
  label: string | null;
}

export interface ChallengeDetail extends ChallengeSummary {
  fields: ChallengeField[];
  /** Every library the challenge draws items from, in the order they were linked. */
  libraries?: ChallengeLibraryRef[];
  /** False when the group switched recommendations off — `recommendedBy` / `originNote` then arrive empty. */
  recommendationsEnabled?: boolean;
  entryTypes: EntryTypeView[];
  items: ChallengeItem[];
  /** Dated sessions, always present (empty for undated rounds), independent of `items`. */
  checkpoints: ChallengeItem[];
  participants: Participant[];
  metrics: Metric[];
  result?: ChallengeResult | null;
  /** False for a retrospective list (e.g. Estante) — the entry form hides the "when" date. */
  collectsEntryDate?: boolean;
  /** This challenge is listed in the public template gallery (a platform admin put it there). */
  publishedAsTemplate?: boolean;
}

export interface Limits {
  groupsPerOwner: number;
  challengesPerGroup: number;
  groupsPerMember: number;
  pendingInvitesPerUser: number;
}

export interface MemberRequest {
  id: Id;
  groupId: Id;
  groupName: string;
  role: Role;
  invitedBy?: string | null;
  createdAt: string;
}

export interface BootstrapData {
  csrfToken: string;
  user: User | null;
  limits: Limits;
  /** The caller's personal-workspace group id, or null until they create one. */
  personalWorkspaceId: Id | null;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  memberRequests: MemberRequest[];
}

export const DEFAULT_LIMITS: Limits = {
  groupsPerOwner: 6,
  challengesPerGroup: 6,
  groupsPerMember: 186,
  pendingInvitesPerUser: 31,
};

export interface InvitePreview {
  token?: string;
  kind?: "group" | "challenge";
  groupId: Id;
  groupName: string;
  challengeId?: Id | null;
  challengeTitle?: string | null;
  invitedBy?: string;
  expiresAt?: string | null;
  status?: "valid" | "expired" | "revoked" | "exhausted" | "accepted";
  accepted?: boolean;
}

export interface InviteAcceptance extends InvitePreview {
  accepted: true;
  idempotent: boolean;
}

export interface GroupInviteResult {
  status: "requested" | "already_member" | "already_pending";
  member: Member;
  groupId: Id;
}

export interface TemplateSummary {
  id: Id;
  title: string;
  summary?: string | null;
  submissionMode: SubmissionMode;
  ruleCount: number;
  fieldCount: number;
  itemCount: number;
  metricCount: number;
  /** People taking part — a count only, never who. */
  participantCount: number;
  publishedAt: string;
}

// A published template's detail is served as a read-only `ChallengeDetail`
// (see `getTemplatePreview`) and rendered by `ParticipantChallengeScreen` in
// preview mode — there is no separate template-detail shape any more.

export interface ApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
  details?: unknown;
}

export type Screen =
  | { kind: "loading" }
  | { kind: "auth"; mode: "login" | "register" }
  | { kind: "dashboard" }
  | { kind: "account" }
  | { kind: "group"; groupId: Id }
  | { kind: "group-catalog"; groupId: Id }
  | { kind: "catalog-item"; groupId: Id; itemId: Id }
  | { kind: "personal-space" }
  | { kind: "personal-catalog" }
  | { kind: "personal-catalog-item"; itemId: Id }
  | { kind: "personal-trash" }
  | { kind: "group-trash"; groupId: Id }
  | { kind: "account-deactivated" }
  | { kind: "invite"; token: string }
  | { kind: "invite-success"; invitation: InviteAcceptance }
  | { kind: "create-challenge"; groupId: Id }
  | { kind: "create-personal-challenge" }
  | { kind: "challenge"; challengeId: Id; tab: ParticipantTab }
  | { kind: "admin"; challengeId: Id; tab: AdminTab }
  | { kind: "templates" }
  | { kind: "template"; challengeId: Id }
  /** `into` skips the "where" question when the chat is started from a group page or My space. */
  | { kind: "quick-create"; into?: { groupId: Id } | "personal" }
  | { kind: "about" };

/** A library property a copy had to leave out — the destination defines the same key differently (or removed it). */
export interface SkippedProperty {
  library: { kind: string; label: string | null; source: "screens" | "pages" | "tables" | "custom" };
  key: string;
  label: string;
  type: string;
  reason: "type_mismatch" | "archived";
  /** `type_mismatch` only: the type the destination's property of that key has. */
  existingType: string | null;
}

/** What duplicating a challenge (or a template) hands back. */
export interface CopyResult {
  challengeId: Id | null;
  skippedProperties: SkippedProperty[];
}

export interface ChallengeCreationInput {
  recipe: CreatableRecipeKey;
  /**
   * Libraries to draw items from *in addition to* the recipe's own (Cinema → Screens, Tables → the
   * workspace's Tables). `custom` has no library of its own, so this is where it gets all of them.
   * A built-in library that has never held an item has no id yet, so it goes by `libraryKind`.
   */
  libraries?: Array<{ libraryId?: Id; libraryKind?: string }>;
  title: string;
  description: string;
  ruleSections: ChallengeRule[];
  startsOn: string | null;
  endsOn: string | null;
  fields: ChallengeField[];
  items: ChallengeItemInput[];
  generateDaily: boolean;
  /** Cinema/Estante: also open the optional pre-watch "Expectativa" rating. */
  expectation?: boolean;
  /** Custom only: ask "when did it happen" on each response. Left out, the recipe's default applies. */
  collectsEntryDate?: boolean;
  /** Custom only: who fills the main response in — each participant, or once for the whole group. */
  answerScope?: "individual" | "shared";
  /** Custom only: `session` makes each entry one check-in holding a record per item (a workout of exercises). */
  recordingMode?: "single" | "session";
  /** With `session`: what one check-in is called ("Workout"). */
  sessionName?: string;
  /** With `session`: the label of the optional note on each check-in ("How did it go?"). */
  sessionNoteLabel?: string;
  sharedEditPolicy?: SharedEditPolicy;
  /** Each item of the chosen libraries has its own scheduled date and time (a match's kickoff). */
  itemDates?: boolean;
  participantIds: Id[];
}

export interface ChallengeItemInput {
  title: string;
  position: number;
  catalogItemId?: Id;
  recommendedByUserId?: Id;
  /** Free-text provenance when no participant recommended it. */
  originNote?: string;
  /** Which of the challenge's libraries this item belongs to (`libraryKind` for a built-in with no id yet). */
  libraryId?: Id;
  libraryKind?: string;
  /** A saved outside recommender (mutually exclusive with `recommendedByUserId` / `originNote`). */
  recommendedByExternalId?: Id;
  /** Values for the library's custom properties, keyed by their attribute key. */
  attributes?: Record<string, string | number | boolean>;
  /** Checkpoint (week/session) this item is organised under. */
  checkpointId?: Id | null;
  author?: string;
  year?: number;
  pageCount?: number;
  runtimeMinutes?: number;
  mainGenre?: string;
  /** The item's own scheduled date (and time) — a match's kickoff. */
  scheduledAt?: EventBody;
}

export type CheckpointKind = "day" | "week" | "session" | "milestone";

export interface CheckpointInput {
  id?: Id;
  title: string;
  kind: CheckpointKind;
  description?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
}

export interface ImportPreviewRow {
  index: number;
  title: string;
  valid: boolean;
  errors: string[];
  mapped: {
    author: string | null;
    year: number | null;
    pageCount: number | null;
    runtimeMinutes: number | null;
    mainGenre: string | null;
  };
  recommendation:
    | { kind: "participant"; userId: Id; name: string }
    | { kind: "origin"; text: string }
    | null;
  existingCatalogItemId: Id | null;
  duplicateInChallenge: boolean;
  unknownKeys: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    importable: number;
    invalid: number;
    duplicatesInCatalog: number;
    duplicatesInChallenge: number;
    unknownKeys: string[];
  };
  limit: number;
  catalogKind: "film" | "book";
}
