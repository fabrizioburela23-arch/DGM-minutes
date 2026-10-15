/** Nombres de personas: normalización para comparar y lectura del nombre que Google Forms agrega a los archivos. */

/** "José  Alarcón " → "jose alarcon" (sin tildes, minúsculas, espacios simples). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Google Forms guarda cada archivo subido como "<nombre original> - <nombre de quien respondió>.<ext>".
 * "IMG_1308 - Ana Pérez.jpeg" → "Ana Pérez". Si el archivo no tiene ese formato, devuelve null.
 */
export function uploaderNameFromFile(fileName: string): string | null {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const idx = base.lastIndexOf(" - ");
  if (idx < 0) return null;
  const name = base.slice(idx + 3).trim();
  return name.length >= 2 ? name : null;
}

export type NamedPerson = { id: number; fullName: string; aliases: string[] };

/** Intérprete cuyo nombre o alias coincide exactamente (tras normalizar) con el nombre dado, si hay uno solo. */
export function matchByName<T extends NamedPerson>(name: string | null, people: T[]): T | null {
  if (!name) return null;
  const target = normalizeName(name);
  if (!target) return null;
  const hits = people.filter((p) => [p.fullName, ...p.aliases].some((n) => normalizeName(n) === target));
  return hits.length === 1 ? hits[0] : null;
}
