CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "schema_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"from_node" text NOT NULL,
	"to_node" text NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"confidence" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"label" text NOT NULL,
	"node_keys" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"crop" jsonb,
	"confidence" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"topic_id" uuid,
	"md_anchor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"before" text,
	"after" text,
	"kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type_source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type_confidence" real;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type_suggested" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "md_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_edges" ADD CONSTRAINT "schema_edges_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_groups" ADD CONSTRAINT "schema_groups_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_nodes" ADD CONSTRAINT "schema_nodes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_nodes" ADD CONSTRAINT "schema_nodes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_corrections" ADD CONSTRAINT "transcription_corrections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schema_edges_from_node_idx" ON "schema_edges" USING btree ("from_node");--> statement-breakpoint
CREATE INDEX "schema_edges_to_node_idx" ON "schema_edges" USING btree ("to_node");--> statement-breakpoint
CREATE INDEX "schema_nodes_document_confidence_idx" ON "schema_nodes" USING btree ("document_id","confidence");