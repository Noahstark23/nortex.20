# Catálogo y recorrido: observación inicial 2026-09-12

Candidato aislado, 1280×720, cuenta Ferretería El Roble QA. Evidencia actual en ../evidence/bodega-20260912.

| ID | Origen | Escenario / consecuencia | Evidencia inicial |
|---|---|---|---|
| UX01 | Inventory.tsx:1475 | Nuevo producto exige elegir entre dos altas divergentes; formulario completo muestra 24 controles | Capturas 01–02 y DOM |
| UX02 | InventoryTabs.tsx:20 | Navegación ofrece Series pero no Recibir ni Contar; conteo escondido en otro menú | Captura 01 / código |
| UX03 | Inventory.tsx:3099 | Importación parcial desmonta resumen y rechazados | Test bodegaInventoryUx rojo |
| UX04 | Inventory.tsx:714 | Lotes anteriores sobreviven falla al cambiar de producto | Test bodegaInventoryUx rojo |
| UX05 | Inventory.tsx:341,1018 | No se puede editar SKU ni mínimo; minStock está erróneamente tratado como movimiento | Test bodegaInventoryUx rojo |
| UX06 | Inventory.tsx:604,624 | Lector activo sobre lotes; HTTP fallido se interpreta como código nuevo | Código; prueba añadida en reparación |
| UX07 | Inventory.tsx:683 | Kardex fallido mantiene datos anteriores y no muestra error | Código |
| UX08 | Inventory.tsx:80,166 | Suma unidades, metros, cajas en un único total 'unidades'; presenta códigos GENERAL/LEGACY en experiencia operativa | Captura 01 |
| UX09 | Inventory.tsx:1095 | Ajuste sin identidad de reintento; compra/devolución libre evita documentos | Código; reproducción API delegada |
| UX10 | Inventory.tsx:439 | KPIs fallidos parecen cero; búsqueda no vincula respuesta a filtros vigentes | Código |

Estados iniciales no implican que el defecto exista en producción. Las capturas y los tests pertenecen al candidato local.

## Resultado local integrado

UX01–UX10 reparados en sus escenarios acotados: alta directa y opciones progresivas, navegación por tarea, importación con resumen persistente, errores explícitos de lotes/Kardex, edición comercial con SKU/mínimo, guardas del lector, total heterogéneo eliminado, ajustes con identidad durable y respuestas de búsquedas/KPI secuenciadas. La lista muestra las familias especiales con nombres españoles y omite GENERAL como ruido.

Revisión real encontró contraste insuficiente en labels del alta en modo día; reparado y capturado. Las tarjetas de resumen usan menos espacio en móvil. Bodegas conserva su propia entrada activa y título del shell. Acción contextual: Registrar pérdida o sobrante.

Pruebas: bodegaInventoryUx caracteriza tres fallos iniciales; bodegaInventoryReview caracteriza mínimo decimal, guardado pendiente, scanner/red y carreras; bodegaAdjustmentRetryUi comprueba cierre/reapertura/recarga, cuenta, almacenamiento, doble envío, confirmación y rechazo durable. Mensajería incierta no permite cambiar UUID; rechazo terminal coincidente sí permite corregir con otro UUID. El reporte integral conserva los conteos finales sin sumar ejecuciones repetidas.
