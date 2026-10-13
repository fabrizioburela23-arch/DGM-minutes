import Anthropic from "@anthropic-ai/sdk";

/** Lo que la IA extrae de un screenshot del portal de Propio. Un dato ilegible va como null. */
export type ScreenshotReading = {
  minutes: number | null;
  calls: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  portalInterpreterId: string | null;
  portalInterpreterName: string | null;
  confidence: number;
  legible: boolean;
  extraFields: Record<string, unknown>;
};

export type ReadResult = { reading: ScreenshotReading; raw: unknown; model: string };

/** Lector intercambiable: el real usa Claude; las pruebas usan uno simulado. */
export interface ScreenshotReader {
  read(image: Buffer, mimeType: string, model: string): Promise<ReadResult>;
}

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImage(mimeType: string): mimeType is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

const TOOL_NAME = "registrar_lectura";

export const READING_INSTRUCTIONS = `Eres un lector de screenshots del portal de intérpretes de Propio (interpreters.propio-ls.com/portal).

Cómo es la pantalla:
- Arriba, en una franja: "Welcome, <nombre completo> (<ID numérico>)" y tres totales: "Calls: N", "Minutes: N", "Pay: $X".
- Debajo, "Call History" con dos campos "Start Date" y "End Date" (ej. "October 7, 2026") y una tabla de llamadas que puede estar paginada.

Qué debes leer:
- minutes: el número de "Minutes:" de la franja superior (entero, sin separadores de miles: "6,810" → 6810). NO sumes las filas de la tabla.
- calls: el número de "Calls:" de la franja superior.
- period_start y period_end: los campos "Start Date" y "End Date", en formato AAAA-MM-DD.
- portal_interpreter_id: el número entre paréntesis después del nombre.
- portal_interpreter_name: el nombre tal como aparece después de "Welcome,".
- legible: false si la imagen no es este portal o si los totales no se pueden leer.
- confidence: entre 0 y 1, qué tan seguro estás de minutes, calls y el rango de fechas en conjunto.
- extra_fields: solo datos visibles que ayuden a revisar, por ejemplo {"filas_en_tabla": "1 – 15 of 482"}. Nunca incluyas "Pay".

Reglas estrictas:
- Si un dato no se ve o no se puede leer con certeza, devuélvelo como null. Prohibido inferir, calcular o completar.
- No uses la fecha de la barra de tareas de Windows ni la de las filas de la tabla para el rango: solo Start Date y End Date.
- Responde únicamente llamando a la herramienta ${TOOL_NAME}.`;

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    minutes: { type: ["integer", "null"], description: "Total 'Minutes' de la franja superior" },
    calls: { type: ["integer", "null"], description: "Total 'Calls' de la franja superior" },
    period_start: { type: ["string", "null"], description: "Start Date en AAAA-MM-DD" },
    period_end: { type: ["string", "null"], description: "End Date en AAAA-MM-DD" },
    portal_interpreter_id: { type: ["string", "null"], description: "ID numérico entre paréntesis" },
    portal_interpreter_name: { type: ["string", "null"], description: "Nombre después de 'Welcome,'" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    legible: { type: "boolean" },
    extra_fields: { type: "object", additionalProperties: true },
  },
  required: [
    "minutes",
    "calls",
    "period_start",
    "period_end",
    "portal_interpreter_id",
    "portal_interpreter_name",
    "confidence",
    "legible",
    "extra_fields",
  ],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(n) && value.trim() !== "" ? Math.round(n) : null;
  }
  return null;
}

function toDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value.trim()) ? value.trim() : null;
}

function toText(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Convierte la respuesta cruda del modelo en una lectura limpia. Lo que no cumple el formato queda null. */
export function normalizeReading(input: Record<string, unknown>): ScreenshotReading {
  const confidence = typeof input.confidence === "number" ? Math.min(1, Math.max(0, input.confidence)) : 0;
  const extra = input.extra_fields && typeof input.extra_fields === "object" ? { ...(input.extra_fields as object) } : {};
  delete (extra as Record<string, unknown>).Pay;
  delete (extra as Record<string, unknown>).pay;
  return {
    minutes: toInt(input.minutes),
    calls: toInt(input.calls),
    periodStart: toDate(input.period_start),
    periodEnd: toDate(input.period_end),
    portalInterpreterId: toText(input.portal_interpreter_id)?.replace(/\D/g, "") || null,
    portalInterpreterName: toText(input.portal_interpreter_name),
    confidence,
    legible: input.legible === true,
    extraFields: extra as Record<string, unknown>,
  };
}

/** Lector real con la API de Anthropic y salida estructurada vía herramienta obligatoria. */
export class ClaudeScreenshotReader implements ScreenshotReader {
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
  }

  async read(image: Buffer, mimeType: string, model: string): Promise<ReadResult> {
    if (!isSupportedImage(mimeType)) throw new Error(`Formato de imagen no soportado: ${mimeType}`);

    const response = await this.client.messages.create({
      model,
      max_tokens: 1024,
      system: READING_INSTRUCTIONS,
      tools: [{ name: TOOL_NAME, description: "Registra los datos leídos del screenshot.", input_schema: TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: image.toString("base64") } },
            { type: "text", text: "Lee este screenshot y registra los datos." },
          ],
        },
      ],
    });

    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("El modelo no devolvió la lectura estructurada");
    const raw = block.input as Record<string, unknown>;
    return { reading: normalizeReading(raw), raw, model };
  }
}
