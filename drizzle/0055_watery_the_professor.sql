ALTER TABLE "entries" ADD COLUMN "parent_entry_id" text;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "parent_type_id" text;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_id_challenge_unique" UNIQUE("id","challenge_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_parent_fk" FOREIGN KEY ("parent_entry_id","challenge_id") REFERENCES "public"."entries"("id","challenge_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_parent_fk" FOREIGN KEY ("parent_type_id","challenge_id") REFERENCES "public"."entry_types"("id","challenge_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_parent_idx" ON "entries" USING btree ("parent_entry_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_parent_not_self_check" CHECK ("entries"."parent_entry_id" is null or "entries"."parent_entry_id" <> "entries"."id");--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_parent_not_self_check" CHECK ("entry_types"."parent_type_id" is null or "entry_types"."parent_type_id" <> "entry_types"."id");