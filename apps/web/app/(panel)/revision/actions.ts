"use server";

import { getDb } from "@dgm/db";
import { revalidatePath } from "next/cache";
import { applyReview, type ReviewInput } from "@/lib/reviews";
import { requireManager } from "@/lib/session";

export type ReviewState = { error?: string; done?: string } | null;

const intOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/[.,\s]/g, "");
  return s === "" ? null : Number(s);
};

/** Recibe el formulario de revisión (confirmar, corregir o rechazar) y lo guarda con el correo del gerente. */
export async function submitReview(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  const manager = await requireManager();
  const submissionId = Number(form.get("submissionId"));
  const action = String(form.get("action"));
  const note = String(form.get("note") ?? "");
  if (!Number.isInteger(submissionId)) return { error: "Entrega inválida" };
  const rawInterpreter = Number(form.get("interpreterId"));
  const interpreterId = Number.isInteger(rawInterpreter) && rawInterpreter > 0 ? rawInterpreter : null;

  let input: ReviewInput;
  if (action === "confirm") {
    input = { action, submissionId, note, interpreterId };
  } else if (action === "reject") {
    input = { action, submissionId, note };
  } else if (action === "correct") {
    const minutes = intOrNull(form.get("minutes"));
    if (minutes === null || Number.isNaN(minutes)) return { error: "Escribe los minutos" };
    const calls = intOrNull(form.get("calls"));
    if (calls !== null && Number.isNaN(calls)) return { error: "Las llamadas deben ser un número" };
    input = {
      action,
      submissionId,
      note,
      interpreterId,
      values: { minutes, calls, periodStart: String(form.get("periodStart") ?? ""), periodEnd: String(form.get("periodEnd") ?? "") },
    };
  } else {
    return { error: "Acción desconocida" };
  }

  const result = await applyReview(getDb(), manager.email, input);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return { done: action === "confirm" ? "Confirmado" : action === "correct" ? "Corregido y confirmado" : "Rechazado" };
}
