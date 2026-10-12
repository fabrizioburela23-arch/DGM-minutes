import { appConfig } from "@dgm/core";

// Una pasada completa del worker. En el hito 3 revisará Drive; en el 4, leerá con IA.
async function run(): Promise<void> {
  const config = appConfig();
  console.log(`[worker] pasada iniciada · zona ${config.timezone} · base ${config.hasDatabase ? "ok" : "sin configurar"}`);
  console.log("[worker] pasada terminada (todavía sin tareas)");
}

run().catch((error: unknown) => {
  console.error("[worker] la pasada falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
