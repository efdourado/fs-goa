import { csrfForSession, type GroupRole, type SessionContext } from "../../auth";
import { withClient } from "../../db";
import { LIMITS } from "../../limits";
import type { ChallengeStatus } from "./access";

export async function bootstrap(session: SessionContext | null): Promise<Record<string, unknown>> {
  if (!session) {
    return {
      csrfToken: "",
      user: null,
      limits: {
        groupsPerOwner: LIMITS.groupsPerOwner,
        challengesPerGroup: LIMITS.challengesPerGroup,
        groupsPerMember: LIMITS.groupsPerMember,
        pendingInvitesPerUser: LIMITS.pendingInvitesPerUser,
      },
      groups: [],
      challenges: [],
      memberRequests: [],
    };
  }

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

    // Pending outgoing invites, shown on the group screen so admins can track or
    // withdraw them. Only groups the viewer manages.
    const manageableGroupIds = groupsResult.rows
      .filter((group) => group.role === "owner" || group.role === "admin")
      .map((group) => group.id);
    const pendingByGroup = new Map<string, Array<Record<string, unknown>>>();
    if (manageableGroupIds.length) {
      const pending = await client.query<{
        group_id: string;
        id: string;
        display_name: string;
        username: string;
        created_at: Date;
      }>(
        `SELECT r.group_id, r.id, u.display_name, u.username, r.created_at
           FROM group_member_requests r JOIN users u ON u.id = r.user_id
          WHERE r.group_id = ANY($1::text[]) AND r.status = 'pending'
          ORDER BY r.created_at`,
        [manageableGroupIds],
      );
      for (const row of pending.rows) {
        const list = pendingByGroup.get(row.group_id) ?? [];
        list.push({ id: row.id, name: row.display_name, username: row.username, createdAt: row.created_at.toISOString() });
        pendingByGroup.set(row.group_id, list);
      }
    }

    const memberRequestsResult = await client.query<{
      id: string;
      group_id: string;
      group_name: string;
      role: GroupRole;
      created_at: Date;
      invited_by: string | null;
    }>(
      `SELECT r.id, r.group_id, g.name AS group_name, r.role, r.created_at,
              inviter.display_name AS invited_by
         FROM group_member_requests r
         JOIN groups g ON g.id = r.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
         LEFT JOIN users inviter ON inviter.id = r.invited_by_user_id
        WHERE r.user_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at DESC`,
      [session.user.id],
    );

    const challengesResult = await client.query<{
      id: string;
      group_id: string;
      title: string;
      description: string | null;
      status: ChallengeStatus;
      start_date: string | null;
      end_date: string | null;
      role: GroupRole;
      is_participant: boolean;
      completed_count: number;
      total_count: number | null;
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
                  AND c.start_date IS NOT NULL
                THEN (SELECT count(*)::int FROM challenge_checkpoints cc
                       WHERE cc.challenge_id = c.id AND cc.archived_at IS NULL)
                WHEN EXISTS (SELECT 1 FROM entry_types et WHERE et.challenge_id = c.id AND et.submission_mode = 'daily')
                THEN NULL
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
      limits: {
        groupsPerOwner: LIMITS.groupsPerOwner,
        challengesPerGroup: LIMITS.challengesPerGroup,
        groupsPerMember: LIMITS.groupsPerMember,
        pendingInvitesPerUser: LIMITS.pendingInvitesPerUser,
      },
      groups: groupsResult.rows.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        role: group.role,
        memberCount: group.member_count,
        members: membersByGroup.get(group.id) ?? [],
        pendingRequests: pendingByGroup.get(group.id) ?? [],
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
      memberRequests: memberRequestsResult.rows.map((request) => ({
        id: request.id,
        groupId: request.group_id,
        groupName: request.group_name,
        role: request.role,
        invitedBy: request.invited_by,
        createdAt: request.created_at.toISOString(),
      })),
    };
  });
}
