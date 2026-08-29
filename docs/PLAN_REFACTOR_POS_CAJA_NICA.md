# Plan de ingeniería para refactorizar el POS Caja Nica

**Fecha:** 2026-08-27  
**Estado:** aprobado para planificación; implementación todavía no iniciada  
**Veredicto de revisión:** `REQUEST CHANGES` antes de seguir agregando funciones a
`components/POS.tsx`

## 1. Objetivo

Convertir el POS actual en un orquestador pequeño, con fronteras explícitas entre
interfaz, estado, reglas puras e IO. La refactorización debe conservar exactamente
el comportamiento observable y no puede debilitar las garantías de dinero,
inventario, caja, aislamiento multi-tenant, idempotencia ni operación offline.

La meta no es repartir 7,458 líneas entre archivos arbitrarios. La meta es que cada
flujo tenga un dueño claro, un contrato pequeño y pruebas que detecten cambios de
comportamiento.

## 2. Alcance y no objetivos

Incluye:

- POS autenticado, carrito, búsqueda y catálogo;
- apertura, toma y cierre de turno;
- efectivo, otros medios, fiado y postventa;
- ventas aparcadas y traspaso desde cotizaciones;
- cola y replay offline;
- escáner, balanza y etiquetas;
- devoluciones y anulación;
- impresión y WhatsApp;
- componentes, hooks, adaptadores y pruebas del frontend;
- contratos backend que protegen la identidad del turno y del empleado.

No incluye:

- rediseñar otra vez la experiencia visual;
- cambiar reglas fiscales, precios, stock o contabilidad;
- reescribir el backend de ventas;
- introducir un framework de estado nuevo por defecto;
- hacer un big-bang rewrite;
- mezclar esta deuda con funciones nuevas.

## 3. Línea base verificada

La medición se hizo sobre el worktree del 27 de agosto de 2026:

| Métrica | Estado actual |
|---|---:|
| Líneas de `components/POS.tsx` | 7,458 |
| Líneas del componente `POS` | 6,931 |
| Llamadas a `useState` dentro de `POS` | 121 |
| Efectos (`useEffect` + `useLayoutEffect`) | 28 |
| `useCallback` | 42 |
| `useMemo` | 17 |
| `fetch(...)` directos | 30 |
| accesos directos a `localStorage` | 45 |
| nodos JSX aproximados | 1,012 |
| tamaño minificado del chunk POS observado | 338.60 kB |

Ya existen buenos puntos de apoyo:

- `components/pos/CajaNicaCatalog.tsx`;
- `components/pos/CajaNicaCheckout.tsx`;
- `utils/posActivation.ts`;
- `utils/posCash.ts`;
- `utils/posSearch.ts`;
- `utils/cartPersistence.ts`;
- `backend/services/salesService.ts` como autoridad de venta, total, stock e
  idempotencia.

La deuda está en la orquestación central: estado visual, reglas, red, almacenamiento,
dispositivos y navegación comparten el mismo closure de React.

## 4. Hallazgos de la revisión de código

### P0 — una venta offline puede entrar sin turno

`backend/routes/sync.ts` pasa `sale.shiftId ?? null`. En
`backend/services/salesService.ts`, el replay offline solo valida el turno cuando
`shiftId` existe. Una venta con `shiftId: null` puede crear venta, descontar stock y
asentar dinero sin quedar ligada a un arqueo.

Riesgo: integridad financiera y trazabilidad de caja.

Decisión:

- toda venta POS offline nueva debe tener `shiftId`;
- el turno debe pertenecer al tenant y al usuario autenticado;
- puede estar cerrado al momento del replay, porque la venta ocurrió antes, pero no
  puede ser inexistente ni ajeno;
- filas legacy sin turno pasan a conciliación; no se reconocen silenciosamente como
  venta.

### P1 — el replay offline confía en `employeeId` del navegador

`normalizeOfflineSalePayload` conserva `employeeId` y `salesService` solo verifica
que ese empleado exista en el tenant. La ruta online ya corrige esto derivándolo del
turno; la ruta offline no.

Riesgo: atribución falsa de venta, comisión o responsabilidad de caja.

Decisión: el servidor deriva `employeeId` del turno validado. El valor del payload
solo sirve para detectar divergencia y mandar el caso a conciliación.

### P1 — el traspaso cotización → POS usa una clave global

`components/QuotationManager.tsx` escribe `nortex_pending_cart` y
`components/POS.tsx` la consume sin namespace de tenant/usuario. En una terminal
compartida puede mostrarse un carrito de la sesión anterior antes de que el backend
rechace los IDs al cobrar.

Riesgo: exposición cruzada de datos y carrito fantasma.

Decisión: crear un payload versionado y una clave namespaceada por
`tenantId:userId`; validar identidad y expiración al consumirlo. No se intentará
“firmar” un payload con una llave dentro del navegador.

