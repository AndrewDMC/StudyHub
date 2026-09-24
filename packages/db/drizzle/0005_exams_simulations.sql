CREATE TABLE "attempt_item_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"awarded" real NOT NULL,
	"max" real NOT NULL,
	"criteria" jsonb NOT NULL,
	"missing" jsonb NOT NULL,
	"source_ref" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"source_doc_ids" jsonb NOT NULL,
	"profile" jsonb NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"job_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_profiles_subject_id_unique" UNIQUE("subject_id")
);
--> statement-breakpoint
CREATE TABLE "simulation_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"simulation_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_min" integer NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"graded_at" timestamp with time zone,
	"total_awarded" real,
	"total_max" real,
	"weak_topics" jsonb
);
--> statement-breakpoint
CREATE TABLE "simulation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"simulation_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"topic_id" uuid,
	"prompt" text NOT NULL,
	"kind" text NOT NULL,
	"points" real NOT NULL,
	"expected_points" jsonb NOT NULL,
	"rubric" jsonb NOT NULL,
	"solution" text NOT NULL,
	"source_ref" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulations" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"topic_id" uuid,
	"time_budget_min" integer NOT NULL,
	"total_points" real NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "allowed_materials" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD CONSTRAINT "attempt_item_results_attempt_id_simulation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."simulation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_item_results" ADD CONSTRAINT "attempt_item_results_item_id_simulation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."simulation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_profiles" ADD CONSTRAINT "exam_profiles_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_attempts" ADD CONSTRAINT "simulation_attempts_simulation_id_artifacts_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_items" ADD CONSTRAINT "simulation_items_simulation_id_artifacts_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_items" ADD CONSTRAINT "simulation_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;