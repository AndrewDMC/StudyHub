CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'ics_import' NOT NULL,
	"uid" text NOT NULL,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_source_uid_idx" ON "calendar_events" USING btree ("source","uid");--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "calendar_events" USING btree ("date");