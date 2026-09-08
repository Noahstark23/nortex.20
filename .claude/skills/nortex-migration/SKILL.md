---
name: nortex-migration
description: Cambios de schema Prisma / base de datos en Nortex. Usar siempre al tocar backend/prisma/schema.prisma; MySQL 8, preflight DDL controlado, cambios aditivos y evidencia de upgrade/restauración.
---

# Migraciones en Nortex

Leer `CLAUDE.md`, `AGENTS.md`, `nortex-feature`, `nortex-deploy` y
`nortex-backup-recovery`. Preservar la rama y los cambios ajenos; trabajar en el
candidato aislado autorizado. MySQL 8 y Prisma 6.4.1 son obligatorios.

## Qué ejecuta el arranque

`scripts/docker-entrypoint.sh` espera MySQL, corre `db:preflight` y después
`db push --skip-generate`, sin `--accept-data-loss`. Los preflights inspeccionan
estado/DDL permitido; `db push` sincroniza schema, pero no ejecuta los SQL de
`backend/prisma/migrations/` ni transforma datos como un backfill de negocio.
Se ejecuta en cada arranque. Las recetas de esta skill no autorizan comandos
manuales contra una base real.

Un cambio incompatible puede detener el arranque. No garantizar que el contenedor
anterior continuará disponible: depende del reemplazo real de Coolify. Mantener
rollback de aplicación compatible y recuperación ensayada.

## Diseño del cambio

- Expansión aditiva: agregar tabla/columna compatible, escribir/leer con transición
  explícita y reconciliar antes de deprecar. No drop, rename ni reducción de precisión.
  Una ampliación de precisión existente también requiere revisar conversión,
  bloqueo DDL, compatibilidad y datos; no se aprueba solo porque dice ALTER.
- Un `UNIQUE` nuevo puede producir warning de pérdida de datos aunque sea expansión.
  No habilitar el flag global. Extender `scripts/deploy-schema-preflight.ts` con
  inspección de `information_schema`, verificación de duplicados/definición exacta,
  DDL acotado, recuperación desde estados parciales y revalidación idempotente.
  Ante datos incompatibles, detenerse; no corregir ni borrar filas automáticamente.
- Dinero nuevo usa Decimal/`decimal.js` y precisión del contrato, habitualmente
  `Decimal(18,4)`. Los Float monetarios legacy de Product no autorizan nuevos Float:
  su transición requiere expansión, backfill y comparación por agregado.
- Cantidades respetan BASE/PACK, paso y fracciones legítimas. No aplicar una regla
  global de enteros. Conservar tipos legacy cuando el contrato lo exija y diseñar
  precisión explícita para campos nuevos; lotes y farmacia requieren conciliación.
- Cada dato de negocio tiene autoridad de tenant derivada del backend autenticado;
  índices compuestos acompañan filtros/orden reales. Unicidad comercial es por
  tenant. Revisar relaciones inversas y políticas de borrado: no añadir cascadas
  que destruyan historia financiera o de inventario.
- Si se desglosa un agregado existente, definir primero la fuente autoritativa y
  su invariante. Un backfill perezoso debe bloquear/releer dentro de la transacción
  y tratar carreras sin duplicar saldos. Capturar P2002 no demuestra por sí solo
  que `SUM(desglose)=agregado`; probar convergencia, datos inconsistentes y rollback.

## Implementación y evidencia

1. Caracterizar conducta, permisos e invariantes antes del cambio; fijar un único
   integrador para schema, preflight y archivos compartidos.
2. Modificar `schema.prisma` y escribir el SQL espejo aditivo en
   `backend/prisma/migrations/<fecha>_<nombre>/migration.sql`, con sintaxis MySQL,
   nombres de índices/FKs coherentes y back-relations completas. Ese SQL documenta
   la transición; el arranque actual no lo ejecutará por ser una migración versionada.
3. Con Node 22.23.2 vía mise, validar/generar con URL dummy y Prisma local:
   ```sh
   DATABASE_URL="mysql://u:p@localhost:3306/db" mise exec -- npx --no-install prisma validate --schema=backend/prisma/schema.prisma
   DATABASE_URL="mysql://u:p@localhost:3306/db" mise exec -- npx --no-install prisma generate --schema=backend/prisma/schema.prisma
   ```
4. Probar upgrade desde schema poblado anterior, reejecución, estado parcial,
   duplicados, referencias e incompatibilidades con MySQL 8 descartable. Verificar
   que un rechazo no altere datos y que el `db push` posterior no pida data loss.
5. Ejecutar TypeScript y las compuertas aplicables. Dinero/inventario exige
   `test:integration:required` sin omitidos, auditoría atómica, concurrencia e
   idempotencia. Mutación pertinente conserva pisos y umbral.
6. Antes de promover schema a un entorno real, comprobar respaldo off-site y
   restore drill vigente de su base conforme a la skill de recuperación, CI y
   staging del mismo candidato. Un smoke sintético no acredita respaldo productivo.

Cierre: diff aditivo revisado, SQL espejo, cliente generado, índices/relaciones,
upgrade y fallos ejecutados, invariantes conciliadas, compatibilidad/rollback y
respaldo acreditados. Registrar implementación, pruebas y despliegue por separado.
