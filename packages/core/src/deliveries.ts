/**
 * Cálculo de entregas y atrasos (ver CLAUDE.md, "Entregas y atrasos").
 * La regla define periodos (día, semana o quincena); cada periodo tiene una hora límite.
 * Funciones puras: reciben los datos ya cargados y devuelven el estado de cada intérprete por periodo.
 */

export type Frequency = "daily" | "weekly" | "semimonthly";

export type DeliveryRule = {
  frequency: Frequency;
  /** "HH:MM" o "HH:MM:SS", hora local de la regla. */
  deadlineTime: string;
  /** Días después del fin del periodo para entregar (0 = el mismo día). */
  deadlineOffsetDays: number;
  timezone: string;
  /** 0 = domingo … 6 = sábado. Solo para la regla diaria. */
  requiredWeekdays: number[];
  /** Solo para la regla diaria. */
  holidays: string[];
};

/** Una entrega con sus valores vigentes (última lectura o corrección). */
export type DeliveryInput = {
  interpreterId: number | null;
  status: "pending" | "read" | "needs_review" | "confirmed" | "rejected" | "duplicate";
  periodStart: string | null;
  periodEnd: string | null;
  /** Momento en que se subió a Drive (o, si falta, cuando el worker la detectó). */
  uploadedAt: Date;
};

export type Period = {
  /** Identificador estable: "2026-10-07" (día), "2026-10-05" (semana, su lunes) o "2026-10-1" / "2026-10-2" (quincena). */
  key: string;
  kind: "day" | "week" | "half";
  start: string;
  end: string;
  deadline: Date;
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

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
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

/** Hora límite de un periodo: su último día + los días de gracia, a la hora de la regla, en su zona horaria. */
export function deadlineFor(rule: DeliveryRule, periodEnd: string): Date {
  return zonedToUtc(addDays(periodEnd, rule.deadlineOffsetDays), rule.deadlineTime, rule.timezone);
}

function makePeriod(rule: DeliveryRule, key: string, kind: Period["kind"], start: string, end: string): Period {
  return { key, kind, start, end, deadline: deadlineFor(rule, end) };
}

/** Periodos exigidos por la regla que se cruzan con [from, to], en orden. */
export function periodsBetween(rule: DeliveryRule, from: string, to: string): Period[] {
  const out: Period[] = [];
  if (rule.frequency === "daily") {
    for (const d of dateRange(from, to)) if (isRequiredDay(rule, d)) out.push(makePeriod(rule, d, "day", d, d));
  } else if (rule.frequency === "weekly") {
    let monday = addDays(from, -((weekdayOf(from) + 6) % 7));
    for (; monday <= to; monday = addDays(monday, 7)) out.push(makePeriod(rule, monday, "week", monday, addDays(monday, 6)));
  } else {
    for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = addDays(lastDayOfMonth(month), 1).slice(0, 7)) {
      const halves: [string, string, string][] = [
        [`${month}-1`, `${month}-01`, `${month}-15`],
        [`${month}-2`, `${month}-16`, lastDayOfMonth(month)],
      ];
      for (const [key, start, end] of halves) if (end >= from && start <= to) out.push(makePeriod(rule, key, "half", start, end));
    }
  }
  return out;
}

/**
 * Una entrega cubre un periodo si su rango (Start Date – End Date) lo abarca entero.
 * Con la regla quincenal, el acumulado del mes "1–15" cubre la 1ª quincena y "1–31" cubre las dos.
 */
export function covers(s: Pick<DeliveryInput, "periodStart" | "periodEnd">, p: Pick<Period, "start" | "end">): boolean {
  return s.periodStart !== null && s.periodEnd !== null && s.periodStart <= p.start && s.periodEnd >= p.end;
}

/**
 * Estado de un intérprete en un periodo:
 * - entregado: una entrega aceptada (read/confirmed) lo cubre y se subió antes de la hora límite.
 * - atrasado: la entrega aceptada llegó después de la hora límite.
 * - en_revision: lo único que lo cubre está en revisión.
 * - falta: no hay nada y la hora límite ya pasó.
 * - pendiente: no hay nada pero todavía está a tiempo.
 */
export function periodStatus(period: Period, own: DeliveryInput[], now: Date): DayStatus {
  const covering = own.filter((s) => covers(s, period));
  const accepted = covering.filter((s) => s.status === "read" || s.status === "confirmed");
  if (accepted.length > 0) {
    return accepted.some((s) => s.uploadedAt.getTime() <= period.deadline.getTime()) ? "entregado" : "atrasado";
  }
  if (covering.some((s) => s.status === "needs_review")) return "en_revision";
  return now.getTime() > period.deadline.getTime() ? "falta" : "pendiente";
}

export type InterpreterLite = { id: number; startDate: string | null; createdAt: Date };

/** Primer día que se le exige a un intérprete: su fecha de inicio o, si no tiene, el día en que se registró. */
export function firstRequiredDate(i: InterpreterLite, timezone: string): string {
  return i.startDate ?? localDate(i.createdAt, timezone);
}

/** Matriz intérprete × periodo con el estado de cada uno. Un periodo que termina antes del inicio del intérprete: no_exigido. */
export function deliveryGrid(
  rule: DeliveryRule,
  people: InterpreterLite[],
  deliveries: DeliveryInput[],
  periods: Period[],
  now: Date,
): Map<number, Map<string, DayStatus>> {
  const grid = new Map<number, Map<string, DayStatus>>();
  for (const person of people) {
    const own = deliveries.filter((d) => d.interpreterId === person.id);
    const start = firstRequiredDate(person, rule.timezone);
    const row = new Map<string, DayStatus>();
    for (const p of periods) row.set(p.key, p.end < start ? "no_exigido" : periodStatus(p, own, now));
    grid.set(person.id, row);
  }
  return grid;
}

/**
 * Periodos de atraso: periodos exigidos consecutivos, contando hacia atrás desde hoy, en estado "falta".
 * El periodo en curso que aún está a tiempo no corta la racha ni suma.
 */
export function periodsBehind(
  rule: DeliveryRule,
  person: InterpreterLite,
  own: DeliveryInput[],
  now: Date,
  lookbackDays = 120,
): { count: number; since: string | null } {
  const today = localDate(now, rule.timezone);
  const start = firstRequiredDate(person, rule.timezone);
  const from = addDays(today, -lookbackDays) > start ? addDays(today, -lookbackDays) : start;
  const periods = periodsBetween(rule, from, today).filter((p) => p.end >= start).reverse();
  let count = 0;
  let since: string | null = null;
  for (const p of periods) {
    const status = periodStatus(p, own, now);
    if (status === "pendiente") continue;
    if (status !== "falta") break;
    count += 1;
    since = p.start;
  }
  return { count, since };
}
