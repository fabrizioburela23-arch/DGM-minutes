import { appConfig } from "@dgm/core";
import { GoogleDriveSource } from "@dgm/core/drive";
import { ClaudeScreenshotReader } from "@dgm/core/reader";
import { S3ObjectStore } from "@dgm/core/storage";
import { closeDb, getDb } from "@dgm/db";
import { parseExpectedJson, runEvalOnce } from "./eval";
import { recordRunError, runPass } from "./pass";
import { readPending } from "./read-pending";

/**
 * Una pasada completa del worker. Railway la corre cada 15 minutos y el proceso termina.
 * 1) Drive → registra screenshots nuevos y guarda copias. 2) IA → lee los pendientes y los valida.
 * 3) Si EVAL_EXPECTED está definida, mide la precisión una vez por versión desplegada.
 */
async function main(): Promise<void> {
  const config = appConfig();
  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rootFolderId) throw new Error("Falta DRIVE_ROOT_FOLDER_ID");
  if (!serviceAccount) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");

  const db = getDb();
  const store = new S3ObjectStore();

  console.log(`[worker] pasada iniciada · zona ${config.timezone}`);
  const result = await runPass({ db, drive: new GoogleDriveSource(serviceAccount), store, rootFolderId, log: console.log });
  for (const alert of result.alerts) console.warn(`[worker] aviso: ${alert}`);
  console.log(
    `[worker] pasada #${result.runId} · vistos ${result.filesSeen} · nuevos ${result.filesNew} · duplicados ${result.duplicates} · fallidos ${result.filesFailed}`,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[worker] sin ANTHROPIC_API_KEY: no se leen screenshots con IA");
    return;
  }
  const reader = new ClaudeScreenshotReader();
  const reading = await readPending({
    db,
    store,
    reader,
    settings: {
      modelSmall: config.modelSmall,
      modelLarge: config.modelLarge,
      confidenceThreshold: config.confidenceThreshold,
      maxMinutesPerDay: config.maxMinutesPerDay,
      timezone: config.timezone,
      batchSize: Number(process.env.READ_BATCH_SIZE || 25),
    },
    log: console.log,
  }).catch(async (error: unknown) => {
    await recordRunError(db, result.runId, `Lectura con IA: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  });
  if (reading.failed > 0 && reading.read + reading.needsReview === 0) {
    // Ninguna lectura salió: suele ser falta de saldo o una clave inválida. Queda anotado para el aviso del dashboard.
    await recordRunError(db, result.runId, `La IA no pudo leer ${reading.failed} screenshot(s)`);
  }
  console.log(
    `[worker] lectura IA · aceptadas ${reading.read} · a revisión ${reading.needsReview} · escaladas ${reading.escalated} · fallidas ${reading.failed}`,
  );

  const expected = process.env.EVAL_EXPECTED;
  if (expected) {
    const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA || "local";
    const summary = await runEvalOnce({
      db,
      store,
      reader,
      models: [config.modelSmall, config.modelLarge],
      expected: parseExpectedJson(expected),
      commitSha,
      log: console.log,
    });
    if (!summary) console.log(`[eval] ya evaluada la versión ${commitSha.slice(0, 7)}`);
  }
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
