# DGM Minutos — Etapa 1 del Trainer AI (appgrade)

Sistema de reporte automático de minutos para DGM Interpreters. Cada intérprete sube un screenshot de sus minutos a su propia subcarpeta en Google Drive. Un worker revisa Drive cada 15 minutos, lee la imagen con IA y guarda el resultado en Postgres. Los gerentes usan un dashboard web con cuatro vistas.

## Cómo trabajar con el dueño del proyecto

- El dueño (Fabrizio, appgrade) no es programador. Explica en español simple qué hiciste, qué falta y qué tiene que hacer él, paso a paso.
- Nunca le pidas que pegue claves, contraseñas o el JSON de Google en el chat. Las claves van solo en las variables de Railway o en un `.env` local que nunca se sube a GitHub.
- Trabaja por hitos (ver "Orden de trabajo"). Al terminar cada uno: prueba, haz commit con un mensaje claro y resume en 3–5 líneas.
- Si falta un dato de DGM (ver "Pendientes de DGM"), no lo inventes: deja un valor configurable con un default razonable y avísale.

## Stack

- TypeScript, Node 20+, monorepo con pnpm:
  - `apps/web` — Next.js (App Router), Auth.js con proveedor Google, Tailwind.
  - `apps/worker` — script que hace una pasada completa y termina. Railway lo corre como cron `*/15 * * * *`.
  - `packages/db` — Drizzle ORM, esquema y migraciones de Postgres.
  - `packages/core` — lectura con IA, reglas de validación y cálculo de entregas/atrasos. Lo usan web y worker.
- Hosting: Railway, proyecto `astonishing-insight`, región EU West. Ya existen: el servicio `DGM-minutes` conectado a este repo, Postgres y el bucket `coordinated-drawer`. El worker será un segundo servicio del mismo repo, con cron. La configuración de Railway vive en la pantalla Settings de cada servicio, no en un `railway.json` (Railway ya no lo acepta para servicios nuevos): `DGM-minutes` construye con `pnpm --filter @dgm/web build`, arranca con `pnpm --filter @dgm/web start`, healthcheck `/api/health`, auto-deploy desde `main`, y paso pre-deploy `pnpm --filter @dgm/db migrate` (aplica migraciones antes de cada despliegue). URL pública: https://dgm-minutes-production.up.railway.app
- Google Cloud: proyecto `dgm-minutos`, API de Drive habilitada, cuenta de servicio `dgm-drive-lector@dgm-minutos.iam.gserviceaccount.com` sin roles (solo verá las carpetas que DGM le comparta).
- IA: API de Anthropic (`@anthropic-ai/sdk`). Modelo pequeño por defecto `claude-haiku-5-5`, modelo mayor `claude-sonnet-5-5`; ambos configurables por variable.
- Google Drive: paquete `googleapis` con cuenta de servicio, permiso de solo lectura (`drive.readonly`).
- Imágenes: Railway Storage Bucket (compatible S3) con `@aws-sdk/client-s3`. El bucket es privado: las imágenes se muestran con URL prefirmada de corta duración, solo a usuarios autenticados.
- Excel: `exceljs`.

## Variables de entorno

Mantén un `.env.example` con todas, sin valores reales.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Referencia a la variable del servicio Postgres de Railway |
| `ANTHROPIC_API_KEY` | Clave de la API de Anthropic |
| `MODEL_SMALL` / `MODEL_LARGE` | Modelos de lectura (defaults arriba) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON completo de la cuenta de servicio. Acepta JSON crudo o en base64 |
| `DRIVE_ROOT_FOLDER_ID` | ID de la carpeta raíz de DGM en Drive |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Bucket de imágenes en Railway. Ya configuradas en el servicio `DGM-minutes` como referencias al bucket `coordinated-drawer` |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Login de gerentes con Google (hito 5) |
| `APP_TIMEZONE` | Zona horaria por defecto: `America/La_Paz` hasta que DGM confirme |
| `CONFIDENCE_THRESHOLD` | Umbral para escalar al modelo mayor. Inicial: `0.85` |
| `MAX_MINUTES_PER_DAY` | Tope de validación. Inicial: `720` |
| `SEED_TEST_DATA` | `true` carga los 3 intérpretes de prueba en cada despliegue (sin duplicar). Activo en Railway; quitarlo cuando lleguen los datos reales |
| `SEED_ADMIN_EMAIL` | Opcional: correo que se registra como gerente admin al hacer seed |

Para crear una migración nueva: cambiar `packages/db/src/schema.ts`, correr `pnpm --filter @dgm/db generate` y probar con `pnpm --filter @dgm/db test` (Postgres en memoria).

## Modelo de datos

