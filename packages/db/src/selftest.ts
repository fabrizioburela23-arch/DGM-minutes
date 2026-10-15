import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { parseEmailList, seedManagers, seedTestData, TEST_INTERPRETERS } from "./seed-data";

/** Prueba local sin servidor: aplica migraciones y seed en un Postgres en memoria (PGlite). */
async function main() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

  await migrate(db, { migrationsFolder });
  await migrate(db, { migrationsFolder }); // segunda vez: no debe fallar

  await seedTestData(db, { adminEmail: "Admin@Example.com" });
  await seedTestData(db, { adminEmail: "admin@example.com" }); // idempotente

  const [{ value: interpreterCount }] = await db.select({ value: count() }).from(schema.interpreters);
  assert.equal(interpreterCount, TEST_INTERPRETERS.length, "3 intérpretes de prueba");

  const rules = await db.select().from(schema.deliveryRules);
  assert.equal(rules.length, 1, "una sola regla de entrega");
  assert.deepEqual(rules[0].requiredWeekdays, [1, 2, 3, 4, 5]);
  assert.equal(rules[0].frequency, "semimonthly");
  assert.equal(rules[0].timezone, "America/La_Paz");

  const admins = await db.select().from(schema.managers);
  assert.equal(admins.length, 1);
  assert.equal(admins[0].email, "admin@example.com");

  // Gerentes desde variables: sin duplicar y sin reactivar a quien se desactivó
  assert.deepEqual(parseEmailList(" A@x.com, b@x.com\nb@x.com;nocorreo "), ["a@x.com", "b@x.com"]);
  await seedManagers(db, ["a@x.com", "b@x.com"], "manager");
  await db.update(schema.managers).set({ active: false }).where(eq(schema.managers.email, "b@x.com"));
  await seedManagers(db, ["a@x.com", "b@x.com"], "manager");
  const [b] = await db.select().from(schema.managers).where(eq(schema.managers.email, "b@x.com"));
  assert.equal(b.active, false);

  // Un archivo de Drive no puede registrarse dos veces.
  const [first] = await db.select().from(schema.interpreters).where(eq(schema.interpreters.code, "T001"));
  await db.insert(schema.submissions).values({ interpreterId: first.id, driveFileId: "f1", fileName: "a.png" });
  await assert.rejects(
    db.insert(schema.submissions).values({ interpreterId: first.id, driveFileId: "f1", fileName: "b.png" }),
  );

  console.log("[selftest] OK: migraciones, seed idempotente y unicidad de drive_file_id");
  await client.close();
}

main().catch((error: unknown) => {
  console.error("[selftest] FALLÓ:", error);
  process.exit(1);
});
