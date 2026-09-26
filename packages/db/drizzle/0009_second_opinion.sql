ALTER TABLE "attempt_item_results" ADD COLUMN "second_opinion_model" text;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD COLUMN "second_opinion_awarded" real;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD COLUMN "second_opinion_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD COLUMN "second_opinion_missing" jsonb;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD COLUMN "second_opinion_at" timestamp with time zone;