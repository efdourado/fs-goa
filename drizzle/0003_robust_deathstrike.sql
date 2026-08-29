CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_token_hash_check" CHECK ("password_reset_tokens"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at"),
	CONSTRAINT "password_reset_tokens_used_at_check" CHECK ("password_reset_tokens"."used_at" is null or "password_reset_tokens"."used_at" >= "password_reset_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "login_attempts" DROP CONSTRAINT "login_attempts_username_check";--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_active_idx" ON "password_reset_tokens" USING btree ("user_id","used_at");--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_identifier_check" CHECK (char_length(btrim("login_attempts"."username_normalized")) between 1 and 254);