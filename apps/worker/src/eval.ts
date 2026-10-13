import type { ScreenshotReader, ScreenshotReading } from "@dgm/core/reader";
import type { ObjectStore } from "@dgm/core/storage";
import { type AnyDb, eq, evalRuns, submissions } from "@dgm/db";
import { mimeFromKey } from "./read-pending";

/** Valor correcto de un screenshot de prueba. `file` es el ID de Drive (Railway) o el nombre de archivo (local). */
export type Expected = {
  file: string;
  minutes: number;
  calls: number;
  start: string;
  end: string;
  portalId: string;
};

export const EVAL_FIELDS = ["minutes", "calls", "periodStart", "periodEnd", "portalInterpreterId"] as const;
export type EvalField = (typeof EVAL_FIELDS)[number];

export function compareReading(expected: Expected, reading: ScreenshotReading): Record<EvalField, boolean> {
  return {
    minutes: reading.minutes === expected.minutes,
    calls: reading.calls === expected.calls,
    periodStart: reading.periodStart === expected.start,
    periodEnd: reading.periodEnd === expected.end,
    portalInterpreterId: reading.portalInterpreterId === expected.portalId,
  };
}

export type EvalRow = { file: string; model: string; matches: Record<EvalField, boolean> | null; error?: string };

/** Resumen sin datos personales: porcentaje de aciertos por campo y modelo, y qué campos fallaron en qué archivo. */
export function summarize(rows: EvalRow[]) {
  const byModel: Record<string, { files: number; errors: number; allFieldsCorrect: number; perField: Record<string, number> }> = {};
  const mismatches: { file: string; model: string; field: string }[] = [];

  for (const model of [...new Set(rows.map((r) => r.model))]) {
    const mine = rows.filter((r) => r.model === model);
    const ok = mine.filter((r) => r.matches);
    const perField: Record<string, number> = {};
    for (const field of EVAL_FIELDS) {
      const hits = ok.filter((r) => r.matches![field]).length;
      perField[field] = mine.length ? Math.round((hits / mine.length) * 100) : 0;
    }
    byModel[model] = {
      files: mine.length,
      errors: mine.length - ok.length,
      allFieldsCorrect: ok.filter((r) => EVAL_FIELDS.every((f) => r.matches![f])).length,
      perField,
    };
    for (const r of ok) for (const f of EVAL_FIELDS) if (!r.matches![f]) mismatches.push({ file: r.file, model, field: f });
  }
  return { byModel, mismatches };
}

export function parseExpectedJson(raw: string): Expected[] {
  const list = JSON.parse(raw) as Expected[];
  if (!Array.isArray(list)) throw new Error("EVAL_EXPECTED debe ser una lista JSON");
  return list.map((e) => ({ ...e, portalId: String(e.portalId) }));
}

/**
 * Evaluación en Railway: corre una sola vez por versión desplegada (commit), lee de nuevo los screenshots de prueba
 * con los dos modelos sin guardar lecturas, y registra solo porcentajes en `eval_runs` y en el log.
 */
export async function runEvalOnce(deps: {
  db: AnyDb;
  store: ObjectStore;
  reader: ScreenshotReader;
  models: string[];
  expected: Expected[];
  commitSha: string;
  log?: (message: string) => void;
}): Promise<ReturnType<typeof summarize> | null> {
  const { db, store, reader, models, expected, commitSha } = deps;
  const log = deps.log ?? (() => {});

  const done = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.commitSha, commitSha)).limit(1);
  if (done.length > 0) return null;

  const rows: EvalRow[] = [];
  for (const item of expected) {
    const [sub] = await db.select().from(submissions).where(eq(submissions.driveFileId, item.file)).limit(1);
    if (!sub?.storageKey) {
      for (const model of models) rows.push({ file: item.file, model, matches: null, error: "no está registrado" });
      continue;
    }
    const image = await store.get(sub.storageKey);
    for (const model of models) {
      try {
        const { reading } = await reader.read(image, mimeFromKey(sub.storageKey), model);
        rows.push({ file: item.file, model, matches: compareReading(item, reading) });
      } catch (error) {
        rows.push({ file: item.file, model, matches: null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const summary = summarize(rows);
  await db.insert(evalRuns).values({ commitSha, summary }).onConflictDoNothing({ target: evalRuns.commitSha });
  for (const [model, s] of Object.entries(summary.byModel)) {
    log(
      `[eval] ${model}: ${s.allFieldsCorrect}/${s.files} screenshots perfectos · ` +
        Object.entries(s.perField).map(([f, p]) => `${f} ${p}%`).join(" · ") +
        (s.errors ? ` · errores ${s.errors}` : ""),
    );
  }
  for (const m of summary.mismatches) log(`[eval] no coincide: ${m.field} en ${m.file} (${m.model})`);
  return summary;
}
