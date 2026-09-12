# Auditoría de bodega y conteos — 2026-09-12

Origen: checkout local con cambios preservados; candidato aislado en `/private/tmp/nortex-bodega-20260912/candidate`. Lectura del código no acredita reproducción HTTP/MySQL. Este inventario antecede a las reparaciones; las líneas apuntan al origen auditado.

| ID | Severidad | Archivo y línea | Escenario y consecuencia | Reparación / prueba necesaria |
|---|---|---|---|---|
| W01 | P1 | backend/server.ts:7930,7976 | Principal implícita usa agregado sin restar otras bodegas; cierre entra en conflicto perpetuo | Residual autoritativo con Decimal; integración saldo 10, secundaria 3, principal 7 |
| W02 | P1 | backend/server.ts:7941 | Venta posterior a captura se repone como sobrante al cerrar | Detectar movimientos posteriores y exigir reconteo |
| W03 | P1 | components/StockCount.tsx:224 | PATCH fallido elimina lo capturado y afirma estado remoto desconocido | Retener borrador, estado pendiente y reintento |
| W04 | P1 | components/StockCount.tsx:233,515,758 | PATCH paralelos se reordenan; cierre se adelanta al guardado | Serializar por producto y bloquear cierre pendiente |
| W05 | P1 | components/StockCount.tsx:411,424 | Lector trunca fracciones y actúa durante confirmación | Medidos capturan cantidad; pausar con modal |
| W06 | P1 | backend/routes/warehouses.ts:159 | Cambiar principal reatribuye stock implícito sin movimiento | Materializar atribución previa, transacción y auditoría |
| W07 | P1 | backend/server.ts:7037; components/Inventory.tsx:1122 | Reintento ambiguo del ajuste duplica movimiento | Identidad persistente, replay, conflicto y prueba HTTP |
| W08 | P1 | backend/server.ts:7081 | Ajuste no verifica período ni registra asiento a diferencia del conteo | Guardia y contabilización atómicas |
| W09 | P1 | components/Inventory.tsx:714 | Error al cargar lotes de B conserva los de A bajo cabecera B | Asociar respuesta al producto, limpiar y mostrar error |
| W10 | P2 | components/StockCount.tsx:111 | Fallos HTTP del historial/bodega/detalle parecen vacío | Error explícito y reintento |
| W11 | P2 | components/StockCount.tsx:258 | Entrada inválida elimina todo; limpiar deja conteo anterior invisible | Preservar entrada válida y semántica explícita cero/sin contar |
| W12 | P2 | backend/routes/warehouses.ts:118 | Desactivar corre después de comprobación de stock no bloqueada | Transacción coordinada con movimientos; no saldos varados |
| W13 | P2 | backend/routes/warehouses.ts:19,28,187 | Prisma propio, escritura en GET y lectura completa | Singleton; inicialización en escritura; paginación futura |
| W14 | P2 | components/Warehouses.tsx:313 | Traslado termina en toast sin historial visible | Mostrar historial existente sin inventar tránsito |
| W15 | P2 | backend/server.ts:7640,7901 | Conteo completo y N+1 de cierre en transacción de 30 s | Conteos parciales y consultas consolidadas |

Controles existentes preservados: idempotencia/Decimal/locks de transferencias; respuesta de existencias vinculada a bodega; exclusión de conteos abiertos por bodega; autorización y ocultación financiera de BODEGUERO. StockService verifica agregado; callers físicos deben validar además bodega.

Pruebas existentes: stockCountWarehouse.integration (secundaria, alta concurrente); stockCountWarehouseScoping y stockCountResponsive (contratos textuales); inventoryAdjust.integration (bodega/fracciones); stockTransferUi/Service/Command. La cobertura textual no prueba pérdida de capturas ni concurrencia HTTP.

## Reparación ejecutada en candidato

- W01/W02: helper `stockCountClosingSnapshot` obtiene residual Decimal y compara saldo actual bloqueado con `bookStockAtCapture`. El integrador agregó columna Decimal nullable, migración y captura HTTP bajo lock Product. Un saldo cambiado o una captura histórica sin evidencia exige reconteo explícito; no depende de fechas comerciales del Kardex.
- W03/W04/W05/W10/W11: captura serial por producto, conservación de cantidades fallidas, borradores pendientes en sessionStorage de la pestaña (solo se cargan tras GET autorizado del conteo), cierre bloqueado mientras falta confirmación, reintento visible, scanner suspendido con diálogo, unidades con paso1 suman1 y medidos/pasos mayores exigen cantidad. HTTP fallido se distingue de vacío. Reconteo permite confirmar el mismo número con evidencia nueva.
- W06/W12: cambio de principal materializa residual en la ubicación anterior y cero en la nueva sin alterar agregado ni inventar movimiento; configuración y auditoría en una transacción, saldo negativo también impide desactivar. StockService mantiene un lock compartido sobre la bodega activa antes del delta. Configuración bloquea productos y bodegas; conflictos de base se devuelven como409 para reintentar sin efecto parcial.
- W14: historial ya existente visible a solicitud, con comprobante/origen/destino/líneas y error/reintento. No se añadió estado de tránsito. Se retiró la etiqueta interna IMPLÍCITO de existencias.
- W13 parcial: cliente Prisma compartido. Inicialización histórica de principal en GET y paginación server-side de existencias quedan pendientes; no se declaran solucionados.
- W15 permanece como deuda de escala: el conteo aún carga todas las líneas y el cierre procesa productos secuencialmente. Las capturas nuevas y sus garantías no acreditan rendimiento con catálogos masivos.
- W07/W08/W09 pertenecen a la integración de ajuste/Inventory; esta entrega de bodega no acredita por sí sola su reparación.

## Evidencia ejecutada

- Reproducción anterior al parche: `stockCountCapture.test.tsx` falló5/5 contra el componente real: pérdida5→2, dos PATCH paralelos, lector detrás de cierre, truncación2.75→3, historial503 sin error visible.
- Después: cinco suites conteo/topología/contratos25/25PASS, ampliadas a ocho suites39/39PASS con navegación/traslados; nueva suite `warehouseHistory.test.tsx`2/2PASS. No sumar ejecuciones repetidas como casos distintos.
- HTTP/MySQL8 descartable `warehouseTopology.integration.test.ts`5/5 y `stockCountWarehouse.integration.test.ts`2/2PASS usando el runner aislado. Escenarios: principal implícita7/total10/secundaria3; cambiar principal conservando atribución; salida posterior retrofechada requiere recaptura; captura histórica null exige confirmación; tres carreras entrada/desactivación nunca dejan saldo en una bodega inactiva.
- TypeScript de la primera comprobación final reportó un error concurrente ajeno al dominio en `inventoryReorder.ts` sobre page/pageSize; integrador avisado. No se considera aprobación del gate total.
- Compuerta integral, build, diseño y demostración de navegador pertenecen al cierre del candidato por el integrador; esta evidencia no acredita producción.

Revisión independiente posterior detectó y corrigió dos regresiones antes del cierre: comparación de Float con Decimal podía exigir reconteo perpetuo, y la nueva revalidación de bodega precedía al lockProduct del caller de venta. La comparación, captura y preflight ahora usan la precisión física de cuatro decimales; Warehouse SHARE se obtiene después del UPDATE que bloquea Product. `warehouseTopology.integration.test.ts` ampliada7/7PASS: HTTP0.1+0.2 capturado0.3 cierra sin ajuste; un movimiento0.0001 exige reconteo; dos transacciones MySQL con barreras (topología y caller de stock sin pre-lock) terminan ambas sin deadlock. Ninguna fecha comercial se usa como prueba de vigencia.
