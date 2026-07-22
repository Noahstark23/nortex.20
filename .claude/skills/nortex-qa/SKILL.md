---
name: nortex-qa
description: Rondas de QA sobre código existente o un diff de Nortex ("haz QA", "5 pasadas", revisar un PR). Cada ronda usa un lente distinto y los hallazgos SE CORRIGEN, no solo se reportan. Para construir features usar nortex-feature (que ya incluye QA).
---

# Rondas de QA de Nortex

Cada pasada = un **lente distinto** sobre el mismo código. Verificar contra el código
real en disco (Read/grep), nunca contra la memoria de lo que "debería" decir.
Hallazgo confirmado → **se corrige y se re-verifica** en la misma sesión; solo se
deja anotado si requiere migración/decisión del CEO.

## Las pasadas (elegir 4–6 según el objetivo)

1. **Contrato de datos** — ¿el backend responde EXACTAMENTE lo que el frontend tipa?
   Campo por campo (el bug `totalAmount` vs `total` → `$NaN` fue de esta clase).
   Prueba decisiva cuando hay Decimal: `JSON.stringify(new Prisma.Decimal('1.5'))`
   → serializa **string**.
2. **Dinero/precisión** — replicar la función de cálculo en un `.cjs` en `/tmp`
   (con `require('/ruta/absoluta/node_modules/decimal.js')`) y correr casos:
   bordes exactos (11.99 vs 12), negativos sub-centavo (−0.001 → "−$0.00"?),
   ida-y-vuelta, redondeos ROUND_HALF_UP, prueba de no-float (0.1+0.2).
3. **Aislamiento multi-tenant** — grep de toda query nueva/tocada:
   `grep -nE "findFirst|findMany|update|delete|create" <archivo>` y confirmar
   `tenantId` (o verificación de propiedad previa) en CADA una. Raw SQL: solo
   `Prisma.sql` parametrizado; contar que la entrada del usuario nunca se concatena.
4. **Concurrencia/atomicidad** — ¿guard y escritura en el MISMO UPDATE?
   ¿AuditLog/Kardex dentro de la transacción? ¿upsert con catch P2002?
   ¿doble escritura mantiene el invariante (Σ desglose == agregado)?
5. **Integración/estado React** — refs colgantes a identificadores eliminados
   (`grep` de los nombres viejos), flujos secundarios: carritos en espera,
   quick-create, restore, offline-sync, scanner.
6. **Build/regresión/entorno** — `npx tsc --noEmit` (comparar contra la línea base
   de errores preexistentes, no exigir 0 global) · `npm run build` · servicios core
   intactos (`git status backend/services/`) · `npm install` hecho (prisma 6.4.1,
   no 7) · defaults preservan comportamiento.

## Reporte final
Tabla ronda → resultado (PASS / defecto encontrado → corregido), con los defectos
descritos como: qué entrada produce qué salida incorrecta. Los fixes van en commit
propio (`fix(<área>): QA — <qué>`) con el detalle de las rondas en el cuerpo.
