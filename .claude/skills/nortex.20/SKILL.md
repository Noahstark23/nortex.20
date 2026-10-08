---
name: nortex-20
description: Punto de entrada a las reglas canónicas de Nortex y al método de desarrollo, QA y promoción por candidato identificado.
---

# Contribuir a Nortex

Leé por completo `AGENTS.md` y `CLAUDE.md`, ejecutá
`git status --short --branch` y preservá cambios, índice y rama existentes.
Esta skill orienta; no duplica políticas del dominio ni autoriza releases.

| Necesidad | Fuente operativa |
|---|---|
| Implementar, reparar o integrar | `.claude/skills/nortex-feature/SKILL.md` |
| Extraer módulos y reducir acoplamiento | `.claude/skills/nortex-clean-code/SKILL.md` |
| Verificar contratos, UI, dinero e inventario | `.claude/skills/nortex-qa/SKILL.md` |
| Smoke con recursos propios descartables | `.claude/skills/run-nortex/SKILL.md` |
| Promover un candidato | `docs/runbooks/release-promotion.md` y workflows de release vigentes |

Node `22.23.2` mediante `mise exec --`; npm/`package-lock.json`, Prisma `6.4.1`
local con `npx --no-install prisma`, MySQL 8. No leer/copiar secretos ni probar con
bases de usuarios. Identidad viene del JWT, cálculos usan Decimal, stock usa
`applyStockDelta` y efectos financieros requieren auditoría atómica.

La compuerta general no sustituye `mise exec -- npm run test:integration:required`
para dinero/inventario. Ese comando crea su MySQL efímero; no se le entrega una
conexión real. El registro de suites y los presupuestos de modularidad viven en
código: no usar cantidades históricas como condiciones actuales de aprobación.

Antes de delegar, acordar contratos, archivos y un propietario por dominio; los
archivos compartidos tienen un único integrador. No promover por acuerdo entre
agentes: la evidencia corresponde a un candidato exacto.

Commit, push, merge, deploy, webhooks, secrets, variables o protecciones solo dentro
del alcance autorizado. CI, staging y producción se verifican por separado según
el runbook y workflows actuales; un merge o un informe anterior no prueba despliegue.
