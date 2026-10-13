CREATE TABLE "eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_commit_uq" ON "eval_runs" USING btree ("commit_sha");