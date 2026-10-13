import { type AnyDb, desc, eq, readings, reviews, submissions } from "@dgm/db";

export type ReviewValues = { minutes: number; calls: number | null; periodStart: string; periodEnd: string };

export type ReviewInput =
  | { action: "confirm"; submissionId: number; note?: string }
  | { action: "correct"; submissionId: number; values: ReviewValues; note?: string }
  | { action: "reject"; submissionId: number; note?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Revisa los datos que escribe un gerente. Devuelve el problema en español, o null si está bien. */
export function checkValues(v: ReviewValues): string | null {
  if (!Number.isInteger(v.minutes) || v.minutes < 0) return "Los minutos deben ser un número entero, 0 o mayor";
  if (v.calls !== null && (!Number.isInteger(v.calls) || v.calls < 0)) return "Las llamadas deben ser un número entero, 0 o mayor";
  if (!ISO_DATE.test(v.periodStart) || !ISO_DATE.test(v.periodEnd)) return "Faltan las fechas del rango";
  if (v.periodEnd < v.periodStart) return "La fecha final no puede ser anterior a la inicial";
  return null;
}

/**
 * Aplica la decisión de un gerente sobre una entrega y la deja registrada en `reviews` (nunca se borra).
 * - confirmar: los valores leídos se aceptan tal cual.
 * - corregir: se guarda una lectura nueva con model "manual" y la entrega queda confirmada.
 * - rechazar: la entrega deja de contar.
 */
export async function applyReview(db: AnyDb, reviewerEmail: string, input: ReviewInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, input.submissionId)).limit(1);
  if (!sub) return { ok: false, error: "La entrega no existe" };

  const [last] = await db.select().from(readings).where(eq(readings.submissionId, sub.id)).orderBy(desc(readings.id)).limit(1);
  const oldValues = {
    status: sub.status,
    minutes: last?.minutes ?? null,
    calls: last?.calls ?? null,
    periodStart: last?.periodStart ?? null,
    periodEnd: last?.periodEnd ?? null,
  };
  const note = input.note?.trim() || null;

  if (input.action === "confirm") {
    if (!last || last.minutes === null || !last.periodStart || !last.periodEnd) {
      return { ok: false, error: "No hay minutos y fechas leídos para confirmar; usa Corregir y escríbelos" };
    }
    await db.transaction(async (tx) => {
      await tx.update(submissions).set({ status: "confirmed" }).where(eq(submissions.id, sub.id));
      await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "confirm", oldValues, newValues: { ...oldValues, status: "confirmed" }, note });
    });
    return { ok: true };
  }

  if (input.action === "correct") {
    const problem = checkValues(input.values);
    if (problem) return { ok: false, error: problem };
    const v = input.values;
    await db.transaction(async (tx) => {
      await tx.insert(readings).values({
        submissionId: sub.id,
        model: "manual",
        minutes: v.minutes,
        calls: v.calls,
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        portalInterpreterId: last?.portalInterpreterId ?? null,
        portalInterpreterName: last?.portalInterpreterName ?? null,
        extraFields: { corregido_por: reviewerEmail },
        confidence: 1,
        legible: true,
        rawResponse: null,
        escalated: false,
      });
      await tx.update(submissions).set({ status: "confirmed" }).where(eq(submissions.id, sub.id));
      await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "correct", oldValues, newValues: { status: "confirmed", ...v }, note });
    });
    return { ok: true };
  }

  await db.transaction(async (tx) => {
    await tx.update(submissions).set({ status: "rejected" }).where(eq(submissions.id, sub.id));
    await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "reject", oldValues, newValues: { status: "rejected" }, note });
  });
  return { ok: true };
}

/** Historial de decisiones sobre una entrega, de la más nueva a la más vieja. */
export async function reviewHistory(db: AnyDb, submissionId: number) {
  return db.select().from(reviews).where(eq(reviews.submissionId, submissionId)).orderBy(desc(reviews.id));
}