### P1 — ventas aparcadas no respetan la misma política de turno

El carrito principal usa `decidirRestauracion`, pero `handleRestoreCart` permite
restaurar cualquier venta aparcada aunque su `shiftId` sea de otro turno. El
bootstrap también puede aparcar el snapshot inicial capturado por un closure después
de que la política de restauración ya lo rechazó.

Riesgo: una venta vieja puede reaparecer bajo otro arqueo o cajero.

Decisión: unificar carrito principal, traspaso y aparcados bajo una sola política de
restauración. Ninguna restauración cruza turno sin una decisión explícita y auditable.

### P2 — el fallback offline captura errores que no son de red

El `try/catch` de `handleCheckout` cubre el POST y todas las actualizaciones locales
posteriores. Cualquier `TypeError`, incluso después de un `200`, se clasifica como red
y encola la venta.

Riesgo: estado offline falso, replays innecesarios y diagnóstico engañoso. La
idempotencia reduce el riesgo de duplicado, pero no corrige la inconsistencia local.

Decisión: separar `submitSaleOnline`, `queueSaleOffline` y `applyConfirmedSale`. Solo
el adaptador de red puede solicitar fallback offline.

### P2 — búsquedas de clientes pueden resolverse fuera de orden

Las solicitudes de sugerencias no se abortan ni tienen un identificador monotónico.
Una respuesta vieja puede pisar resultados nuevos.

Decisión: el adaptador usa `AbortController` o un request token y descarta respuestas
obsoletas.

### P2 — deuda de accesibilidad y modales

Movimiento de caja, agente bancario y cierre de turno no comparten un contrato de
diálogo. Foco, `Escape`, bloqueo durante submit y semántica accesible se implementan
de forma distinta.

Decisión: una primitiva compartida controla foco, cierre, `role="dialog"`,
`aria-modal`, scroll y estado ocupado.

### Deuda de pruebas

Hay buena cobertura de helpers y subcomponentes, pero no existe una suite que
renderice el POS autenticado completo. Varias pruebas leen `POS.tsx` como texto y
buscan substrings. Esas pruebas pueden impedir renombres sanos y aun así no detectar
una carrera o una transición imposible.

## 5. Invariantes que ningún PR puede romper

1. El tenant siempre proviene del JWT del backend.
2. El frontend nunca decide el total, precio, costo, stock ni régimen fiscal final.
3. Dinero nuevo y validaciones monetarias usan `Decimal`.
4. Stock solo cambia mediante `applyStockDelta` dentro del backend.
5. Venta online y replay offline comparten idempotencia por `offlineId`.
6. Una venta POS siempre queda ligada a un turno válido.
7. La identidad del empleado se deriva server-side.
8. Un fallo no puede vaciar el carrito ni perder el monto recibido.
9. Un `4xx` de negocio nunca se transforma en venta offline.
10. Un timeout antes de confirmación puede ir a la cola; un error posterior a un
    `200` no.
11. Restauración y storage quedan aislados por tenant y usuario.
12. Impresión usa el snapshot de la venta confirmada, no el carrito mutable.
13. Cada mutación de dinero/inventario conserva auditoría atómica y libro/Kardex.

## 6. Arquitectura objetivo

Dirección de dependencias:

```text
components/pos (presentación)
        ↓
hooks/pos (casos de uso y transiciones)
        ↓
lib/pos (API, storage, offline, printer, dispositivos)
        ↓
utils/* (reglas puras existentes)

backend /api/sales + salesService = autoridad final
```

Reglas:

- los componentes visuales no hacen `fetch`, IndexedDB ni `localStorage`;
- los hooks no construyen headers ni conocen detalles de Dexie/impresora;
- los adaptadores no manejan estado visual;
- las reglas puras no dependen de React, DOM o browser;
- no se reemplaza el componente gigante por un hook gigante.

El flujo de cobro usa un estado discriminado, no banderas independientes:

```text
SELLING → CASH_ENTRY | PAYMENT_METHOD → SUBMITTING
SUBMITTING → COMPLETED | RECOVERABLE_ERROR | BUSINESS_ERROR
RECOVERABLE_ERROR → SUBMITTING | QUEUED_OFFLINE
COMPLETED → SELLING
```

## 7. Ejecución por PRs secuenciales

Cada PR se integra antes de iniciar el siguiente. Un solo responsable modifica
`POS.tsx` por PR para evitar conflictos y pérdida de cambios.

Precondición operativa: el worktree actual contiene cambios simultáneos de fiscal,
clientes y POS. Antes de implementar este plan, esos cambios deben quedar separados y
verificados en sus entregas correspondientes. No se inicia la extracción sobre un
árbol mezclado, ni se cambia de rama o se descarta trabajo existente para “limpiarlo”.

### PR-00 · Integridad del replay offline

