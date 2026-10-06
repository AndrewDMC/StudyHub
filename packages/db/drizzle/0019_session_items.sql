ALTER TABLE "study_sessions" ADD COLUMN "briefing_job_id" uuid;--> statement-breakpoint
CREATE TABLE "session_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_index" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"difficulty" smallint,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_id" uuid,
	"state" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_items_session_idx" ON "session_items" USING btree ("session_id","kind","order_index");
