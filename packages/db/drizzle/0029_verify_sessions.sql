ALTER TABLE "study_sessions" ADD COLUMN "verify_prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "mastery_before" real;