- `interpreters`: id, code (código interno DGM), full_name, email, drive_folder_id, active, start_date, notes.
- `delivery_rules`: frequency (`daily` | `weekly`), deadline_time, timezone, required_weekdays, holidays (lista de fechas). Una regla activa por ahora.
- `submissions`: id, interpreter_id, drive_file_id (único), file_name, drive_created_at, detected_at, sha256, storage_key, status (`pending` | `read` | `needs_review` | `confirmed` | `rejected` | `duplicate`), review_reason.
- `readings`: id, submission_id, model, minutes, work_date, extra_fields (jsonb), confidence (0–1), legible (bool), raw_response (jsonb), escalated (bool), created_at.
- `reviews`: id, submission_id, reviewer_email, action (`confirm` | `correct` | `reject`), old_values, new_values, note, created_at. Nunca se borran.
- `managers`: email, name, role (`manager` | `admin`), active.
- `worker_runs`: started_at, finished_at, files_seen, files_new, files_failed, error.

## Flujo del worker (una pasada)

1. Listar las subcarpetas de `DRIVE_ROOT_FOLDER_ID` y asociarlas a `interpreters` por `drive_folder_id`. Una carpeta sin intérprete se registra como alerta, no se procesa.
2. Listar imágenes (png, jpg, jpeg, webp, heic) que no existan en `submissions` por `drive_file_id`.
3. Descargar y calcular sha256. Si el hash ya existe: `status = duplicate`, va a la bandeja.
4. Subir una copia al bucket con clave `interpreters/<code>/<yyyy-mm>/<drive_file_id>.<ext>`.
5. Leer con `MODEL_SMALL` usando salida JSON estricta: `{ minutes, work_date, extra_fields, confidence, legible }`. Un dato que no se lee en la imagen va como `null`. Prohibido inferir o completar.
6. Validar (reglas abajo). Si la confianza es menor a `CONFIDENCE_THRESHOLD` o falla una regla, repetir con `MODEL_LARGE` y marcar `escalated`. Si sigue dudoso: `needs_review` con el motivo.
7. Registrar la pasada en `worker_runs`.

El worker es idempotente: correrlo dos veces seguidas no duplica nada. Un archivo que falla no detiene la pasada.

## Reglas de validación

Todas mandan a `needs_review`; ninguna corrige sola.

- `minutes` es null, negativo o mayor que `MAX_MINUTES_PER_DAY`.
- `work_date` es null, futura o de hace más de 14 días.
- Mismo sha256 que otra imagen (duplicado exacto).
- Mismo intérprete y misma `work_date` ya registrada (posible duplicado).
- Valor más de 3 veces la mediana de ese intérprete en los últimos 30 días.

## Entregas y atrasos

Para cada intérprete activo y cada día exigido por la regla, en la zona horaria de la regla:

- `entregado`: hay una submission con esa `work_date`, subida antes de la hora límite.
- `atrasado`: llegó después de la hora límite.
- `falta`: no hay nada y la hora límite ya pasó.
- `en revisión`: la única submission de ese día está en `needs_review`.

Días de atraso = días exigidos consecutivos, hasta hoy, en estado `falta`. Feriados y días no exigidos no cuentan.

## Dashboard (apps/web)

- Login con Google. Solo entran los correos activos en `managers`; cualquier otro ve "sin acceso".
- Todo en español, usable en celular.
- Vistas:
  1. **Atrasos** — quién no subió antes de la hora límite, días de atraso, historial del mes.
  2. **Minutos** — por día, semana y mes; ranking y total del equipo; filtro por fechas.
  3. **Entregas** — tabla intérprete × día con el estado.
  4. **Screenshots** — imagen, lectura de la IA, confianza y enlace al archivo en Drive.
- **Bandeja de revisión**: confirmar, corregir o rechazar; cada acción se guarda en `reviews`.
- **Descargar Excel** en cada vista, con los filtros aplicados.
- Los totales usan solo lecturas `read` o `confirmed`; lo que está en revisión se muestra aparte.

## Seguridad

- `.gitignore` incluye `.env*` (menos `.env.example`), `*.json` de credenciales y `fixtures/real/`.
- Los screenshots reales de DGM tienen datos personales: van en `fixtures/real/`, que nunca se sube a GitHub.
- Drive se usa solo en lectura. El sistema nunca borra ni mueve archivos de DGM.
- No escribir en logs nombres, minutos ni contenido de imágenes; solo IDs.

## Orden de trabajo (hitos)

1. **Esqueleto**: monorepo, `.env.example`, README corto, página "hola" desplegada en Railway.
2. **Base de datos**: esquema Drizzle, migraciones y seed con 3 intérpretes de prueba.
3. **Worker sin IA**: listar Drive, deduplicar, copiar al bucket, registrar submissions.
4. **Lectura con IA y validación**: más un script `pnpm eval` que lee `fixtures/real/` y un `expected.csv` (archivo, minutos, fecha) y reporta el porcentaje de aciertos.
5. **Dashboard**: login, cuatro vistas, bandeja de revisión y Excel.
6. **Producción**: cron de 15 minutos en Railway, copias de la base, y un aviso visible en el dashboard si el worker falla dos pasadas seguidas.

## Pendientes de DGM (no inventar)

- Regla de entrega: frecuencia, hora límite, zona horaria, días exigidos y feriados.
- Lista real de intérpretes y sus correos.
- Campos extra que importan además de los minutos.
- 10–20 screenshots reales con el valor correcto anotado.
- Si su plataforma exporta minutos o tiene API (cambiaría la fuente de datos).
