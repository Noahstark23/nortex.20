---
name: nortex-migration
description: Cambios de schema Prisma / base de datos en Nortex (agregar modelos/campos, índices, migraciones). Usar SIEMPRE que se toque backend/prisma/schema.prisma — la BD es MySQL 8 y el deploy usa db push (solo DDL), lo que impone patrones específicos.
---

# Migraciones en Nortex (MySQL 8 + `db push`)

## Realidad del deploy (dicta todo lo demás)
El Dockerfile arranca con `npx prisma db push` (sin `--accept-data-loss`, ya se
quitó) → **aplica el schema como DDL y NUNCA ejecuta DML**. Consecuencias:
- Los backfills de datos **van en la aplicación** (patrón perezoso), no en SQL.
- Sin el flag, un rename/tipo incompatible **hace fallar el arranque** (la instancia
  vieja sigue viva) en vez de borrar datos → los cambios deben ser **ADITIVOS**
  igual (agregar columna/tabla nullable o con default). Rename = agregar nueva +
  migrar en app + deprecar.
- Igual se escribe el SQL en `backend/prisma/migrations/<YYYYMMDD>_<nombre>/migration.sql`
  (documentación + `migrate deploy` futuro). **Sintaxis MySQL**: backticks,
  `VARCHAR(191)`, `DATETIME(3)`, `DOUBLE`, `BOOLEAN`, `DECIMAL(18,4)`.

## Flujo
1. Editar `schema.prisma` (comentando el porqué del campo).
2. Relaciones: agregar el back-relation en TODOS los modelos tocados
   (`Tenant`/`Product` acumulan listas — añadir la línea adyacente; esto genera
   conflictos triviales keep-both entre PRs hermanos: avisarlo en el PR).
3. Validar y generar (sin BD real, con URL dummy):
   ```bash
   DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma validate --schema=backend/prisma/schema.prisma
   DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma generate --schema=backend/prisma/schema.prisma
   ```
   ⚠️ Si `validate` dice "datasource url no soportado" → estás corriendo prisma 7
   del registry: `npm install` primero (el repo pinnea 6.4.1).
4. Escribir el `migration.sql` espejo (aditivo, con FKs e índices con los nombres
   que Prisma genera: `Tabla_campo_idx`, `Tabla_campoA_campoB_key`).
5. `npx tsc --noEmit` (el client generado tipa el código nuevo).

## Patrones del repo
- **Dinero nuevo** → `Decimal @db.Decimal(18, 4)`. Excepción documentada: campos
  hermanos de `Product.price/cost` (Float legacy) se mantienen Float y migran
  juntos en el sweep pendiente.
- **Cantidades** → `Float` (unidades fraccionables: kg/litro/metro). Jamás `Int`
  para cantidades de venta.
- **Scoping** → todo modelo de negocio lleva `tenantId` + `@@index([tenantId])` +
  relación a `Tenant` (con `onDelete: Cascade` solo si el dato muere con el tenant).
- **Unicidad por tenant** → `@@unique([tenantId, campo])` (nunca unique global de
  un campo de negocio).
- **Backfill perezoso** (cuando una tabla nueva desglosa un agregado existente):
  la primera escritura siembra la fila con `agregado − Σ otras filas` (SUM con
  `FOR UPDATE`); carrera de creación → catch `P2002` y reintentar como incremento.
  Invariante a testear: Σ desglose == agregado.
- **FULLTEXT** → `@@fulltext([campos])` en el schema (GA en prisma 6.4, sin
  previewFeatures) + `MATCH ... AGAINST` vía `Prisma.sql`.

## Definition of Done
- [ ] Cambio aditivo (ninguna columna/tabla existente alterada o renombrada)
- [ ] `prisma validate` + `generate` OK con 6.4.1 · `tsc` 0 nuevos
- [ ] `migration.sql` espejo presente y en sintaxis MySQL
- [ ] Back-relations completas · índices de scoping
- [ ] Si hay backfill: es perezoso, race-safe (P2002) y con invariante verificado
