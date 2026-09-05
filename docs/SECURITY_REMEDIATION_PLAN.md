# Plan de Remediación — Security & Integrity Loop

> **Revalidación 2026-09-04:** el cuerpo conserva el análisis histórico de su fecha.
> La evidencia actual está en [AUDITORIA_GENERAL_2026-09-04.md](AUDITORIA_GENERAL_2026-09-04.md)
> y la prioridad en [PLAN_TRANSFORMACION_TOTAL_2026.md](PLAN_TRANSFORMACION_TOTAL_2026.md).
> No ejecutar una receta antigua sin contrastarla con código, pruebas y reglas de integridad.
> Estado local, staging y producción se registran por separado.

> Supplier ya tiene archivado. Revalidar pendientes de auth/roles y efectos antes
> de repetir cambios históricos. No se ejecutó un escaneo de seguridad exhaustivo.

Plan por fases para llevar Nortex al estándar del **Security & Integrity Loop** (ver
`CLAUDE.md`). Cada hallazgo `Sx` referencia `docs/SECURITY_AUDIT.md`. Las fases están
ordenadas por **riesgo/esfuerzo**: primero lo crítico-barato, al final lo grande con migración.

---

## Fase 0 — ✅ HECHO en este PR (crítico, bajo riesgo)

- **S1–S4** Brechas de escritura cross-tenant cerradas (loans repayments/clients/refinance,
  credits/payment) con el patrón de propiedad `findFirst({where:{id,tenantId|lenderId}})`.
- **S20** Rate-limit en `register` (10/h) y `reset-password` (5/15min).
- **S23** Validación de monto `> 0` en `credits/payment` y `loans/:id/repayments`.
- Bug `req.user` → `req.userId/role/email` en loans.ts (crash en `/vault/deposit` + fuga intra-tenant a COLLECTOR).
- **S19** `.env.backup` removido del tracking.
- **S26** `scripts/backup-db.sh` (backup MySQL off-site).
- `CLAUDE.md` con el loop como gobernanza.

---

## Fase 1 — Urgente, SIN migración (1–3 días)

> **Estado:** las partes de **código/config** ya están aplicadas (1b docker-compose,
> 1c Zod en auth + endpoints de dinero, 1d login a 5/h, 1a password de super-admin a
> env). Quedan las **ops del CEO**: rotar los valores reales de los secretos, purgar el
> historial de git, y desplegar el cron de backup + bucket off-site.

### 1a. Rotación de secretos comprometidos (CEO) — S19, S25
- `JWT_SECRET`: generar nuevo. Gracias al **keyring** (`services/secrets.ts`), poné el nuevo
  como primero en `JWT_SECRETS` (CSV) y mantené el viejo unas horas para no expulsar
  sesiones; luego retiralo. **Sin downtime.**
- `DATABASE_URL`: rotar credenciales de MySQL.
- `createSuperAdmin.ts`: mover el password a env (`SUPERADMIN_PASSWORD`) y rotarlo.
- **Purga de historial:** `git filter-repo --path .env.backup --invert-paths` (o BFG) +
  force-push coordinado con el equipo.

### 1b. Endurecer infraestructura — S26, S27, S28
- `docker-compose.yml`: **no publicar** `3306:3306` (quitar el `ports` del servicio `db`;
  el `app` lo alcanza por la red interna). Exigir `DB_ROOT_PASSWORD` fuerte (sin default `root`).
- Sacar `phpmyadmin` del compose de producción (o protegerlo tras VPN/red interna).
- Desplegar el backup: cron diario de `scripts/backup-db.sh` a un bucket S3-compatible
  (DigitalOcean Spaces) con ciclo de vida (retención 30–90 días) y `BACKUP_ALERT_WEBHOOK`.
  Probar **una restauración** antes de declarar resuelto.

### 1c. Validación Zod en endpoints críticos — S21, S22 (parcial)
- Crear `RegisterSchema` (email válido, password `min(8)`) y `LoginSchema` (email válido,
  password presente — **sin** `min` para no bloquear cuentas viejas). Aplicar con el
  middleware `validate()` existente.
- Cablear los schemas que **ya existen** pero no se usan: `CreateSaleSchema` en `/api/sales`,
  `CreateExpenseSchema`. Agregar schemas money para loans (`z.number().positive()`) y
  `credits/payment`, `kardex/record`, `finance-purchase`.

### 1d. Endurecer login — S24
- `loginLimiter`: bajar a ~5, agregar llaveo por email/cuenta (no solo IP) o lockout tras N fallos.

