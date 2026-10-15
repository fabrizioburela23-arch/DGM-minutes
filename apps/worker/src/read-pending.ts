import type { ScreenshotReader, ScreenshotReading } from "@dgm/core/reader";
import { isSupportedImage } from "@dgm/core/reader";
import type { ObjectStore } from "@dgm/core/storage";
import { todayIn, validateReading, type PriorReading } from "@dgm/core/validate";
import { and, type AnyDb, asc, deliveryRules, eq, inArray, interpreters, ne, readings, submissions } from "@dgm/db";

type Person = { id: number; fullName: string; portalId: string | null };

/**
 * Dueño de un screenshot: manda el ID de Propio que leyó la IA (si coincide con un intérprete activo);
 * si no, queda el que ya tenía la entrega (su carpeta o el nombre del Google Form).
 */
export function resolveInterpreter(
  current: Person | null,
  portalId: string | null,
  people: Person[],
): { person: Person | null; conflict: string | null } {
  const byId = portalId ? people.find((p) => p.portalId === portalId) ?? null : null;
  if (byId) {
    const conflict =
      current && current.id !== byId.id && current.portalId === null
        ? `El nombre del Form apunta a ${current.fullName}, pero el ID de Propio es de ${byId.fullName}`
        : null;
    return { person: byId, conflict };
  }
  return { person: current, conflict: null };
}

export type ReadSettings = {
  modelSmall: string;
  modelLarge: string;
  confidenceThreshold: number;
  maxMinutesPerDay: number;
  timezone: string;
  /** Máximo de entregas a leer por pasada (controla costo y duración). */
  batchSize: number;
};

export type ReadResultSummary = { read: number; needsReview: number; escalated: number; failed: number };

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic" };

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Lecturas aceptadas (read o confirmed) del intérprete, excepto la entrega actual. La última lectura de cada entrega manda. */
async function priorReadings(db: AnyDb, interpreterId: number, excludeSubmissionId: number): Promise<PriorReading[]> {
  const rows = await db
    .select({
      submissionId: readings.submissionId,
      minutes: readings.minutes,
      periodStart: readings.periodStart,
      periodEnd: readings.periodEnd,
    })
    .from(readings)
    .innerJoin(submissions, eq(readings.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.interpreterId, interpreterId),
        inArray(submissions.status, ["read", "confirmed"]),
        ne(submissions.id, excludeSubmissionId),
      ),
    )
    .orderBy(asc(readings.id));

  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.submissionId, row);
  return [...latest.values()]
    .filter((r) => r.minutes !== null && r.periodStart && r.periodEnd)
    .map((r) => ({ periodStart: r.periodStart!, periodEnd: r.periodEnd!, minutes: r.minutes! }));
}

async function saveReading(db: AnyDb, submissionId: number, model: string, reading: ScreenshotReading, raw: unknown, escalated: boolean) {
  await db.insert(readings).values({
    submissionId,
    model,
    minutes: reading.minutes,
    calls: reading.calls,
    periodStart: reading.periodStart,
    periodEnd: reading.periodEnd,
    portalInterpreterId: reading.portalInterpreterId,
    portalInterpreterName: reading.portalInterpreterName,
    extraFields: reading.extraFields,
    confidence: reading.confidence,
    legible: reading.legible,
    rawResponse: raw,
    escalated,
  });
}

/**
 * Lee con IA las entregas pendientes: primero el modelo pequeño; si la confianza es baja o falla una regla,
 * repite con el modelo mayor. Termina en `read` (sin observaciones) o `needs_review` (con el motivo).
 * Si la API falla, la entrega queda `pending` y se reintenta en la siguiente pasada.
 */
export async function readPending(deps: {
  db: AnyDb;
  store: ObjectStore;
  reader: ScreenshotReader;
  settings: ReadSettings;
  log?: (message: string) => void;
  now?: () => Date;
}): Promise<ReadResultSummary> {
  const { db, store, reader, settings } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const summary: ReadResultSummary = { read: 0, needsReview: 0, escalated: 0, failed: 0 };

  const [rule] = await db.select().from(deliveryRules).where(eq(deliveryRules.active, true)).limit(1);
  const ruleFrequency = rule?.frequency ?? "semimonthly";
  const timezone = rule?.timezone ?? settings.timezone;

  const people: Person[] = await db
    .select({ id: interpreters.id, fullName: interpreters.fullName, portalId: interpreters.portalId })
    .from(interpreters)
    .where(eq(interpreters.active, true));

  const pending = await db
    .select({
      id: submissions.id,
      storageKey: submissions.storageKey,
      interpreterId: submissions.interpreterId,
    })
    .from(submissions)
    .where(eq(submissions.status, "pending"))
    .orderBy(asc(submissions.id))
    .limit(settings.batchSize);

  for (const sub of pending) {
    try {
      if (!sub.storageKey) throw new Error("sin copia en el bucket");
      const mime = mimeFromKey(sub.storageKey);

      if (!isSupportedImage(mime)) {
        await db
          .update(submissions)
          .set({ status: "needs_review", reviewReason: `Formato de imagen no soportado (${mime}); pedir captura en PNG o JPG` })
          .where(eq(submissions.id, sub.id));
        summary.needsReview += 1;
        continue;
      }

      const image = await store.get(sub.storageKey);
      const current = sub.interpreterId ? (people.find((p) => p.id === sub.interpreterId) ?? null) : null;

      const check = async (reading: ScreenshotReading) => {
        const { person, conflict } = resolveInterpreter(current, reading.portalInterpreterId, people);
        const reasons = validateReading(reading, {
          today: todayIn(timezone, now()),
          ruleFrequency,
          maxMinutesPerDay: settings.maxMinutesPerDay,
          confidenceThreshold: settings.confidenceThreshold,
          expectedPortalId: person?.portalId ?? null,
          unidentified: person === null,
          prior: person ? await priorReadings(db, person.id, sub.id) : [],
        });
        return { person, reasons: conflict ? [...reasons, conflict] : reasons };
      };

      const first = await reader.read(image, mime, settings.modelSmall);
      await saveReading(db, sub.id, first.model, first.reading, first.raw, false);
      let { person, reasons } = await check(first.reading);

      if (reasons.length > 0) {
        // Si el modelo mayor falla, no se reintenta en cada pasada (costaría lo mismo una y otra vez):
        // la entrega va a revisión con lo que vio el modelo pequeño.
        try {
          const second = await reader.read(image, mime, settings.modelLarge);
          await saveReading(db, sub.id, second.model, second.reading, second.raw, true);
          ({ person, reasons } = await check(second.reading));
          summary.escalated += 1;
        } catch (error) {
          reasons = [...reasons, "No se pudo verificar con el modelo mayor"];
          log(`[worker] escalado de la entrega #${sub.id} falló: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (person?.id !== sub.interpreterId) {
        await db.update(submissions).set({ interpreterId: person?.id ?? null }).where(eq(submissions.id, sub.id));
      }

      if (reasons.length === 0) {
        await db.update(submissions).set({ status: "read", reviewReason: null }).where(eq(submissions.id, sub.id));
        summary.read += 1;
      } else {
        await db.update(submissions).set({ status: "needs_review", reviewReason: reasons.join("; ") }).where(eq(submissions.id, sub.id));
        summary.needsReview += 1;
      }
    } catch (error) {
      summary.failed += 1;
      log(`[worker] lectura de la entrega #${sub.id} falló: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return summary;
}
