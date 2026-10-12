import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb, seedTestData } from "./index";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Aplica las migraciones pendientes. Railway lo corre como paso previo a cada despliegue.
 * Si SEED_TEST_DATA=true, además carga los datos de prueba (no duplica nada).
 */
async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log("[db] migraciones aplicadas");

  if (process.env.SEED_TEST_DATA === "true") {
    await seedTestData(db, { adminEmail: process.env.SEED_ADMIN_EMAIL });
    console.log("[db] datos de prueba cargados");
  }
}

main()
  .catch((error: unknown) => {
    console.error("[db] la migración falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
