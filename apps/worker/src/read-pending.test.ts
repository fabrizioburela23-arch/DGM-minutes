import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { ReadResult, ScreenshotReader, ScreenshotReading } from "@dgm/core/reader";
import type { ObjectStore } from "@dgm/core/storage";
import { deliveryRules, evalRuns, interpreters, readings, schema, seedTestData, submissions } from "@dgm/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { runEvalOnce } from "./eval";
import { readPending, type ReadSettings } from "./read-pending";

const base: ScreenshotReading = {
  minutes: 144,
  calls: 19,
  periodStart: "2026-10-07",
  periodEnd: "2026-10-07",
  portalInterpreterId: "63602",
  portalInterpreterName: "Prueba",
  confidence: 0.95,
  legible: true,
  extraFields: {},
};

/** IA simulada: la respuesta depende del contenido de la "imagen" y del modelo. */
class FakeReader implements ScreenshotReader {
  calls: string[] = [];
  constructor(private answers: Record<string, Partial<Record<"small" | "large", Partial<ScreenshotReading> | "error">>>) {}
  async read(image: Buffer, _mime: string, model: string): Promise<ReadResult> {
    const key = image.toString();
    const size = model === "small" ? "small" : "large";
    this.calls.push(`${key}:${size}`);
    const answer = this.answers[key]?.[size] ?? this.answers[key]?.small;
    if (answer === "error" || answer === undefined) throw new Error("API simulada caída");
    return { reading: { ...base, ...answer }, raw: { simulated: true }, model };
  }
}

class MemoryStore implements ObjectStore {
  data = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.data.set(key, body);
  }
  async get(key: string) {
    const v = this.data.get(key);
    if (!v) throw new Error("no existe");
    return v;
  }
}

const settings: ReadSettings = {
  modelSmall: "small",
  modelLarge: "large",
  confidenceThreshold: 0.85,
  maxMinutesPerDay: 720,
  timezone: "America/La_Paz",
  batchSize: 25,
};

