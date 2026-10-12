import { appConfig } from "@dgm/core";
import { GoogleDriveSource } from "@dgm/core/drive";
import { S3ObjectStore } from "@dgm/core/storage";
import { closeDb, getDb } from "@dgm/db";
import { runPass } from "./pass";

/** Una pasada completa del worker. Railway la corre cada 15 minutos y el proceso termina. */
async function main(): Promise<void> {
  const config = appConfig();
  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rootFolderId) throw new Error("Falta DRIVE_ROOT_FOLDER_ID");
  if (!serviceAccount) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");

  console.log(`[worker] pasada iniciada · zona ${config.timezone}`);
  const result = await runPass({
    db: getDb(),
    drive: new GoogleDriveSource(serviceAccount),
    store: new S3ObjectStore(),
    rootFolderId,
    log: console.log,
  });

  for (const alert of result.alerts) console.warn(`[worker] aviso: ${alert}`);
  console.log(
    `[worker] pasada #${result.runId} terminada · vistos ${result.filesSeen} · nuevos ${result.filesNew} · duplicados ${result.duplicates} · fallidos ${result.filesFailed}`,
  );
}

// Las librerías de Google y S3 dejan conexiones abiertas que impiden que Node termine solo.
// Railway no lanza la siguiente pasada del cron mientras esta siga viva, así que salimos explícitamente.
main()
  .catch((error: unknown) => {
    console.error("[worker] la pasada falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
