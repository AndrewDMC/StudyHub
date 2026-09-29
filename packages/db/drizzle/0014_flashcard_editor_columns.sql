ALTER TABLE "flashcards" ALTER COLUMN "source_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "flagged_at" timestamp with time zone;