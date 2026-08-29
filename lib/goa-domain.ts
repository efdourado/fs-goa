import type { PoolClient } from "pg";
import {
  csrfForSession,
  type GroupRole,
  requireGroupRole,
  type SessionContext,
} from "./auth";
import { inTransaction, oneOrNull, withClient } from "./db";
import { ApiError, stringValue } from "./http";
import { assertUnder, LIMITS } from "./limits";
import { generateOpaqueToken, hashToken } from "./security";
import { validateDateValue } from "./validation";

export type ChallengeStatus = "draft" | "active" | "closed";

interface ChallengeAccessRow {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  rules: string | null;
  start_date: string;
  end_date: string;
  time_zone: string;
  status: ChallengeStatus;
  role: GroupRole;
  is_participant: boolean;
  results_published_at: Date | null;
}

export interface ChallengeAccess {
  challenge: ChallengeAccessRow;
  canManage: boolean;
}

const FIELD_KINDS = new Set(["text", "number", "rating", "choice", "boolean", "date"]);
const SUBMISSION_MODES = new Set(["item", "daily", "free"]);

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

function dateString(value: unknown, name: string): string {
  const result = validateDateValue(value);
  if (!result.ok) throw new ApiError(400, "invalid_date", `${name}: ${result.message}`);
  return result.value;
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ApiError(400, "invalid_number", `Use um número inteiro entre ${min} e ${max}.`);
  }
  return number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function challengeAccess(
  userId: string,
  challengeId: string,
  client?: PoolClient,
  lock = false,
): Promise<ChallengeAccess> {
  const work = async (activeClient: PoolClient) => {
    const challenge = await oneOrNull<ChallengeAccessRow>(
      activeClient,
      `SELECT c.id, c.group_id, c.title, c.description, c.rules,
              c.start_date::text AS start_date, c.end_date::text AS end_date,
              c.time_zone, c.status, gm.role,
              EXISTS (
                SELECT 1 FROM challenge_participants cp
                 WHERE cp.challenge_id = c.id AND cp.user_id = $2 AND cp.removed_at IS NULL
              ) AS is_participant,
              c.results_published_at
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
         JOIN group_members gm ON gm.group_id = c.group_id
          AND gm.user_id = $2 AND gm.removed_at IS NULL
        WHERE c.id = $1 AND c.deleted_at IS NULL
          AND (c.status <> 'draft' OR gm.role IN ('owner','admin'))${lock ? " FOR UPDATE OF c" : ""}`,
      [challengeId, userId],
    );
    if (!challenge) throw new ApiError(404, "not_found", "Desafio não encontrado.");
    return {
      challenge,
      canManage: challenge.role === "owner" || challenge.role === "admin",
    };
  };
  return client ? work(client) : withClient(work);
}

