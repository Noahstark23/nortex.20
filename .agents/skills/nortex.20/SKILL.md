---
name: nortex-20
description: Reglas reales de contribución y promoción para Nortex ERP/POS.
---

# Nortex.20 — patrones de trabajo reales

Antes de editar, lee por completo `AGENTS.md` y `CLAUDE.md`, ejecuta
`git status --short --branch` y conserva todo cambio ajeno. Nortex maneja dinero e
inventario: el `tenantId` viene del JWT, dinero nuevo usa `decimal.js`, stock usa
`applyStockDelta`, y las mutaciones requieren auditoría atómica.

## Toolchain y pruebas

- Node `22.23.2` mediante `mise exec -- ...`; npm y `package-lock.json` son
  canónicos. Prisma es `6.4.1` con `npx --no-install prisma`; MySQL 8, no Postgres.
- La prueba es Vitest (`npm test`), con suites en `tests/**/*.test.ts` y verificación
  de tipos `npx tsc --noEmit`. Usa `npm run check:design` y `npm run build` para
  cambios de interfaz; no inventes comandos ni lockfiles alternos.
- Si cambia dinero o inventario, `npm run test:integration:required` es adicional
  y obligatorio: solo MySQL 8 temporal y datos sintéticos; una suite ausente,
  fallida u omitida impide aprobar el candidato.
- La app local segura es `nortex frontend` en `127.0.0.1:4174`; backend y Docker se
  levantan solo según los límites de `AGENTS.md`.

## Releases y agentes

CI, staging, aprobación del environment y producción son estados separados. Un
merge —incluido uno documental— solo ejecuta CI y no actualiza staging ni
producción. `release-staging.yml` es la única ruta a staging: SHA completo en
`main`, `STAGE <SHA>` exacto, CI terminal y revalidación posterior al environment.
`ci.yml` no contiene staging ni producción; la única ruta técnica a producción es
`.github/workflows/release-production.yml`, que exige SHA candidato completo,
`PROMOTE <SHA>`, staging sano y revalidación tras la aprobación.

No hagas push, merge, deploy, webhook ni cambies secrets, variables, reglas de
Environment o protección de ramas sin autorización explícita y separada. Consulta
`docs/runbooks/release-promotion.md`; los informes en `docs/releases/` son evidencia
histórica, no recetas ejecutables.
