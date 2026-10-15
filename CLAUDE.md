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
- Worker en Railway: servicio `DGM-worker` (duplicado del web), build `echo worker-sin-build`, start `pnpm --filter @dgm/worker start`, sin healthcheck ni pre-deploy, cron `*/15 * * * *` (UTC), auto-deploy desde `main`. Sus variables son copias de las del web más `DRIVE_ROOT_FOLDER_ID`. Si se rota una clave, hay que cambiarla en los dos servicios. Desde el 14 oct 2026 `DRIVE_ROOT_FOLDER_ID` apunta a la carpeta "Google Forms" de DGM, con `DRIVE_LAYOUT=form` y `DRIVE_SINCE=2026-10-01`. La carpeta de prueba "DGM Minutos – prueba" (T001–T003) ya no se usa; esos intérpretes de prueba están dados de baja y la bandeja los oculta.
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
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Login de gerentes con Google (hito 5). Cliente OAuth "DGM Minutos web" en el proyecto `dgm-minutos`, en modo prueba (solo usuarios de prueba de Google Cloud) |
| `AUTH_URL` | Opcional. URL pública del dashboard. Si falta, se arma con `RAILWAY_PUBLIC_DOMAIN` (sin esto Auth.js usa localhost:8080 detrás del proxy y Google responde `redirect_uri_mismatch`) |
| `APP_TIMEZONE` | Zona horaria por defecto: `America/La_Paz` hasta que DGM confirme |
| `CONFIDENCE_THRESHOLD` | Umbral para escalar al modelo mayor. Inicial: `0.85` |
| `MAX_MINUTES_PER_DAY` | Tope de validación. Inicial: `720` |
| `ADMIN_EMAILS` / `MANAGER_EMAILS` | Correos (separados por comas) que se agregan como administradores / gerentes en cada despliegue. Solo agregan: quitar el acceso se hace en la página Gerentes |
| `DEV_LOGIN_EMAIL` | Solo local con `next dev`: entra como ese correo sin Google. Ignorado en producción |
| `SEED_TEST_DATA` | `true` carga los 3 intérpretes de prueba en cada despliegue (sin duplicar). Activo en Railway; quitarlo cuando lleguen los datos reales |
| `SEED_ADMIN_EMAIL` | Opcional: correo que se registra como gerente admin al hacer seed |
| `DRIVE_LAYOUT` | Solo en `DGM-worker`. `form` = una sola carpeta (la del Google Form de DGM, archivos "captura - Nombre.png"); `folders` (por defecto) = una subcarpeta por intérprete |
| `DRIVE_SINCE` | Solo en `DGM-worker`. AAAA-MM-DD: ignora archivos de Drive creados antes (para no cargar el historial). Inicial: `2026-10-01` |
| `READ_BATCH_SIZE` | Máximo de entregas que la IA lee por pasada. Inicial: `25` |
| `EVAL_EXPECTED` | Solo en `DGM-worker`. Lista JSON `[{file (ID de Drive), minutes, calls, start, end, portalId}]` de screenshots de prueba. Si existe, el worker mide la precisión una vez por versión desplegada y guarda solo porcentajes en `eval_runs` |

## Pruebas y evaluación

- `pnpm test`: pruebas sin red (Postgres en memoria, Drive, bucket e IA simulados). Correrlas antes de cada commit.
- `pnpm eval`: lee con los dos modelos los screenshots de `fixtures/real/` y los compara con `fixtures/real/expected.csv` (`archivo,portal_id,nombre,inicio,fin,llamadas,minutos`). Necesita `ANTHROPIC_API_KEY` en el `.env` local. Muestra valores en pantalla: solo para uso local.
- En Railway, la evaluación corre sola con `EVAL_EXPECTED` y deja el resultado en el log del worker (`[eval] …`) y en `eval_runs`.

Para ver el dashboard en local: Postgres local en `DATABASE_URL`, `pnpm --filter @dgm/db migrate`, y `DEV_LOGIN_EMAIL=<correo de un gerente> pnpm dev`.

Para crear una migración nueva: cambiar `packages/db/src/schema.ts`, correr `pnpm --filter @dgm/db generate` y probar con `pnpm --filter @dgm/db test` (Postgres en memoria).

## Modelo de datos

- `interpreters`: id, code (ID de Propio si lo tiene; si no `N001`…), full_name, company (C-tel, Simplified, Interpredia), aliases (nombres con los que sube al Form), email, portal_id (ID en el portal de Propio), drive_folder_id, active, start_date, notes.
- `delivery_rules`: frequency (`daily` | `weekly` | `semimonthly`, texto), deadline_time, deadline_offset_days, timezone, required_weekdays, holidays. Una regla activa: **quincenal** (confirmado por DGM el 14 oct 2026), plazo 1 día después de cada corte a las 23:59 (plazo y hora pendientes de confirmar).
- `submissions`: id, interpreter_id (puede ser null hasta identificar al dueño), uploader_name (nombre que agrega Google Forms), drive_file_id (único), file_name, drive_created_at, detected_at, sha256, storage_key, status (`pending` | `read` | `needs_review` | `confirmed` | `rejected` | `duplicate`), review_reason.
- `readings`: id, submission_id, model, minutes, calls, period_start, period_end, portal_interpreter_id, portal_interpreter_name, extra_fields (jsonb), confidence (0–1), legible (bool), raw_response (jsonb), escalated (bool), created_at.
- `reviews`: id, submission_id, reviewer_email, action (`confirm` | `correct` | `reject`), old_values, new_values, note, created_at. Nunca se borran.
- `managers`: email, name, role (`manager` | `admin`), active.
- `worker_runs`: started_at, finished_at, files_seen, files_new, files_failed, alerts (jsonb), error.
- `eval_runs`: commit_sha (único), created_at, summary (jsonb: % de aciertos por campo y modelo, sin datos personales).

