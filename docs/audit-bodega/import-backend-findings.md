# Importación de catálogo y existencias — inventario previo a corrección

Candidato: `/private/tmp/nortex-bodega-20260912/candidate`. Lectura del 2026-09-12; copia aislada sin `.git`, no despliegue. Alcance: POST `/api/products/bulk` y servicio extraído. `CLAUDE.md` y `nortex-feature` leídos completos.

| ID | Estado previo | Evidencia y efecto | Corrección y comprobación previstas |
|---|---|---|---|
| IB01 | Defecto identificado; reproducción pendiente | `backend/server.ts:6223-6566`: catch de cada fila dentro de la transacción común. `product.update` precede stock/Kardex/auditoría. Un error tardío suma `errors` pero puede confirmar cambios parciales. | Transacción independiente por fila; contar sólo después de commit. Fallo de trigger SQL en auditoría debe dejar producto, versión comercial, stock y Kardex intactos, y continuar filas siguientes. |
| IB02 | Defecto identificado | `backend/server.ts:6330-6410`: stock enviado se trata como objetivo agregado y diferencia se aplica sin ubicación, a Principal. Un reimport puede retirar stock de una bodega distinta o reiniciar existencias vendidas. | Importación sólo permite existencia inicial de altas; existente con stock explícito se rechaza íntegro. UI de catálogo omite stock. Altas con stock requieren ubicación inequívoca. |
| IB03 | Riesgo por validar | `backend/server.ts:6247-6354`: catálogo se lee antes del lock y defaults opcionales se derivan de esa lectura; edición concurrente de costo/configuración puede perderse. Auditoría before tampoco representa estado bloqueado. | Resolver todo estado existente bajo lock y validar estado final. Concurrencia de dos importaciones debe preservar columnas omitidas y auditorías verdaderas. |
| IB04 | Defecto identificado | `backend/server.ts:6267-6291`: validación final omite `reorderPoint`, `maxStock`, `wholesaleMinQty`; cambio modo/paso puede dejar cantidades comerciales no vendibles. | Validar todas las cantidades persistidas contra configuración final sin resetear opcionales omitidos. |
| IB05 | Riesgo por validar | Errores internos de Prisma se retornan como `itemError.message`/500 y pueden filtrar consulta/datos internos. | Mensajes públicos estables para fallos de persistencia, manteniendo errores de validación de dominio. |

Contrato acordado con integrador: URL, roles OWNER/ADMIN (+excepción SUPER_ADMIN existente), aliases, límites 500 y respuesta created/updated/errors/total se conservan. Opcionales ausentes/blancos se preservan; `false` y `0` son explícitos. `warehouseId` de petición sólo resuelve una bodega activa del tenant autenticado. Ninguna fila rechazada puede persistir efectos del producto. No se modifica schema de BD ni se ejecutan acciones externas.

## Evidencia ejecutada y reparación

- **IB01 reproducido** en proceso baseline antes de extraer: trigger SQL rechaza `PRODUCT_BULK_UPDATED`; API reportó fila rechazada mientras nombre, precio 100→5, costo 42→2 y versión promocional 1→2 persistieron. La prueba luego pasa con transacción por fila. Otro trigger en alta verifica rollback de Product, ProductStock, Kardex y AuditLog.
- **IB04 reproducido**: baseline permitió COUNTED/paso1 con reorderPoint=1.25, maxStock=20.25 y wholesaleMinQty=2.25. Estado final ahora se valida completo.
- **IB06 adicional reproducido**: raw SQL de MySQL devolvía `requiresBatchTracking=0`; al omitir columna en Excel, Prisma recibió Int en Boolean y rechazó toda actualización. Lectura tipada bajo lock resuelve el defecto.
- **IB07 adicional reproducido**: alta COUNTED/paso2 sin mínimo heredaba 5 y fallaba. Altas importadas ahora parten con mínimo 0 cuando no fue indicado; existentes conservan su valor.
- **IB02/IB05 comprobados**: baseline ingresaba stock en Principal aun existiendo varias bodegas y filtraba la invocación Prisma. Candidato exige ubicación inequívoca para altas, rechaza stock explícito de existentes y retorna error público estable sin SQL.
- **IB03 comprobado en candidato**: dos importaciones HTTP concurrentes, ambas bloqueadas por una transacción externa, conservan costo y categoría escritos por personas distintas y sólo generan una auditoría monetaria para el cambio material.

Ejecutado el 2026-09-12 a las 11:30 hora local: `mise exec -- node /private/tmp/nortex-bodega-20260912/runtime/run.mjs test tests/productImport.integration.test.ts --maxWorkers=1` → **13 aprobados, 0 omitidos**, MySQL8 descartable y API real `127.0.0.1:3221`, 2.23s. `mise exec -- npx --no-install tsc --noEmit --pretty false` → exit0. La compuerta integral queda a cargo del integrador; estas cifras no son CI, staging ni producción.

Extracción medida en aislamiento: bloque original 373 líneas → composición 15; con import de módulo, `backend/server.ts` 14266→13909 (**−357**). `backend/services/productImportService.ts` nuevo **193** líneas. Total runtime afectado **−164**. Integrador ajusta trinquete conjunto después de las demás extracciones. Prueba HTTP nueva 199 líneas (incluida evidencia de conducta, no ahorro runtime).

Política conservada: el alta inicial usa `applyStockDelta` y Kardex, sin agregar una compra ni un asiento que el flujo original no generaba. La migración contable de saldos iniciales no se acredita con esta corrección. Control de lotes sigue el modo vigente del tenant; esta prueba incluye ENFORCED, no una reconciliación del modo OFF histórico.

Reverificación conjunta 11:38:49 con schema de cantidades final y composición DELETE integrada: backend nuevo efímero del candidato, `vitest run tests/productImport.integration.test.ts tests/productDeletion.integration.test.ts --maxWorkers=1` → **21/21, 0 omitidos**, 4.57s (13 importación + 8 eliminación). Backend propio cerrado al finalizar; no se reinició el servidor de demostración compartido.
