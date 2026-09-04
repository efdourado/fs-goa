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
  | "cine_free"
  | "cine_curated"
  | "reading_club"
  | "reading_daily";
export type CreatableRecipeKey = "cinema" | "library" | "bookshelf";
export type EntryPurpose = "progress" | "completion" | "expectation" | "rating" | "checkin";
export type TargetPolicy = "required" | "optional" | "none";
export type Cardinality = "once_per_item" | "once_per_item_day" | "repeatable" | "once_per_day";
export type SchedulePolicy = "free" | "while_active" | "checkpoint";
export type AdminTab =
  | "overview"
  | "participants"
  | "fields"
  | "items"
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

export interface CatalogItem {
  id: Id;
  kind: "film" | "book" | "other";
  title: string;
  author?: string | null;
  year?: number | null;
  pageCount?: number | null;
  mainGenre?: string | null;
  roundCount?: number;
  ratingAvg?: number | null;
  ratingCount?: number;
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
  catalogItem?: Pick<CatalogItem, "id" | "title" | "author" | "year" | "pageCount" | "mainGenre"> | null;
  recommendedBy?: { id: Id; name: string } | null;
}

export interface Participant {
  id: Id;
  userId?: Id;
  name: string;
  username?: string;
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
  fields: ChallengeField[];
}

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
  | "sum" | "average" | "count" | "min" | "max" | "completion_rate"
  | "bayesian_average" | "spread" | "surprise" | "indicator_bias";

export interface MetricSeriesEntry {
  key: string;
  label: string;
  value: number | null;
  formattedValue?: string;
  sampleSize: number;
}

export interface Metric {
  id: Id;
  label: string;
  operation: MetricOperation;
  fieldId?: Id | null;
  groupBy?: "none" | "participant" | "item" | "day" | "week";
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  minSample?: number;
  value?: string | number | null;
  formattedValue?: string | null;
  /** Present when `groupBy !== "none"` — a ranking or per-person breakdown. */
  series?: MetricSeriesEntry[];
}

interface ResultComment {
  id: Id;
  entryId?: Id;
  fieldId?: Id;
  authorName?: string;
  text: string;
  itemTitle?: string;
}

export interface ChallengeResult {
  headline?: string | null;
  summary?: string | null;
  metrics?: Metric[];
  comments?: ResultComment[];
  publishedAt?: string | null;
  /** Raw public share token, present once the showcase has been published. */
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
  | { kind: "personal-catalog" }
  | { kind: "personal-catalog-item"; itemId: Id }
  | { kind: "invite"; token: string }
  | { kind: "invite-success"; invitation: InviteAcceptance }
  | { kind: "create-challenge"; groupId: Id }
  | { kind: "create-personal-challenge" }
  | { kind: "challenge"; challengeId: Id; tab: ParticipantTab }
  | { kind: "admin"; challengeId: Id; tab: AdminTab }
  | { kind: "templates" }
  | { kind: "template"; challengeId: Id };

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
  participantIds: Id[];
}

export interface ChallengeItemInput {
  title: string;
  position: number;
  catalogItemId?: Id;
  recommendedByUserId?: Id;
  author?: string;
  year?: number;
  pageCount?: number;
  mainGenre?: string;
}
