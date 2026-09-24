CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"page_from" integer NOT NULL,
	"page_to" integer NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"tokens" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"original_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"pages" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"lang" text,
	"md_path" text,
	"md_edited" boolean DEFAULT false NOT NULL,
	"md_confidence" real,
	"verification_status" text DEFAULT 'not_required' NOT NULL,
	"blocked_blocks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ingested_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_text_fts_idx" ON "chunks" USING gin (to_tsvector('italian', "text"));