CREATE TYPE "public"."delivery_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."manager_role" AS ENUM('manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('confirm', 'correct', 'reject');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'read', 'needs_review', 'confirmed', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TABLE "delivery_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"frequency" "delivery_frequency" DEFAULT 'daily' NOT NULL,
	"deadline_time" time DEFAULT '23:59' NOT NULL,
	"timezone" text DEFAULT 'America/La_Paz' NOT NULL,
	"required_weekdays" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"holidays" date[] DEFAULT '{}'::date[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interpreters" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"drive_folder_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managers" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text,
	"role" "manager_role" DEFAULT 'manager' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"model" text NOT NULL,
	"minutes" integer,
	"work_date" date,
	"extra_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real,
	"legible" boolean,
	"raw_response" jsonb,
	"escalated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"reviewer_email" text NOT NULL,
	"action" "review_action" NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"interpreter_id" integer NOT NULL,
	"drive_file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"drive_created_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sha256" text,
	"storage_key" text,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"review_reason" text
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"files_seen" integer DEFAULT 0 NOT NULL,
	"files_new" integer DEFAULT 0 NOT NULL,
	"files_failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_interpreter_id_interpreters_id_fk" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interpreters_code_uq" ON "interpreters" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "interpreters_drive_folder_uq" ON "interpreters" USING btree ("drive_folder_id");--> statement-breakpoint
CREATE INDEX "readings_submission_idx" ON "readings" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "readings_work_date_idx" ON "readings" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "reviews_submission_idx" ON "reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_drive_file_uq" ON "submissions" USING btree ("drive_file_id");--> statement-breakpoint
CREATE INDEX "submissions_sha256_idx" ON "submissions" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "submissions_interpreter_idx" ON "submissions" USING btree ("interpreter_id");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status");