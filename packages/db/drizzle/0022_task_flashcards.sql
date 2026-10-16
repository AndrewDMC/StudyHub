CREATE TABLE "task_flashcards" (
	"task_id" uuid NOT NULL,
	"flashcard_id" uuid NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_flashcards_task_id_flashcard_id_pk" PRIMARY KEY("task_id","flashcard_id")
);
--> statement-breakpoint
ALTER TABLE "task_flashcards" ADD CONSTRAINT "task_flashcards_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flashcards" ADD CONSTRAINT "task_flashcards_flashcard_id_flashcards_id_fk" FOREIGN KEY ("flashcard_id") REFERENCES "public"."flashcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_flashcards_flashcard_idx" ON "task_flashcards" USING btree ("flashcard_id");
