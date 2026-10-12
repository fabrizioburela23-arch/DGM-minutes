import { closeDb, getDb, seedTestData } from "./index";

seedTestData(getDb(), { adminEmail: process.env.SEED_ADMIN_EMAIL })
  .then(() => console.log("[db] datos de prueba cargados"))
  .catch((error: unknown) => {
    console.error("[db] el seed falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
