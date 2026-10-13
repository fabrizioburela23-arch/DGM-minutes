import { and, eq, getDb, managers } from "@dgm/db";

export type Manager = typeof managers.$inferSelect;

/** Gerente activo con ese correo, o null. */
export async function findManager(email: string): Promise<Manager | null> {
  const [row] = await getDb()
    .select()
    .from(managers)
    .where(and(eq(managers.email, email.trim().toLowerCase()), eq(managers.active, true)))
    .limit(1);
  return row ?? null;
}
