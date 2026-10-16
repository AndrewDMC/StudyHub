ALTER TABLE "attempt_answer_photos" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "attempt_answer_photos" ADD COLUMN "transcript_status" text;--> statement-breakpoint
ALTER TABLE "attempt_answer_photos" ADD COLUMN "transcribed_at" timestamp with time zone;