Alcance:

- exigir y validar `shiftId` en ventas POS offline;
- derivar `employeeId` desde el turno;
- comparar `userId` del payload, cuando exista, con el JWT;
- enviar filas legacy sin turno o con identidad divergente a conciliación;
- añadir auditoría del motivo de conciliación.

Pruebas obligatorias:

- turno nulo;
- turno de otro tenant;
- turno de otro usuario;
- turno cerrado válido para replay;
- empleado divergente;
- replay idempotente del mismo payload.

Salida: ningún camino online/offline crea una venta POS sin turno e identidad
autoritativa.

### PR-01 · Aislamiento de sesión y política única de restauración

Alcance:

- sustituir `nortex_pending_cart` por un payload versionado y namespaceado;
- incluir origen, identidad, fecha y expiración;
- aplicar la misma política a carrito, aparcados y traspasos;
- eliminar el stale closure del bootstrap;
- impedir que un aparcado ajeno/antiguo entre silenciosamente al turno actual.

Pruebas obligatorias:

- dos tenants en la misma terminal;
- dos usuarios del mismo tenant;
- carrito del turno actual;
- carrito y aparcado de otro turno;
- rescate + traspaso simultáneo;
- payload vencido o corrupto.

Salida: cero claves de traspaso globales y cero restauraciones implícitas entre
identidades o turnos.

### PR-02 · Harness y pruebas de caracterización del POS real

Alcance:

- renderizar `POS` con router, contexto, sesión y reloj controlados;
- simular API, storage, online/offline y dispositivos mediante adaptadores;
- conservar temporalmente tests de texto solo como red secundaria;
- capturar el comportamiento actual antes de mover cada flujo.

Escenarios mínimos:

- producto → carrito → efectivo exacto → confirmación → nueva venta;
- efectivo insuficiente, cambio y doble Enter/F9;
- tarjeta, transferencia y fiado;
- apertura/toma/cierre de turno;
- error `4xx`, error `5xx`, timeout y `200` seguido de fallo local;
- aparcar, intercambiar, restaurar y descartar;
- scanner, etiqueta duplicada y override;
- offline, replay, conciliación y reconexión;
- devolución, anulación, ticket e impresión.

Salida: cada flujo que se vaya a extraer tiene primero una prueba conductual roja si
cambia el comportamiento.

### PR-03 · Adaptadores de IO

Crear contratos pequeños en `lib/pos/`:

- `posApi.ts`;
- `posSessionStorage.ts`;
- `posOfflineStore.ts`;
- `posPrinter.ts`;
- `posDevices.ts`.

Alcance:

- mover headers, parsing, timeout y normalización de errores fuera de React;
- usar la identidad ya resuelta en memoria para la cola offline;
- cancelar búsquedas obsoletas;
- mantener respuestas tipadas y sin `any` nuevo.

Salida:

- ningún `fetch` nuevo en `POS.tsx`;
- ningún acceso nuevo a `localStorage` en `POS.tsx`;
- cada adaptador tiene pruebas de contrato.

### PR-04 · Carrito, persistencia y aparcados

Crear `usePosCart` y `useHeldCarts` sobre las reglas puras existentes.

Alcance:

- agregar, quitar, cantidades, empaques, mayoreo y descuentos;
- persistencia, undo, aparcar e intercambiar;
- errores de cantidad y stock visible;
- mantener `basePrice`, snapshots de cotización y líneas medidas.

Salida:

- `POS.tsx` no transforma líneas con `map/find` ad hoc;
- reglas de cantidad/precio tienen mutación cuando corresponda;
- ninguna restauración depende de efectos competidores.

### PR-05 · Checkout como caso de uso

Crear `usePosCheckout` y el reducer/estado discriminado del cobro.

Alcance:

- construir intención y firma estable;
- validar turno, cliente y efectivo;
- lock anti doble submit;
- submit online;
- fallback offline exclusivamente por fallo de transporte;
- aplicar respuesta confirmada;
- postventa, refrescos y errores recuperables.

Salida:

- desaparece `handleCheckout` de `POS.tsx`;
- ningún booleano permite dos modales de pago incompatibles;
- todos los medios y fallos tienen pruebas de transición.

### PR-06 · Turno, gaveta y corresponsalía

Crear:

- `useShiftFlow`;
- `useCashDrawer`;
- `useAgentBanking`.

Alcance:

- apertura, toma y cierre;
- balance, movimientos y pulso;
- operación de corresponsalía como flujo separado del ticket;
- estados de carga/error sin compartir banderas accidentales.

Salida: la pantalla consume comandos y snapshots; no conoce endpoints de caja.

### PR-07 · Scanner y balanza

Crear `useScaleScanner`.

Alcance:

- listener wedge único;
- preview y aceptación;
- reescaneo duplicado;
- override autorizado;
- cantidad manual medida;
- contexto offline.

