import { APP_NAME, appConfig } from "@dgm/core";
import { count, getDb, interpreters } from "@dgm/db";

export const dynamic = "force-dynamic";

async function databaseStatus(): Promise<string> {
  if (!process.env.DATABASE_URL) return "sin configurar";
  try {
    const [row] = await getDb().select({ value: count() }).from(interpreters);
    return `conectada · ${row.value} intérpretes registrados`;
  } catch {
    return "conectada, pero sin tablas todavía";
  }
}

export default async function Home() {
  const config = appConfig();
  const dbStatus = await databaseStatus();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-slate-500">appgrade · DGM Interpreters</p>
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <p className="text-slate-600">
        Hola. El sistema de reporte de minutos está en construcción. Aquí aparecerá el dashboard de gerentes con
        atrasos, minutos, entregas y screenshots.
      </p>
      <ul className="mt-2 space-y-1 text-sm text-slate-600">
        <li>Zona horaria: {config.timezone}</li>
        <li>Base de datos: {dbStatus}</li>
      </ul>
    </main>
  );
}
