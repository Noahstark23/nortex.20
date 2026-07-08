---
name: nortex-feature
description: Loop de ingeniería para construir features en Nortex de punta a punta (recon → rama → schema/backend/frontend → rondas de QA → PR draft). Usar SIEMPRE que se implemente, refactorice o corrija código de Nortex — es el método de trabajo del proyecto, no una guía opcional.
---

# Loop de ingeniería de Nortex

Método probado con el que se construyó el sistema (mayoreo, multi-bodega, OC, series,
RAG de WhatsApp, dashboard admin). La regla madre: **verificar > asumir** — cada
edición se ancla leyendo el código real primero, y cada entrega se prueba antes
del push. Nada de "debería funcionar".

## Flujo (en orden, sin saltarse pasos)

### 0 · Entorno
```bash
git fetch origin main && git checkout -B claude/<feature> origin/main
npm install   # SIEMPRE tras cambiar de rama/rebase
```
⚠️ Sin `npm install`, `npx prisma` baja la **última versión del registry** (7.x),
que rechaza el schema 6.x con errores engañosos (`datasource url no soportado`).
El proyecto pinnea **prisma 6.4.1**. Verificar: `npx prisma --version`.

### 1 · Recon (antes de diseñar)
- `grep -rn` los términos del dominio: ¿ya existe algo? ¿dónde viven los patrones?
- Leer el modelo Prisma tocado, el handler análogo más cercano y el componente destino.
- Ubicar **anclas de edición exactas** (Read del bloque) — los line numbers se mueven;
  editar por string único, nunca por número de línea recordado.
- Si el pedido nombra un archivo ("Dashboard.tsx"), confirmar que ES el archivo real
  (el Command Center resultó ser `SuperAdmin.tsx`; la landing de prod es `landing.html`,
  no `LandingPage.tsx`).

### 2 · Diseño mínimo
- Elegir el diseño que **no toca el core**: capa aditiva > refactor. Ejemplos vivos:
  - Multi-bodega: `Product.stock` siguió siendo el agregado autoritativo; el desglose
    se construyó debajo con backfill perezoso.
  - Recepción de OC: goods-receipt separado de la factura → el path de dinero
    auditado quedó intacto.
  - Mayoreo: el precio efectivo se resuelve en el POS; el contrato de `executeSale`
    no cambió.
- Extraer la lógica de negocio como **función pura testeable** (ej: la regla de
  precios por cantidad al tope de `components/POS.tsx`) — es lo que permite la
  ronda de QA de casos.

### 3 · Implementación (orden fijo)
1. **Schema** (`backend/prisma/schema.prisma`): cambios **aditivos** con comentario
   del porqué. Validar: `DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma validate --schema=backend/prisma/schema.prisma`
2. **Migración** (`backend/prisma/migrations/<fecha>_<nombre>/migration.sql`):
   SQL MySQL (backticks). ⚠️ El deploy usa `prisma db push` que **solo aplica DDL,
   nunca DML** → los backfills de datos van en la aplicación (patrón perezoso:
   la primera escritura siembra la fila; carrera P2002 → el perdedor reintenta
   como incremento).
3. **Backend**: endpoints/handlers siguiendo los patrones obligatorios (abajo).
4. **Tipos compartidos** (`types.ts`) y **frontend** (interfaz local del componente
   también — varios componentes duplican su `interface Product`).
5. `npx prisma generate` tras tocar el schema (el router nuevo lo necesita para tipar).

### 4 · Rondas de QA (mínimo 4; los hallazgos SE CORRIGEN antes de seguir)
1. **Tipos/schema** — `npx tsc --noEmit` (0 errores nuevos) + `prisma validate` + `generate`.
2. **Lógica pura** — replicar la función de negocio en un `.cjs` en `/tmp` y correr
   casos reales + bordes (umbral exacto, borde −0.01, degradaciones con campos null/0,
   ida-y-vuelta, empates de precedencia, cantidades fraccionables). Esta ronda ha
   atrapado bugs de diseño reales (el doble conteo del backfill de bodegas se detectó
   aquí, no en producción).
3. **Aislamiento/integración** — grep de que TODA query nueva filtra por `tenantId`;
   verificar los call-sites afectados (checkout, carritos en espera, quick-create);
   raw SQL solo parametrizado (`Prisma.sql`), jamás concatenado.
4. **Build + regresión** — `npm run build` (si se tocó frontend); confirmar que los
   servicios core NO cambiaron (`git status backend/services/`); el default de todo
   flag nuevo debe preservar el comportamiento actual.
5. (Si aplica) **entorno/deploy** — ¿el Dockerfile ejecuta lo nuevo? ¿`db push`
   cubre el schema? ¿preview features deprecados?