Salida: registrar/desregistrar listeners está probado y ninguna captura se procesa dos
veces.

### PR-08 · Devoluciones y clientes

Crear:

- `useReturnsFlow`;
- `usePosCustomerPicker`.

Alcance:

- búsqueda, draft, validación y submit de devolución/anulación;
- selector, creación rápida, crédito y respuestas fuera de orden;
- conservar autoridad y permisos del backend.

Salida: devoluciones y clientes dejan de compartir estado incidental con checkout.

### PR-09 · Paneles, diálogos y accesibilidad

Extraer presentación en `components/pos/`:

- `PosHeader`;
- `PosCatalogPanel`;
- `PosCartPanel`;
- `PosPostSale`;
- `PosDialog` y `PosSheet`;
- diálogos específicos pequeños.

Salida:

- foco inicial y retorno de foco probados;
- `Escape` cierra solo la capa superior;
- submit bloqueado no puede cerrarse accidentalmente;
- todos los diálogos críticos tienen semántica accesible;
- no se duplica lógica entre móvil y escritorio.

### PR-10 · Shell final y eliminación de deuda temporal

Alcance:

- dejar `POS.tsx` como composición y wiring;
- retirar tests de texto reemplazados por comportamiento;
- eliminar adaptadores/flags temporales;
- documentar límites y propietarios;
- activar una compuerta que impida volver a introducir IO directo.

Meta final: `POS.tsx` entre 800 y 1,500 líneas. El rango no se fuerza mediante
fragmentación artificial: se acepta una excepción documentada si las dependencias ya
son correctas.

## 8. Compuertas de calidad por PR

Siempre:

```text
mise exec -- npx --no-install prisma generate
mise exec -- npx tsc --noEmit
mise exec -- npm test -- --run <suite afectada>
mise exec -- npm run check:design
mise exec -- npm run build
```

Además:

- `sh scripts/ci-local-safe.sh` antes de declarar listo el PR;
- `NORTEX_CI_MUTATION=1` cuando cambie lógica de dinero, cantidad, stock o
  idempotencia;
- integración MySQL para ventas, turnos, replay y devoluciones;
- prueba de navegador desktop y 390×844 para cambios visibles;
- ninguna reducción de umbrales ni debilitamiento de aserciones;
- `git diff --check` y revisión de secretos antes del handoff.

## 9. Estrategia de entrega y rollback

- No mezclar dos flujos operativos en un PR.
- No desplegar una fase si el SHA exacto no pasó staging.
- Las primeras fases no requieren cambios destructivos de schema.
- Cada PR debe poder revertirse sin revertir los anteriores.
- Los adaptadores mantienen compatibilidad durante una fase; se elimina el camino
  viejo solo después de pruebas de paridad.
- Smoke obligatorio en staging: abrir turno, vender efectivo exacto/con cambio,
  tarjeta, fiado, offline/reconexión, aparcado, devolución, impresión y cierre.
- Producción requiere autorización separada y observación posterior; este documento
  no autoriza push, merge ni deploy.

## 10. Métricas de progreso

Se registran en cada PR:

- líneas de `POS.tsx`;
- estados y efectos que aún posee el shell;
- llamadas directas a red/storage/dispositivos;
- proporción de tests conductuales frente a tests de texto;
- tamaño del chunk POS;
- errores de consola y respuestas HTTP fallidas en smoke;
- tiempo producto → cobro confirmado en móvil y escritorio.

La línea nunca puede crecer sin una excepción explícita en la descripción del PR.

## 11. Definición de terminado

La deuda se considera resuelta solo cuando:

- no quedan hallazgos P0/P1 abiertos;
- venta online y offline exigen turno e identidad autoritativa;
- `POS.tsx` no hace `fetch`, IndexedDB, `localStorage` ni impresión directa;
- checkout, turno, carrito, scanner, offline y devoluciones tienen contratos propios;
- todos los flujos críticos tienen pruebas ejecutables;
- los tests de texto ya no se usan para validar comportamiento;
- los diálogos críticos comparten semántica, foco y cierre;
- `POS.tsx` es un shell de 800–1,500 líneas;
- TypeScript, Vitest, mutación aplicable, diseño, build e integración MySQL pasan;
- staging pasa el smoke completo sobre el mismo SHA que se promovería.

## 12. Primer corte recomendado

No comenzar moviendo JSX. El orden inmediato es:

1. PR-00: cerrar turno/empleado en replay offline;
2. PR-01: aislar traspasos y restauración por sesión/turno;
3. PR-02: montar el harness del POS real;
4. continuar con adaptadores y extracciones secuenciales.

Este orden corrige primero los riesgos de dinero y aislamiento descubiertos durante
la revisión, crea una red de seguridad ejecutable y recién después reduce el archivo.