export async function bootstrap(session: SessionContext | null): Promise<Record<string, unknown>> {
  if (!session) return { csrfToken: "", user: null, groups: [], challenges: [] };

  return withClient(async (client) => {
    const groupsResult = await client.query<{
      id: string;
      name: string;
      description: string | null;
      role: GroupRole;
      member_count: number;
    }>(
      `SELECT g.id, g.name, g.description, gm.role,
              count(active_members.user_id)::int AS member_count
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
          AND gm.user_id = $1 AND gm.removed_at IS NULL
         LEFT JOIN group_members active_members ON active_members.group_id = g.id
          AND active_members.removed_at IS NULL
        WHERE g.archived_at IS NULL AND g.deleted_at IS NULL
        GROUP BY g.id, gm.role
        ORDER BY g.created_at`,
      [session.user.id],
    );
    const groupIds = groupsResult.rows.map((group) => group.id);
    const membersByGroup = new Map<string, Array<Record<string, unknown>>>();
    if (groupIds.length) {
      const members = await client.query<{
        group_id: string;
        id: string;
        display_name: string;
        username: string;
        role: GroupRole;
      }>(
        `SELECT gm.group_id, u.id, u.display_name, u.username, gm.role
           FROM group_members gm JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ANY($1::text[]) AND gm.removed_at IS NULL
          ORDER BY u.display_name`,
        [groupIds],
      );
      for (const member of members.rows) {
        const list = membersByGroup.get(member.group_id) ?? [];
        list.push({ id: member.id, name: member.display_name, username: member.username, role: member.role });
        membersByGroup.set(member.group_id, list);
      }
    }

    const challengesResult = await client.query<{
      id: string;
      group_id: string;
      title: string;
      description: string | null;
      status: ChallengeStatus;
      start_date: string;
      end_date: string;
      role: GroupRole;
      is_participant: boolean;
      completed_count: number;
      total_count: number;
    }>(
      `SELECT c.id, c.group_id, c.title, c.description, c.status,
              c.start_date::text AS start_date, c.end_date::text AS end_date,
              gm.role,
              EXISTS (SELECT 1 FROM challenge_participants cp
                       WHERE cp.challenge_id = c.id AND cp.user_id = $1 AND cp.removed_at IS NULL)
                AS is_participant,
              (SELECT count(*)::int FROM entries e
                WHERE e.challenge_id = c.id AND e.participant_user_id = $1 AND e.deleted_at IS NULL)
                AS completed_count,
              CASE
                WHEN EXISTS (SELECT 1 FROM entry_types et WHERE et.challenge_id = c.id AND et.submission_mode = 'item')
                THEN (SELECT count(*)::int FROM challenge_items ci WHERE ci.challenge_id = c.id AND ci.archived_at IS NULL)
                WHEN EXISTS (SELECT 1 FROM entry_types et WHERE et.challenge_id = c.id AND et.submission_mode = 'daily')
                THEN (c.end_date - c.start_date + 1)::int
                ELSE 1
              END AS total_count
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
         JOIN group_members gm ON gm.group_id = c.group_id
          AND gm.user_id = $1 AND gm.removed_at IS NULL
        WHERE c.deleted_at IS NULL
          AND (c.status <> 'draft' OR gm.role IN ('owner','admin'))
        ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, c.created_at DESC`,
      [session.user.id],
    );

    return {
      csrfToken: await csrfForSession(session),
      user: session.user,
      groups: groupsResult.rows.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        role: group.role,
        memberCount: group.member_count,
        members: membersByGroup.get(group.id) ?? [],
      })),
      challenges: challengesResult.rows.map((challenge) => ({
        id: challenge.id,
        groupId: challenge.group_id,
        title: challenge.title,
        description: challenge.description,
        status: challenge.status,
        startsOn: challenge.start_date,
        endsOn: challenge.end_date,
        viewerRole: challenge.role,
        isParticipant: challenge.is_participant,
        completedCount: challenge.completed_count,
        totalCount: challenge.total_count,
      })),
    };
  });
}

export async function createGroup(session: SessionContext, body: Record<string, unknown>) {
  const name = stringValue(body, "name", { min: 1, max: 120 })!;
  const description = stringValue(body, "description", { max: 1_000, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const owned = await oneOrNull<{ count: number }>(
      client,
      `SELECT count(*)::int AS count FROM groups
        WHERE owner_user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL`,
      [session.user.id],
    );
    assertUnder(
      owned?.count ?? 0,
      LIMITS.groupsPerOwner,
      "group_limit",
      `Você atingiu o limite de ${LIMITS.groupsPerOwner} grupos. Apague um grupo para criar outro.`,
    );

    const id = publicId();
    await client.query(
      `INSERT INTO groups (id, name, description, owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [id, name, description, session.user.id],
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
       VALUES ($1, $2, 'owner', $2, now())`,
      [id, session.user.id],
    );
    await writeAudit(client, id, null, session.user.id, "group.created", "group", id, null, { name });
    return { id, name, role: "owner" as const, memberCount: 1 };
  });
}

