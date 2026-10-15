import { matchByName, normalizeName } from "@dgm/core/names";
import { and, type AnyDb, desc, eq, interpreters, ne, readings, reviews, submissions } from "@dgm/db";

export type ReviewValues = { minutes: number; calls: number | null; periodStart: string; periodEnd: string };

export type ReviewInput =
  | { action: "confirm"; submissionId: number; interpreterId?: number | null; note?: string }
  | { action: "correct"; submissionId: number; values: ReviewValues; interpreterId?: number | null; note?: string }
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
    interpreterId: sub.interpreterId,
    minutes: last?.minutes ?? null,
    calls: last?.calls ?? null,
    periodStart: last?.periodStart ?? null,
    periodEnd: last?.periodEnd ?? null,
  };
  const note = input.note?.trim() || null;

  // Un gerente puede asignar (o cambiar) a quién pertenece el screenshot al confirmar o corregir.
  let interpreterId = sub.interpreterId;
  if (input.action !== "reject" && input.interpreterId) {
    const [person] = await db.select().from(interpreters).where(eq(interpreters.id, input.interpreterId)).limit(1);
    if (!person) return { ok: false, error: "Ese intérprete no existe" };
    interpreterId = person.id;
  }
  if (input.action !== "reject" && interpreterId === null) {
    return { ok: false, error: "Elige a qué intérprete corresponde este screenshot" };
  }
  const owner = interpreterId !== sub.interpreterId ? { interpreterId } : {};

  if (input.action === "confirm") {
    if (!last || last.minutes === null || !last.periodStart || !last.periodEnd) {
      return { ok: false, error: "No hay minutos y fechas leídos para confirmar; usa Corregir y escríbelos" };
    }
    await db.transaction(async (tx) => {
      await tx.update(submissions).set({ status: "confirmed", ...owner }).where(eq(submissions.id, sub.id));
      await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "confirm", oldValues, newValues: { ...oldValues, status: "confirmed", interpreterId }, note });
    });
    await learnIdentity(db, interpreterId!, last?.portalInterpreterId ?? null, sub.uploaderName);
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
      await tx.update(submissions).set({ status: "confirmed", ...owner }).where(eq(submissions.id, sub.id));
      await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "correct", oldValues, newValues: { status: "confirmed", interpreterId, ...v }, note });
    });
    await learnIdentity(db, interpreterId!, last?.portalInterpreterId ?? null, sub.uploaderName);
    return { ok: true };
  }

  await db.transaction(async (tx) => {
    await tx.update(submissions).set({ status: "rejected" }).where(eq(submissions.id, sub.id));
    await tx.insert(reviews).values({ submissionId: sub.id, reviewerEmail, action: "reject", oldValues, newValues: { status: "rejected" }, note });
  });
  return { ok: true };
}

/**
 * Lo que el sistema aprende cuando un gerente confirma de quién es un screenshot:
 * - si el intérprete no tenía ID de Propio y el screenshot trae uno que nadie más usa, se guarda;
 * - si el nombre que puso en el Google Form no es el suyo, se agrega como alias.
 * Así los próximos screenshots de esa persona se asignan solos.
 */
export async function learnIdentity(db: AnyDb, interpreterId: number, portalId: string | null, uploaderName: string | null) {
  const [person] = await db.select().from(interpreters).where(eq(interpreters.id, interpreterId)).limit(1);
  if (!person) return;
  const patch: Partial<typeof interpreters.$inferInsert> = {};
  if (!person.portalId && portalId) {
    const [taken] = await db
      .select({ id: interpreters.id })
      .from(interpreters)
      .where(and(eq(interpreters.portalId, portalId), ne(interpreters.id, interpreterId)))
      .limit(1);
    if (!taken) patch.portalId = portalId;
  }
  if (uploaderName && normalizeName(uploaderName) && !matchByName(uploaderName, [person])) {
    patch.aliases = [...person.aliases, uploaderName.trim()];
  }
  if (Object.keys(patch).length > 0) await db.update(interpreters).set(patch).where(eq(interpreters.id, interpreterId));
}

/** Historial de decisiones sobre una entrega, de la más nueva a la más vieja. */
export async function reviewHistory(db: AnyDb, submissionId: number) {
  return db.select().from(reviews).where(eq(reviews.submissionId, submissionId)).orderBy(desc(reviews.id));
}
