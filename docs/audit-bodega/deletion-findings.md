# Eliminación de productos — inventario previo a corrección

Alcance adicional asignado por integrador después de importación verde (2026-09-12): `DELETE /api/products/:id`, sólo servicio nuevo y pruebas. El integrador conserva propiedad de `server.ts`.

| ID | Estado al identificar | Evidencia y efecto |
|---|---|---|
| C14-A | Defecto identificado; reproducción HTTP pendiente | Handler comprueba `stock > 0`, permitiendo stock negativo. Indica al usuario bajar stock a cero para borrar. |
| C14-B | Defecto identificado; reproducción HTTP pendiente | `Product` se borra físicamente sin comprobar Kardex, lotes, series y conteos cuyas relaciones tienen `onDelete: Cascade`; borra evidencia real aunque saldo sea cero. |
| C14-C | Defecto identificado | Lectura y guard de stock fuera de la transacción de borrado. Un ingreso concurrente puede llegar después del guard y desaparecer con cascada. |
| C14-D | Riesgo por validar | Venta, compra y cotización guardan productId sin FK; permitir borrado deja referencia huérfana aun cuando no haya Kardex heredado. Transferencias/devoluciones/pedidos públicos guardan JSON. |

La inspección confirma que bloquear sólo documentos encontrados no cierra la carrera con documentos sin FK: una cotización puede leer la ficha antes del lock y crear su referencia después del borrado. No corresponde afirmar seguridad con ese guard parcial.

**Contrato decidido por integrador:** se deshabilita el DELETE físico sin excepciones hasta tener un archivo coherente con todos los consumidores. Se conserva auth OWNER/ADMIN (y excepción SUPER_ADMIN), aislamiento tenant y 404 de ID inexistente/ajeno. Un producto propio devuelve 409 `PRODUCT_DELETION_DISABLED` con mensaje: «Los productos se conservan para proteger su historial. Podés corregir su ficha u ocultarlo del catálogo público.» No se ejecutan escrituras ni se finge haber archivado. El frontend retira el botón destructivo y la indicación de bajar stock para borrar. La capacidad de archivar transversalmente permanece pendiente, separada de ocultar del catálogo público.

## Reproducción antes del cambio

11:33 del 2026-09-12, API local real y MySQL8 descartable: suite inicial 8 casos, **5 fallaron** al exigir preservación y 3 caracterizaron el contrato anterior. El caso dirigido de cascadas verificó los conteos persistidos: Product=0, ProductBatch=0, StockCountItem=0 y KardexMovement=0 después de DELETE exitoso, cuando cada tabla tenía 1 fila. El saldo negativo se borró con HTTP200; ventas/cotizaciones sin FK y pedidos JSON tampoco impedían borrado. No son escenarios hipotéticos.

`backend/services/productDeletionService.ts` agrega 26 líneas con consulta de existencia tenant-scoped y rechazo estable. Bloque anterior del servidor: 60 líneas; composición posterior a cargo del integrador. No necesita transacción de escritura ni nuevo índice porque ya no existe mutación. TypeScript del candidato pasó (exit0) después de crear servicio y pruebas.

## Verificación posterior

11:38:49 del 2026-09-12: backend HTTP nuevo del candidato en puerto efímero local, misma base MySQL8 descartable y configuración sintética protegida; proceso de prueba cerrado al finalizar. `vitest run tests/productImport.integration.test.ts tests/productDeletion.integration.test.ts --maxWorkers=1` → **21 aprobados, 0 omitidos**, 4.57s; importación 13, eliminación 8. La suite de eliminación conserva ficha sin actividad, stock negativo, las cuatro tablas afectadas por cascada, venta sin FK, cotización/pedido JSON, auditoría monetaria y desglose de bodega. Verifica tenant/roles y un rechazo HTTP concurrente con un ingreso por `applyStockDelta` cuyo stock/Kardex permanecen.

Queda demostrada la eliminación deshabilitada del endpoint, **no una funcionalidad de archivo**. La gestión de productos inactivos a través de POS, búsquedas, compras, catálogos y reportes queda pendiente de diseño y aplicación consistentes. No se declara restauración de históricos previamente borrados ni evidencia de CI/staging/producción.