### 5 · Entrega
- Commit en español: `feat|fix(<área>): <qué>` + cuerpo con el porqué, decisiones
  y resumen de QA. Nunca incluir el id del modelo en commits/PRs.
- `git push -u origin claude/<feature>` y **PR en DRAFT** contra `main` con:
  problema → solución (tabla por capa) → decisiones de diseño → rondas de QA con
  resultados → qué queda para la siguiente fase.
- Fases grandes = PRs separados y secuenciales (Fase A mergeada antes de construir B).

### 6 · Post-merge
- Si otro PR hermano toca líneas adyacentes (relaciones de `Tenant`/`Product`,
  imports/mounts de `server.ts`), verificar su mergeabilidad:
  `git merge-tree --write-tree origin/main origin/<rama>` → si conflictúa, resolver
  **conservando ambos lados** (las adiciones adyacentes casi nunca compiten).
- Si git "auto-mergea" mal (hunks injertados), tomar la versión completa de un lado
  (`git checkout --theirs`) y **re-aplicar quirúrgicamente** los cambios propios.
- Si un archivo quedó con versiones apiladas de merges manuales (campos duplicados,
  arrays sin cerrar), NO re-mezclar a mano: reconstruir desde git history
  (`git log --oneline -- <archivo>` → checkout del último estado limpio, ej. `<merge>^1`).

## Patrones obligatorios del repo

| Regla | Cómo |
|---|---|
| Tenant SOLO del JWT | `req.tenantId`/`req.userId`/`req.role` (los pone `authenticate`); JAMÁS del body/query. Toda query de negocio filtra por `tenantId`; `update/delete` por id → `findFirst({id, tenantId})` primero |
| Dinero | `decimal.js` (`new Decimal(x.toString())`), nunca `parseFloat` para calcular. `price/cost/wholesale/pack` son Float legacy → migran juntos a `Decimal(18,4)` (sweep pendiente); campos money NUEVOS no relacionados: `Decimal` |
| Stock | SIEMPRE vía `applyStockDelta` (`backend/services/stockService.ts`): UPDATE condicional atómico + row-lock + read-back; acepta `warehouseId` opcional. Nunca `product.update({stock})` directo |
| Auditoría | Operación que mueve dinero/inventario → `auditLog.create` con before/after **dentro de la misma transacción** |
| Validación | Zod en el body cuando hay dinero; inputs opcionales numéricos: `''`/null limpia → null, si viene valor → `> 0` finito; validación cruzada de updates parciales sobre el **estado final** (leer la fila existente) |
| Roles | Mutaciones sensibles: `checkRole(['OWNER','ADMIN','MANAGER'])` según el caso |
| Kardex | Todo movimiento de stock deja `KardexMovement` con `stockBefore/After` reales (del read-back, no calculados aparte) |
| Concurrencia | Guard + escritura en el MISMO UPDATE (`updateMany({where: {..., stock: {gte: qty}}})`); upsert con unique → catch `P2002` y reintentar como update |
| Respuestas | Errores en español nica; `res.status(4xx).json({error})`; 500 con `console.error` |

## Trampas conocidas (todas pasaron de verdad)
- **`npx` sin node_modules sincronizado** → prisma 7 fantasma. `npm install` primero.
- **`take: N` y re-rank en JS** → top-N arbitrario a escala; el ranking va en SQL
  (`ORDER BY` relevancia / FULLTEXT).
- **Prisma `select` + `include` en la misma relación** → throw silencioso (lista vacía).
- **Backfill que siembra con el agregado completo** → doble conteo si otras filas ya
  atribuyen parte; sembrar con `agregado − Σ otras` (SUM con `FOR UPDATE`).
- **`<button>` dentro de `<button>`** → HTML inválido; la affordance extra va en otra
  zona (la línea del carrito, no la tarjeta).
- **`parseInt` sobre cantidades** → trunca fraccionables (kg/litro); usar `parseFloat`.
- **Línea de carrito que sobreescribe `price`** sin guardar `basePrice` → no puede
  volver al precio de detalle al bajar cantidad.
- **Merges manuales de ramas paralelas** → versiones apiladas + build roto; ver §6.

## Definition of Done
- [ ] `tsc --noEmit` 0 errores nuevos · `prisma validate` OK
- [ ] Rondas de QA corridas y hallazgos corregidos (no documentados-y-dejados)
- [ ] Aislamiento por tenant verificado en todo lo nuevo
- [ ] Sin regresión: defaults preservan comportamiento; servicios core intactos
- [ ] `npm run build` OK si se tocó frontend
- [ ] Migración aditiva presente si se tocó el schema
- [ ] PR draft con QA documentada · `✓ Security & Integrity Loop superado` con su alcance
