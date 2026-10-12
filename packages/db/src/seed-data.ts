import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { deliveryRules, interpreters, managers } from "./schema";
import type * as schema from "./schema";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const TEST_NOTE = "Intérprete de prueba. Borrar cuando lleguen los datos reales de DGM.";

/** Tres intérpretes ficticios para probar el sistema antes de tener la lista real de DGM. */
export const TEST_INTERPRETERS = [
  { code: "T001", fullName: "Prueba Uno" },
  { code: "T002", fullName: "Prueba Dos" },
  { code: "T003", fullName: "Prueba Tres" },
] as const;

/**
 * Carga los datos de prueba. Se puede correr varias veces: no duplica nada.
 * La regla de entrega es un valor por defecto hasta que DGM confirme la suya.
 */
export async function seedTestData(db: AnyDb, options: { adminEmail?: string } = {}) {
  await db
    .insert(interpreters)
    .values(TEST_INTERPRETERS.map((i) => ({ ...i, notes: TEST_NOTE })))
    .onConflictDoNothing({ target: interpreters.code });

  const existingRules = await db.select({ id: deliveryRules.id }).from(deliveryRules).limit(1);
  if (existingRules.length === 0) {
    await db.insert(deliveryRules).values({});
  }

  if (options.adminEmail) {
    await db
      .insert(managers)
      .values({ email: options.adminEmail.trim().toLowerCase(), role: "admin" })
      .onConflictDoNothing({ target: managers.email });
  }
}
