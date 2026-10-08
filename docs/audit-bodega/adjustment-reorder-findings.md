# Auditoría local: ajustes físicos y reposición

## Demostrado en HTTP + MySQL 8.0.43 descartable

### Ajustes

- El handler original creaba movimientos distintos al recibir dos veces el mismo UUID. Tanto el reintento secuencial como dos requests simultáneas duplicaban existencias.
- Sobrante y pérdida no generaban asiento contable; un período cerrado aceptaba ajustes incluso con costo cero.
- Aceptaba IN_PURCHASE y RETURN sin su documento, y pérdidas de productos con números de serie sin identificar la unidad afectada.
- La protección existente de tenant, rol y paso contado explícito pasó la caracterización.
- Reparación: servicio y router propios; claim AuditLog determinista, conflicto de payload, respuesta durable, stock/Kardex/asiento/auditoría en una misma transacción. Se reutiliza valoración Decimal y cuentas de conteo. Período cerrado bloqueado también a costo cero. Compras/devoluciones exigen su documento; lotes y series exigen su flujo detallado. Reglas de unidades heredadas compartidas.
- Resultado ejecutado final: bodegaAdjustment.integration 17/17 y inventoryAdjust.integration 3/3. El trigger de falla final prueba rollback de todos los efectos y la posibilidad de reintentar después. SUPER_ADMIN conserva su permiso anterior dentro del tenant autenticado; un producto ajeno devuelve 404.
- Reinicio Node real entre confirmación y replay: mismo token/UUID devolvió mismo movimiento, stock 5 y replayed=true.
- Límite: clientes anteriores sin UUID siguen compatibles, pero no pueden deduplicar reintentos. El fallo de openAdjust que reiniciaba el identificador se comunicó al integrador; la UI candidata ahora conserva UUID/payload en sessionStorage por tenant/usuario/producto y verifica identidad de la respuesta antes de limpiar el intento. La evidencia visual y de recuperación de la UI se registra en su informe correspondiente.

- La recuperación inicial conservaba para siempre incluso un rechazo de negocio definitivo; una pérdida mayor al stock no podía corregirse. Se añadió resultado terminal REJECTED con el mismo claim único, después del rollback. Claim y resultado rechazado se confirman juntos en una nueva transacción. Si un retry ya ganó esa carrera, se devuelve su APPLIED real; si gana el rechazo, ese UUID nunca puede aplicarse aunque vuelva el stock o reabra el período. Una corrección usa un UUID nuevo solo después de verificar el recibo exacto del rechazo.
- Prueba de carrera con MySQL real: se detiene mediante barrera la propagación del rollback de la primera petición; otra repone stock y aplica el mismo UUID; la primera recupera el mismo movimiento aplicado. Sin sleeps ni hooks de producción.
- Tres solicitudes concurrentes pueden producir un 409 transitorio de InnoDB sin recibo. El test exige que su reintento recupere la única decisión durable. Permisos, conflicto de payload, evidencia corrupta, error SQL y fallo al guardar el rechazo nunca entregan confirmación terminal. La UI conserva estos intentos ambiguos.

Evidencia: adjustment-baseline.log, adjustment-serial-baseline.log, adjustment-final.log, adjustment-rejection-baseline.log (4 rojas nuevas y 12 verdes), adjustment-rejection-final.log (20/20 con regresión), adjustment-rejection-tsc-final.log. replay-restart.mjs conserva la prueba de reinicio; su fixture efímero fue eliminado para restaurar los mismos seis productos de la demostración y su evidencia no secreta permanece en replay-evidence.json.

### Reposición

- El endpoint real es GET /api/inventory/reorder. Ignoraba saldos de OC aprobadas o parcialmente recibidas y sugería comprar nuevamente lo pendiente.
- Solo miraba reorderPoint: un producto con mínimo configurado y punto de reorden cero no aparecía.
- Leía todos los movimientos y todo el catálogo sin límite, y sumaba costos de sugerencias con Number.
- Caracterización HTTP: 5 fallos y 1 aprobado de 6 casos. Prueba exactos frente a sombras Float, estados cerrados, cobertura completa por pendiente, mínimo legado, paginación/aislamiento y suma 0.1+0.2.
- Reparación en módulos nuevos: agregaciones SQL exactas por tenant, saldos orderedExact - receivedExact - closedShortExact (con fallback histórico), estados APPROVED/PARTIALLY_RECEIVED, mínimo como fallback, cantidad neta redondeada al paso. Excluye sugerencias completamente cubiertas por lo entrante.
- Contrato: page/pageSize (máximo100), items de la página, total y totalEstimatedCost globales consistentes dentro de snapshot transaccional, hasMore. incomingQuantity y projectedStock por fila. SmartPurchases adaptado por agente de recepción.
- Índices existentes cubren las consultas: Kardex(tenantId,type,date), PurchaseOrder(tenantId,status), PurchaseOrderItem(purchaseOrderId), Product(tenantId).
- Smoke de SQL real contra tenant demostración pasó. Tras composición del router y reinicio del backend completo: reposición 6/6 y ajustes 11/11 aprobados, 0 omitidos. La compuerta posterior amplió ajustes a 12/12 con SUPER_ADMIN. La regresión anterior de ajustes mantiene 3/3 aprobados.

