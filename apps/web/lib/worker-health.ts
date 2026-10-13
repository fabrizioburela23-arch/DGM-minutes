import { type AnyDb, desc, eq, sql, submissions, workerRuns } from "@dgm/db";

export type RunLite = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  filesNew: number;
  filesFailed: number;
  error: string | null;
};

export type WorkerHealth = {
  level: "ok" | "warn" | "error";
  messages: string[];
  lastRunAt: Date | null;
};

const MIN = 60_000;
/** Una pasada sin terminar más de este tiempo se considera caída. */
const STUCK_AFTER = 20 * MIN;
/** El cron corre cada 15 min; si no hay pasadas en este tiempo, el worker se detuvo. */
const SILENT_AFTER = 45 * MIN;
/** Screenshots sin leer por la IA más de este tiempo. */
const PENDING_AFTER = 60 * MIN;

function failure(r: RunLite, now: Date): string | null {
  if (r.error) return r.error;
  if (!r.finishedAt && now.getTime() - r.startedAt.getTime() > STUCK_AFTER) return "La pasada no terminó";
  if (r.filesFailed > 0 && r.filesNew === 0) return `${r.filesFailed} archivo(s) de Drive no se pudieron copiar`;
  return null;
}

/**
 * Estado del worker para el aviso del dashboard (CLAUDE.md, hito 6): alerta si las dos últimas pasadas fallaron,
 * si el worker dejó de correr, o si hay screenshots esperando a la IA demasiado tiempo.
 */
export function assessWorker(
  runsNewestFirst: RunLite[],
  pending: { count: number; oldest: Date | null },
  now = new Date(),
): WorkerHealth {
  const messages: string[] = [];
  let level: WorkerHealth["level"] = "ok";
  const raise = (l: "warn" | "error", m: string) => {
    messages.push(m);
    if (l === "error" || level === "ok") level = l;
  };

  const lastRunAt = runsNewestFirst[0]?.startedAt ?? null;
  if (!lastRunAt) {
    raise("warn", "El worker todavía no ha revisado Drive ni una vez.");
  } else if (now.getTime() - lastRunAt.getTime() > SILENT_AFTER) {
    raise("error", "El worker dejó de revisar Drive: no hay pasadas en los últimos 45 minutos. Revisar el servicio DGM-worker en Railway.");
  }

  // La pasada que está corriendo ahora no cuenta.
  const done = runsNewestFirst.filter((r) => r.finishedAt || now.getTime() - r.startedAt.getTime() > STUCK_AFTER);
  if (done.length >= 2) {
    const [a, b] = [failure(done[0], now), failure(done[1], now)];
    if (a && b) raise("error", `El worker falló en las dos últimas pasadas. Último error: ${a}`);
  }

  if (pending.count > 0 && pending.oldest && now.getTime() - pending.oldest.getTime() > PENDING_AFTER) {
    raise(
      "warn",
      `${pending.count} screenshot(s) esperan la lectura de la IA desde hace más de 1 hora. Puede faltar saldo en la cuenta de Anthropic o haber un problema con la clave.`,
    );
  }
  return { level, messages, lastRunAt };
}

export async function loadWorkerHealth(db: AnyDb, now = new Date()): Promise<WorkerHealth> {
  const runs = await db
    .select({
      id: workerRuns.id,
      startedAt: workerRuns.startedAt,
      finishedAt: workerRuns.finishedAt,
      filesNew: workerRuns.filesNew,
      filesFailed: workerRuns.filesFailed,
      error: workerRuns.error,
    })
    .from(workerRuns)
    .orderBy(desc(workerRuns.id))
    .limit(5);
  const [p] = await db
    .select({ count: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${submissions.detectedAt})` })
    .from(submissions)
    .where(eq(submissions.status, "pending"));
  return assessWorker(runs, { count: p?.count ?? 0, oldest: p?.oldest ? new Date(p.oldest) : null }, now);
}


