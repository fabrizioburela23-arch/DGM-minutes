import {
  addDays,
  deliveryGrid,
  lastDayOfMonth,
  localDate,
  periodsBehind,
  periodsBetween,
  type DayStatus,
  type DeliveryInput,
  type DeliveryRule,
  type InterpreterLite,
  type Period,
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
  isNull,
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
  frequency: "semimonthly",
  deadlineTime: "23:59:00",
  deadlineOffsetDays: 1,
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
    deadlineOffsetDays: rule.deadlineOffsetDays,
    timezone: rule.timezone,
    requiredWeekdays: rule.requiredWeekdays,
    holidays: rule.holidays,
  };
}

export type InterpreterRow = typeof interpreters.$inferSelect;

export async function loadInterpreters(db: AnyDb, opts: { activeOnly?: boolean } = {}): Promise<InterpreterRow[]> {
  const q = db.select().from(interpreters);
  const rows = opts.activeOnly ? await q.where(eq(interpreters.active, true)) : await q;
  return rows.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "") || a.fullName.localeCompare(b.fullName));
}

export function toLite(i: InterpreterRow): InterpreterLite {
  return { id: i.id, startDate: i.startDate, createdAt: i.createdAt };
}

/** Una entrega con los valores vigentes: la última lectura guardada (de la IA o la corrección de un gerente). */
export type SubmissionView = {
  id: number;
  interpreterId: number | null;
  interpreterCode: string | null;
  interpreterName: string | null;
  expectedPortalId: string | null;
  uploaderName: string | null;
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
  /** Un intérprete, o "none" para los screenshots que aún no tienen dueño. */
  interpreterId?: number | "none";
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
  if (f.interpreterId === "none") conditions.push(isNull(submissions.interpreterId));
  else if (f.interpreterId) conditions.push(eq(submissions.interpreterId, f.interpreterId));
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
      uploaderName: submissions.uploaderName,
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
    .leftJoin(interpreters, eq(submissions.interpreterId, interpreters.id))
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
  return { from: `${month}-01`, to: lastDayOfMonth(month) };
}

function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Meses que muestra la tabla de Entregas: con quincenas caben 6 meses; con días, uno. */
export function deliveriesSpan(rule: DeliveryRule): number {
  return rule.frequency === "semimonthly" ? 6 : rule.frequency === "weekly" ? 3 : 1;
}

export type DeliveriesReport = {
  rule: DeliveryRule;
  today: string;
  periods: Period[];
  people: InterpreterRow[];
  grid: Map<number, Map<string, DayStatus>>;
};

/** Tabla intérprete × periodo (días, semanas o quincenas) hasta el mes elegido, con el estado de cada uno. */
export async function deliveriesReport(db: AnyDb, month: string, now = new Date()): Promise<DeliveriesReport> {
  const rule = await loadRule(db);
  const today = localDate(now, rule.timezone);
  const from = `${shiftMonthKey(month, 1 - deliveriesSpan(rule))}-01`;
  const to = lastDayOfMonth(month);
  const people = await loadInterpreters(db, { activeOnly: true });
  const subs = await loadSubmissions(db, { from, to });
  const periods = periodsBetween(rule, from, to);
  const grid = deliveryGrid(rule, people.map(toLite), subs.map(toDeliveryInput), periods, now);
  return { rule, today, periods, people, grid };
}

export type LateRow = {
  interpreter: InterpreterRow;
  /** Periodos seguidos sin entregar hasta hoy (días o quincenas según la regla). */
  behind: number;
  behindSince: string | null;
  lastDelivery: string | null;
  month: Record<DayStatus, number>;
  /** Periodos del mes en falta o atrasados, para el historial. */
  incidents: { period: Period; status: "falta" | "atrasado" }[];
};

