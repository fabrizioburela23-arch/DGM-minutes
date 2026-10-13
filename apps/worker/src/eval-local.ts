import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appConfig } from "@dgm/core";
import { ClaudeScreenshotReader } from "@dgm/core/reader";
import { compareReading, EVAL_FIELDS, type EvalRow, type Expected, summarize } from "./eval";

/**
 * `pnpm eval`: lee los screenshots reales de fixtures/real/ con los dos modelos y los compara con expected.csv
 * (archivo,portal_id,nombre,inicio,fin,llamadas,minutos). Necesita ANTHROPIC_API_KEY en el .env de la raíz.
 * Muestra valores leídos en pantalla: es solo para uso local, nunca en los logs de producción.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  // sin .env: se usan las variables del entorno
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function loadExpected(dir: string): Expected[] {
  const lines = readFileSync(join(dir, "expected.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const [file, portalId, , start, end, calls, minutes] = line.split(",").map((s) => s.trim());
    return { file, portalId, start, end, calls: Number(calls), minutes: Number(minutes) };
  });
}

async function main() {
  const dir = join(root, "fixtures/real");
  const expected = loadExpected(dir);
  const present = new Set(readdirSync(dir));
  const config = appConfig();
  const reader = new ClaudeScreenshotReader();
  const rows: EvalRow[] = [];

  for (const item of expected) {
    if (!present.has(item.file)) {
      console.warn(`Falta el archivo ${item.file}`);
      continue;
    }
    const image = readFileSync(join(dir, item.file));
    for (const model of [config.modelSmall, config.modelLarge]) {
      const { reading } = await reader.read(image, MIME[extname(item.file).toLowerCase()] ?? "image/png", model);
      const matches = compareReading(item, reading);
      rows.push({ file: item.file, model, matches });
      const bad = EVAL_FIELDS.filter((f) => !matches[f]);
      console.log(
        `${item.file} · ${model} · ${bad.length ? `falla: ${bad.join(", ")}` : "OK"} · leído ${reading.minutes} min, ${reading.calls} llamadas, ` +
          `${reading.periodStart}→${reading.periodEnd}, ID ${reading.portalInterpreterId}, confianza ${reading.confidence}`,
      );
    }
  }

  const summary = summarize(rows);
  console.log(JSON.stringify(summary.byModel, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
