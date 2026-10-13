import type { ScreenshotReading } from "./reader";

export type PriorReading = { periodStart: string; periodEnd: string; minutes: number };

export type ValidationContext = {
  /** Hoy, en la zona horaria de la regla (AAAA-MM-DD). */
  today: string;
  ruleFrequency: "daily" | "weekly";
  maxMinutesPerDay: number;
  confidenceThreshold: number;
  /** ID de Propio cargado para el intérprete, si existe. */
  expectedPortalId: string | null;
  /** Lecturas ya aceptadas de este intérprete (read o confirmed), para detectar doble conteo y valores raros. */
  prior: PriorReading[];
  /** Días de antigüedad máxima del rango. */
  maxAgeDays?: number;
};

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function daysInRange(start: string, end: string): number {
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hoy en una zona horaria, como AAAA-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Reglas del CLAUDE.md. Devuelve los motivos en español; una lista vacía significa que la lectura es aceptable.
 * Ninguna regla corrige datos: solo señala.
 */
export function validateReading(r: ScreenshotReading, ctx: ValidationContext): string[] {
  const reasons: string[] = [];
  const maxAge = ctx.maxAgeDays ?? 14;

  if (!r.legible) reasons.push("La IA indica que el screenshot no es legible o no es del portal de Propio");
  if (r.confidence < ctx.confidenceThreshold) {
    reasons.push(`Confianza baja (${r.confidence.toFixed(2)} < ${ctx.confidenceThreshold})`);
  }

  const hasRange = r.periodStart !== null && r.periodEnd !== null;
  if (!hasRange) reasons.push("No se pudo leer el rango de fechas (Start Date / End Date)");

  let days = 1;
  if (hasRange) {
    const start = r.periodStart!;
    const end = r.periodEnd!;
    if (toUtc(end) < toUtc(start)) reasons.push("La fecha final es anterior a la inicial");
    days = Math.max(1, daysInRange(start, end));
    if (toUtc(end) > toUtc(ctx.today) || toUtc(start) > toUtc(ctx.today)) reasons.push("El rango incluye fechas futuras");
    const ageDays = Math.round((toUtc(ctx.today) - toUtc(end)) / DAY_MS);
    if (ageDays > maxAge) reasons.push(`El rango terminó hace ${ageDays} días (máximo ${maxAge})`);
    if (ctx.ruleFrequency === "daily" && days > 1) reasons.push(`El screenshot cubre ${days} días; la regla de entrega es diaria`);
    if (ctx.ruleFrequency === "weekly" && days > 7) reasons.push(`El screenshot cubre ${days} días; la regla de entrega es semanal`);

    const overlapping = ctx.prior.filter((p) => toUtc(p.periodStart) <= toUtc(end) && toUtc(start) <= toUtc(p.periodEnd));
    if (overlapping.length > 0) reasons.push("El rango se superpone con otra entrega ya registrada (posible doble conteo)");
  }

  if (r.minutes === null) {
    reasons.push("No se pudieron leer los minutos");
  } else if (r.minutes < 0) {
    reasons.push("Minutos negativos");
  } else if (r.minutes > ctx.maxMinutesPerDay * days) {
    reasons.push(`Minutos (${r.minutes}) por encima del máximo para ${days} día(s)`);
  }

  if (r.calls === null) reasons.push("No se pudo leer el número de llamadas");

  if (ctx.expectedPortalId && r.portalInterpreterId !== ctx.expectedPortalId) {
    reasons.push("El ID de Propio del screenshot no coincide con el del intérprete");
  }

  // Valor atípico: más de 3 veces la mediana diaria de las últimas 30 lecturas-día (mínimo 5 para comparar).
  if (r.minutes !== null && hasRange) {
    const cutoff = toUtc(ctx.today) - 30 * DAY_MS;
    const perDay = ctx.prior
      .filter((p) => toUtc(p.periodEnd) >= cutoff)
      .map((p) => p.minutes / Math.max(1, daysInRange(p.periodStart, p.periodEnd)));
    if (perDay.length >= 5) {
      const m = median(perDay);
      if (m > 0 && r.minutes / days > 3 * m) reasons.push("Minutos por día más de 3 veces la mediana del intérprete en 30 días");
    }
  }

  return reasons;
}
