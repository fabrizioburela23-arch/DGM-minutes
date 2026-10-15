import { addDays, localDate, type Period } from "@dgm/core/deliveries";
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

const MONTH_SHORT = (month: string) =>
  new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" }).format(asDate(`${month}-15`)).replace(".", "");

/** Etiqueta de un grupo de minutos: día, semana ("Semana del 12 oct 2026"), quincena ("1ª quincena · oct 2026") o mes. */
export function periodLabel(key: string, grouping: Grouping): string {
  if (grouping === "mes") return monthName(key);
  if (grouping === "semana") return `Semana del ${mediumDate(key)}`;
  if (grouping === "quincena") return `${key.endsWith("-1") ? "1ª" : "2ª"} quincena · ${MONTH_SHORT(key.slice(0, 7))}`;
  return shortDate(key);
}

/** Encabezado corto de una columna de Entregas: "lun 12", "sem 12 oct", "1ª oct". */
export function periodShort(p: Period): { top: string; bottom: string } {
  if (p.kind === "half") return { top: p.key.endsWith("-1") ? "1ª" : "2ª", bottom: MONTH_SHORT(p.start.slice(0, 7)) };
  if (p.kind === "week") return { top: "sem", bottom: shortDate(p.start).replace(/^\S+\s/, "") };
  return { top: shortDate(p.start).split(" ")[0].replace(",", "").replace(".", ""), bottom: String(Number(p.start.slice(8))) };
}

/** Nombre completo de un periodo: "1ª quincena de oct 2026 (1–15)", "lun 12 oct", "semana del 12 oct 2026". */
export function periodName(p: Period): string {
  if (p.kind === "half") return `${p.key.endsWith("-1") ? "1ª" : "2ª"} quincena de ${MONTH_SHORT(p.start.slice(0, 7))} (${Number(p.start.slice(8))}–${Number(p.end.slice(8))})`;
  if (p.kind === "week") return `semana del ${mediumDate(p.start)}`;
  return shortDate(p.start);
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

export function parseGrouping(value: string | null | undefined, allowed: Grouping[]): Grouping {
  return allowed.includes(value as Grouping) ? (value as Grouping) : allowed[0];
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

/** "3 quincenas" / "1 día" según la regla. */
export function periodUnit(frequency: "daily" | "weekly" | "semimonthly", n: number): string {
  const [one, many] = frequency === "semimonthly" ? ["quincena", "quincenas"] : frequency === "weekly" ? ["semana", "semanas"] : ["día", "días"];
  return n === 1 ? one : many;
}