**Verificación Fase 1:** `tsc --noEmit`; smoke test de login/registro/reset; restauración de
backup; confirmar `3306` no accesible desde fuera.

---

## Fase 2 — Precisión financiera por agregado (revisada 2026-09-04)

Product conserva precios/costos Float; ya hay columnas exactas en otros dominios.
La transición debe declarar la autoridad y redondeo de cada campo. La receta
histórica de un sweep global en una sola migración queda sustituida:

1. Inventariar columnas, consumidores y contratos de ventas, compras, devoluciones,
   caja, crédito y contabilidad; definir escala necesaria con el dueño del dominio.
2. Preparar backup restaurable y schema preflight antes de cambios productivos.
3. Expandir aditivamente un agregado con columnas exactas y compatibilidad explícita.
4. Backfill idempotente por lotes, comparación y reconciliación; no asumir que
   convertir Float corrige precisión histórica ya perdida.
5. Persistir Decimal/string exactos; `toNumber()` solo en límites de presentación
   justificados, nunca como regla para persistencia monetaria.
6. Probar historial, replays, redondeo, pagos parciales, devoluciones, stock y
   asientos con MySQL; exigir igualdad de invariantes y pruebas negativas.
7. Cambiar autoridad de lectura por agregado cuando la comparación sea aceptada,
   con rollback compatible. No borrar columnas ni usar --accept-data-loss.

La convivencia temporal tiene contrato y métricas explícitos. No mezclar fuentes
numéricas silenciosamente ni retirar compatibilidad antes de validar consumidores.

---

## Fase 3 — Archivado por agregado (revisada 2026-09-04)

Supplier ya tiene deletedAt. Priorizar Product y las cascadas históricas con el
responsable de inventario/ingeniería (T19 del plan maestro). No aplicar un
middleware global que transforme indiscriminadamente lecturas y borrados.

1. Definir baja comercial, restauración, retención y eliminación excepcional para
   cada agregado; declarar qué roles pueden ejecutarlas y registrar AuditLog atómico.
2. Ocultar archivados solo de catálogo operativo; históricos, devoluciones,
   conciliaciones y replays conservan acceso a sus referencias originales.
3. Revisar FK/cascadas de Kardex, lotes y conteos y preservar evidencia subordinada.
4. Definir unicidad de SKU/email según dominio; no liberar identificadores sin
   estudiar idempotencia, referencias, reactivación y colisiones.
5. Probar baja, listado, venta rechazada, histórico legible, replay idéntico y
   restauración con datos sintéticos. Mantener migraciones aditivas y reversión segura.

---

## Fase 4 — Auditoría robusta — S8–S14 (1 semana)

1. **Estructura:** agregar a `AuditLog` columnas `before Json?` / `after Json?` (además del
   `details`), y **inmutabilidad** a nivel BD: revocar `UPDATE`/`DELETE` al rol de la app, o
   trigger “append-only”, o encadenado por hash como ya hace el libro de caja (`ledger.ts`).
2. **Cobertura:** envolver en su transacción un `AuditLog.create` con before/after+userId+tenantId
   para: desembolso de préstamo (S8), pago de préstamo (S9), abono a crédito (S10),
   penalidad/refinanciamiento/bóveda (S11), desembolso de capital (S13), **cambio de precio**
   (S12), y las de nómina/wallet (S14).

**Verificación:** cada mutación de dinero deja exactamente un asiento con estados antes/después.

---

## Fase 5 — Validación sistémica y enforcement (continuo)

- **S22:** completar el rollout de Zod a todos los handlers que leen `req.body`.
- **S1 (MED) pedidos tracking:** quitar el teléfono del motorizado de la proyección pública
  o ponerlo tras un token opaco.
- **Enforcement automatizable** (lint/CI — esto SÍ puede ser un hook real):
  - Falla si un query Prisma de un modelo de negocio no incluye `tenantId`/`lenderId`.
  - Falla si aparece `Number(`/`parseFloat(` sobre campos monetarios.
  - Falla si un endpoint que lee `req.body` no pasa por `validate(...)`.

---

## Orden sugerido

`Fase 1 (rotar secretos + infra + Zod auth)` → `Fase 4 (auditoría money)` →
`Fase 2 (Decimal)` → `Fase 3 (soft-delete)` → `Fase 5 (sistémico)`.

Las Fases 0–1 cierran lo explotable hoy. Las 2–4 son deuda estructural con migración: una
por PR, con backup previo y verificación, nunca a medias.
