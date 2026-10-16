ALTER TABLE "study_sessions" ADD COLUMN "mood" text;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_mood_check" CHECK ("mood" IS NULL OR "mood" IN ('hard', 'ok', 'good'));