export async function updateGroup(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const current = await oneOrNull<{ name: string; description: string | null }>(
      client,
      `SELECT name, description
         FROM groups
        WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [groupId],
    );
    if (!current) throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const name = body.name === undefined
      ? current.name
      : stringValue(body, "name", { min: 1, max: 120 })!;
    const description = body.description === undefined
      ? current.description
      : stringValue(body, "description", { max: 1_000, optional: true }) ?? null;

    await client.query(
      "UPDATE groups SET name = $2, description = $3, updated_at = now() WHERE id = $1",
      [groupId, name, description],
    );
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.updated",
      "group",
      groupId,
      current,
      { name, description },
    );
    return { id: groupId, name, description };
  });
}

export async function softDeleteGroup(session: SessionContext, groupId: string) {
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner"], client);
    const current = await oneOrNull<{ name: string }>(
      client,
      "SELECT name FROM groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [groupId],
    );
    if (!current) throw new ApiError(404, "not_found", "Grupo não encontrado.");
    await client.query(
      `UPDATE groups
          SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now()
        WHERE id = $1`,
      [groupId, session.user.id],
    );
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.deleted",
      "group",
      groupId,
      current,
      null,
    );
    return { id: groupId, deleted: true };
  });
}

export async function createInvite(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const expiresInDays = integerValue(body.expiresInDays, 7, 1, 30);
  const maxUses = integerValue(body.maxUses, 1, 1, 100);
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const rawToken = generateOpaqueToken();
    const tokenHash = await hashToken(rawToken);
    const id = publicId();
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    await client.query(
      `INSERT INTO group_invites
        (id, group_id, token_hash, role, created_by_user_id, max_uses, use_count, expires_at, created_at)
       VALUES ($1, $2, $3, 'participant', $4, $5, 0, $6, now())`,
      [id, groupId, tokenHash, session.user.id, maxUses, expiresAt],
    );
    await writeAudit(client, groupId, null, session.user.id, "invite.created", "group_invite", id, null, {
      expiresAt: expiresAt.toISOString(),
      maxUses,
    });
    return { id, token: rawToken, expiresAt: expiresAt.toISOString(), maxUses };
  });
}

interface InviteRow {
  id: string;
  group_id: string;
  group_name: string;
  invited_by: string;
  role: "participant" | "admin";
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
}

async function inviteByToken(token: string, client: PoolClient, lock = false): Promise<InviteRow | null> {
  let tokenHash: string;
  try {
    tokenHash = await hashToken(token);
  } catch {
    return null;
  }
  return oneOrNull<InviteRow>(
    client,
    `SELECT gi.id, gi.group_id, g.name AS group_name, u.display_name AS invited_by,
            gi.role, gi.max_uses, gi.use_count, gi.expires_at, gi.revoked_at
       FROM group_invites gi
       JOIN groups g ON g.id = gi.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
       JOIN users u ON u.id = gi.created_by_user_id
      WHERE gi.token_hash = $1${lock ? " FOR UPDATE OF gi" : ""}`,
    [tokenHash],
  );
}

function inviteStatus(invite: InviteRow): "valid" | "expired" | "revoked" | "exhausted" {
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at.getTime() <= Date.now()) return "expired";
  if (invite.use_count >= invite.max_uses) return "exhausted";
  return "valid";
}

export async function previewInvite(token: string) {
  return withClient(async (client) => {
    const invite = await inviteByToken(token, client);
    if (!invite) throw new ApiError(404, "not_found", "Convite não encontrado.");
    return {
      groupId: invite.group_id,
      groupName: invite.group_name,
      invitedBy: invite.invited_by,
      expiresAt: invite.expires_at.toISOString(),
      status: inviteStatus(invite),
    };
  });
}

export async function acceptInvite(session: SessionContext, token: string) {
  return inTransaction(async (client) => {
    const invite = await inviteByToken(token, client, true);
    if (!invite) throw new ApiError(404, "not_found", "Convite não encontrado.");
    const prior = await oneOrNull<{ invite_id: string }>(
      client,
      "SELECT invite_id FROM invite_redemptions WHERE invite_id = $1 AND user_id = $2",
      [invite.id, session.user.id],
    );
    if (prior) return { groupId: invite.group_id, accepted: true, idempotent: true };
    const status = inviteStatus(invite);
    if (status !== "valid") throw new ApiError(410, `invite_${status}`, "Este convite não está mais disponível.");

    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1, $2, 'participant', now())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         removed_at = NULL,
         joined_at = CASE WHEN group_members.removed_at IS NULL THEN group_members.joined_at ELSE now() END,
         role = CASE WHEN group_members.role IN ('owner', 'admin') THEN group_members.role ELSE 'participant' END`,
      [invite.group_id, session.user.id],
    );
    await client.query(
      "INSERT INTO invite_redemptions (invite_id, user_id, redeemed_at) VALUES ($1, $2, now())",
      [invite.id, session.user.id],
    );
    const consumed = await client.query(
      `UPDATE group_invites SET use_count = use_count + 1
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND use_count < max_uses
        RETURNING id`,
      [invite.id],
    );
    if (!consumed.rowCount) throw new ApiError(409, "invite_consumed", "O convite acabou de atingir seu limite.");
    await writeAudit(client, invite.group_id, null, session.user.id, "invite.accepted", "group_invite", invite.id);
    return { groupId: invite.group_id, accepted: true, idempotent: false };
  });
}

interface ClientField {
  key?: unknown;
  label?: unknown;
  type?: unknown;
  required?: unknown;
  position?: unknown;
  config?: unknown;
}

function defaultFields(template: unknown): ClientField[] {
  if (template === "reading") {
    return [
      { key: "livro_atual", label: "Livro atual", type: "text", required: true },
      { key: "paginas", label: "Páginas lidas hoje", type: "number", required: true, config: { min: 0, step: 1 } },
      { key: "livro_concluido", label: "Livro concluído?", type: "boolean", required: true },
      { key: "nota", label: "Nota do livro", type: "rating", required: false },
      { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ];
  }
  return [
    { key: "nota", label: "Nota", type: "rating", required: true },
    { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 280 } },
  ];
}

