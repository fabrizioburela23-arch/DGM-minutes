import { normalizeName } from "@dgm/core/names";
import { type AnyDb, eq, interpreters } from "@dgm/db";

export type RosterRow = { fullName: string; company: string | null; portalId: string | null };

/**
 * Lee una lista pegada desde una hoja de cálculo: una persona por línea, columnas separadas por tab, ";" o ",".
 * Orden: Nombre, Empresa, ID de Propio (las dos últimas son opcionales). Ignora la fila de encabezados.
 */
export function parseRoster(text: string): { rows: RosterRow[]; skipped: string[] } {
  const rows: RosterRow[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",").map((c) => c.trim());
    const [name, company, id] = cells;
    if (!name || /^(name|nombre)$/i.test(name)) continue;
    const portalId = id?.replace(/\D/g, "") || null;
    if (normalizeName(name).length < 3) {
      skipped.push(line);
      continue;
    }
    rows.push({ fullName: name.replace(/\s+/g, " "), company: company || null, portalId });
  }
  return { rows, skipped };
}

/**
 * Agrega o actualiza intérpretes. Busca primero por ID de Propio y después por nombre (sin tildes ni mayúsculas).
 * Nunca borra ni desactiva a nadie: las bajas se hacen a mano en la página.
 */
export async function importRoster(db: AnyDb, rows: RosterRow[]): Promise<{ added: number; updated: number }> {
  const existing = await db.select().from(interpreters);
  let added = 0;
  let updated = 0;
  let next = existing.filter((i) => /^N\d+$/.test(i.code)).reduce((max, i) => Math.max(max, Number(i.code.slice(1))), 0);

  for (const row of rows) {
    const match =
      (row.portalId && existing.find((i) => i.portalId === row.portalId)) ||
      existing.find((i) => normalizeName(i.fullName) === normalizeName(row.fullName));
    if (match) {
      const patch: Partial<typeof interpreters.$inferInsert> = {};
      if (row.company && row.company !== match.company) patch.company = row.company;
      if (row.portalId && !match.portalId && !existing.some((i) => i.portalId === row.portalId)) patch.portalId = row.portalId;
      if (Object.keys(patch).length > 0) {
        await db.update(interpreters).set(patch).where(eq(interpreters.id, match.id));
        Object.assign(match, patch);
        updated += 1;
      }
      continue;
    }
    const code = row.portalId && !existing.some((i) => i.code === row.portalId) ? row.portalId : `N${String(++next).padStart(3, "0")}`;
    const [created] = await db
      .insert(interpreters)
      .values({ code, fullName: row.fullName, company: row.company, portalId: row.portalId })
      .returning();
    existing.push(created);
    added += 1;
  }
  return { added, updated };
}
