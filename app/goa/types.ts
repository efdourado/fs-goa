export type Id = string;
export type Role = "owner" | "admin" | "participant";
export type ChallengeStatus = "draft" | "active" | "closed";
export type FieldType = "text" | "number" | "rating" | "select" | "boolean" | "date";
export type SubmissionMode = "item" | "daily" | "free";
export type Template = "cine" | "reading";
export type AdminTab =
  | "overview"
  | "participants"
  | "fields"
  | "items"
  | "review"
  | "metrics"
  | "results";
export type ParticipantTab = "today" | "history" | "progress" | "results";

export interface User {
  id: Id;
  name: string;
  username: string;
  email?: string | null;
  platformAdmin?: boolean;
}

interface Member extends User {
  role: Role;
}

export interface GroupSummary {
  id: Id;
  name: string;
  description?: string | null;
  role: Role;
  memberCount?: number;
  members?: Member[];
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

export interface ChallengeItem {
  id: Id;
  title: string;
  description?: string | null;
  position?: number;
  opensAt?: string | null;
  dueAt?: string | null;
  date?: string | null;
  status?: "scheduled" | "open" | "past_due" | "closed";
}

export interface Participant {
  id: Id;
  userId?: Id;
  name: string;
  username?: string;
}

interface EntryValueItem {
  fieldId: Id;
  value: unknown;
}

export interface Entry {
  id: Id;
  itemId?: Id | null;
  checkpointId?: Id | null;
  participantId?: Id;
  userId?: Id;
  participantName?: string;
  participantUsername?: string;
  submittedAt?: string;
  updatedAt?: string;
  isLate?: boolean;
  values: Record<Id, unknown> | EntryValueItem[];
}

export interface Metric {
  id: Id;
  label: string;
  operation: "sum" | "average" | "count" | "min" | "max" | "completion_rate";
  fieldId?: Id | null;
  groupBy?: "none" | "participant" | "item";
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  value?: string | number | null;
  formattedValue?: string | null;
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
}

export interface ChallengeRule {
  title: string;
  description: string;
}

export interface ChallengeSummary {
  id: Id;
  groupId: Id;
  title: string;
  description?: string | null;
  rules?: string | null;
  ruleSections?: ChallengeRule[];
  startsOn?: string | null;
  endsOn?: string | null;
  status: ChallengeStatus;
  template?: Template | null;
  submissionMode?: SubmissionMode;
  viewerRole?: Role;
  isParticipant?: boolean;
  completedCount?: number;
  totalCount?: number;
}

export interface ChallengeDetail extends ChallengeSummary {
  fields: ChallengeField[];
  items: ChallengeItem[];
  participants: Participant[];
  metrics: Metric[];
  result?: ChallengeResult | null;
}

export interface Limits {
  groupsPerOwner: number;
  challengesPerGroup: number;
}

export interface BootstrapData {
  csrfToken: string;
  user: User | null;
  limits: Limits;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
}

export const DEFAULT_LIMITS: Limits = { groupsPerOwner: 6, challengesPerGroup: 6 };

export interface InvitePreview {
  token?: string;
  groupId: Id;
  groupName: string;
  invitedBy?: string;
  expiresAt?: string | null;
  status?: "valid" | "expired" | "revoked" | "exhausted" | "accepted";
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
  | { kind: "invite"; token: string }
  | { kind: "create-challenge"; groupId: Id }
  | { kind: "challenge"; challengeId: Id; tab: ParticipantTab }
  | { kind: "admin"; challengeId: Id; tab: AdminTab };

export interface ChallengeCreationInput {
  template: Template;
  title: string;
  description: string;
  ruleSections: ChallengeRule[];
  startsOn: string;
  endsOn: string;
  submissionMode: SubmissionMode;
  fields: ChallengeField[];
  items: Array<{ title: string; position: number }>;
  generateDaily: boolean;
  participantIds: Id[];
}
