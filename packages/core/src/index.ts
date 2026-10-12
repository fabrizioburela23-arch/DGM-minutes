export const APP_NAME = "DGM Minutos";

export type AppConfig = {
  timezone: string;
  maxMinutesPerDay: number;
  confidenceThreshold: number;
  modelSmall: string;
  modelLarge: string;
  hasDatabase: boolean;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Lee la configuración del entorno con valores por defecto razonables (ver CLAUDE.md). */
export function appConfig(): AppConfig {
  return {
    timezone: process.env.APP_TIMEZONE || "America/La_Paz",
    maxMinutesPerDay: numberFromEnv("MAX_MINUTES_PER_DAY", 720),
    confidenceThreshold: numberFromEnv("CONFIDENCE_THRESHOLD", 0.85),
    modelSmall: process.env.MODEL_SMALL || "claude-haiku-5-5",
    modelLarge: process.env.MODEL_LARGE || "claude-sonnet-5-5",
    hasDatabase: Boolean(process.env.DATABASE_URL),
  };
}