/** Vista de atrasos: racha actual de periodos en falta y resumen del mes. */
export async function lateReport(db: AnyDb, month: string, now = new Date()): Promise<{ rule: DeliveryRule; today: string; rows: LateRow[] }> {
  const rule = await loadRule(db);
  const today = localDate(now, rule.timezone);
  const { from, to } = monthBounds(month);
  const lookbackFrom = addDays(today, -120) < from ? addDays(today, -120) : from;
  const people = await loadInterpreters(db, { activeOnly: true });
  const subs = await loadSubmissions(db, { from: lookbackFrom, to: to > today ? to : today });
  const inputs = subs.map(toDeliveryInput);
  const monthPeriods = periodsBetween(rule, from, to).filter((p) => p.start <= today);
  const grid = deliveryGrid(rule, people.map(toLite), inputs, monthPeriods, now);

  const rows = people.map((p): LateRow => {
    const own = inputs.filter((d) => d.interpreterId === p.id);
    const behind = periodsBehind(rule, toLite(p), own, now);
    const counts: Record<DayStatus, number> = { entregado: 0, atrasado: 0, falta: 0, en_revision: 0, pendiente: 0, no_exigido: 0 };
    const incidents: LateRow["incidents"] = [];
    for (const period of monthPeriods) {
      const status = grid.get(p.id)!.get(period.key)!;
      counts[status] += 1;
      if (status === "falta" || status === "atrasado") incidents.push({ period, status });
    }
    const accepted = subs.filter((s) => s.interpreterId === p.id && ACCEPTED.includes(s.status) && s.periodEnd);
    const lastDelivery = accepted.reduce<string | null>((max, s) => (max === null || s.periodEnd! > max ? s.periodEnd! : max), null);
    return { interpreter: p, behind: behind.count, behindSince: behind.since, lastDelivery, month: counts, incidents };
  });
  rows.sort((a, b) => b.behind - a.behind || b.month.falta - a.month.falta || a.interpreter.fullName.localeCompare(b.interpreter.fullName));
  return { rule, today, rows };
}

export type Grouping = "dia" | "semana" | "quincena" | "mes";

/** Agrupaciones que tienen sentido según la regla: con acumulados quincenales no se puede bajar a días. */
export function groupingsFor(rule: DeliveryRule): Grouping[] {
  return rule.frequency === "semimonthly" ? ["quincena", "mes"] : ["dia", "semana", "mes"];
}

export const GROUPING_LABEL: Record<Grouping, string> = { dia: "Día", semana: "Semana", quincena: "Quincena", mes: "Mes" };

/** Clave del grupo al que pertenece una fecha: el día, el lunes de su semana, su quincena o el mes. */
export function groupKey(date: string, grouping: Grouping): string {
  if (grouping === "mes") return date.slice(0, 7);
  if (grouping === "quincena") return `${date.slice(0, 7)}-${Number(date.slice(8)) <= 15 ? 1 : 2}`;
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
  cumulative: boolean;
  total: { minutes: number; calls: number; deliveries: number };
  /** En la regla quincenal los minutos de lo que está en revisión no se suman (serían acumulados repetidos): solo se cuentan. */
  inReview: { minutes: number | null; deliveries: number };
  unidentified: number;
  ranking: MinutesRankingRow[];
  /** Totales del equipo por periodo, ordenados. */
  periods: { key: string; minutes: number; calls: number }[];
  /** Minutos por intérprete y periodo (para el Excel). */
  pivot: Map<number, Map<string, number>>;
};

type Bucket = { minutes: number; calls: number };

/**
 * Valores por intérprete y periodo a partir de reportes acumulados del mes:
 * el total del mes es el acumulado con la fecha final más tardía; la 1ª quincena es el acumulado que cierra
 * más cerca del día 15 (entre el 15 y el 20). 2ª quincena = total − 1ª. Si solo hay total, va entero a la 2ª.
 */
