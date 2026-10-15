ALTER TABLE "delivery_rules" ALTER COLUMN "frequency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "delivery_rules" ALTER COLUMN "frequency" SET DATA TYPE text USING "frequency"::text;--> statement-breakpoint
ALTER TABLE "delivery_rules" ALTER COLUMN "frequency" SET DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "interpreter_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_rules" ADD COLUMN "deadline_offset_days" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interpreters" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "interpreters" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "uploader_name" text;--> statement-breakpoint
DROP TYPE "public"."delivery_frequency";--> statement-breakpoint
-- DGM confirmó (14 oct 2026): reporte cada 15 días, acumulado del mes (1–15 y mes completo). Plazo: 1 día después de cada corte, a la hora límite (pendiente de confirmar).
UPDATE "delivery_rules" SET "frequency" = 'semimonthly', "deadline_offset_days" = 1 WHERE "active" = true;