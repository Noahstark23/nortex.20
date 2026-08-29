# Nortex Agent Instructions

Nortex es un ERP/POS multi-tenant que maneja dinero e inventario reales. Antes de
modificar el producto, lee `CLAUDE.md` completo: es la fuente canónica de reglas de
dominio, seguridad, integridad, escalabilidad y QA para todos los agentes.

## Antes de tocar archivos

- Ejecuta `git status --short --branch` y preserva todo cambio existente del usuario.
- No cambies de rama, limpies, restaures, hagas rebase o alteres worktrees sin una
  solicitud explícita. Nunca uses `git clean`, `reset --hard` o equivalentes.
- No leas ni muestres `.env*`, llaves, tokens, credenciales o datos de producción.
- No hagas deploy, push, merge, cambios DNS, llamadas a webhooks ni mensajes externos
  salvo autorización explícita y separada.

## Toolchain canónico

- Node `22.23.2`, fijado en `.mise.toml`; usa `mise install` y `mise exec -- ...`.
- npm + `package-lock.json` son canónicos. No generes ni uses lockfiles de pnpm/yarn.
- Prisma está fijado a `6.4.1`; usa siempre el binario local con
  `npx --no-install prisma`.
- MySQL 8 es la base de datos. No asumas PostgreSQL.

## Desarrollo y verificación

- Frontend local seguro: `nortex frontend` (`127.0.0.1:4174`).
- Backend local: `nortex backend` (`127.0.0.1:3210`) después de `nortex db-up`.
- Integración Docker completa opcional: `nortex app-up` y `nortex app-down`.
- Compuerta rápida, sin deploy: `nortex check` o `sh scripts/ci-local-safe.sh`.
- La compuerta mínima es: Prisma generate, TypeScript, Vitest, sistema de diseño y
  build. Activa mutación con `NORTEX_CI_MUTATION=1` cuando cambie lógica de dinero.
- Los servicios locales viven en `~/Developer/Nortex`; no uses el Compose de
  producción para desarrollo general ni inicies su servicio de backup.

## Reglas de revisión

- Toda lectura/escritura de negocio debe quedar aislada por `tenantId` obtenido del
  JWT autenticado; nunca confiar en un tenant enviado por el cliente.
- Dinero nuevo usa Decimal/`decimal.js`; stock se mueve mediante `applyStockDelta`.
- Mutaciones de dinero o inventario requieren auditoría atómica en la misma transacción.
- Cambios de schema son aditivos y nunca usan `--accept-data-loss`.
- Trata cualquier valor de entorno como secreto y evita incorporarlo a bundles,
  fixtures, logs, capturas o respuestas del agente.
