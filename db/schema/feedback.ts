import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, smallint, text } from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";

/**
 * "Como podemos melhorar?" submissions. Deliberately holds no group or challenge
 * *content* — only what the person types here plus the neutral context the client
 * attaches (route, locale, their role). `user_id` is null for logged-out senders
 * and set null (not cascade) when an account is removed, so the signal survives.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    route: text("route"),
    appVersion: text("app_version"),
    locale: text("locale"),
    templateKind: text("template_kind"),
    userRole: text("user_role"),
    formVersion: smallint("form_version").notNull().default(1),
    area: text("area").notNull(),
    goal: text("goal").notNull(),
    succeeded: boolean("succeeded"),
    ease: smallint("ease"),
    friction: text("friction"),
    impact: text("impact").notNull(),
    workaround: text("workaround"),
    wish: text("wish"),
    contactEmail: text("contact_email"),
    contactOk: boolean("contact_ok").notNull().default(false),
    category: text("category"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("feedback_created_idx").on(table.createdAt),
    index("feedback_user_created_idx").on(table.userId, table.createdAt),
    check("feedback_area_check", sql`char_length(btrim(${table.area})) between 1 and 400`),
    check("feedback_goal_check", sql`char_length(btrim(${table.goal})) between 1 and 400`),
    check("feedback_ease_check", sql`${table.ease} is null or ${table.ease} between 1 and 5`),
    check("feedback_impact_check", sql`${table.impact} in ('blocked', 'effort', 'minor', 'idea')`),
    check(
      "feedback_friction_check",
      sql`${table.friction} is null or char_length(${table.friction}) <= 4000`,
    ),
    check("feedback_wish_check", sql`${table.wish} is null or char_length(${table.wish}) <= 4000`),
    check(
      "feedback_workaround_check",
      sql`${table.workaround} is null or char_length(${table.workaround}) <= 4000`,
    ),
    check(
      "feedback_contact_email_check",
      sql`${table.contactEmail} is null or (char_length(${table.contactEmail}) <= 254 and ${table.contactEmail} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')`,
    ),
  ],
);
