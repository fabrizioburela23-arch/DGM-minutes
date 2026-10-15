import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "read",
  "needs_review",
  "confirmed",
  "rejected",
  "duplicate",
]);
export const reviewAction = pgEnum("review_action", ["confirm", "correct", "reject"]);
export const managerRole = pgEnum("manager_role", ["manager", "admin"]);

/** Intérpretes de DGM. drive_folder_id une a cada uno con su subcarpeta en Drive. */
export const interpreters = pgTable(
  "interpreters",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    /** ID del intérprete en el portal de Propio (ej. 63602), para verificar que el screenshot es suyo. */
    portalId: text("portal_id"),
    /** Cuenta o cliente con el que trabaja (C-tel, Simplified, Interpredia). */
    company: text("company"),
    /** Otros nombres con los que firma (por ejemplo, el nombre que pone en el Google Form). */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    driveFolderId: text("drive_folder_id"),
    active: boolean("active").notNull().default(true),
    startDate: date("start_date"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("interpreters_code_uq").on(t.code), uniqueIndex("interpreters_drive_folder_uq").on(t.driveFolderId)],
);

/** Regla de entrega (cada cuánto se sube el reporte y hasta qué hora). Una activa por ahora. */
export const deliveryRules = pgTable("delivery_rules", {
  id: serial("id").primaryKey(),
  /** daily = cada día exigido; weekly = cada semana; semimonthly = acumulado del mes, por quincena (1–15 y 16–fin). */
  frequency: text("frequency").$type<"daily" | "weekly" | "semimonthly">().notNull().default("daily"),
  deadlineTime: time("deadline_time").notNull().default("23:59"),
  /** Días después del fin de cada periodo para entregar (0 = el mismo día). */
  deadlineOffsetDays: smallint("deadline_offset_days").notNull().default(0),
  timezone: text("timezone").notNull().default("America/La_Paz"),
  /** 0 = domingo … 6 = sábado. */
  requiredWeekdays: smallint("required_weekdays").array().notNull().default(sql`'{1,2,3,4,5}'::smallint[]`),
  holidays: date("holidays").array().notNull().default(sql`'{}'::date[]`),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Cada screenshot detectado en Drive. Nunca se duplica por drive_file_id. */
export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    /** Puede quedar vacío si aún no se sabe de quién es (screenshots del Google Form); se asigna por el ID de Propio. */
    interpreterId: integer("interpreter_id").references(() => interpreters.id),
    /** Nombre que Google Forms agrega al archivo ("captura - Nombre.png"). Solo referencia, no identifica. */
    uploaderName: text("uploader_name"),
    driveFileId: text("drive_file_id").notNull(),
    fileName: text("file_name").notNull(),
    driveCreatedAt: timestamp("drive_created_at", { withTimezone: true }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    sha256: text("sha256"),
    storageKey: text("storage_key"),
    status: submissionStatus("status").notNull().default("pending"),
    reviewReason: text("review_reason"),
  },
  (t) => [
    uniqueIndex("submissions_drive_file_uq").on(t.driveFileId),
    index("submissions_sha256_idx").on(t.sha256),
    index("submissions_interpreter_idx").on(t.interpreterId),
    index("submissions_status_idx").on(t.status),
  ],
);

/**
 * Lo que leyó la IA en cada screenshot. Puede haber dos por submission (modelo pequeño y mayor).
 * El portal de Propio muestra totales de un rango de fechas (Start Date – End Date), no de un día.
 */
export const readings = pgTable(
  "readings",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id),
    model: text("model").notNull(),
    minutes: integer("minutes"),
    calls: integer("calls"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    portalInterpreterId: text("portal_interpreter_id"),
    portalInterpreterName: text("portal_interpreter_name"),
    extraFields: jsonb("extra_fields").$type<Record<string, unknown>>().notNull().default({}),
    confidence: real("confidence"),
    legible: boolean("legible"),
    rawResponse: jsonb("raw_response"),
    escalated: boolean("escalated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("readings_submission_idx").on(t.submissionId), index("readings_period_idx").on(t.periodStart, t.periodEnd)],
);

/** Confirmaciones y correcciones de gerentes. Nunca se borran. */
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id),
    reviewerEmail: text("reviewer_email").notNull(),
    action: reviewAction("action").notNull(),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_submission_idx").on(t.submissionId)],
);

/** Correos de Google autorizados a entrar al dashboard. */
export const managers = pgTable("managers", {
  email: text("email").primaryKey(),
  name: text("name"),
  role: managerRole("role").notNull().default("manager"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Resultado de cada evaluación de precisión de la IA (una por versión desplegada). Sin datos personales. */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: serial("id").primaryKey(),
    commitSha: text("commit_sha").notNull(),
    createdAt: createdAt(),
    summary: jsonb("summary").notNull(),
  },
  (t) => [uniqueIndex("eval_runs_commit_uq").on(t.commitSha)],
);

/** Registro de cada pasada del worker. */
export const workerRuns = pgTable("worker_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  filesSeen: integer("files_seen").notNull().default(0),
  filesNew: integer("files_new").notNull().default(0),
  filesFailed: integer("files_failed").notNull().default(0),
  /** Avisos que no detienen la pasada (ej. carpeta sin intérprete). Solo IDs y nombres de carpeta. */
  alerts: jsonb("alerts").$type<string[]>().notNull().default([]),
  error: text("error"),
});
