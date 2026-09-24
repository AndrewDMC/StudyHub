CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flashcard_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_stability" real,
	"new_stability" real NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_flashcard_id_flashcards_id_fk" FOREIGN KEY ("flashcard_id") REFERENCES "public"."flashcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flashcards_due_at_idx" ON "flashcards" USING btree ("due_at") WHERE not "flashcards"."suspended";