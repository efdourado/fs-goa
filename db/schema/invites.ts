import {
  foreignKey,
  index,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { challenges } from "./challenges";
import { timestamptz } from "./columns";
import { groupInvites } from "./groups";

/**
 * Optional challenge target for an otherwise regular group invitation.
 *
 * The two composite foreign keys guarantee that the invitation and challenge
 * belong to the same group. Keeping this separate preserves the semantics of
 * existing group-only invitations without adding nullable challenge state to
 * their core table.
 */
export const inviteChallengeTargets = pgTable(
  "invite_challenge_targets",
  {
    inviteId: text("invite_id").primaryKey(),
    groupId: text("group_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "invite_challenge_targets_invite_group_fk",
      columns: [table.inviteId, table.groupId],
      foreignColumns: [groupInvites.id, groupInvites.groupId],
    }).onDelete("cascade"),
    foreignKey({
      name: "invite_challenge_targets_challenge_group_fk",
      columns: [table.challengeId, table.groupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("restrict"),
    index("invite_challenge_targets_challenge_idx").on(table.challengeId),
  ],
);
