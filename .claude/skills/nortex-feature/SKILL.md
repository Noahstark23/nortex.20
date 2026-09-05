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
- Leer `AGENTS.md`, `CLAUDE.md`, `git status --short --branch` y versiones del runtime.
- Con cambios existentes, conservar checkout, índice y rama. Preparar un candidato
  aislado que incluya esos cambios si son parte del producto revisado; documentar
  origen y comparar hashes antes de reintegrar. No usar `checkout -B`, reset, clean,
  rebase o reemplazos completos de archivos para preparar una reparación.
- Usar dependencias bloqueadas (`npm ci` en el candidato cuando haga falta).
  El proyecto fija Prisma 6.4.1; no descargar una versión distinta con `npx`.
- No leer secretos ni conectar una base real para pruebas. Generar credenciales
  efímeras y mantenerlas fuera del repositorio y de los reportes.

### 1 · Recon (antes de diseñar)
- `rg -n` los términos del dominio: ¿ya existe algo? ¿dónde viven los patrones?
- Leer el modelo Prisma tocado, el handler análogo más cercano y el componente destino.
- Ubicar **anclas de edición exactas** (Read del bloque) — los line numbers se mueven;
  editar por string único, nunca por número de línea recordado.
- Si el pedido nombra un archivo ("Dashboard.tsx"), confirmar que ES el archivo real
  (el Command Center resultó ser `SuperAdmin.tsx`; la landing de prod es `landing.html`,
  no `LandingPage.tsx`).

### 2 · Diseño mínimo
- Definir contrato, propietario de cada archivo y comprobación de aceptación.
- Reparar la autoridad existente de dinero/inventario; no construir un motor
  alternativo para esquivar el defecto. Extraer responsabilidades al intervenirlas
  con pruebas del comportamiento previo. No elevar presupuestos para acomodar deuda.
- Elegir el cambio más pequeño que resuelve el caso y sus efectos relacionados.
  Un cambio aditivo también puede aumentar riesgo: justificarlo con evidencia.

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

### 4 · Rondas de QA
1. **Reproducción**: una prueba contra la función o ruta real falla antes de la
   reparación. No copiar fórmulas a `.cjs`: una réplica puede pasar mientras el
   producto sigue roto. Aseverar resultados independientes y efectos persistidos.
2. **Regresión y tipos**: casos límite, errores, tenant/roles y sesión; `tsc --noEmit`,
   Prisma validate y build si corresponde. No rebajar aserciones para ocultar fallos.
3. **Dinero e inventario**: `npm run test:integration:required` con MySQL 8 local,
   `DATABASE_URL` de base `nortex_qa`, `nortex_quality` o `nortex_test` y
   `NORTEX_QA_DATABASE_ACK=disposable-database`. Preparar el schema únicamente allí.
   El runner inicia su backend, genera claves temporales, exige salud y ejecuta todas
   las suites requeridas sin omisiones. Reintentos, duplicados, rollback y conflictos
   se verifican por sus efectos, no solo por HTTP 200.
4. **Diseño y mutación**: `npm run check:design` y `npm run test:mutation` cuando aplica.
   Realinear rangos Stryker si se mueven funciones; mantener el umbral y comprobar
   mutantes ejecutados. No presentar un porcentaje parcial como cobertura global.
5. **Navegador**: recorrer el flujo afectado en el candidato y documentar resolución,
   datos sintéticos y resultado. Separar QA de software de equipos físicos y usuarios.

### 5 · Entrega
- Registrar archivos, motivación, pruebas con conteos, fallos resueltos y límites.
- Reintegrar solo cambios propios después de comprobar que el origen no cambió;
  preservar el trabajo previo y el estado del índice.
- Un commit o PR autorizado describe el problema y el comportamiento resultante.
  No ejecutar push, merge o despliegue por ser el siguiente paso de esta guía.
- Antes de promover se exige CI del candidato y staging del mismo SHA; producción
  conserva su autorización y verificación propias. Un resultado local no las sustituye.

### 6 · Integración y conflictos
- Inspeccionar ambos lados y el ancestro. Resolver en aislamiento, conservando los
  cambios ajenos; no reemplazar archivos enteros con `--theirs` ni con versiones viejas.
- Volver a ejecutar las comprobaciones afectadas por la resolución y documentar el
  candidato preciso. Si cambian los archivos originales, integrar el cambio nuevo
  antes de aplicar el parche, sin sobreescribirlo.

## Patrones obligatorios del repo

| Regla | Cómo |
|---|---|
| Tenant SOLO del JWT | `req.tenantId`/`req.userId`/`req.role` (los pone `authenticate`); JAMÁS del body/query. Toda query de negocio filtra por `tenantId`; `update/delete` por id → `findFirst({id, tenantId})` primero |
| Dinero | `decimal.js` (`new Decimal(x.toString())`), nunca `parseFloat` para calcular. `price/cost/wholesale/pack` siguen siendo Float legacy en este schema; su migración exige expansión, backfill y conciliación por agregado, sin sweep global. Campos monetarios nuevos: `Decimal` con precisión explícita |
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
