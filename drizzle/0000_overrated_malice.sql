-- Challenge duplication is structural only: copy configuration with fresh IDs.
-- Never copy participants, entries, values, result blocks, share tokens, sessions,
-- invitations, or any other personal data into the duplicated challenge.
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"challenge_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_action_check" CHECK (char_length(btrim("audit_events"."action")) between 1 and 100),
	CONSTRAINT "audit_events_entity_type_check" CHECK (char_length(btrim("audit_events"."entity_type")) between 1 and 80),
	CONSTRAINT "audit_events_metadata_object_check" CHECK (jsonb_typeof("audit_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "challenge_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"semantic_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_checkpoints_challenge_key_unique" UNIQUE("challenge_id","semantic_key"),
	CONSTRAINT "challenge_checkpoints_id_challenge_unique" UNIQUE("id","challenge_id"),
	CONSTRAINT "challenge_checkpoints_key_check" CHECK ("challenge_checkpoints"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "challenge_checkpoints_title_check" CHECK (char_length(btrim("challenge_checkpoints"."title")) between 1 and 160),
	CONSTRAINT "challenge_checkpoints_position_check" CHECK ("challenge_checkpoints"."position" >= 0),
	CONSTRAINT "challenge_checkpoints_schedule_check" CHECK ("challenge_checkpoints"."starts_at" is null or "challenge_checkpoints"."due_at" is null or "challenge_checkpoints"."due_at" >= "challenge_checkpoints"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "challenge_duplications" (
	"group_id" text NOT NULL,
	"source_challenge_id" text NOT NULL,
	"target_challenge_id" text PRIMARY KEY NOT NULL,
	"copied_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_duplications_distinct_check" CHECK ("challenge_duplications"."source_challenge_id" <> "challenge_duplications"."target_challenge_id")
);
--> statement-breakpoint
CREATE TABLE "challenge_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"entry_type_id" text NOT NULL,
	"semantic_key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"kind" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"number_scale" smallint,
	"min_scaled" bigint,
	"max_scaled" bigint,
	"step_scaled" bigint,
	"max_length" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_fields_challenge_key_unique" UNIQUE("challenge_id","semantic_key"),
	CONSTRAINT "challenge_fields_id_challenge_unique" UNIQUE("id","challenge_id"),
	CONSTRAINT "challenge_fields_id_type_unique" UNIQUE("id","entry_type_id"),
	CONSTRAINT "challenge_fields_id_challenge_type_unique" UNIQUE("id","challenge_id","entry_type_id"),
	CONSTRAINT "challenge_fields_key_check" CHECK ("challenge_fields"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "challenge_fields_label_check" CHECK (char_length(btrim("challenge_fields"."label")) between 1 and 120),
	CONSTRAINT "challenge_fields_kind_check" CHECK ("challenge_fields"."kind" in ('text', 'number', 'rating', 'choice', 'boolean', 'date')),
	CONSTRAINT "challenge_fields_position_check" CHECK ("challenge_fields"."position" >= 0),
	CONSTRAINT "challenge_fields_numeric_config_check" CHECK ((
        "challenge_fields"."kind" in ('number', 'rating')
        and "challenge_fields"."number_scale" is not null
        and "challenge_fields"."number_scale" between 0 and 6
        and ("challenge_fields"."min_scaled" is null or "challenge_fields"."max_scaled" is null or "challenge_fields"."max_scaled" >= "challenge_fields"."min_scaled")
        and ("challenge_fields"."step_scaled" is null or "challenge_fields"."step_scaled" > 0)
        and ("challenge_fields"."kind" <> 'rating' or ("challenge_fields"."min_scaled" is not null and "challenge_fields"."max_scaled" is not null and "challenge_fields"."step_scaled" is not null))
      ) or (
        "challenge_fields"."kind" not in ('number', 'rating')
        and "challenge_fields"."number_scale" is null
        and "challenge_fields"."min_scaled" is null
        and "challenge_fields"."max_scaled" is null
        and "challenge_fields"."step_scaled" is null
      )),
	CONSTRAINT "challenge_fields_text_config_check" CHECK (("challenge_fields"."kind" = 'text' and ("challenge_fields"."max_length" is null or "challenge_fields"."max_length" > 0))
        or ("challenge_fields"."kind" <> 'text' and "challenge_fields"."max_length" is null))
);
--> statement-breakpoint
CREATE TABLE "challenge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"checkpoint_id" text,
	"entry_type_id" text NOT NULL,
	"semantic_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"opens_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_items_challenge_key_unique" UNIQUE("challenge_id","semantic_key"),
	CONSTRAINT "challenge_items_id_challenge_type_unique" UNIQUE("id","challenge_id","entry_type_id"),
	CONSTRAINT "challenge_items_key_check" CHECK ("challenge_items"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "challenge_items_title_check" CHECK (char_length(btrim("challenge_items"."title")) between 1 and 200),
	CONSTRAINT "challenge_items_position_check" CHECK ("challenge_items"."position" >= 0),
	CONSTRAINT "challenge_items_schedule_check" CHECK ("challenge_items"."opens_at" is null or "challenge_items"."due_at" is null or "challenge_items"."due_at" >= "challenge_items"."opens_at"),
	CONSTRAINT "challenge_items_metadata_object_check" CHECK (jsonb_typeof("challenge_items"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "challenge_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"entry_type_id" text NOT NULL,
	"field_id" text,
	"semantic_key" text NOT NULL,
	"label" text NOT NULL,
	"operation" text NOT NULL,
	"group_by" text DEFAULT 'none' NOT NULL,
	"decimal_places" smallint DEFAULT 2 NOT NULL,
	"visible_during_challenge" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_metrics_challenge_key_unique" UNIQUE("challenge_id","semantic_key"),
	CONSTRAINT "challenge_metrics_id_challenge_unique" UNIQUE("id","challenge_id"),
	CONSTRAINT "challenge_metrics_key_check" CHECK ("challenge_metrics"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "challenge_metrics_label_check" CHECK (char_length(btrim("challenge_metrics"."label")) between 1 and 120),
	CONSTRAINT "challenge_metrics_operation_check" CHECK ("challenge_metrics"."operation" in ('sum', 'average', 'count', 'min', 'max', 'completion_rate')),
	CONSTRAINT "challenge_metrics_group_by_check" CHECK ("challenge_metrics"."group_by" in ('none', 'participant', 'item', 'day', 'week')),
	CONSTRAINT "challenge_metrics_field_requirement_check" CHECK (("challenge_metrics"."operation" in ('sum', 'average', 'min', 'max') and "challenge_metrics"."field_id" is not null)
        or ("challenge_metrics"."operation" = 'completion_rate' and "challenge_metrics"."field_id" is null)
        or ("challenge_metrics"."operation" = 'count')),
	CONSTRAINT "challenge_metrics_format_check" CHECK ("challenge_metrics"."decimal_places" between 0 and 6 and "challenge_metrics"."position" >= 0),
	CONSTRAINT "challenge_metrics_settings_object_check" CHECK (jsonb_typeof("challenge_metrics"."settings") = 'object')
);
--> statement-breakpoint
CREATE TABLE "challenge_participants" (
	"challenge_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "challenge_participants_pk" PRIMARY KEY("challenge_id","user_id"),
	CONSTRAINT "challenge_participants_removed_at_check" CHECK ("challenge_participants"."removed_at" is null or "challenge_participants"."removed_at" >= "challenge_participants"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rules" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"results_published_at" timestamp with time zone,
	"result_share_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "challenges_result_share_token_hash_unique" UNIQUE("result_share_token_hash"),
	CONSTRAINT "challenges_title_check" CHECK (char_length(btrim("challenges"."title")) between 1 and 160),
	CONSTRAINT "challenges_date_range_check" CHECK ("challenges"."end_date" >= "challenges"."start_date"),
	CONSTRAINT "challenges_time_zone_check" CHECK (char_length(btrim("challenges"."time_zone")) between 1 and 100),
	CONSTRAINT "challenges_status_check" CHECK ("challenges"."status" in ('draft', 'active', 'closed')),
	CONSTRAINT "challenges_status_timestamps_check" CHECK (("challenges"."status" = 'draft' and "challenges"."activated_at" is null and "challenges"."closed_at" is null)
        or ("challenges"."status" = 'active' and "challenges"."activated_at" is not null and "challenges"."closed_at" is null)
        or ("challenges"."status" = 'closed' and "challenges"."activated_at" is not null and "challenges"."closed_at" is not null and "challenges"."closed_at" >= "challenges"."activated_at")),
	CONSTRAINT "challenges_results_publication_check" CHECK ("challenges"."results_published_at" is null or ("challenges"."status" = 'closed' and "challenges"."results_published_at" >= "challenges"."closed_at")),
	CONSTRAINT "challenges_share_token_check" CHECK ("challenges"."result_share_token_hash" is null or ("challenges"."results_published_at" is not null and "challenges"."result_share_token_hash" ~ '^[A-Za-z0-9_-]{43}$'))
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"entry_type_id" text NOT NULL,
	"submission_mode" text NOT NULL,
	"item_id" text,
	"participant_user_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_edited_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entries_id_challenge_type_unique" UNIQUE("id","challenge_id","entry_type_id"),
	CONSTRAINT "entries_item_mode_check" CHECK (("entries"."submission_mode" = 'item' and "entries"."item_id" is not null)
        or ("entries"."submission_mode" in ('daily', 'free') and "entries"."item_id" is null)),
	CONSTRAINT "entries_deleted_at_check" CHECK ("entries"."deleted_at" is null or "entries"."deleted_at" >= "entries"."created_at")
);
--> statement-breakpoint
CREATE TABLE "entry_types" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"semantic_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"submission_mode" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_types_challenge_key_unique" UNIQUE("challenge_id","semantic_key"),
	CONSTRAINT "entry_types_id_challenge_unique" UNIQUE("id","challenge_id"),
	CONSTRAINT "entry_types_id_challenge_mode_unique" UNIQUE("id","challenge_id","submission_mode"),
	CONSTRAINT "entry_types_key_check" CHECK ("entry_types"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "entry_types_name_check" CHECK (char_length(btrim("entry_types"."name")) between 1 and 120),
	CONSTRAINT "entry_types_submission_mode_check" CHECK ("entry_types"."submission_mode" in ('item', 'daily', 'free'))
);
--> statement-breakpoint
CREATE TABLE "entry_values" (
	"entry_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"entry_type_id" text NOT NULL,
	"field_id" text NOT NULL,
	"text_value" text,
	"number_scaled" bigint,
	"boolean_value" boolean,
	"date_value" date,
	"option_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_values_pk" PRIMARY KEY("entry_id","field_id"),
	CONSTRAINT "entry_values_entry_field_challenge_unique" UNIQUE("entry_id","field_id","challenge_id"),
	CONSTRAINT "entry_values_exactly_one_value_check" CHECK (num_nonnulls(
        "entry_values"."text_value",
        "entry_values"."number_scaled",
        "entry_values"."boolean_value",
        "entry_values"."date_value",
        "entry_values"."option_id"
      ) = 1)
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" text PRIMARY KEY NOT NULL,
	"field_id" text NOT NULL,
	"semantic_key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_options_field_key_unique" UNIQUE("field_id","semantic_key"),
	CONSTRAINT "field_options_id_field_unique" UNIQUE("id","field_id"),
	CONSTRAINT "field_options_key_check" CHECK ("field_options"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "field_options_label_check" CHECK (char_length(btrim("field_options"."label")) between 1 and 120),
	CONSTRAINT "field_options_position_check" CHECK ("field_options"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "group_invites_token_hash_check" CHECK ("group_invites"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "group_invites_role_check" CHECK ("group_invites"."role" in ('admin', 'participant')),
	CONSTRAINT "group_invites_usage_check" CHECK ("group_invites"."max_uses" > 0 and "group_invites"."use_count" between 0 and "group_invites"."max_uses"),
	CONSTRAINT "group_invites_expiry_check" CHECK ("group_invites"."expires_at" > "group_invites"."created_at"),
	CONSTRAINT "group_invites_revocation_check" CHECK ("group_invites"."revoked_at" is null or "group_invites"."revoked_at" >= "group_invites"."created_at")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"added_by_user_id" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "group_members_pk" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "group_members_role_check" CHECK ("group_members"."role" in ('owner', 'admin', 'participant')),
	CONSTRAINT "group_members_removed_at_check" CHECK ("group_members"."removed_at" is null or "group_members"."removed_at" >= "group_members"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_check" CHECK (char_length(btrim("groups"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"invite_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemptions_pk" PRIMARY KEY("invite_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"username_normalized" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_attempts_username_check" CHECK ("login_attempts"."username_normalized" ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
	CONSTRAINT "login_attempts_failure_count_check" CHECK ("login_attempts"."failure_count" >= 0),
	CONSTRAINT "login_attempts_lock_window_check" CHECK ("login_attempts"."locked_until" is null or "login_attempts"."locked_until" >= "login_attempts"."window_started_at")
);
--> statement-breakpoint
CREATE TABLE "result_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"kind" text NOT NULL,
	"metric_id" text,
	"source_entry_id" text,
	"source_field_id" text,
	"heading" text,
	"body_snapshot" text,
	"value_snapshot" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_blocks_kind_check" CHECK ("result_blocks"."kind" in ('metric', 'entry_value', 'text')),
	CONSTRAINT "result_blocks_position_check" CHECK ("result_blocks"."position" >= 0),
	CONSTRAINT "result_blocks_source_check" CHECK ((
          "result_blocks"."kind" = 'metric'
          and "result_blocks"."metric_id" is not null
          and "result_blocks"."source_entry_id" is null
          and "result_blocks"."source_field_id" is null
        ) or (
          "result_blocks"."kind" = 'entry_value'
          and "result_blocks"."metric_id" is null
          and "result_blocks"."source_entry_id" is not null
          and "result_blocks"."source_field_id" is not null
          and "result_blocks"."body_snapshot" is not null
        ) or (
          "result_blocks"."kind" = 'text'
          and "result_blocks"."metric_id" is null
          and "result_blocks"."source_entry_id" is null
          and "result_blocks"."source_field_id" is null
          and "result_blocks"."body_snapshot" is not null
        ))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"rotated_from_session_id" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_rotated_from_unique" UNIQUE("rotated_from_session_id"),
	CONSTRAINT "sessions_token_hash_check" CHECK ("sessions"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "sessions_expiry_check" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_revocation_check" CHECK ("sessions"."revoked_at" is null or "sessions"."revoked_at" >= "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"username" text NOT NULL,
	"username_normalized" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_normalized_check" CHECK ("users"."username_normalized" ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
	CONSTRAINT "users_display_name_check" CHECK (char_length(btrim("users"."display_name")) between 1 and 80),
	CONSTRAINT "users_username_check" CHECK (char_length("users"."username") between 3 and 32)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_challenge_group_fk" FOREIGN KEY ("challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_checkpoints" ADD CONSTRAINT "challenge_checkpoints_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_copied_by_user_id_users_id_fk" FOREIGN KEY ("copied_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_source_group_fk" FOREIGN KEY ("source_challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_target_group_fk" FOREIGN KEY ("target_challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_fields" ADD CONSTRAINT "challenge_fields_type_challenge_fk" FOREIGN KEY ("entry_type_id","challenge_id") REFERENCES "public"."entry_types"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_checkpoint_challenge_fk" FOREIGN KEY ("checkpoint_id","challenge_id") REFERENCES "public"."challenge_checkpoints"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_type_challenge_fk" FOREIGN KEY ("entry_type_id","challenge_id") REFERENCES "public"."entry_types"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_type_challenge_fk" FOREIGN KEY ("entry_type_id","challenge_id") REFERENCES "public"."entry_types"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_field_scope_fk" FOREIGN KEY ("field_id","challenge_id","entry_type_id") REFERENCES "public"."challenge_fields"("id","challenge_id","entry_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_group_fk" FOREIGN KEY ("challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_group_member_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."group_members"("group_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_last_edited_by_user_id_users_id_fk" FOREIGN KEY ("last_edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_challenge_participant_fk" FOREIGN KEY ("challenge_id","participant_user_id") REFERENCES "public"."challenge_participants"("challenge_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_type_challenge_mode_fk" FOREIGN KEY ("entry_type_id","challenge_id","submission_mode") REFERENCES "public"."entry_types"("id","challenge_id","submission_mode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_item_challenge_type_fk" FOREIGN KEY ("item_id","challenge_id","entry_type_id") REFERENCES "public"."challenge_items"("id","challenge_id","entry_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_values" ADD CONSTRAINT "entry_values_entry_scope_fk" FOREIGN KEY ("entry_id","challenge_id","entry_type_id") REFERENCES "public"."entries"("id","challenge_id","entry_type_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_values" ADD CONSTRAINT "entry_values_field_scope_fk" FOREIGN KEY ("field_id","challenge_id","entry_type_id") REFERENCES "public"."challenge_fields"("id","challenge_id","entry_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_values" ADD CONSTRAINT "entry_values_option_field_fk" FOREIGN KEY ("option_id","field_id") REFERENCES "public"."field_options"("id","field_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "field_options_field_id_challenge_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."challenge_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_invite_id_group_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."group_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_metric_challenge_fk" FOREIGN KEY ("metric_id","challenge_id") REFERENCES "public"."challenge_metrics"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_entry_value_challenge_fk" FOREIGN KEY ("source_entry_id","source_field_id","challenge_id") REFERENCES "public"."entry_values"("entry_id","field_id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rotated_from_fk" FOREIGN KEY ("rotated_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_group_created_idx" ON "audit_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_challenge_created_idx" ON "audit_events" USING btree ("challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_created_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "challenge_checkpoints_order_idx" ON "challenge_checkpoints" USING btree ("challenge_id","position");--> statement-breakpoint
CREATE INDEX "challenge_duplications_source_idx" ON "challenge_duplications" USING btree ("source_challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "challenge_fields_order_idx" ON "challenge_fields" USING btree ("entry_type_id","position");--> statement-breakpoint
CREATE INDEX "challenge_items_order_idx" ON "challenge_items" USING btree ("challenge_id","checkpoint_id","position");--> statement-breakpoint
CREATE INDEX "challenge_items_due_idx" ON "challenge_items" USING btree ("challenge_id","due_at");--> statement-breakpoint
CREATE INDEX "challenge_metrics_order_idx" ON "challenge_metrics" USING btree ("challenge_id","position");--> statement-breakpoint
CREATE INDEX "challenge_participants_user_active_idx" ON "challenge_participants" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "challenge_participants_challenge_active_idx" ON "challenge_participants" USING btree ("challenge_id","removed_at");--> statement-breakpoint
CREATE INDEX "challenges_group_status_dates_idx" ON "challenges" USING btree ("group_id","status","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_response_uidx" ON "entries" USING btree ("item_id","participant_user_id") WHERE "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_daily_response_uidx" ON "entries" USING btree ("challenge_id","entry_type_id","participant_user_id","occurred_on") WHERE "entries"."submission_mode" = 'daily' and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_participant_history_idx" ON "entries" USING btree ("challenge_id","participant_user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "entries_challenge_active_idx" ON "entries" USING btree ("challenge_id","deleted_at");--> statement-breakpoint
CREATE INDEX "entries_item_active_idx" ON "entries" USING btree ("item_id","deleted_at");--> statement-breakpoint
CREATE INDEX "entry_values_field_number_idx" ON "entry_values" USING btree ("field_id","number_scaled");--> statement-breakpoint
CREATE INDEX "entry_values_field_option_idx" ON "entry_values" USING btree ("field_id","option_id");--> statement-breakpoint
CREATE INDEX "field_options_order_idx" ON "field_options" USING btree ("field_id","position");--> statement-breakpoint
CREATE INDEX "group_invites_group_active_idx" ON "group_invites" USING btree ("group_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "group_invites_expires_at_idx" ON "group_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_active_owner_uidx" ON "group_members" USING btree ("group_id") WHERE "group_members"."role" = 'owner' and "group_members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "group_members_user_active_idx" ON "group_members" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "group_members_group_role_active_idx" ON "group_members" USING btree ("group_id","role","removed_at");--> statement-breakpoint
CREATE INDEX "invite_redemptions_user_idx" ON "invite_redemptions" USING btree ("user_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "login_attempts_locked_until_idx" ON "login_attempts" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX "result_blocks_order_idx" ON "result_blocks" USING btree ("challenge_id","position");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_normalized_uidx" ON "users" USING btree ("username_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uidx" ON "users" USING btree ("email_normalized") WHERE "users"."email_normalized" is not null;
