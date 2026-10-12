DROP INDEX "readings_work_date_idx";--> statement-breakpoint
ALTER TABLE "interpreters" ADD COLUMN "portal_id" text;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "calls" integer;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "portal_interpreter_id" text;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "portal_interpreter_name" text;--> statement-breakpoint
CREATE INDEX "readings_period_idx" ON "readings" USING btree ("period_start","period_end");--> statement-breakpoint
ALTER TABLE "readings" DROP COLUMN "work_date";