import assert from "node:assert/strict";
import {
  dateRange,
  dayStatus,
  daysBehind,
  deadlineFor,
  deliveryGrid,
  localDate,
  zonedToUtc,
  type DeliveryInput,
  type DeliveryRule,
} from "./deliveries";

const rule: DeliveryRule = {
  frequency: "daily",
  deadlineTime: "23:59:00",
  timezone: "America/La_Paz",
  requiredWeekdays: [1, 2, 3, 4, 5],
  holidays: ["2026-10-08"],
};

// La Paz es UTC-4 sin horario de verano
assert.equal(zonedToUtc("2026-10-07", "23:59", "America/La_Paz").toISOString(), "2026-10-08T03:59:00.000Z");
assert.equal(deadlineFor(rule, "2026-10-07").toISOString(), "2026-10-08T03:59:00.000Z");
// Zona con horario de verano (Madrid: UTC+2 en verano, UTC+1 en invierno)
assert.equal(zonedToUtc("2026-07-01", "09:00", "Europe/Madrid").toISOString(), "2026-07-01T07:00:00.000Z");
assert.equal(zonedToUtc("2026-12-01", "09:00", "Europe/Madrid").toISOString(), "2026-12-01T08:00:00.000Z");
assert.equal(localDate(new Date("2026-10-08T02:00:00Z"), "America/La_Paz"), "2026-10-07");
assert.deepEqual(dateRange("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);

const sub = (start: string, end: string, uploaded: string, status: DeliveryInput["status"] = "read"): DeliveryInput => ({
  interpreterId: 1,
  status,
  periodStart: start,
  periodEnd: end,
  uploadedAt: new Date(uploaded),
});

const now = new Date("2026-10-14T15:00:00Z"); // miércoles 14, 11:00 en La Paz
const own = [
  sub("2026-10-05", "2026-10-05", "2026-10-05T22:00:00Z"), // a tiempo
  sub("2026-10-06", "2026-10-06", "2026-10-07T12:00:00Z"), // tarde
  sub("2026-10-07", "2026-10-07", "2026-10-07T22:00:00Z", "needs_review"),
  sub("2026-10-09", "2026-10-09", "2026-10-09T22:00:00Z", "rejected"), // rechazada: no cuenta
];

assert.equal(dayStatus(rule, "2026-10-05", own, now), "entregado");
assert.equal(dayStatus(rule, "2026-10-06", own, now), "atrasado");
assert.equal(dayStatus(rule, "2026-10-07", own, now), "en_revision");
assert.equal(dayStatus(rule, "2026-10-08", own, now), "no_exigido", "feriado");
assert.equal(dayStatus(rule, "2026-10-09", own, now), "falta");
assert.equal(dayStatus(rule, "2026-10-10", own, now), "no_exigido", "sábado");
assert.equal(dayStatus(rule, "2026-10-14", own, now), "pendiente", "hoy, antes de la hora límite");

// Racha: 9 (vie), 12 (lun), 13 (mar) en falta; 14 aún a tiempo; 10–11 fin de semana; 8 feriado; 7 en revisión corta
const person = { id: 1, startDate: null, createdAt: new Date("2026-09-01T12:00:00Z") };
assert.deepEqual(daysBehind(rule, person, own, now), { days: 3, since: "2026-10-09" });

// Un screenshot de varios días cubre todos esos días
const ranged = [sub("2026-10-12", "2026-10-13", "2026-10-13T20:00:00Z")];
assert.equal(dayStatus(rule, "2026-10-12", ranged, now), "atrasado", "el lunes se subió el martes");
assert.equal(dayStatus(rule, "2026-10-13", ranged, now), "entregado");
assert.deepEqual(daysBehind(rule, person, ranged, now), { days: 0, since: null });

// Antes de que el intérprete empiece no se le exige nada
const newcomer = { id: 1, startDate: "2026-10-13", createdAt: new Date("2026-10-13T12:00:00Z") };
const grid = deliveryGrid(rule, [newcomer], [], ["2026-10-12", "2026-10-13"], now);
assert.equal(grid.get(1)?.get("2026-10-12"), "no_exigido");
assert.equal(grid.get(1)?.get("2026-10-13"), "falta");
assert.deepEqual(daysBehind(rule, newcomer, [], now), { days: 1, since: "2026-10-13" });

console.log("[deliveries.test] OK: horas límite, estados por día, rangos y días de atraso");
