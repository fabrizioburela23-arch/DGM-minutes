"use server";

import { eq, getDb, managers } from "@dgm/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";

export type ManagerState = { error?: string; done?: string } | null;

/** Agrega un gerente nuevo (o reactiva uno existente con el rol elegido). Solo administradores. */
export async function addManager(_prev: ManagerState, form: FormData): Promise<ManagerState> {
  await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim() || null;
  const role = form.get("role") === "admin" ? "admin" : "manager";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Escribe un correo válido" };
  await getDb()
    .insert(managers)
    .values({ email, name, role })
    .onConflictDoUpdate({ target: managers.email, set: { name, role, active: true } });
  revalidatePath("/gerentes");
  return { done: `${email} ya puede entrar` };
}

export async function setManagerActive(form: FormData): Promise<void> {
  const me = await requireAdmin();
  const email = String(form.get("email") ?? "");
  const active = form.get("active") === "true";
  if (email === me.email && !active) return; // nadie se quita el acceso a sí mismo por error
  await getDb().update(managers).set({ active }).where(eq(managers.email, email));
  revalidatePath("/gerentes");
}
