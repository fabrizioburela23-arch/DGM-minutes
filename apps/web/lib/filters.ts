import type { DeliveryRule } from "@dgm/core/deliveries";
import { groupingsFor, type SubmissionStatus } from "./data";
import { defaultMinutesRange, parseDay, parseGrouping, parseMonth, shiftMonth } from "./format";

/** Lo que llega en la URL (?mes=…&desde=…), como lo entregan las páginas o URLSearchParams. */
export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function monthFilter(params: RawParams, timezone: string) {
  return { month: parseMonth(get(params, "mes"), timezone) };
}

export function minutesFilter(params: RawParams, rule: DeliveryRule, now = new Date()) {
  const def = defaultMinutesRange(rule.timezone, now);
  // Con reportes quincenales, por defecto se ven los últimos 3 meses.
  if (rule.frequency === "semimonthly") def.from = `${shiftMonth(def.from.slice(0, 7), -2)}-01`;
  let from = parseDay(get(params, "desde"), def.from);
  let to = parseDay(get(params, "hasta"), def.to);
  if (to < from) [from, to] = [to, from];
  return { from, to, grouping: parseGrouping(get(params, "agrupar"), groupingsFor(rule)) };
}

const STATUSES: SubmissionStatus[] = ["pending", "read", "needs_review", "confirmed", "rejected", "duplicate"];

export function screenshotsFilter(params: RawParams) {
  const rawInterpreter = get(params, "interprete");
  const interpreter = Number(rawInterpreter);
  const status = get(params, "estado") as SubmissionStatus | undefined;
  const from = get(params, "desde");
  const to = get(params, "hasta");
  const page = Math.max(1, Math.floor(Number(get(params, "pagina")) || 1));
  return {
    interpreterId: rawInterpreter === "sin" ? ("none" as const) : Number.isInteger(interpreter) && interpreter > 0 ? interpreter : undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    from: from ? parseDay(from, "") || undefined : undefined,
    to: to ? parseDay(to, "") || undefined : undefined,
    page,
  };
}

/** Convierte los filtros activos en el query string para enlaces (Excel, paginación). */
export function toQuery(params: RawParams, overrides: Record<string, string | undefined> = {}): string {
  const out = new URLSearchParams();
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as const);
  for (const [k, v] of entries) if (v) out.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") out.delete(k);
    else out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}
