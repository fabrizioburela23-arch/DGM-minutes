"use server";

import { normalizeName } from "@dgm/core/names";
import { and, eq, getDb, interpreters, ne } from "@dgm/db";
import { revalidatePath } from "next/cache";
import { importRoster, parseRoster } from "@/lib/roster";
import { requireAdmin } from "@/lib/session";

export type RosterState = { error?: string; done?: string } | null;

export async function importRosterAction(_prev: RosterState, form: FormData): Promise<RosterState> {
  await requireAdmin();
  const { rows, skipped } = parseRoster(String(form.get("roster") ?? ""));
  if (rows.length === 0) return { error: "No encontré ninguna fila. Pega una persona por línea: Nombre, Empresa, ID de Propio." };
  const { added, updated } = await importRoster(getDb(), rows);
  revalidatePath("/", "layout");
  return { done: `${added} agregados, ${updated} actualizados${skipped.length ? `, ${skipped.length} líneas ignoradas` : ""}` };
}

export async function updateInterpreterAction(_prev: RosterState, form: FormData): Promise<RosterState> {
  await requireAdmin();
  const id = Number(form.get("id"));
  const fullName = String(form.get("fullName") ?? "").trim().replace(/\s+/g, " ");
  const company = String(form.get("company") ?? "").trim() || null;
  const portalId = String(form.get("portalId") ?? "").replace(/\D/g, "") || null;
  const startDate = String(form.get("startDate") ?? "") || null;
  const aliases = String(form.get("aliases") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => normalizeName(a));
  if (!Number.isInteger(id) || normalizeName(fullName).length < 3) return { error: "Falta el nombre" };
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: "Fecha de inicio inválida" };
  const db = getDb();
  if (portalId) {
    const [taken] = await db
      .select({ name: interpreters.fullName })
      .from(interpreters)
      .where(and(eq(interpreters.portalId, portalId), ne(interpreters.id, id)))
      .limit(1);
    if (taken) return { error: `El ID ${portalId} ya es de ${taken.name}` };
  }
  await db.update(interpreters).set({ fullName, company, portalId, aliases, startDate }).where(eq(interpreters.id, id));
  revalidatePath("/", "layout");
  return { done: "Guardado" };
}

export async function setInterpreterActive(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get("id"));
  const active = form.get("active") === "true";
  if (!Number.isInteger(id)) return;
  await getDb().update(interpreters).set({ active }).where(eq(interpreters.id, id));
  revalidatePath("/", "layout");
}