function scaled(value: unknown, scale: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(400, "invalid_field_config", "Limite numérico inválido.");
  const result = Math.round(number * 10 ** scale);
  if (!Number.isSafeInteger(result)) throw new ApiError(400, "invalid_field_config", "Limite numérico fora da faixa.");
  return result;
}

async function insertField(
  client: PoolClient,
  challengeId: string,
  entryTypeId: string,
  field: ClientField,
  position: number,
): Promise<{ id: string; kind: string; semanticKey: string }> {
  const label = typeof field.label === "string" ? field.label.trim() : "";
  if (!label || Array.from(label).length > 120) throw new ApiError(400, "invalid_field", "Campo sem rótulo válido.");
  const clientKind = field.type === "select" ? "choice" : field.type;
  if (typeof clientKind !== "string" || !FIELD_KINDS.has(clientKind)) {
    throw new ApiError(400, "invalid_field", "Tipo de campo não suportado.");
  }
  const config = asRecord(field.config);
  const scale = clientKind === "rating" ? 1 : clientKind === "number" ? 3 : null;
  const id = publicId();
  const key = semanticKey(field.key, `campo_${position + 1}`);
  const min = clientKind === "rating" ? 0 : scale === null ? null : scaled(config.min, scale);
  const max = clientKind === "rating" ? 50 : scale === null ? null : scaled(config.max, scale);
  const step = clientKind === "rating" ? 5 : scale === null ? null : scaled(config.step, scale);
  const maxLength = clientKind === "text" ? integerValue(config.maxLength, 5_000, 1, 20_000) : null;
  await client.query(
    `INSERT INTO challenge_fields
      (id, challenge_id, entry_type_id, semantic_key, label, kind, required, position,
       number_scale, min_scaled, max_scaled, step_scaled, max_length, settings, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now(),now())`,
    [id, challengeId, entryTypeId, key, label, clientKind, field.required === true, position,
      scale, min, max, step, maxLength, JSON.stringify(clientKind === "text" ? { multiline: config.multiline === true } : {})],
  );
  if (clientKind === "choice") {
    const options = Array.isArray(config.options) ? config.options : [];
    if (!options.length) throw new ApiError(400, "invalid_field", "Campos de opção precisam de alternativas.");
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = asRecord(options[optionIndex]);
      const optionLabel = typeof option.label === "string" ? option.label.trim() : "";
      if (!optionLabel) throw new ApiError(400, "invalid_field", "Opção sem rótulo.");
      await client.query(
        `INSERT INTO field_options (id, field_id, semantic_key, label, position, created_at)
         VALUES ($1,$2,$3,$4,$5,now())`,
        [publicId(), id, semanticKey(option.value ?? option.label, `opcao_${optionIndex + 1}`), optionLabel, optionIndex],
      );
    }
  }
  return { id, kind: clientKind, semanticKey: key };
}

