import { APP_NAME, appConfig } from "@dgm/core";

export const dynamic = "force-dynamic";

export default function Home() {
  const config = appConfig();

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
        <li>Base de datos: {config.hasDatabase ? "conectada" : "sin configurar"}</li>
      </ul>
    </main>
  );
}
