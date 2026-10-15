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

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const tokenOk = (want: string, have: string) => want === have || (want.length >= 5 && levenshtein(want, have) <= 1);

/**
 * Sugerencia por nombre parecido: todas las palabras del nombre registrado (mínimo 2) aparecen en el nombre del Form,
 * tolerando una letra de diferencia en palabras largas. "Josue Callapa" ← "Josue Callapa Andrade";
 * "Fabrizio Del Pozo" ← "Fabrizzio Del Pozo". Devuelve solo si hay un candidato. Es una pista: un gerente confirma.
 */
export function suggestByName<T extends NamedPerson>(name: string | null, people: T[]): T | null {
  const exact = matchByName(name, people);
  if (exact) return exact;
  if (!name) return null;
  const have = normalizeName(name).split(" ").filter(Boolean);
  const hits = people.filter((p) =>
    [p.fullName, ...p.aliases].some((n) => {
      const want = normalizeName(n).split(" ").filter(Boolean);
      return want.length >= 2 && want.every((w) => have.some((h) => tokenOk(w, h)));
    }),
  );
  return hits.length === 1 ? hits[0] : null;
}
