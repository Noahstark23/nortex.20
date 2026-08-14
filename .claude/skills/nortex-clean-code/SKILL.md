---
name: nortex-clean-code
description: Buenas prácticas de código y tests en Nortex — cómo escribir código limpio, testeable y que pase el mutation testing (separar lógica pura de Prisma, decimal.js, Zod, naming en español, vitest + Stryker). Usar al escribir o refactorizar cualquier módulo nuevo, al agregar funciones de dinero, o cuando un test/mutante falle. Complementa nortex-feature (método) y nortex-qa (verificación) — esta skill es el CÓMO se escribe.
---

# Clean code y tests en Nortex

Nortex maneja dinero real en un monolito grande (server.ts ~9.7k líneas). Código
nuevo NO agranda el problema: se escribe modular, puro donde se pueda, y testeable
desde el día uno. Regla madre: **si una función calcula dinero, tiene que poder
correrse sin base de datos** — eso decide toda la estructura.

## 1. Estructura: separá lo puro de lo impuro

- **Lógica pura** (cálculos, reglas de precio, fiscal, laboral) → función exportada
  SIN imports de Prisma/Express, que recibe valores y devuelve valores. Vive en
  `utils/` (frontend/compartido) o al tope del service (backend), ANTES de cualquier
  código con I/O. Ejemplos del repo: la regla de precios al tope de
  `components/POS.tsx`, `utils/calc-laborales.ts`, las funciones puras de
  `backend/services/nicaTax.ts`.
- **Orquestación impura** (Prisma, transacciones, HTTP) → llama a las puras. Nunca
  mezclar un cálculo de dinero inline dentro de un handler de 200 líneas.
- ¿Por qué tan estricto? El **mutation testing** (Stryker) solo puede morder lógica
  pura, y los archivos con Prisma se mutan por rango de líneas
  (`stryker.config.json` → `mutate`). Función de dinero nueva enterrada en un
  handler = invisible para la red de seguridad.

## 2. Dinero

- **`decimal.js` siempre**; `Number`/`parseFloat` prohibidos en cálculos. Cadena
  completa en Decimal y redondeo explícito (`ROUND_HALF_UP`) solo al presentar.
- Campos nuevos de schema: `Decimal(18,4)`. (`Product.price/cost` son Float legacy
  — NO copiar ese patrón; migran en su propio sweep.)
- Serialización: `Prisma.Decimal` → JSON emite **string**. El frontend tipa
  `string | number` y convierte con Decimal, no con `+valor`.
- Totales autoritativos **server-side** (patrón `executeSale`): el cliente propone,
  el servidor calcula y manda.

## 3. Entradas y errores

- Toda ruta que mueve dinero valida `req.body` con **Zod** (schema arriba del
  handler, `safeParse`, 400 con detalle). El tenant NUNCA viene del body/query:
  `req.tenantId` del middleware `authenticate`.
- Errores: fallar ruidoso y temprano. Nada de `catch {}` silencioso; si se traga
  un error a propósito (best-effort: email, evento), comentario de una línea con
  el porqué.
- No inventar helpers duplicados: antes de escribir uno, grep — el repo ya tiene
  `applyStockDelta`, `audit`, `ledger`, `secrets`. Reusar es la primera opción.

## 4. Estilo del repo

- **Español nicaragüense**: mensajes de UI y comentarios (voseo en UI). Nombres de
  código en inglés está bien (convención existente); textos al usuario jamás.
- Comentarios explican el **porqué** (decisión, trampa, regulación), no el qué.
  Densidad como la del archivo vecino — ni novela ni desierto.
- TypeScript estricto: sin `any` nuevos; tipos compartidos en `types.ts` cuando
  frontend y backend los comparten.
- Sin dependencias pesadas nuevas sin justificación (el bundle roza el límite de
  precache del PWA). Sin `new PrismaClient()` nuevos: importar
  `backend/lib/prisma.ts`.

## 5. Tests: la pirámide de Nortex

1. **Vitest** (`tests/*.test.ts`, `npm test`) para toda lógica pura nueva. Casos
   que valen: **bordes exactos** (el umbral justo, techo INSS, tope 30 días), el
   caso cero/negativo, y un caso de **número dorado** calculado a mano (no
   comparar la función contra sí misma — el bug clásico de aserción-identidad).
2. **Sondas `.cjs`** en el scratchpad para verificar comportamiento real en QA
   (`require('decimal.js')` con ruta absoluta) — desechables, no se commitean.
3. **Mutation testing** (`npm run test:mutation`, Stryker, en CI): si tocás
   `utils/calc-laborales`, `utils/pricing`, `services/loanMath` o las zonas puras
   de `nicaTax`/`stockService`/`accounting`, los tests deben **matar mutantes**,
   no solo pasar. Reglas duras:
   - El umbral (`stryker.config.json`) **solo sube**. Si tu cambio lo hunde, se
     arregla el test — nunca se baja el umbral ni se debilita una aserción.
   - Función de dinero nueva → agregarla al array `mutate` (por rango de líneas
     si el archivo toca Prisma) y al piso de `scripts/check-mutation-scope.cjs`.
   - Un mutante que sobrevive = un bug que tus tests no verían en prod. Se caza
     con una aserción de valor absoluto, no ajustando el mutante.

## 6. Definition of done

`npx tsc --noEmit` limpio (contra línea base) · tests nuevos verdes y matando
mutantes si aplica · `npm run build` si tocaste frontend · queries nuevas con
`tenantId` + índice en el mismo cambio · sin estado en memoria nuevo (ver
guardrails de CLAUDE.md) · commit `feat|fix(<área>):` con el porqué y el resumen
de QA. Para el proceso completo: skill **nortex-feature**; para verificación por
lentes: **nortex-qa**.
