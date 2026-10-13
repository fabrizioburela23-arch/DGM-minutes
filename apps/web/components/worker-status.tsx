import type { WorkerHealth } from "@/lib/worker-health";

/** Aviso visible en todas las páginas cuando el worker falla (dos pasadas seguidas, sin pasadas o lecturas atascadas). */
export function WorkerBanner({ health }: { health: WorkerHealth }) {
  if (health.level === "ok") return null;
  const style = health.level === "error" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div role="alert" className={`mb-5 rounded-xl border p-3 text-sm ${style}`}>
      <p className="font-semibold">{health.level === "error" ? "⚠ Problema con la revisión automática" : "Atención"}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {health.messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs opacity-80">Los datos del panel pueden estar desactualizados hasta que se resuelva.</p>
    </div>
  );
}

function ago(date: Date): string {
  const min = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} días`;
}

export function WorkerFooter({ health }: { health: WorkerHealth }) {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-6 text-xs text-slate-500">
      Última revisión de Drive: {health.lastRunAt ? ago(health.lastRunAt) : "nunca"} · se revisa cada 15 minutos
    </footer>
  );
}
