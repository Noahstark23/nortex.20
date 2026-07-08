---
name: nortex-security-audit
description: Auditoría de seguridad e integridad de Nortex (auditar endpoints, buscar brechas cross-tenant, revisar manejo de dinero). Usar cuando se pida auditar, revisar seguridad, o antes de declarar seguro un subsistema. Los hallazgos van numerados (S-n) a docs/SECURITY_AUDIT.md.
---

# Auditoría de seguridad de Nortex

Las 6 capas del Security & Integrity Loop (CLAUDE.md) convertidas en **búsquedas
concretas**. Cada clase de bug de abajo YA ocurrió en este repo — buscarlas primero.

## Barrido por clase de bug (greps de arranque)

**Capa 1 — Cross-tenant (la clase más crítica):**
```bash
# updates/deletes por id suelto (sin tenantId en el where ni verificación previa)
grep -rnE "\.(update|delete)\(\{ *where: *\{ *id" backend/ --include=*.ts | grep -v node_modules
# findUnique por id de negocio (no verifica tenant)
grep -rnE "findUnique\(\{ *where: *\{ *id" backend/ --include=*.ts
# tenant tomado del body (PROHIBIDO)
grep -rnE "req\.body\.(tenantId|lenderId)" backend/
```
Patrón correcto: `findFirst({ where: { id, tenantId } })` antes de mutar, o el
filtro de tenant dentro del `updateMany`. En WhatsApp: el tenant viaja SOLO en
`ToolContext` server-side (nunca del modelo/usuario).

**Capa 3/4 — Dinero:**
```bash
grep -rnE "parseFloat|parseInt" backend/ --include=*.ts | grep -viE "req.query|page|limit"   # dinero con float?
grep -rnE "Math\.round\(.*\* *100\)" backend/    # redondeo float manual (usar Decimal)
```
- Toda mutación de dinero/stock → `AuditLog` con before/after **dentro de la tx**.
- Sumas de dinero → `Decimal.plus`, jamás `reduce((s,x)=>s+Number(x))`.

**Capa 5 — Entradas/inyección:**
```bash
grep -rnE "queryRawUnsafe|\\\$queryRaw\(\`" backend/    # raw SQL sin Prisma.sql = hallazgo
grep -rnE "app\.(post|put|patch)" backend/server.ts | grep -v "validate("   # rutas de dinero sin Zod
```
- Tokens/operadores del usuario hacia FULLTEXT/SQL: sanear a alfanumérico Y parametrizar.
- Secretos: `grep -rnE "(secret|password|key) *[:=] *['\"]" backend/` (fallbacks literales = hallazgo).

**Trampas Prisma/concurrencia (clases reales del repo):**
- `select` + `include` en la misma relación → throw silencioso.
- Leer→validar→escribir en pasos separados (TOCTOU) → debe ser UPDATE condicional
  (`updateMany({ where: {..., stock: { gte: qty } } })`).
- `upsert`/`create` sobre unique sin catch `P2002`.
- `take: N` + re-rank en JS → resultados arbitrarios a escala.

## Verificación adversarial
Todo hallazgo se **confirma con el código completo del handler** (leer el flujo
entero, no solo la línea del grep) antes de reportarlo: ¿hay una verificación de
propiedad arriba? ¿el middleware ya lo cubre? Falso positivo → descartar.

## Reporte
- Numerar S-n continuando `docs/SECURITY_AUDIT.md`; tabla: id · descripción ·
  archivo:línea · severidad (🔴/🟠/🟡) · estado (✅ FIXED / 📋 PLAN).
- Hotfixes de aislamiento/dinero: **corregir en el mismo PR** de la auditoría.
  Lo estructural (migraciones, soft-deletes) → plan por fases, un PR cada una.
- Actualizar el estado en `CLAUDE.md` §Estado actual si cambia lo "ya cumplido".
- Nunca declarar "seguro a nivel sistema": declarar el **alcance** auditado.
