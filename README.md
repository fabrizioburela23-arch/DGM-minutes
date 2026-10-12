# DGM Minutos

Reporte automático de minutos para DGM Interpreters (Etapa 1 del Trainer AI de appgrade).

Los intérpretes suben un screenshot de sus minutos a su carpeta de Google Drive. Un worker lo lee con IA cada 15 minutos y los gerentes ven atrasos, minutos, entregas y screenshots en un dashboard.

## Estructura

| Carpeta | Qué es |
| --- | --- |
| `apps/web` | Dashboard para gerentes (Next.js) |
| `apps/worker` | Revisión de Drive y lectura con IA (corre cada 15 min en Railway) |
| `packages/db` | Esquema y migraciones de Postgres |
| `packages/core` | Lectura con IA, validaciones y cálculo de atrasos |

## Trabajar en local

```bash
corepack enable
pnpm install
cp .env.example .env   # y completa los valores
pnpm dev               # abre http://localhost:3000
```

El detalle técnico y el orden de trabajo están en `CLAUDE.md`.
