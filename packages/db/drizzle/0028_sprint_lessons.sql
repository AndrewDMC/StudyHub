ALTER TABLE "session_items" ADD COLUMN "concepts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "session_items" ADD COLUMN "solution_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "session_items" ADD COLUMN "solution_revealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_items" ADD COLUMN "parent_item_id" uuid;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_parent_item_id_session_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD COLUMN "concept" text;
