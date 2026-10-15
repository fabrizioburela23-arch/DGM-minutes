import assert from "node:assert/strict";
import { normalizeReading, type ScreenshotReading } from "./reader";
import { daysInRange, todayIn, validateReading, type ValidationContext } from "./validate";

const good: ScreenshotReading = {
  minutes: 144,
  calls: 19,
  periodStart: "2026-10-07",
  periodEnd: "2026-10-07",
  portalInterpreterId: "63602",
  portalInterpreterName: "Persona de prueba",
  confidence: 0.95,
  legible: true,
  extraFields: {},
};

const ctx: ValidationContext = {
  today: "2026-10-12",
  ruleFrequency: "daily",
  maxMinutesPerDay: 720,
  confidenceThreshold: 0.85,
  expectedPortalId: null,
  prior: [],
};

assert.equal(daysInRange("2023-12-01", "2023-12-27"), 27);
assert.equal(todayIn("America/La_Paz", new Date("2026-10-13T02:00:00Z")), "2026-10-12");

assert.deepEqual(validateReading(good, ctx), [], "lectura buena sin motivos");

const has = (r: ScreenshotReading, c: ValidationContext, text: RegExp) =>
  assert.ok(validateReading(r, c).some((m) => text.test(m)), `debería incluir ${text}`);

has({ ...good, confidence: 0.5 }, ctx, /Confianza baja/);
has({ ...good, legible: false }, ctx, /no es legible/);
has({ ...good, minutes: null }, ctx, /minutos/);
has({ ...good, calls: null }, ctx, /llamadas/);
has({ ...good, periodStart: null }, ctx, /rango de fechas/);
has({ ...good, periodStart: "2026-10-13", periodEnd: "2026-10-13" }, ctx, /futuras/);
has({ ...good, periodStart: "2026-09-09", periodEnd: "2026-09-09" }, ctx, /hace 33 días/);
has({ ...good, periodStart: "2026-10-01", periodEnd: "2026-10-07", minutes: 900 }, ctx, /cubre 7 días/);
has({ ...good, minutes: 800 }, ctx, /por encima del máximo/);
has(good, { ...ctx, expectedPortalId: "74040" }, /no coincide/);
assert.deepEqual(validateReading(good, { ...ctx, expectedPortalId: "63602" }), []);
has(good, { ...ctx, prior: [{ periodStart: "2026-10-07", periodEnd: "2026-10-07", minutes: 100 }] }, /superpone/);

// Atípico: mediana 40 min/día, 144 > 120
const prior = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"].map((d) => ({
  periodStart: d,
  periodEnd: d,
  minutes: 40,
}));
has(good, { ...ctx, prior }, /3 veces la mediana/);
assert.ok(!validateReading({ ...good, minutes: 100 }, { ...ctx, prior }).some((m) => /mediana/.test(m)));

// Una semana completa es válida con regla semanal
assert.deepEqual(
  validateReading({ ...good, periodStart: "2026-10-05", periodEnd: "2026-10-11", minutes: 900 }, { ...ctx, ruleFrequency: "weekly" }),
  [],
);

// Normalización de la respuesta del modelo
const n = normalizeReading({
  minutes: "6,810",
  calls: 482,
  period_start: "2023-12-01",
  period_end: "December 27, 2023",
  portal_interpreter_id: "(21260)",
  portal_interpreter_name: "  Nombre  ",
  confidence: 1.4,
  legible: true,
  extra_fields: { Pay: "$0.00", filas_en_tabla: "1 – 15 of 482" },
});
assert.equal(n.minutes, 6810);
assert.equal(n.periodEnd, null, "fecha en otro formato no se acepta");
assert.equal(n.portalInterpreterId, "21260");
assert.equal(n.portalInterpreterName, "Nombre");
assert.equal(n.confidence, 1);
assert.deepEqual(n.extraFields, { filas_en_tabla: "1 – 15 of 482" });

// Regla quincenal: acumulados del mes
{
  const semi: ValidationContext = { ...ctx, ruleFrequency: "semimonthly", prior: [{ periodStart: "2026-10-01", periodEnd: "2026-10-05", minutes: 900 }] };
  const mtd = { ...good, periodStart: "2026-10-01", periodEnd: "2026-10-11", minutes: 2000 };
  assert.deepEqual(validateReading(mtd, semi), [], "un acumulado mayor del mismo mes es normal");
  has({ ...mtd, minutes: 800 }, semi, /no cuadran/);
  has({ ...mtd, periodStart: "2026-10-02" }, semi, /día 1/);
  has({ ...mtd, periodStart: "2026-10-01", periodEnd: "2026-10-05" }, semi, /mismo rango/);
  has(mtd, { ...semi, unidentified: true }, /ID de Propio 63602/);
  has({ ...mtd, portalInterpreterId: null }, { ...semi, unidentified: true }, /no se leyó el ID/);
}

console.log("[validate.test] OK: reglas de validación y normalización");
