ALTER TABLE "session_items" ADD COLUMN "feedback" jsonb;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "flashcard_deck_id" uuid;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "drill_id" uuid;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_flashcard_deck_id_artifacts_id_fk" FOREIGN KEY ("flashcard_deck_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_drill_id_artifacts_id_fk" FOREIGN KEY ("drill_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD COLUMN "time_factor" real DEFAULT 1 NOT NULL;
