ALTER TABLE "study_sessions" ADD COLUMN "kind" text DEFAULT 'lesson' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "method" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "block_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "block_count" integer;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_kind_check" CHECK ("kind" IN ('lesson', 'verify'));--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_method_check" CHECK ("method" IN ('standard', 'sprint'));--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_phase_check" CHECK ("phase" IS NULL OR "phase" IN ('explore', 'understand', 'rework', 'apply', 'recall', 'exercises', 'theory', 'retry'));--> statement-breakpoint
ALTER TABLE "session_items" ADD COLUMN "linked_block_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "lesson_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"formula" text,
	"example_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trap" text,
	"check_question" text,
	"check_answer" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'locked' NOT NULL,
	"student_answer" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_blocks_state_check" CHECK ("state" IN ('locked', 'open', 'done'))
);
--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_blocks_session_order_idx" ON "lesson_blocks" USING btree ("session_id","order_index");
