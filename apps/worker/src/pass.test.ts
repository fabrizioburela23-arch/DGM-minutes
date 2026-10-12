import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DriveFolder, DriveImage, DriveSource } from "@dgm/core/drive";
import type { ObjectStore } from "@dgm/core/storage";
import { interpreters, schema, seedTestData, submissions, workerRuns } from "@dgm/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { codeFromFolderName, runPass, storageKey } from "./pass";

class FakeDrive implements DriveSource {
  constructor(
    private folders: DriveFolder[],
    private images: Record<string, DriveImage[]>,
    private bytes: Record<string, string>,
    private broken = new Set<string>(),
  ) {}
  async listSubfolders() {
    return this.folders;
  }
  async listImages(folderId: string) {
    return this.images[folderId] ?? [];
  }
  async download(fileId: string) {
    if (this.broken.has(fileId)) throw new Error("descarga simulada fallida");
    return Buffer.from(this.bytes[fileId]);
  }
}

class FakeStore implements ObjectStore {
  keys: string[] = [];
  async put(key: string) {
    this.keys.push(key);
  }
}

const img = (id: string, name: string, createdTime = "2026-10-07T15:00:00Z"): DriveImage => ({
  id,
  name,
  mimeType: name.endsWith(".png") ? "image/png" : "image/jpeg",
  createdTime,
});

async function main() {
  // Funciones puras
  assert.equal(codeFromFolderName("T001 - Prueba Uno"), "T001");
  assert.equal(codeFromFolderName("t002_Ana"), "T002");
  assert.equal(codeFromFolderName("D014"), "D014");
  assert.equal(codeFromFolderName("  - sin código"), null);
  assert.equal(
    storageKey("T001", img("abc", "captura.jpeg", "2026-09-30T23:00:00Z"), new Date()),
    "interpreters/T001/2026-09/abc.jpg",
  );

  // Base en memoria con migraciones y datos de prueba
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
  await migrate(db, { migrationsFolder });
  await seedTestData(db);

  const drive = new FakeDrive(
    [
      { id: "fold-1", name: "T001 - Prueba Uno" },
      { id: "fold-2", name: "T002 - Prueba Dos" },
      { id: "fold-x", name: "Carpeta de alguien sin registrar" },
    ],
    {
      "fold-1": [img("f-a", "oct7.jpg"), img("f-b", "oct9.jpg", "2026-10-09T15:00:00Z"), img("f-bad", "rota.png")],
      "fold-2": [img("f-c", "copia.jpg")],
      "fold-x": [img("f-z", "z.jpg")],
    },
    { "f-a": "imagen A", "f-b": "imagen B", "f-c": "imagen A", "f-z": "imagen Z", "f-bad": "x" },
    new Set(["f-bad"]),
  );
  const store = new FakeStore();

  // Primera pasada
  const first = await runPass({ db, drive, store, rootFolderId: "root" });
  assert.equal(first.filesSeen, 4, "vistos: 3 en T001 + 1 en T002 (la carpeta sin intérprete no se procesa)");
  assert.equal(first.filesNew, 3);
  assert.equal(first.duplicates, 1, "f-c es idéntica a f-a");
  assert.equal(first.filesFailed, 1, "f-bad falla sin detener la pasada");
  assert.equal(first.alerts.length, 1);
  assert.match(first.alerts[0], /sin intérprete/);

  const linked = await db.select().from(interpreters).orderBy(asc(interpreters.code));
  assert.equal(linked[0].driveFolderId, "fold-1");
  assert.equal(linked[1].driveFolderId, "fold-2");
  assert.equal(linked[2].driveFolderId, null);

  const rows = await db.select().from(submissions).orderBy(asc(submissions.id));
  assert.deepEqual(
    rows.map((r) => [r.driveFileId, r.status]),
    [
      ["f-a", "pending"],
      ["f-b", "pending"],
      ["f-c", "duplicate"],
    ],
  );
  assert.match(rows[2].reviewReason ?? "", /idéntica a la entrega #\d+/);
  assert.ok(store.keys.includes("interpreters/T001/2026-10/f-a.jpg"));

  // Segunda pasada: nada nuevo, y el archivo roto se reintenta (sigue fallando)
  const second = await runPass({ db, drive, store, rootFolderId: "root" });
  assert.equal(second.filesNew, 0);
  assert.equal(second.filesFailed, 1);
  assert.equal((await db.select().from(submissions)).length, 3);

  const runs = await db.select().from(workerRuns).orderBy(asc(workerRuns.id));
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.finishedAt && r.error === null));

  // Una falla de Drive completa queda registrada en worker_runs
  const failingDrive: DriveSource = {
    listSubfolders: async () => {
      throw new Error("sin acceso a Drive");
    },
    listImages: async () => [],
    download: async () => Buffer.alloc(0),
  };
  await assert.rejects(runPass({ db, drive: failingDrive, store, rootFolderId: "root" }));
  const [last] = await db.select().from(workerRuns).where(eq(workerRuns.id, runs[1].id + 1));
  assert.equal(last.error, "sin acceso a Drive");

  console.log("[pass.test] OK: vinculación, duplicados, fallos aislados, idempotencia y registro de pasadas");
  await client.close();
}

main().catch((error: unknown) => {
  console.error("[pass.test] FALLÓ:", error);
  process.exit(1);
});
