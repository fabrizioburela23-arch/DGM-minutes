import {
  addDays,
  dateRange,
  daysBehind,
  deliveryGrid,
  localDate,
  type DayStatus,
  type DeliveryInput,
  type DeliveryRule,
  type InterpreterLite,
} from "@dgm/core/deliveries";
import {
  and,
  type AnyDb,
  asc,
  deliveryRules,
  desc,
  eq,
  inArray,
  interpreters,
  readings,
  sql,
  submissions,
} from "@dgm/db";

export type SubmissionStatus = (typeof submissions.$inferSelect)["status"];

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Pendiente de lectura",
  read: "Leído",
  needs_review: "En revisión",
  confirmed: "Confirmado",
  rejected: "Rechazado",
  duplicate: "Duplicado",
};

/** Estados que cuentan en los totales (CLAUDE.md: solo read o confirmed). */
export const ACCEPTED: SubmissionStatus[] = ["read", "confirmed"];
/** Lo que espera una decisión de un gerente. */
export const INBOX: SubmissionStatus[] = ["needs_review", "duplicate"];

const DEFAULT_RULE: DeliveryRule = {
  frequency: "daily",
  deadlineTime: "23:59:00",
  timezone: process.env.APP_TIMEZONE || "America/La_Paz",
  requiredWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

export async function loadRule(db: AnyDb): Promise<DeliveryRule> {
  const [rule] = await db.select().from(deliveryRules).where(eq(deliveryRules.active, true)).orderBy(asc(deliveryRules.id)).limit(1);
  if (!rule) return DEFAULT_RULE;
  return {
    frequency: rule.frequency,
    deadlineTime: rule.deadlineTime,
    timezone: rule.timezone,
    requiredWeekdays: rule.requiredWeekdays,
    holidays: rule.holidays,
  };
}

export type InterpreterRow = typeof interpreters.$inferSelect;

export async function loadInterpreters(db: AnyDb, opts: { activeOnly?: boolean } = {}): Promise<InterpreterRow[]> {
  const q = db.select().from(interpreters);
  const rows = opts.activeOnly ? await q.where(eq(interpreters.active, true)) : await q;
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export function toLite(i: InterpreterRow): InterpreterLite {
  return { id: i.id, startDate: i.startDate, createdAt: i.createdAt };
}

/** Una entrega con los valores vigentes: la última lectura guardada (de la IA o la corrección de un gerente). */
export type SubmissionView = {
  id: number;
  interpreterId: number;
  interpreterCode: string;
  interpreterName: string;
  expectedPortalId: string | null;
  driveFileId: string;
  fileName: string;
  storageKey: string | null;
  uploadedAt: Date;
  status: SubmissionStatus;
  reviewReason: string | null;
  readingId: number | null;
  model: string | null;
  minutes: number | null;
  calls: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  portalInterpreterId: string | null;
  portalInterpreterName: string | null;
  confidence: number | null;
  escalated: boolean;
};

export type SubmissionFilters = {
  /** Rango de fechas: entregas cuyo periodo se cruza con él (o, si no tienen periodo, detectadas en él). */
  from?: string;
  to?: string;
  interpreterId?: number;
  statuses?: SubmissionStatus[];
  order?: "newest" | "oldest";
  limit?: number;
  offset?: number;
};

export async function loadSubmissions(db: AnyDb, f: SubmissionFilters = {}): Promise<SubmissionView[]> {
  const latest = db
    .selectDistinctOn([readings.submissionId], {
      submissionId: readings.submissionId,
      readingId: sql<number>`${readings.id}`.as("reading_id"),
      model: readings.model,
      minutes: readings.minutes,
      calls: readings.calls,
      periodStart: readings.periodStart,
      periodEnd: readings.periodEnd,
      portalInterpreterId: readings.portalInterpreterId,
      portalInterpreterName: readings.portalInterpreterName,
      confidence: readings.confidence,
      escalated: readings.escalated,
    })
    .from(readings)
    .orderBy(readings.submissionId, desc(readings.id))
    .as("latest");

  const conditions = [];
  if (f.interpreterId) conditions.push(eq(submissions.interpreterId, f.interpreterId));
  if (f.statuses && f.statuses.length > 0) conditions.push(inArray(submissions.status, f.statuses));
  if (f.from) {
    conditions.push(
      sql`coalesce(${latest.periodEnd}, (coalesce(${submissions.driveCreatedAt}, ${submissions.detectedAt}))::date) >= ${f.from}::date`,
    );
  }
  if (f.to) {
    conditions.push(
      sql`coalesce(${latest.periodStart}, (coalesce(${submissions.driveCreatedAt}, ${submissions.detectedAt}))::date) <= ${f.to}::date`,
    );
  }

  const uploaded = sql`coalesce(${submissions.driveCreatedAt}, ${submissions.detectedAt})`;
  let query = db
    .select({
      id: submissions.id,
      interpreterId: submissions.interpreterId,
      interpreterCode: interpreters.code,
      interpreterName: interpreters.fullName,
      expectedPortalId: interpreters.portalId,
      driveFileId: submissions.driveFileId,
      fileName: submissions.fileName,
      storageKey: submissions.storageKey,
      driveCreatedAt: submissions.driveCreatedAt,
      detectedAt: submissions.detectedAt,
      status: submissions.status,
      reviewReason: submissions.reviewReason,
      readingId: latest.readingId,
      model: latest.model,
      minutes: latest.minutes,
      calls: latest.calls,
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
      portalInterpreterId: latest.portalInterpreterId,
      portalInterpreterName: latest.portalInterpreterName,
      confidence: latest.confidence,
      escalated: latest.escalated,
    })
    .from(submissions)
    .innerJoin(interpreters, eq(submissions.interpreterId, interpreters.id))
    .leftJoin(latest, eq(latest.submissionId, submissions.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(f.order === "oldest" ? asc(uploaded) : desc(uploaded), f.order === "oldest" ? asc(submissions.id) : desc(submissions.id))
    .$dynamic();
  if (f.limit) query = query.limit(f.limit);
  if (f.offset) query = query.offset(f.offset);

  const rows = await query;
  return rows.map(({ driveCreatedAt, detectedAt, ...r }) => ({
    ...r,
    uploadedAt: driveCreatedAt ?? detectedAt,
    escalated: r.escalated ?? false,
  }));
}

export async function countSubmissions(db: AnyDb, statuses: SubmissionStatus[]): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(inArray(submissions.status, statuses));
  return row?.n ?? 0;
}

function toDeliveryInput(s: SubmissionView): DeliveryInput {
  return { interpreterId: s.interpreterId, status: s.status, periodStart: s.periodStart, periodEnd: s.periodEnd, uploadedAt: s.uploadedAt };
}

/** Mes como "AAAA-MM" → primer y último día. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export type DeliveriesReport = {
  rule: DeliveryRule;
  today: string;
  days: string[];
  people: InterpreterRow[];
  grid: Map<number, Map<string, DayStatus>>;
};

/** Tabla intérprete × día del mes, con el estado de cada día. */
export async function deliveriesReport(db: AnyDb, month: string, now = new Date()): Promise<DeliveriesReport> {
  const rule = await loadRule(db);
  const today = localDate(now, rule.timezone);
  const { from, to } = monthBounds(month);
  const people = await loadInterpreters(db, { activeOnly: true });
  const subs = await loadSubmissions(db, { from, to });
  const days = dateRange(from, to);
  const grid = deliveryGrid(rule, people.map(toLite), subs.map(toDeliveryInput), days, now);
  return { rule, today, days, people, grid };
}

export type LateRow = {
  interpreter: InterpreterRow;
  daysBehind: number;
  behindSince: string | null;
  lastDelivery: string | null;
  month: Record<DayStatus, number>;
  /** Días del mes en falta o atrasados, para el historial. */
  incidents: { date: string; status: "falta" | "atrasado" }[];
};

/** Vista de atrasos: racha actual de días en falta y resumen del mes. */
export async function lateReport(db: AnyDb, month: string, now = new Date()): Promise<{ rule: DeliveryRule; today: string; rows: LateRow[] }> {
  const rule = await loadRule(db);
  const today = localDate(now, rule.timezone);
  const { from, to } = monthBounds(month);
  const lookbackFrom = addDays(today, -120) < from ? addDays(today, -120) : from;
  const people = await loadInterpreters(db, { activeOnly: true });
  const subs = await loadSubmissions(db, { from: lookbackFrom, to: to > today ? to : today });
  const inputs = subs.map(toDeliveryInput);
  const monthDays = dateRange(from, to < today ? to : today);
  const grid = deliveryGrid(rule, people.map(toLite), inputs, monthDays, now);

  const rows = people.map((p): LateRow => {
    const own = inputs.filter((d) => d.interpreterId === p.id);
    const behind = daysBehind(rule, toLite(p), own, now);
    const counts: Record<DayStatus, number> = { entregado: 0, atrasado: 0, falta: 0, en_revision: 0, pendiente: 0, no_exigido: 0 };
    const incidents: LateRow["incidents"] = [];
    for (const [date, status] of grid.get(p.id) ?? []) {
      counts[status] += 1;
      if (status === "falta" || status === "atrasado") incidents.push({ date, status });
    }
    const accepted = subs.filter((s) => s.interpreterId === p.id && ACCEPTED.includes(s.status) && s.periodEnd);
    const lastDelivery = accepted.reduce<string | null>((max, s) => (max === null || s.periodEnd! > max ? s.periodEnd! : max), null);
    return { interpreter: p, daysBehind: behind.days, behindSince: behind.since, lastDelivery, month: counts, incidents };
  });
  rows.sort((a, b) => b.daysBehind - a.daysBehind || b.month.falta - a.month.falta || a.interpreter.code.localeCompare(b.interpreter.code));
  return { rule, today, rows };
}

export type Grouping = "dia" | "semana" | "mes";

/** Clave del grupo al que pertenece una fecha: el día, el lunes de su semana o el mes. */
export function groupKey(date: string, grouping: Grouping): string {
  if (grouping === "mes") return date.slice(0, 7);
  if (grouping === "semana") {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return addDays(date, -((weekday + 6) % 7));
  }
  return date;
}

export type MinutesRankingRow = { interpreter: InterpreterRow; minutes: number; calls: number; deliveries: number };

export type MinutesReport = {
  from: string;
  to: string;
  grouping: Grouping;
  total: { minutes: number; calls: number; deliveries: number };
  inReview: { minutes: number; deliveries: number };
  ranking: MinutesRankingRow[];
  /** Totales del equipo por periodo, ordenados. */
  periods: { key: string; minutes: number; calls: number }[];
  /** Minutos por intérprete y periodo (para el Excel). */
  pivot: Map<number, Map<string, number>>;
};

/**
 * Minutos del equipo entre dos fechas. Solo cuentan lecturas read o confirmed; lo que está en revisión se muestra aparte.
 * Un screenshot que cubre varios días se cuenta en la fecha final de su rango (no se puede repartir por día).
 */
export async function minutesReport(db: AnyDb, from: string, to: string, grouping: Grouping): Promise<MinutesReport> {
  const people = await loadInterpreters(db);
  const subs = (await loadSubmissions(db, { from, to })).filter((s) => s.periodEnd && s.periodEnd >= from && s.periodEnd <= to);
  const accepted = subs.filter((s) => ACCEPTED.includes(s.status) && s.minutes !== null);
  const review = subs.filter((s) => s.status === "needs_review");

  const byPerson = new Map<number, MinutesRankingRow>();
  const byPeriod = new Map<string, { key: string; minutes: number; calls: number }>();
  const pivot = new Map<number, Map<string, number>>();
  for (const s of accepted) {
    const person = people.find((p) => p.id === s.interpreterId)!;
    const row = byPerson.get(person.id) ?? { interpreter: person, minutes: 0, calls: 0, deliveries: 0 };
    row.minutes += s.minutes!;
    row.calls += s.calls ?? 0;
    row.deliveries += 1;
    byPerson.set(person.id, row);

    const key = groupKey(s.periodEnd!, grouping);
    const period = byPeriod.get(key) ?? { key, minutes: 0, calls: 0 };
    period.minutes += s.minutes!;
    period.calls += s.calls ?? 0;
    byPeriod.set(key, period);

    const cells = pivot.get(person.id) ?? new Map<string, number>();
    cells.set(key, (cells.get(key) ?? 0) + s.minutes!);
    pivot.set(person.id, cells);
  }

  const ranking = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes || a.interpreter.code.localeCompare(b.interpreter.code));
  return {
    from,
    to,
    grouping,
    total: {
      minutes: ranking.reduce((n, r) => n + r.minutes, 0),
      calls: ranking.reduce((n, r) => n + r.calls, 0),
      deliveries: accepted.length,
    },
    inReview: { minutes: review.reduce((n, s) => n + (s.minutes ?? 0), 0), deliveries: review.length },
    ranking,
    periods: [...byPeriod.values()].sort((a, b) => a.key.localeCompare(b.key)),
    pivot,
  };
}
