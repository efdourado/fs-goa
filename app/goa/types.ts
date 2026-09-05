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
  | "cine_free"
  | "cine_curated"
  | "reading_club"
  | "reading_daily";
export type CreatableRecipeKey = "cinema" | "library" | "bookshelf" | "habit";
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
  | "review"
  | "metrics"
  | "results";
export type ParticipantTab = "today" | "results";

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
}

interface FieldOption {
  id?: Id;
  label: string;
  value?: string;
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

/** A group- or personal-workspace-defined catalog column ("diretor" on films…). */
export interface CatalogAttributeDef {
  id: Id;
  kind: "film" | "book" | "other";
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  position: number;
}

export interface CatalogAttributeValue {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  value: string | number | boolean;
}

export interface CatalogItem {
  id: Id;
  kind: "film" | "book" | "other";
  title: string;
  author?: string | null;
  year?: number | null;
  pageCount?: number | null;
  /** Films/series only. */
  runtimeMinutes?: number | null;
  mainGenre?: string | null;
  roundCount?: number;
  ratingAvg?: number | null;
  ratingCount?: number;
  /** Custom attributes this group/person defined for this kind — never global. */
  attributes?: CatalogAttributeValue[];
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
  date?: string | null;
  status?: "scheduled" | "open" | "past_due" | "closed";
  catalogItem?: Pick<CatalogItem, "id" | "title" | "author" | "year" | "pageCount" | "runtimeMinutes" | "mainGenre"> | null;
  recommendedBy?: { id: Id; name: string } | null;
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
  fields: ChallengeField[];
}

export type VisibilityPolicy = "group_realtime" | "after_own" | "after_close" | "author_only";

interface EntryValueItem {
  fieldId: Id;
  value: unknown;
}

export interface Entry {
  id: Id;
  itemId?: Id | null;
  checkpointId?: Id | null;
  entryTypeId?: Id;
  participantId?: Id;
  userId?: Id;
  participantName?: string;
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
  groupBy?: MetricGroupBy;
  /** `groupBy: "checkpoint"` only — each row folds in every earlier checkpoint. */
  cumulative?: boolean;
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  minSample?: number;
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
  /** Whether a public link exists. The raw token itself is never sent back — it
   *  is shown once, in the publish response, and cannot be recovered. */
  hasPublishedLink?: boolean;
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
  status: ChallengeStatus;
  /** `list` is a first-class category (see `isLivingList`), decided once at creation. */
  kind?: "round" | "list";
  template?: Template | null;
  recipeKey?: RecipeKey | null;
  resultsAnon?: boolean;
  submissionMode?: SubmissionMode;
  completionEntryTypeId?: Id | null;
  viewerRole?: Role;
  isParticipant?: boolean;
  /** The viewer's own name-in-publication consent for this challenge (V1 §12). */
  viewerNameConsent?: boolean;
  completedCount?: number;
  totalCount?: number | null;
}

export interface ChallengeDetail extends ChallengeSummary {
  fields: ChallengeField[];
  entryTypes: EntryTypeView[];
  items: ChallengeItem[];
  /** Dated sessions, always present (empty for undated rounds), independent of `items`. */
  checkpoints: ChallengeItem[];
  participants: Participant[];
  metrics: Metric[];
  result?: ChallengeResult | null;
  /** False for a retrospective list (e.g. Estante) — the entry form hides the "when" date. */
  collectsEntryDate?: boolean;
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
  publishedAt: string;
}

export interface TemplateFieldPreview {
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
}

export interface TemplateDetail {
  id: Id;
  title: string;
  description?: string | null;
  summary?: string | null;
  ruleSections: ChallengeRule[];
  submissionMode: SubmissionMode;
  durationDays: number | null;
  fields: TemplateFieldPreview[];
  items: Array<{ title: string; description?: string | null }>;
  metrics: Array<{ label: string; operation: Metric["operation"]; groupBy: string }>;
}

export interface ApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

export type Screen =
  | { kind: "loading" }
  | { kind: "auth"; mode: "login" | "register" }
  | { kind: "reset"; token: string }
  | { kind: "dashboard" }
  | { kind: "account" }
  | { kind: "group"; groupId: Id }
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
  | { kind: "about" };

export interface ChallengeCreationInput {
  recipe: CreatableRecipeKey;
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
  participantIds: Id[];
}

export interface ChallengeItemInput {
  title: string;
  position: number;
  catalogItemId?: Id;
  recommendedByUserId?: Id;
  /** Free-text provenance when no participant recommended it. */
  originNote?: string;
  /** Checkpoint (week/session) this item is organised under. */
  checkpointId?: Id | null;
  author?: string;
  year?: number;
  pageCount?: number;
  runtimeMinutes?: number;
  mainGenre?: string;
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