function eachDate(start: string, end: string): string[] {
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  const dates: string[] = [];
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    if (dates.length > 366) throw new ApiError(400, "date_range", "Desafios diários podem ter no máximo 366 dias.");
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export async function createChallenge(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { min: 1, max: 160 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  const rules = stringValue(body, "rules", { max: 10_000, optional: true }) ?? null;
  const startDate = dateString(body.startsOn ?? body.startDate, "Data inicial");
  const endDate = dateString(body.endsOn ?? body.endDate, "Data final");
  if (endDate < startDate) throw new ApiError(400, "date_range", "A data final deve ser posterior ao início.");
  const submissionMode = typeof body.submissionMode === "string" ? body.submissionMode : body.template === "reading" ? "daily" : "item";
  if (!SUBMISSION_MODES.has(submissionMode)) throw new ApiError(400, "submission_mode", "Modo de registro inválido.");
  const fields = Array.isArray(body.fields) && body.fields.length ? (body.fields as ClientField[]) : defaultFields(body.template);
  if (fields.length > 30) throw new ApiError(400, "field_limit", "Use no máximo 30 campos.");
  const items = Array.isArray(body.items) ? body.items : [];
  const participantIds = Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.filter((id): id is string => typeof id === "string"))]
    : [session.user.id];

  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const existing = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM challenges WHERE group_id = $1 AND deleted_at IS NULL",
      [groupId],
    );
    assertUnder(
      existing?.count ?? 0,
      LIMITS.challengesPerGroup,
      "challenge_limit",
      `Este grupo atingiu o limite de ${LIMITS.challengesPerGroup} desafios. Apague um desafio para criar outro.`,
    );

    const id = publicId();
    await client.query(
      `INSERT INTO challenges
        (id, group_id, created_by_user_id, title, description, rules, start_date, end_date,
         time_zone, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',now(),now())`,
      [id, groupId, session.user.id, title, description, rules, startDate, endDate, "America/Sao_Paulo"],
    );
    const entryTypeId = publicId();
    await client.query(
      `INSERT INTO entry_types
        (id, challenge_id, semantic_key, name, submission_mode, created_at, updated_at)
       VALUES ($1,$2,'registro','Registro',$3,now(),now())`,
      [entryTypeId, id, submissionMode],
    );

    const insertedFields: Array<{ id: string; kind: string; semanticKey: string }> = [];
    for (let index = 0; index < fields.length; index += 1) {
      insertedFields.push(await insertField(client, id, entryTypeId, fields[index], index));
    }

    if (submissionMode === "item") {
      if (!items.length || items.length > 200) throw new ApiError(400, "item_limit", "Adicione de 1 a 200 itens.");
      for (let index = 0; index < items.length; index += 1) {
        const item = asRecord(items[index]);
        const itemTitle = typeof item.title === "string" ? item.title.trim() : "";
        if (!itemTitle) throw new ApiError(400, "invalid_item", "Item sem título.");
        await client.query(
          `INSERT INTO challenge_items
            (id, challenge_id, entry_type_id, semantic_key, title, position, metadata, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb,now(),now())`,
          [publicId(), id, entryTypeId, semanticKey(itemTitle, `item_${index + 1}`), itemTitle, index],
        );
      }
    } else if (submissionMode === "daily" && body.generateDaily !== false) {
      const dates = eachDate(startDate, endDate);
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index];
        await client.query(
          `INSERT INTO challenge_checkpoints
            (id, challenge_id, semantic_key, title, position, starts_at, due_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6::date::timestamp AT TIME ZONE 'America/Sao_Paulo',
                   ($6::date + interval '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo',now(),now())`,
          [publicId(), id, `dia_${index + 1}`, `Dia ${index + 1}`, index, date],
        );
      }
    }

    const requestedParticipants = participantIds.length ? participantIds : [session.user.id];
    const validParticipants = await client.query<{ user_id: string }>(
      `SELECT user_id FROM group_members
        WHERE group_id = $1 AND removed_at IS NULL AND user_id = ANY($2::text[])`,
      [groupId, requestedParticipants],
    );
    if (validParticipants.rows.length !== requestedParticipants.length) {
      throw new ApiError(400, "invalid_participant", "Todos os participantes precisam ser membros ativos do grupo.");
    }
    for (const participant of validParticipants.rows) {
      await client.query(
        `INSERT INTO challenge_participants
          (challenge_id, group_id, user_id, added_by_user_id, joined_at)
         VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
        [id, groupId, participant.user_id, session.user.id],
      );
    }

    const numeric = insertedFields.find((field) => field.kind === "rating" || field.kind === "number");
    if (numeric) {
      await client.query(
        `INSERT INTO challenge_metrics
          (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
           group_by, decimal_places, visible_during_challenge, position, settings,
           created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'average','none',2,true,0,'{}'::jsonb,$7,now(),now())`,
        [publicId(), id, entryTypeId, numeric.id, `media_${numeric.semanticKey}`, `Média de ${fields.find((field) => semanticKey(field.key, "") === numeric.semanticKey)?.label ?? "valores"}`, session.user.id],
      );
    }
    await client.query(
      `INSERT INTO challenge_metrics
        (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
         group_by, decimal_places, visible_during_challenge, position, settings,
         created_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,NULL,'taxa_conclusao','Taxa de conclusão','completion_rate',
               'none',1,true,1,'{}'::jsonb,$4,now(),now())`,
      [publicId(), id, entryTypeId, session.user.id],
    );
    await writeAudit(client, groupId, id, session.user.id, "challenge.created", "challenge", id, null, {
      title,
      template: body.template ?? null,
    });
    return { id, challengeId: id, status: "draft" };
  });
}

export async function writeAudit(
  client: PoolClient,
  groupId: string,
  challengeId: string | null,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown = null,
  after: unknown = null,
  metadata: unknown = {},
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
      (id, group_id, challenge_id, actor_user_id, action, entity_type, entity_id,
       before, after, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now())`,
    [publicId(), groupId, challengeId, actorUserId, action, entityType, entityId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), JSON.stringify(metadata)],
  );
}

export { asRecord, dateString, insertField, integerValue };
