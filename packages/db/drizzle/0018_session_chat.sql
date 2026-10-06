ALTER TABLE "study_sessions" ADD COLUMN "transcript_path" text;--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"focus" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_messages_session_idx" ON "session_messages" USING btree ("session_id","created_at");
