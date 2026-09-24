CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"exam_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" text NOT NULL,
	"target_date" text NOT NULL,
	"availability" jsonb NOT NULL,
	"prefs" jsonb NOT NULL,
	"feasibility" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"job_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"task_key" text NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"topic_key" text,
	"topic_id" uuid,
	"minutes" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'planner' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_plan_key_idx" ON "tasks" USING btree ("plan_id","task_key");--> statement-breakpoint
CREATE INDEX "tasks_subject_date_idx" ON "tasks" USING btree ("subject_id","date");