## Qué muestran los screenshots (portal de Propio)

Los intérpretes de DGM trabajan en `interpreters.propio-ls.com/portal`. El screenshot muestra:

- Arriba: "Welcome, <nombre> (<ID de portal>)" y tres totales: **Calls**, **Minutes**, **Pay** (Pay siempre $0.00; ignorarlo).
- Los totales corresponden al rango **Start Date – End Date** elegido en la página, no a un día fijo. Un mismo screenshot puede cubrir un mes entero.
- Abajo, la tabla de llamadas (Customer ID, fecha, hora, duración). Puede estar paginada: la fuente de verdad son los totales de arriba, no la suma de las filas visibles.

Consecuencias: la IA lee `minutes`, `calls`, `period_start`, `period_end`, `portal_interpreter_id` y `portal_interpreter_name`. El ID de portal se compara con `interpreters.portal_id` para detectar screenshots de otra persona.

## Cómo trabaja DGM hoy (visto en su Drive el 14 oct 2026)

- Los intérpretes suben el screenshot con un **Google Form**. Los archivos caen todos en la carpeta "Minute report (File responses)" → "Google Forms" (ID `1QGSGnBpw26H3MkopaIa8gcSa8JH6l8-LZixVaQtegWR5k5MQoX7sVtvSpyFjEm5EHDsT02Im`), con nombre "<original> - <nombre que escribió>.ext". La carpeta está compartida con `dgm-drive-lector`.
- Tres grupos, todos en Propio: C-tel y Simplified (hoja "Ctel-Simplified Minute report sheet 2026", con Interpreter ID) e Interpredia (hoja "Interpredia report sheet 2026", sin ID). "Agent List" está desactualizada.
- Reportan **cada 15 días** el **acumulado del mes** (Start Date = 1): uno al día 15 y otro con el mes completo. Hoy alguien copia esos números a mano en las hojas.
- El nombre del archivo no identifica bien (apodos, faltas de ortografía): manda el **ID de Propio** que lee la IA. El nombre es una pista y se aprende como alias al confirmar.

## Flujo del worker (una pasada)

Con `DRIVE_LAYOUT=form` el paso 1 es: listar las imágenes de la carpeta del Form (desde `DRIVE_SINCE`), tomar el nombre del archivo y buscarlo entre nombres y alias (solo si hay una coincidencia exacta). Al leer con IA, si el ID de Propio coincide con un intérprete activo, ese es el dueño; si no hay dueño, va a revisión para asignarlo a mano. Si el nombre y el ID apuntan a personas distintas, va a revisión.

1. Listar las subcarpetas de `DRIVE_ROOT_FOLDER_ID` y asociarlas a `interpreters` por `drive_folder_id`. Si no hay vínculo, se vincula por el código al inicio del nombre de la carpeta (`T001 - Nombre`) cuando ese intérprete aún no tiene carpeta. Una carpeta sin intérprete se registra como alerta en `worker_runs.alerts`, no se procesa.
2. Listar imágenes (png, jpg, jpeg, webp, heic) que no existan en `submissions` por `drive_file_id`.
3. Descargar y calcular sha256. Si el hash ya existe: `status = duplicate`, va a la bandeja.
4. Subir una copia al bucket con clave `interpreters/<code>/<yyyy-mm>/<drive_file_id>.<ext>`.
5. Leer con `MODEL_SMALL` usando salida JSON estricta: `{ minutes, calls, period_start, period_end, portal_interpreter_id, portal_interpreter_name, extra_fields, confidence, legible }`. Un dato que no se lee en la imagen va como `null`. Prohibido inferir o completar.
6. Validar (reglas abajo). Si la confianza es menor a `CONFIDENCE_THRESHOLD` o falla una regla, repetir con `MODEL_LARGE` y marcar `escalated`. Si sigue dudoso: `needs_review` con el motivo.
7. Registrar la pasada en `worker_runs`.

El worker es idempotente: correrlo dos veces seguidas no duplica nada. Un archivo que falla no detiene la pasada.

## Reglas de validación

Todas mandan a `needs_review`; ninguna corrige sola.

