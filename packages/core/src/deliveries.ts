/**
 * Cálculo de entregas y atrasos (ver CLAUDE.md, "Entregas y atrasos").
 * Funciones puras: reciben los datos ya cargados y devuelven el estado de cada intérprete por día.
 */

export type DeliveryRule = {
  frequency: "daily" | "weekly";
  /** "HH:MM" o "HH:MM:SS", hora local de la regla. */
  deadlineTime: string;
  timezone: string;
  /** 0 = domingo … 6 = sábado. */
  requiredWeekdays: number[];
  holidays: string[];
};

/** Una entrega con sus valores vigentes (última lectura o corrección). */
export type DeliveryInput = {
  interpreterId: number;
  status: "pending" | "read" | "needs_review" | "confirmed" | "rejected" | "duplicate";
  periodStart: string | null;
  periodEnd: string | null;
  /** Momento en que se subió a Drive (o, si falta, cuando el worker la detectó). */
  uploadedAt: Date;
};

export type DayStatus = "entregado" | "atrasado" | "falta" | "en_revision" | "pendiente" | "no_exigido";

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  entregado: "Entregado",
  atrasado: "Atrasado",
  falta: "Falta",
  en_revision: "En revisión",
  pendiente: "Aún a tiempo",
  no_exigido: "No exigido",
};

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Lista de fechas AAAA-MM-DD entre dos fechas, incluidas. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fecha local (AAAA-MM-DD) de un instante en una zona horaria. */
export function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Diferencia (ms) entre la hora local de la zona y UTC en un instante dado. */
function offsetMs(instant: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante UTC que corresponde a una fecha y hora local en una zona horaria. */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [h = "0", m = "0", s = "0"] = time.split(":");
  const naive = Date.parse(`${date}T00:00:00Z`) + (+h * 3600 + +m * 60 + +s) * 1000;
  const first = naive - offsetMs(new Date(naive), timezone);
  // Segunda pasada por si el cambio de horario cae entre ambos instantes.
  return new Date(naive - offsetMs(new Date(first), timezone));
}

export function isRequiredDay(rule: DeliveryRule, date: string): boolean {
  return rule.requiredWeekdays.includes(weekdayOf(date)) && !rule.holidays.includes(date);
}

/** Hora límite de un día exigido: ese mismo día a la hora de la regla, en su zona horaria. */
export function deadlineFor(rule: DeliveryRule, date: string): Date {
  return zonedToUtc(date, rule.deadlineTime, rule.timezone);
}

const covers = (s: DeliveryInput, date: string) =>
  s.periodStart !== null && s.periodEnd !== null && s.periodStart <= date && date <= s.periodEnd;

/**
 * Estado de un intérprete en un día:
 * - entregado: una entrega aceptada (read/confirmed) cubre el día y se subió antes de la hora límite.
 * - atrasado: la entrega aceptada llegó después de la hora límite.
 * - en_revision: lo único que cubre el día está en revisión.
 * - falta: no hay nada y la hora límite ya pasó.
 * - pendiente: no hay nada pero todavía está a tiempo.
 * - no_exigido: fin de semana, feriado o día no exigido por la regla.
 */
export function dayStatus(rule: DeliveryRule, date: string, own: DeliveryInput[], now: Date): DayStatus {
  if (!isRequiredDay(rule, date)) return "no_exigido";
  const deadline = deadlineFor(rule, date);
  const covering = own.filter((s) => covers(s, date));
  const accepted = covering.filter((s) => s.status === "read" || s.status === "confirmed");
  if (accepted.length > 0) {
    return accepted.some((s) => s.uploadedAt.getTime() <= deadline.getTime()) ? "entregado" : "atrasado";
  }
  if (covering.some((s) => s.status === "needs_review")) return "en_revision";
  return now.getTime() > deadline.getTime() ? "falta" : "pendiente";
}

export type InterpreterLite = { id: number; startDate: string | null; createdAt: Date };

/** Primer día que se le exige a un intérprete: su fecha de inicio o, si no tiene, el día en que se registró. */
export function firstRequiredDate(i: InterpreterLite, timezone: string): string {
  return i.startDate ?? localDate(i.createdAt, timezone);
}

/** Matriz intérprete × día con el estado de cada celda. Antes del inicio del intérprete: no_exigido. */
export function deliveryGrid(
  rule: DeliveryRule,
  people: InterpreterLite[],
  deliveries: DeliveryInput[],
  days: string[],
  now: Date,
): Map<number, Map<string, DayStatus>> {
  const grid = new Map<number, Map<string, DayStatus>>();
  for (const person of people) {
    const own = deliveries.filter((d) => d.interpreterId === person.id);
    const start = firstRequiredDate(person, rule.timezone);
    const row = new Map<string, DayStatus>();
    for (const day of days) row.set(day, day < start ? "no_exigido" : dayStatus(rule, day, own, now));
    grid.set(person.id, row);
  }
  return grid;
}

/**
 * Días de atraso: días exigidos consecutivos, contando hacia atrás desde hoy, en estado "falta".
 * Feriados, días no exigidos y el día de hoy si aún está a tiempo no cortan la racha ni suman.
 */
export function daysBehind(
  rule: DeliveryRule,
  person: InterpreterLite,
  own: DeliveryInput[],
  now: Date,
  maxLookback = 120,
): { days: number; since: string | null } {
  const start = firstRequiredDate(person, rule.timezone);
  let day = localDate(now, rule.timezone);
  let count = 0;
  let since: string | null = null;
  for (let i = 0; i < maxLookback && day >= start; i++, day = addDays(day, -1)) {
    const status = dayStatus(rule, day, own, now);
    if (status === "no_exigido" || status === "pendiente") continue;
    if (status !== "falta") break;
    count += 1;
    since = day;
  }
  return { days: count, since };
}
