import { createHash } from "node:crypto";
import type { DriveImage, DriveSource } from "@dgm/core/drive";
import type { ObjectStore } from "@dgm/core/storage";
import { type AnyDb, eq, inArray, interpreters, submissions, workerRuns } from "@dgm/db";

export type PassResult = {
  runId: number;
  filesSeen: number;
  filesNew: number;
  filesFailed: number;
  duplicates: number;
  alerts: string[];
};

type Log = (message: string) => void;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function extensionFor(file: Pick<DriveImage, "name" | "mimeType">): string {
  const fromName = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName === "jpeg" ? "jpg" : fromName;
  return EXT_BY_MIME[file.mimeType] ?? "bin";
}

/** Código del intérprete al inicio del nombre de carpeta: "T001 - Ana Pérez" → "T001". */
export function codeFromFolderName(name: string): string | null {
  const match = name.trim().match(/^([A-Za-z0-9]+)(?:\s*[-–—_ ]|$)/);
  return match ? match[1].toUpperCase() : null;
}

export function storageKey(code: string, file: Pick<DriveImage, "id" | "name" | "mimeType" | "createdTime">, now: Date): string {
  const when = file.createdTime ? new Date(file.createdTime) : now;
  const month = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
  return `interpreters/${code}/${month}/${file.id}.${extensionFor(file)}`;
}

/**
 * Una pasada del worker (hito 3, sin IA): vincula carpetas, detecta screenshots nuevos,
 * marca duplicados exactos, guarda una copia en el bucket y registra todo.
 * Es idempotente: correrla dos veces no duplica nada. Un archivo que falla no detiene la pasada.
 */
export async function runPass(deps: {
  db: AnyDb;
  drive: DriveSource;
  store: ObjectStore;
  rootFolderId: string;
  log?: Log;
  now?: () => Date;
}): Promise<PassResult> {
  const { db, drive, store, rootFolderId } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());

  const [run] = await db.insert(workerRuns).values({}).returning({ id: workerRuns.id });
  const result: PassResult = { runId: run.id, filesSeen: 0, filesNew: 0, filesFailed: 0, duplicates: 0, alerts: [] };

  try {
    const folders = await drive.listSubfolders(rootFolderId);
    const people = await db.select().from(interpreters).where(eq(interpreters.active, true));
    const byFolder = new Map(people.filter((p) => p.driveFolderId).map((p) => [p.driveFolderId!, p]));
    const byCode = new Map(people.map((p) => [p.code.toUpperCase(), p]));

    for (const folder of folders) {
      let person = byFolder.get(folder.id);

      // Vincula una carpeta nueva por el código al inicio de su nombre, si ese intérprete aún no tiene carpeta.
      if (!person) {
        const code = codeFromFolderName(folder.name);
        const candidate = code ? byCode.get(code) : undefined;
        if (candidate && !candidate.driveFolderId) {
          await db.update(interpreters).set({ driveFolderId: folder.id }).where(eq(interpreters.id, candidate.id));
          candidate.driveFolderId = folder.id;
          person = candidate;
          log(`[worker] carpeta ${folder.id} vinculada al intérprete #${candidate.id}`);
        }
      }

      if (!person) {
        result.alerts.push(`Carpeta sin intérprete: "${folder.name}" (${folder.id})`);
        continue;
      }

      const images = await drive.listImages(folder.id);
      result.filesSeen += images.length;
      if (images.length === 0) continue;

      const known = await db
        .select({ driveFileId: submissions.driveFileId })
        .from(submissions)
        .where(inArray(submissions.driveFileId, images.map((i) => i.id)));
      const knownIds = new Set(known.map((k) => k.driveFileId));

      for (const image of images) {
        if (knownIds.has(image.id)) continue;
        try {
          const bytes = await drive.download(image.id);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const key = storageKey(person.code, image, now());
          await store.put(key, bytes, image.mimeType || "application/octet-stream");

          const [twin] = await db
            .select({ id: submissions.id })
            .from(submissions)
            .where(eq(submissions.sha256, sha256))
            .limit(1);

          const inserted = await db
            .insert(submissions)
            .values({
              interpreterId: person.id,
              driveFileId: image.id,
              fileName: image.name,
              driveCreatedAt: image.createdTime ? new Date(image.createdTime) : null,
              sha256,
              storageKey: key,
              status: twin ? "duplicate" : "pending",
              reviewReason: twin ? `Imagen idéntica a la entrega #${twin.id}` : null,
            })
            .onConflictDoNothing({ target: submissions.driveFileId })
            .returning({ id: submissions.id });

          if (inserted.length > 0) {
            result.filesNew += 1;
            if (twin) result.duplicates += 1;
          }
        } catch (error) {
          result.filesFailed += 1;
          log(`[worker] archivo ${image.id} falló: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    await db
      .update(workerRuns)
      .set({
        finishedAt: now(),
        filesSeen: result.filesSeen,
        filesNew: result.filesNew,
        filesFailed: result.filesFailed,
        alerts: result.alerts,
      })
      .where(eq(workerRuns.id, run.id));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(workerRuns)
      .set({ finishedAt: now(), filesSeen: result.filesSeen, filesNew: result.filesNew, filesFailed: result.filesFailed, alerts: result.alerts, error: message })
      .where(eq(workerRuns.id, run.id));
    throw error;
  }
}

/** Anota un problema en la pasada (sin borrar lo que ya tenía) para que el dashboard pueda avisar. Solo IDs, nunca datos personales. */
export async function recordRunError(db: AnyDb, runId: number, message: string): Promise<void> {
  const [run] = await db.select({ error: workerRuns.error }).from(workerRuns).where(eq(workerRuns.id, runId));
  const error = run?.error ? `${run.error} · ${message}` : message;
  await db.update(workerRuns).set({ error }).where(eq(workerRuns.id, runId));
}