- `minutes` es null, negativo o mayor que `MAX_MINUTES_PER_DAY` × días del rango.
- `period_start` o `period_end` es null, futuro, o `period_end` es de hace más de 14 días.
- El rango no coincide con la regla de entrega (ej. regla diaria y el screenshot cubre varios días; regla quincenal y el rango no empieza el día 1 o abarca dos meses).
- Sin intérprete identificado (ID de Propio desconocido o ilegible).
- `portal_interpreter_id` no coincide con `interpreters.portal_id` (si el intérprete tiene uno cargado).
- Mismo sha256 que otra imagen (duplicado exacto; lo marca el worker sin IA).
- Mismo intérprete y rango que se superpone con otra lectura ya registrada (posible doble conteo). Con la regla quincenal los acumulados del mismo mes se superponen a propósito: se marca solo el mismo rango repetido, o un acumulado posterior con menos minutos.
- Valor más de 3 veces la mediana de ese intérprete en los últimos 30 días.

## Entregas y atrasos

Para cada intérprete activo y cada día exigido por la regla, en la zona horaria de la regla:

- `entregado`: hay una submission cuyo rango (`period_start`–`period_end`) cubre ese día, subida antes de la hora límite.
- `atrasado`: llegó después de la hora límite.
- `falta`: no hay nada y la hora límite ya pasó.
- `en revisión`: la única submission de ese día está en `needs_review`.

Días de atraso = días exigidos consecutivos, hasta hoy, en estado `falta`. Feriados y días no exigidos no cuentan.

Con la regla quincenal los periodos son quincenas (1–15 y 16–fin de mes): un screenshot cubre una quincena si su rango la abarca entera (el acumulado 1–15 cubre la 1ª, el 1–30/31 cubre las dos). La hora límite es el último día de la quincena + `deadline_offset_days`. Atrasos se cuentan en quincenas. En Minutos, el total del mes es el último acumulado; la 1ª quincena es el acumulado que cierra entre el 15 y el 20; la 2ª es la diferencia (si solo hay total, va entero a la 2ª). Nunca se suman dos acumulados.

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
- Implementación: lógica de entregas/atrasos en `packages/core/src/deliveries.ts`; consultas en `apps/web/lib/data.ts`; revisiones en `apps/web/lib/reviews.ts` (corregir = nueva lectura con `model = "manual"` + fila en `reviews`); Excel en `apps/web/lib/excel.ts` (`/api/excel/<vista>`). Los valores vigentes de una entrega son su última lectura.
- Un screenshot de varios días cuenta para todos los días de su rango en Entregas/Atrasos, y en Minutos se suma en la fecha final del rango.
- La hora límite de un día exigido es ese mismo día a `deadline_time` (pendiente de confirmar con DGM). Antes de `start_date` del intérprete (o de su fecha de alta) no se exige nada.
- Página **Gerentes** (solo admin): agregar correos y quitar/devolver acceso.
- Página **Intérpretes** (solo admin): importar la lista pegando columnas Nombre, Empresa, ID de Propio (`apps/web/lib/roster.ts`; agrega o completa, nunca borra), editar ID, empresa, alias y fecha de inicio, dar de baja. Al confirmar en Revisión un screenshot de alguien sin ID, el sistema guarda el ID leído y el nombre del Form como alias (`learnIdentity`).

## Producción (hito 6)

- Cron del worker: `*/15 * * * *` en `DGM-worker` (Railway).
- Copias de la base: copias del volumen de Postgres en Railway (pestaña Backups del servicio Postgres): diaria (se guarda 6 días), semanal (27 días) y mensual (89 días). Para restaurar: Postgres → Backups → elegir copia → Restore. Las copias viven dentro de Railway; no hay copia fuera de Railway.
- Aviso de fallas en el dashboard (`apps/web/lib/worker-health.ts`, se ve en todas las páginas):
  - error si las dos últimas pasadas terminadas fallaron (`worker_runs.error`, pasada colgada más de 20 min, o todos los archivos fallaron);
  - error si no hay pasadas en 45 min (el cron se detuvo);
  - advertencia si hay screenshots `pending` hace más de 1 hora (saldo o clave de Anthropic).
- El worker anota en `worker_runs.error` los fallos de la lectura con IA (`recordRunError`), además de los de Drive.
- Pie de página: hora de la última revisión de Drive.

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
- Confirmar que la pestaña Septiembre de cada hoja es el equipo actual (cargada el 14 oct 2026: 28 de C-tel/Simplified con ID y 23 de Interpredia sin ID). Primera prueba real: los 26 totales de septiembre de C-tel/Simplified leídos por la IA coinciden exactamente con la hoja que DGM llena a mano.
- Plazo exacto de cada corte quincenal (hoy: día 16 y día 1, 23:59).
- Compartir la hoja de respuestas del Google Form (hora exacta y correo de quien envía).
- Campos extra que importan además de los minutos.
- 10–20 screenshots reales con el valor correcto anotado. Hay 4 de prueba en `fixtures/real/` con su `expected.csv` (local, nunca en GitHub).
- ID de portal de Propio de los intérpretes de Interpredia (C-tel y Simplified ya lo tienen en su hoja).
- Si Propio le entrega a DGM un reporte de minutos por intérprete (como proveedor), que sería mejor fuente que el screenshot.
