import assert from "node:assert/strict";
import {
  dateRange,
  deliveryGrid,
  lastDayOfMonth,
  localDate,
  periodStatus,
  periodsBehind,
  periodsBetween,
  zonedToUtc,
  type DeliveryInput,
  type DeliveryRule,
} from "./deliveries";

// Horas y zonas
assert.equal(zonedToUtc("2026-10-07", "23:59", "America/La_Paz").toISOString(), "2026-10-08T03:59:00.000Z");
assert.equal(zonedToUtc("2026-07-01", "09:00", "Europe/Madrid").toISOString(), "2026-07-01T07:00:00.000Z");
assert.equal(zonedToUtc("2026-12-01", "09:00", "Europe/Madrid").toISOString(), "2026-12-01T08:00:00.000Z");
assert.equal(localDate(new Date("2026-10-08T02:00:00Z"), "America/La_Paz"), "2026-10-07");
assert.deepEqual(dateRange("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
assert.equal(lastDayOfMonth("2026-02"), "2026-02-28");

const sub = (start: string, end: string, uploaded: string, status: DeliveryInput["status"] = "read"): DeliveryInput => ({
  interpreterId: 1,
  status,
  periodStart: start,
  periodEnd: end,
  uploadedAt: new Date(uploaded),
});
const person = { id: 1, startDate: null, createdAt: new Date("2026-08-01T12:00:00Z") };

// ── Regla diaria (por si algún cliente la usa) ──
const daily: DeliveryRule = {
  frequency: "daily",
  deadlineTime: "23:59:00",
  deadlineOffsetDays: 0,
  timezone: "America/La_Paz",
  requiredWeekdays: [1, 2, 3, 4, 5],
  holidays: ["2026-10-08"],
};
{
  const now = new Date("2026-10-14T15:00:00Z");
  const days = periodsBetween(daily, "2026-10-05", "2026-10-14");
  assert.deepEqual(days.map((p) => p.key), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"], "sin fin de semana ni feriado");
  const own = [
    sub("2026-10-05", "2026-10-05", "2026-10-05T22:00:00Z"),
    sub("2026-10-06", "2026-10-06", "2026-10-07T12:00:00Z"),
    sub("2026-10-07", "2026-10-07", "2026-10-07T22:00:00Z", "needs_review"),
  ];
  const at = (key: string) => periodStatus(days.find((p) => p.key === key)!, own, now);
  assert.equal(at("2026-10-05"), "entregado");
  assert.equal(at("2026-10-06"), "atrasado");
  assert.equal(at("2026-10-07"), "en_revision");
  assert.equal(at("2026-10-09"), "falta");
  assert.equal(at("2026-10-14"), "pendiente");
  const recent = { ...person, startDate: "2026-10-01" };
  assert.deepEqual(periodsBehind(daily, recent, own, now), { count: 3, since: "2026-10-09" }, "9, 12 y 13; el 7 en revisión corta");
}

// ── Regla quincenal de DGM: acumulado del mes, 1 día de gracia ──
const semi: DeliveryRule = { ...daily, frequency: "semimonthly", deadlineOffsetDays: 1, requiredWeekdays: [], holidays: [] };
{
  const halves = periodsBetween(semi, "2026-09-01", "2026-10-31");
  assert.deepEqual(halves.map((p) => [p.key, p.start, p.end]), [
    ["2026-09-1", "2026-09-01", "2026-09-15"],
    ["2026-09-2", "2026-09-16", "2026-09-30"],
    ["2026-10-1", "2026-10-01", "2026-10-15"],
    ["2026-10-2", "2026-10-16", "2026-10-31"],
  ]);
  assert.equal(halves[0].deadline.toISOString(), "2026-09-17T03:59:00.000Z", "16 sep 23:59 en La Paz");
  assert.deepEqual(periodsBetween(semi, "2026-10-20", "2026-10-25").map((p) => p.key), ["2026-10-2"], "solo la quincena que se cruza");

  const own = [
    sub("2026-09-01", "2026-09-15", "2026-09-16T20:00:00Z"), // a tiempo (16 sep)
    sub("2026-09-01", "2026-09-30", "2026-10-03T14:00:00Z"), // mes completo, tarde
  ];
  const now = new Date("2026-10-17T15:00:00Z"); // 17 oct
  const status = (key: string) => periodStatus(halves.find((p) => p.key === key)!, own, now);
  assert.equal(status("2026-09-1"), "entregado");
  assert.equal(status("2026-09-2"), "atrasado");
  assert.equal(status("2026-10-1"), "falta", "la 1ª de octubre vencía el 16");
  assert.equal(status("2026-10-2"), "pendiente");

  // El acumulado del mes completo también cubre la 1ª quincena (pero cuenta como atrasado si llegó tarde)
  const onlyTotal = [sub("2026-09-01", "2026-09-30", "2026-10-01T20:00:00Z")];
  assert.equal(periodStatus(halves[0], onlyTotal, now), "atrasado");
  assert.equal(periodStatus(halves[1], onlyTotal, now), "entregado");

  // Un rango que no empieza el 1 no cubre la 1ª quincena
  assert.equal(periodStatus(halves[0], [sub("2026-09-02", "2026-09-15", "2026-09-15T20:00:00Z")], now), "falta");

  assert.deepEqual(periodsBehind(semi, person, own, now), { count: 1, since: "2026-10-01" });
  assert.deepEqual(periodsBehind(semi, person, [], now).count, 5, "ago 1ª y 2ª, sep 1ª y 2ª, oct 1ª");

  const grid = deliveryGrid(semi, [{ id: 1, startDate: "2026-09-20", createdAt: new Date() }], own, halves, now);
  assert.equal(grid.get(1)?.get("2026-09-1"), "no_exigido", "antes de su inicio");
  assert.equal(grid.get(1)?.get("2026-09-2"), "atrasado");
}

console.log("[deliveries.test] OK: periodos diarios y quincenales, horas límite, estados y atrasos");