async function main() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)) });
  await seedTestData(db);
  // Este primer escenario usa la regla diaria; el modo Google Form (quincenal) se prueba más abajo.
  await db.update(deliveryRules).set({ frequency: "daily" });
  const people = await db.select().from(interpreters).orderBy(asc(interpreters.code));
  const [t1, t2, t3] = people;
  await db.update(interpreters).set({ portalId: "99999" }).where(eq(interpreters.id, t3.id));

  const store = new MemoryStore();
  const add = async (interpreterId: number, id: string, ext = "jpg") => {
    const key = `interpreters/x/2026-10/${id}.${ext}`;
    await store.put(key, Buffer.from(id));
    await db.insert(submissions).values({ interpreterId, driveFileId: id, fileName: `${id}.${ext}`, storageKey: key });
  };

  await add(t1.id, "bueno"); // lectura limpia con el modelo pequeño
  await add(t1.id, "dudoso"); // confianza baja → el grande lo resuelve (otra fecha, sin superposición)
  await add(t2.id, "viejo"); // fecha antigua → revisión aunque escale
  await add(t2.id, "foto", "heic"); // formato no soportado
  await add(t2.id, "caida"); // la API falla → queda pendiente
  await add(t1.id, "repetido"); // mismo día que "bueno" → doble conteo
  await add(t3.id, "ajeno"); // ID de Propio distinto al cargado
  await add(t3.id, "sinescalar"); // el modelo mayor falla → revisión, no reintento infinito

  const reader = new FakeReader({
    bueno: { small: {} },
    dudoso: { small: { confidence: 0.4 }, large: { periodStart: "2026-10-09", periodEnd: "2026-10-09", minutes: 156, calls: 15 } },
    viejo: { small: { periodStart: "2026-09-09", periodEnd: "2026-09-09" } },
    caida: { small: "error" },
    repetido: { small: {} },
    ajeno: { small: { portalInterpreterId: "63602" } },
    sinescalar: { small: { confidence: 0.3, periodStart: "2026-10-10", periodEnd: "2026-10-10", portalInterpreterId: "99999" }, large: "error" },
  });

  const now = () => new Date("2026-10-12T20:00:00Z");
  const result = await readPending({ db, store, reader, settings, now });

  const status = Object.fromEntries(
    (await db.select().from(submissions)).map((s) => [s.driveFileId, { status: s.status, reason: s.reviewReason ?? "" }]),
  );
  assert.equal(status.bueno.status, "read");
  assert.equal(status.dudoso.status, "read", "el modelo mayor resuelve la confianza baja");
  assert.equal(status.viejo.status, "needs_review");
  assert.match(status.viejo.reason, /hace 33 días/);
  assert.equal(status.foto.status, "needs_review");
  assert.match(status.foto.reason, /no soportado/);
  assert.equal(status.caida.status, "pending", "si la API falla se reintenta en la próxima pasada");
  assert.equal(status.repetido.status, "needs_review");
  assert.match(status.repetido.reason, /superpone/);
  assert.equal(status.ajeno.status, "needs_review");
  assert.match(status.ajeno.reason, /no coincide/);

  assert.equal(status.sinescalar.status, "needs_review");
  assert.match(status.sinescalar.reason, /Confianza baja.*No se pudo verificar con el modelo mayor/);

  // Escalan con éxito: dudoso, viejo, repetido y ajeno. "sinescalar" intenta y falla.
  assert.deepEqual(result, { read: 2, needsReview: 5, escalated: 4, failed: 1 });
  assert.ok(!reader.calls.includes("bueno:large"), "lo que sale bien no se escala");
  assert.ok(reader.calls.includes("dudoso:large"));

  const saved = await db.select().from(readings).orderBy(asc(readings.id));
  assert.equal(saved.length, 10, "6 lecturas pequeñas (la caída y la HEIC no generan lectura) + 4 escaladas");
  assert.ok(saved.filter((r) => r.escalated).every((r) => r.model === "large"));

  // ── Modo Google Form, regla quincenal: el dueño lo decide el ID de Propio ──
  await db.update(deliveryRules).set({ frequency: "semimonthly", deadlineOffsetDays: 1 });
  // T003 no tiene lecturas aceptadas en octubre: así los acumulados de esta parte no chocan con las de arriba.
  await db.update(interpreters).set({ portalId: "11111" }).where(eq(interpreters.id, t3.id));
  const addForm = async (id: string, interpreterId: number | null) => {
    const key = `form/2026-10/${id}.png`;
    await store.put(key, Buffer.from(id));
    await db.insert(submissions).values({ interpreterId, uploaderName: "alguien", driveFileId: id, fileName: `${id} - alguien.png`, storageKey: key });
  };
  await addForm("f-porid", null); // sin pista de nombre, el ID 11111 es de T003
  await addForm("f-nadie", null); // ID que nadie tiene
  await addForm("f-cruce", t2.id); // el nombre apuntaba a T002 (sin ID), pero el ID es de T003
  await addForm("f-quinc", t3.id); // acumulado mayor del mismo mes de T003: normal
  const formReader = new FakeReader({
    "f-porid": { small: { periodStart: "2026-10-01", periodEnd: "2026-10-05", minutes: 600, portalInterpreterId: "11111" } },
    "f-nadie": { small: { periodStart: "2026-10-01", periodEnd: "2026-10-08", minutes: 900, portalInterpreterId: "77777" } },
    "f-cruce": { small: { periodStart: "2026-10-01", periodEnd: "2026-10-09", minutes: 1000, portalInterpreterId: "11111" } },
    "f-quinc": { small: { periodStart: "2026-10-01", periodEnd: "2026-10-10", minutes: 1200, portalInterpreterId: "11111" } },
  });
  await readPending({ db, store, reader: formReader, settings, now });
  const byFile = Object.fromEntries((await db.select().from(submissions)).map((s) => [s.driveFileId, s]));
  assert.equal(byFile["f-porid"].interpreterId, t3.id, "asignado por ID de Propio");
  assert.equal(byFile["f-porid"].status, "read");
  assert.equal(byFile["f-nadie"].interpreterId, null);
  assert.equal(byFile["f-nadie"].status, "needs_review");
  assert.match(byFile["f-nadie"].reviewReason ?? "", /ID de Propio 77777/);
  assert.equal(byFile["f-cruce"].interpreterId, t3.id);
  assert.match(byFile["f-cruce"].reviewReason ?? "", /nombre del Form apunta a Prueba Dos, pero el ID de Propio es de Prueba Tres/);
  assert.equal(byFile["f-quinc"].status, "read", "un acumulado mayor del mismo mes no es doble conteo");

  // Evaluación: una sola vez por versión
  const evalReader = new FakeReader({
    bueno: { small: { minutes: 140 }, large: {} },
  });
  const expected = [{ file: "bueno", minutes: 144, calls: 19, start: "2026-10-07", end: "2026-10-07", portalId: "63602" }];
  const summary = await runEvalOnce({ db, store, reader: evalReader, models: ["small", "large"], expected, commitSha: "abc" });
  assert.ok(summary);
  assert.equal(summary.byModel.small.perField.minutes, 0);
  assert.equal(summary.byModel.large.allFieldsCorrect, 1);
  assert.deepEqual(summary.mismatches, [{ file: "bueno", model: "small", field: "minutes" }]);
  assert.equal(await runEvalOnce({ db, store, reader: evalReader, models: ["small"], expected, commitSha: "abc" }), null);
  assert.equal((await db.select().from(evalRuns)).length, 1);

  console.log("[read-pending.test] OK: lectura, escalado, validaciones, reintentos y evaluación");
  await client.close();
}

main().catch((error: unknown) => {
  console.error("[read-pending.test] FALLÓ:", error);
  process.exit(1);
});
