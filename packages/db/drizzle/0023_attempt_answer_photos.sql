CREATE TABLE "attempt_answer_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"rel_path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt_answer_photos" ADD CONSTRAINT "attempt_answer_photos_attempt_id_simulation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."simulation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer_photos" ADD CONSTRAINT "attempt_answer_photos_item_id_simulation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."simulation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_answer_photos_attempt_item_idx" ON "attempt_answer_photos" USING btree ("attempt_id","item_id");
