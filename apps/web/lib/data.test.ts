import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { deliveryRules, interpreters, readings, reviews, schema, seedTestData, submissions } from "@dgm/db";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { deliveriesReport, groupKey, lateReport, loadSubmissions, minutesReport, monthBounds } from "./data";
import { buildWorkbook } from "./excel";
import { applyReview } from "./reviews";
import { importRoster, parseRoster } from "./roster";

async function main() {
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(groupKey("2026-10-14", "semana"), "2026-10-12", "la semana empieza el lunes");
  assert.equal(groupKey("2026-10-12", "semana"), "2026-10-12");
  assert.equal(groupKey("2026-10-18", "semana"), "2026-10-12", "el domingo es de la semana anterior");
  assert.equal(groupKey("2026-10-14", "mes"), "2026-10");
  assert.equal(groupKey("2026-10-15", "quincena"), "2026-10-1");
  assert.equal(groupKey("2026-10-16", "quincena"), "2026-10-2");

  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)) });
  await seedTestData(db);
  // Primera parte: regla diaria (la quincenal de DGM se prueba más abajo).
  await db.update(deliveryRules).set({ frequency: "daily", deadlineOffsetDays: 0 });
  await db.update(interpreters).set({ startDate: "2026-10-01" });
  const [t1, t2, t3] = await db.select().from(interpreters).orderBy(asc(interpreters.code));

  let n = 0;
  const add = async (
    interpreterId: number,
    status: (typeof submissions.$inferSelect)["status"],
    uploaded: string,
    reading?: { minutes: number | null; calls: number; start: string; end: string },
  ) => {
    n += 1;
    const [s] = await db
      .insert(submissions)
      .values({ interpreterId, driveFileId: `f${n}`, fileName: `f${n}.jpg`, status, driveCreatedAt: new Date(uploaded), storageKey: `k/f${n}.jpg` })
      .returning();
    if (reading) {
      // Dos lecturas: la segunda (modelo mayor) es la que vale
      await db.insert(readings).values({ submissionId: s.id, model: "small", minutes: 1, calls: 1, periodStart: reading.start, periodEnd: reading.end });
      await db
        .insert(readings)
        .values({ submissionId: s.id, model: "large", minutes: reading.minutes, calls: reading.calls, periodStart: reading.start, periodEnd: reading.end, escalated: true });
    }
    return s.id;
  };

  // T001: entrega el 5 a tiempo, el 6 tarde. T002: una en revisión el 6 y un screenshot de 2 días (7–8). T003: nada.
  await add(t1.id, "read", "2026-10-05T20:00:00Z", { minutes: 100, calls: 10, start: "2026-10-05", end: "2026-10-05" });
  await add(t1.id, "read", "2026-10-07T13:00:00Z", { minutes: 50, calls: 5, start: "2026-10-06", end: "2026-10-06" });
  const reviewId = await add(t2.id, "needs_review", "2026-10-06T20:00:00Z", { minutes: 300, calls: 20, start: "2026-10-06", end: "2026-10-06" });
  await add(t2.id, "confirmed", "2026-10-08T20:00:00Z", { minutes: 200, calls: 8, start: "2026-10-07", end: "2026-10-08" });
  const dupId = await add(t2.id, "duplicate", "2026-10-08T21:00:00Z");
  await add(t1.id, "rejected", "2026-10-09T20:00:00Z", { minutes: 999, calls: 1, start: "2026-10-09", end: "2026-10-09" });

  const all = await loadSubmissions(db);
  assert.equal(all.length, 6);
  assert.equal(all.find((s) => s.id === reviewId)?.model, "large", "vale la última lectura");
  assert.equal(all.find((s) => s.id === dupId)?.minutes, null);
  assert.equal((await loadSubmissions(db, { from: "2026-10-07", to: "2026-10-07" })).filter((s) => s.periodStart).length, 1, "rango 7–8 cruza el 7");

  const now = new Date("2026-10-09T15:00:00Z"); // viernes 9, 11:00 en La Paz
  const grid = await deliveriesReport(db, "2026-10", now);
  const row = (id: number) => {
    const byKey = grid.grid.get(id)!;
    return { get: (day: string) => byKey.get(day) ?? "no_exigido" };
  };
  assert.equal(row(t1.id).get("2026-10-05"), "entregado");
  assert.equal(row(t1.id).get("2026-10-06"), "atrasado");
  assert.equal(row(t1.id).get("2026-10-07"), "falta");
  assert.equal(row(t1.id).get("2026-10-09"), "pendiente", "rechazado no cuenta; hoy aún está a tiempo");
  assert.equal(row(t2.id).get("2026-10-06"), "en_revision");
  assert.equal(row(t2.id).get("2026-10-07"), "atrasado", "el screenshot de 7–8 se subió el 8");
  assert.equal(row(t2.id).get("2026-10-08"), "entregado");
  assert.equal(row(t3.id).get("2026-10-01"), "falta");
  assert.equal(row(t3.id).get("2026-10-04"), "no_exigido", "domingo");

  const late = await lateReport(db, "2026-10", now);
  assert.equal(late.rows[0].interpreter.code, "T003", "el más atrasado primero");
  assert.equal(late.rows[0].behind, 6, "1, 2, 5, 6, 7 y 8 de octubre");
  assert.equal(late.rows.find((r) => r.interpreter.id === t1.id)?.behind, 2, "7 y 8");
  assert.equal(late.rows.find((r) => r.interpreter.id === t2.id)?.behind, 0);
  assert.equal(late.rows.find((r) => r.interpreter.id === t1.id)?.lastDelivery, "2026-10-06");

  const minutes = await minutesReport(db, "2026-10-01", "2026-10-31", "dia");
  assert.equal(minutes.cumulative, false);
  assert.deepEqual(minutes.total, { minutes: 350, calls: 23, deliveries: 3 }, "solo read y confirmed; rechazado fuera");
  assert.deepEqual(minutes.inReview, { minutes: 300, deliveries: 1 });
  assert.equal(minutes.ranking[0].interpreter.code, "T002");
  assert.deepEqual(minutes.periods.map((p) => p.key), ["2026-10-05", "2026-10-06", "2026-10-08"], "rango 7–8 cuenta en el 8");

  // Revisiones
  assert.equal((await applyReview(db, "g@x.com", { action: "confirm", submissionId: dupId })).ok, false, "sin lectura no se confirma");
  const bad = await applyReview(db, "g@x.com", { action: "correct", submissionId: reviewId, values: { minutes: -1, calls: 1, periodStart: "2026-10-06", periodEnd: "2026-10-06" } });
  assert.equal(bad.ok, false);
  assert.deepEqual(
    await applyReview(db, "g@x.com", { action: "correct", submissionId: reviewId, values: { minutes: 30, calls: 2, periodStart: "2026-10-06", periodEnd: "2026-10-06" }, note: "leí mal" }),
    { ok: true },
  );
  assert.deepEqual(await applyReview(db, "g@x.com", { action: "reject", submissionId: dupId }), { ok: true });
  const fixed = (await loadSubmissions(db)).find((s) => s.id === reviewId)!;
  assert.equal(fixed.status, "confirmed");
  assert.equal(fixed.minutes, 30);
  assert.equal(fixed.model, "manual");
  const log = await db.select().from(reviews).orderBy(asc(reviews.id));
  assert.deepEqual(log.map((r) => r.action), ["correct", "reject"]);
  assert.equal((log[0].oldValues as { minutes: number }).minutes, 300);
  const [dup] = await db.select().from(submissions).where(eq(submissions.id, dupId));
  assert.equal(dup.status, "rejected");
  assert.equal((await minutesReport(db, "2026-10-01", "2026-10-31", "mes")).total.minutes, 380);

  // ── Regla quincenal de DGM: acumulados del mes, screenshots del Google Form sin dueño ──
  await db.update(deliveryRules).set({ frequency: "semimonthly", deadlineOffsetDays: 1 });
  const roster = parseRoster("Nombre\tEmpresa\tID\nAna Pérez\tC-tel\t52822\nLuis Gómez\tInterpredia\n\nx");
  assert.deepEqual(roster.rows.map((r) => [r.fullName, r.company, r.portalId]), [
    ["Ana Pérez", "C-tel", "52822"],
    ["Luis Gómez", "Interpredia", null],
  ]);
  assert.equal(roster.skipped.length, 1);
  assert.deepEqual(await importRoster(db, roster.rows), { added: 2, updated: 0 });
  assert.deepEqual(await importRoster(db, [{ fullName: "luis gomez", company: "Interpredia", portalId: "61000" }]), { added: 0, updated: 1 }, "completa el ID");
  const people = await db.select().from(interpreters);
  const ana = people.find((p) => p.fullName === "Ana Pérez")!;
  const luis = people.find((p) => p.fullName === "Luis Gómez")!;
  assert.equal(ana.code, "52822");
  assert.equal(luis.portalId, "61000");
  await db.update(interpreters).set({ startDate: "2026-09-01" }).where(inArray(interpreters.id, [ana.id, luis.id]));

  const addCum = async (interpreterId: number | null, uploaded: string, start: string, end: string, minutesValue: number, status: (typeof submissions.$inferSelect)["status"] = "read") => {
    n += 1;
    const [s] = await db
      .insert(submissions)
      .values({ interpreterId, uploaderName: interpreterId ? null : "Anita", driveFileId: `c${n}`, fileName: `c${n} - Anita.png`, status, driveCreatedAt: new Date(uploaded), storageKey: `form/c${n}.png` })
      .returning();
    await db.insert(readings).values({ submissionId: s.id, model: "small", minutes: minutesValue, calls: 10, periodStart: start, periodEnd: end, portalInterpreterId: "52822" });
    return s.id;
  };
  await addCum(ana.id, "2026-09-16T15:00:00Z", "2026-09-01", "2026-09-15", 2500);
  await addCum(ana.id, "2026-10-01T15:00:00Z", "2026-09-01", "2026-09-30", 5600);
  await addCum(luis.id, "2026-10-05T15:00:00Z", "2026-09-01", "2026-09-30", 4000); // solo total, tarde
  const orphan = await addCum(null, "2026-10-16T15:00:00Z", "2026-10-01", "2026-10-15", 2700, "needs_review");

  const cumNow = new Date("2026-10-17T15:00:00Z");
  const byMonth = await minutesReport(db, "2026-09-01", "2026-09-30", "mes");
  assert.equal(byMonth.cumulative, true);
  const rankOf = (r: typeof byMonth, id: number) => r.ranking.find((x) => x.interpreter.id === id)?.minutes;
  assert.equal(rankOf(byMonth, ana.id), 5600, "el último acumulado del mes, no la suma 2500 + 5600");
  assert.equal(rankOf(byMonth, luis.id), 4000);
  const byHalf = await minutesReport(db, "2026-09-01", "2026-09-30", "quincena");
  assert.equal(byHalf.pivot.get(ana.id)?.get("2026-09-1"), 2500);
  assert.equal(byHalf.pivot.get(ana.id)?.get("2026-09-2"), 3100, "5600 − 2500");
  assert.equal(byHalf.pivot.get(luis.id)?.get("2026-09-2"), 4000, "solo total: va a la 2ª");
  assert.equal(byHalf.inReview.minutes, null, "los acumulados en revisión no se suman");
  const october = await minutesReport(db, "2026-10-01", "2026-10-31", "mes");
  assert.equal(october.unidentified, 1);

  const halves = await deliveriesReport(db, "2026-10", cumNow);
  assert.equal(halves.periods.length, 12, "6 meses × 2 quincenas");
  assert.equal(halves.grid.get(ana.id)?.get("2026-09-1"), "entregado");
  assert.equal(halves.grid.get(ana.id)?.get("2026-09-2"), "entregado", "subido el 1 de octubre: dentro del día de gracia");
  assert.equal(halves.grid.get(luis.id)?.get("2026-09-1"), "atrasado");
  assert.equal(halves.grid.get(luis.id)?.get("2026-09-2"), "atrasado");
  assert.equal(halves.grid.get(ana.id)?.get("2026-10-1"), "falta", "el de octubre no tiene dueño todavía");
  const cumLate = await lateReport(db, "2026-10", cumNow);
  assert.equal(cumLate.rows.find((r) => r.interpreter.id === ana.id)?.behind, 1);

  // Asignar el screenshot huérfano: confirma, aprende el nombre del Form como alias
  assert.equal((await applyReview(db, "g@x.com", { action: "confirm", submissionId: orphan })).ok, false, "sin intérprete no se confirma");
  assert.deepEqual(await applyReview(db, "g@x.com", { action: "confirm", submissionId: orphan, interpreterId: ana.id }), { ok: true });
  const [anaAfter] = await db.select().from(interpreters).where(eq(interpreters.id, ana.id));
  assert.deepEqual(anaAfter.aliases, ["Anita"]);
  assert.equal((await deliveriesReport(db, "2026-10", cumNow)).grid.get(ana.id)?.get("2026-10-1"), "entregado");

  // Aprender el ID: Luis sin ID confirma un screenshot con ID 61999
  await db.update(interpreters).set({ portalId: null }).where(eq(interpreters.id, luis.id));
  const luisShot = await addCum(null, "2026-10-16T15:00:00Z", "2026-10-01", "2026-10-15", 2000, "needs_review");
  await db.update(readings).set({ portalInterpreterId: "61999" }).where(eq(readings.submissionId, luisShot));
  await applyReview(db, "g@x.com", { action: "confirm", submissionId: luisShot, interpreterId: luis.id });
  const [luisAfter] = await db.select().from(interpreters).where(eq(interpreters.id, luis.id));
  assert.equal(luisAfter.portalId, "61999");

  // Excel: las cuatro vistas generan un archivo válido
  for (const view of ["atrasos", "minutos", "entregas", "screenshots"] as const) {
    const params = new URLSearchParams(view === "minutos" ? { desde: "2026-10-01", hasta: "2026-10-31", agrupar: "semana" } : { mes: "2026-10" });
    const { buffer, fileName } = await buildWorkbook(db, view, params, now);
    assert.ok(buffer.byteLength > 1000, `${view}: archivo con contenido`);
    assert.match(fileName, new RegExp(`^dgm-${view}-`));
  }

  console.log("[web data.test] OK: entregas, atrasos, minutos, revisiones y Excel");
  await client.close();
}

main().catch((error: unknown) => {
  console.error("[web data.test] FALLÓ:", error);
  process.exit(1);
});
