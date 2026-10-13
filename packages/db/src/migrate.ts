import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb, parseEmailList, seedManagers, seedTestData } from "./index";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Aplica las migraciones pendientes. Railway lo corre como paso previo a cada despliegue.
 * Si SEED_TEST_DATA=true, además carga los datos de prueba (no duplica nada).
 * ADMIN_EMAILS y MANAGER_EMAILS (listas con comas) agregan gerentes nuevos; nunca reactivan ni borran.
 */
async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log("[db] migraciones aplicadas");

  if (process.env.SEED_TEST_DATA === "true") {
    await seedTestData(db, { adminEmail: process.env.SEED_ADMIN_EMAIL });
    console.log("[db] datos de prueba cargados");
  }

  const admins = parseEmailList(process.env.ADMIN_EMAILS);
  const managers = parseEmailList(process.env.MANAGER_EMAILS).filter((e) => !admins.includes(e));
  await seedManagers(db, admins, "admin");
  await seedManagers(db, managers, "manager");
  if (admins.length + managers.length > 0) console.log(`[db] gerentes revisados: ${admins.length} admin, ${managers.length} gerentes`);
}

main()
  .catch((error: unknown) => {
    console.error("[db] la migración falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
