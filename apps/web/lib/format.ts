import { addDays, localDate } from "@dgm/core/deliveries";
import type { Grouping } from "./data";

const LOCALE = "es-BO";

const asDate = (d: string) => new Date(`${d}T12:00:00Z`);

/** "lun 12 oct" */
export function shortDate(d: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(asDate(d));
}

/** "12 oct 2026" */
export function mediumDate(d: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(asDate(d));
}

/** "Octubre de 2026" */
export function monthName(month: string): string {
  const s = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(asDate(`${month}-15`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fecha y hora local: "12 oct 2026, 18:05" */
export function dateTime(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(instant);
}

export function range(start: string | null, end: string | null): string {
  if (!start || !end) return "Sin fechas";
  return start === end ? mediumDate(start) : `${mediumDate(start)} – ${mediumDate(end)}`;
}

export function number(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

export function periodLabel(key: string, grouping: Grouping): string {
  if (grouping === "mes") return monthName(key);
  if (grouping === "semana") return `Semana del ${mediumDate(key)}`;
  return shortDate(key);
}

export function currentMonth(timezone: string, now = new Date()): string {
  return localDate(now, timezone).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseMonth(value: string | null | undefined, timezone: string): string {
  return value && MONTH.test(value) ? value : currentMonth(timezone);
}

export function parseDay(value: string | null | undefined, fallback: string): string {
  return value && DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

export function parseGrouping(value: string | null | undefined): Grouping {
  return value === "semana" || value === "mes" ? value : "dia";
}

/** Por defecto, la vista de minutos muestra del 1 del mes a hoy. */
export function defaultMinutesRange(timezone: string, now = new Date()): { from: string; to: string } {
  const today = localDate(now, timezone);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function driveLink(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export { addDays };