Evidencia: reorder-baseline.log y adjustment-reorder-final.log; inventoryReorderService.ts contiene consulta autoritativa y tests/bodegaReorder.integration.test.ts ejecuta el contrato HTTP.

## Modularidad y contrato

- Conteo reproducible de código runtime (desde app.post/app.get hasta su cierre, sin blancos posteriores): ajuste original 195 líneas y reposición original 90, total 285. Destinos finales: ajuste 173 + router 31; reposición 99 + router 22, total 325. Las dos importaciones y dos composiciones agregan 4 líneas a server: delta de estos bloques e integraciones en server -281, destinos +325, conjunto runtime +44. La extracción inicial reducía 5 líneas netas; el protocolo adicional de rechazo terminal agregó 49. No se ampliaron presupuestos ni excepciones para pasar una prueba. Las pruebas nuevas y documentación se contabilizan aparte en el informe integral del integrador.
- Las pruebas de arquitectura existentes que señalaban app.post ajustan sus fuentes al nuevo servicio y a la composición del router. Se conservan guardas de tenant/bodega, origen del snapshot bajo lock y restricciones de tracking. Comprobación normal: 19/19 pruebas de contrato; los casos HTTP asociados se omiten solo sin entorno QA y se ejecutan por su compuerta separada.

## No probado

CI, staging, producción, usuarios reales, redes móviles o scanners físicos. Toda evidencia descrita se limita al candidato aislado y datos sintéticos.

## Compuerta integral: trazabilidad de intentos

- Primer intento: 13 suites /112 casos aprobados; la siguiente suite falló porque el runner no transmitía el ACK descartable ya validado al proceso hijo. Se agregó exclusivamente esa variable a la lista permitida; se conservaron todas las validaciones.
- Segundo intento: 18 suites /155 casos aprobados; assistantFlow falló por ausencia de los PDF/PNG sintéticos del corpus en la copia. El integrador restauró los 100 archivos y verificó hashes, sin modificar las pruebas.
- Tercer intento: 32 suites /288 casos aprobados; dos casos de promociones no podían consultar las tablas diagnósticas de locks. Se concedió al usuario de la instancia descartable SELECT únicamente sobre performance_schema.data_locks y data_lock_waits. La suite aislada pasó 4/4 sin editar producto ni pruebas.
- Cuarto intento: comando terminó con 41 suites /349 casos aprobados, ninguno omitido. Se conserva como evidencia intermedia, no como candidato final: el servicio de compras cambió durante la ejecución por un hallazgo financiero nuevo de autoridad de caja. El informe es quality-integration-attempt4-mixed-summary.json y el log quality-integration-final4.log en el runtime de la auditoría. La compuerta final deberá incluir también la nueva suite de ese hallazgo sobre un candidato estable.
- Quinto intento sobre el código congelado incluyó las 42 suites: 38 suites /354 casos aprobados, luego procurementPhaseTwoB falló porque su prueba antigua exigía cero auditorías para un ajuste rechazado. El contrato nuevo agrega exactamente claim y resultado REJECTED sin stock/Kardex/asiento. Se actualizó exclusivamente esa aserción para verificar las dos identidades, acciones, payload y código de rechazo; las guardas originales de stock, lotes, Kardex, asiento y conteo siguen intactas. La suite focal aprobó 8/8. Evidencia: quality-integration-final5.log, quality-integration-attempt5-summary.json y procurement-adjustment-contract-final.log. Este intento no acredita la compuerta integral.
- Sexto intento FINAL sobre el código congelado: **42 suites /367 casos aprobados, 0 omitidos, exit 0**. Se volvió a validar cada informe JSON con assertExecutedSuite y se concilió el total con summary.json. Incluye los 17 casos de ajustes y los 13 de autoridad de caja/entrega en compras. Evidencia: quality-integration-final6.log y quality-integration-final-summary.json en el runtime; reports/quality-integration/summary.json del candidato tiene passed=true. Esta es la compuerta integral local aprobada; no acredita CI ni despliegue.