function cumulativeBuckets(subs: SubmissionView[], grouping: Grouping): Map<number, Map<string, Bucket>> {
  const byPersonMonth = new Map<string, SubmissionView[]>();
  for (const s of subs) {
    if (!s.periodStart || !s.periodEnd || s.periodStart.slice(8) !== "01" || s.periodStart.slice(0, 7) !== s.periodEnd.slice(0, 7)) continue;
    const k = `${s.interpreterId}|${s.periodEnd.slice(0, 7)}`;
    byPersonMonth.set(k, [...(byPersonMonth.get(k) ?? []), s]);
  }
  const out = new Map<number, Map<string, Bucket>>();
  for (const [k, list] of byPersonMonth) {
    const [idText, month] = k.split("|");
    const id = Number(idText);
    const latestFirst = [...list].sort((a, b) => b.periodEnd!.localeCompare(a.periodEnd!) || b.uploadedAt.getTime() - a.uploadedAt.getTime());
    const total = latestFirst[0];
    const mid = [...list]
      .filter((s) => Number(s.periodEnd!.slice(8)) >= 15 && Number(s.periodEnd!.slice(8)) <= 20 && s.id !== total.id)
      .sort((a, b) => a.periodEnd!.localeCompare(b.periodEnd!) || b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
    const cells = out.get(id) ?? new Map<string, Bucket>();
    const add = (key: string, minutes: number, calls: number) => {
      const c = cells.get(key) ?? { minutes: 0, calls: 0 };
      c.minutes += minutes;
      c.calls += calls;
      cells.set(key, c);
    };
    if (grouping === "mes") {
      add(month, total.minutes!, total.calls ?? 0);
    } else if (mid) {
      add(`${month}-1`, mid.minutes!, mid.calls ?? 0);
      add(`${month}-2`, Math.max(0, total.minutes! - mid.minutes!), Math.max(0, (total.calls ?? 0) - (mid.calls ?? 0)));
    } else if (Number(total.periodEnd!.slice(8)) <= 20) {
      add(`${month}-1`, total.minutes!, total.calls ?? 0);
    } else {
      add(`${month}-2`, total.minutes!, total.calls ?? 0);
    }
    out.set(id, cells);
  }
  return out;
}

/** Valores por intérprete y periodo sumando cada screenshot en la fecha final de su rango (reglas diaria y semanal). */
function summedBuckets(subs: SubmissionView[], grouping: Grouping): Map<number, Map<string, Bucket>> {
  const out = new Map<number, Map<string, Bucket>>();
  for (const s of subs) {
    if (!s.periodEnd) continue;
    const cells = out.get(s.interpreterId!) ?? new Map<string, Bucket>();
    const key = groupKey(s.periodEnd, grouping);
    const c = cells.get(key) ?? { minutes: 0, calls: 0 };
    c.minutes += s.minutes!;
    c.calls += s.calls ?? 0;
    cells.set(key, c);
    out.set(s.interpreterId!, cells);
  }
  return out;
}

/**
 * Minutos del equipo entre dos fechas. Solo cuentan lecturas read o confirmed; lo que está en revisión se muestra aparte.
 * Regla quincenal: los screenshots son acumulados del mes y nunca se suman entre sí (ver cumulativeBuckets).
 * Otras reglas: cada screenshot se cuenta en la fecha final de su rango.
 */
export async function minutesReport(db: AnyDb, from: string, to: string, grouping: Grouping, rule?: DeliveryRule): Promise<MinutesReport> {
  const activeRule = rule ?? (await loadRule(db));
  const cumulative = activeRule.frequency === "semimonthly";
  const people = await loadInterpreters(db);
  const subs = (await loadSubmissions(db, { from, to })).filter((s) => s.periodEnd && s.periodEnd >= from && s.periodEnd <= to);
  const isMonthToDate = (s: SubmissionView) =>
    s.periodStart !== null && s.periodEnd !== null && s.periodStart.slice(8) === "01" && s.periodStart.slice(0, 7) === s.periodEnd.slice(0, 7);
  // Con la regla quincenal solo valen los acumulados del mes (Start Date = 1); el resto queda fuera de los totales.
  const accepted = subs.filter(
    (s) => ACCEPTED.includes(s.status) && s.minutes !== null && s.interpreterId !== null && (!cumulative || isMonthToDate(s)),
  );
  const review = subs.filter((s) => s.status === "needs_review");

  const pivotBuckets = cumulative ? cumulativeBuckets(accepted, grouping) : summedBuckets(accepted, grouping);
  const byPeriod = new Map<string, { key: string; minutes: number; calls: number }>();
  const pivot = new Map<number, Map<string, number>>();
  const ranking: MinutesRankingRow[] = [];
  for (const [id, cells] of pivotBuckets) {
    const person = people.find((p) => p.id === id);
    if (!person) continue;
    const row: MinutesRankingRow = { interpreter: person, minutes: 0, calls: 0, deliveries: accepted.filter((s) => s.interpreterId === id).length };
    const mins = new Map<string, number>();
    for (const [key, b] of cells) {
      row.minutes += b.minutes;
      row.calls += b.calls;
      mins.set(key, b.minutes);
      const period = byPeriod.get(key) ?? { key, minutes: 0, calls: 0 };
      period.minutes += b.minutes;
      period.calls += b.calls;
      byPeriod.set(key, period);
    }
    pivot.set(id, mins);
    ranking.push(row);
  }
  ranking.sort((a, b) => b.minutes - a.minutes || a.interpreter.fullName.localeCompare(b.interpreter.fullName));

  return {
    from,
    to,
    grouping,
    cumulative,
    total: {
      minutes: ranking.reduce((n, r) => n + r.minutes, 0),
      calls: ranking.reduce((n, r) => n + r.calls, 0),
      deliveries: accepted.length,
    },
    inReview: { minutes: cumulative ? null : review.reduce((n, s) => n + (s.minutes ?? 0), 0), deliveries: review.length },
    unidentified: subs.filter((s) => s.interpreterId === null && s.status !== "rejected").length,
    ranking,
    periods: [...byPeriod.values()].sort((a, b) => a.key.localeCompare(b.key)),
    pivot,
  };
}
