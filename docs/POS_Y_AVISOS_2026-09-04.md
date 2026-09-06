# POS y avisos operativos

**Fecha:** 2026-09-04. **Estado:** implementación local con compuerta técnica aprobada; validación física y con usuarios pendiente. Sin publicación.

Esta entrega hace más claro el recorrido vender → cobrar → comprobar el resultado → atender otra venta. Añade un panel de pendientes actuales y separa una venta guardada en el dispositivo de una confirmada por el servidor. Reutiliza las primitivas visuales existentes y extrae responsabilidades del POS; no sustituye las reglas de venta, inventario, caja o fiscalidad.

El fundador informa 45 personas registradas, tres habituales en ferreterías/farmacias y personas que no llegan a vender o hacen una venta y no regresan. Ese autorreporte orienta el trabajo, pero no identifica la causa de abandono ni demuestra retención o ingresos. La validación con esos comercios sigue pendiente. La entrega anterior de activación se documenta en [Primera venta, regreso y modularidad](ACTIVACION_Y_MODULARIDAD_2026-09-04.md); el marco de aceptación está en [Dirección UX y validación](PLAN_DIRECCION_UX_Y_VALIDACION_2026.md).

## 1. Recorrido y resultado de la venta

La cabecera muestra una tarea única, **Primera venta** o **Nueva venta**, junto al negocio truncado cuando falta espacio. `PosSaleHeader` contiene identidad y acciones; POS conserva caja, conexión y venta. Los avisos están disponibles desde la caja sin añadir otra navegación principal.

El cobro conserva los controles y validaciones existentes. Al terminar, `PosSaleResultSheet` presenta el resultado en `FluidSheet`: encabezado comprensible, detalle desplazable y **Hacer otra venta** al pie. La primera venta conserva **Ver mi negocio** como acción secundaria. El vuelto y demás importes se reciben del flujo existente; la nueva carcasa no los recalcula.

| Resultado | Qué significa y qué permite |
|---|---|
| `pending` | La venta quedó en IndexedDB en este dispositivo. Todavía no existe confirmación recibida. Se informa **Venta guardada para confirmar**, se pide no reingresarla y se conserva el acceso a otra venta. No se muestra como hito de primera venta ni como venta confirmada del día. |
| `confirmed` | El POST online respondió correctamente y POS utiliza la foto autoritativa devuelta por la venta. Se muestra el resultado confirmado y se conservan las acciones de comprobante existentes. |

El camino offline y el rescate de un fallo de transporte emiten `sale_queued`, sin `sale_completed` ni `first_real_sale_completed`. Los eventos de confirmación siguen perteneciendo al éxito online. Esto evita inflar conversión con una cola local; no crea por sí solo una medición completa de conversión tras sincronizar. Para cohortes deben utilizarse ventas confirmadas del backend con sus exclusiones y ventanas, no únicamente eventos del navegador.

**Comprobante offline:** mientras el resultado está pendiente se ocultan impresión, envío del comprobante por WhatsApp y factura A4 definitiva. El componente oculto de impresión tampoco recibe ese resultado como factura confirmada. Después de confirmar se consulta el comprobante en **Ventas** (`/app/sales`). La pantalla abierta de resultado no se convierte por sí sola en una factura histórica tras el replay. No se añade un comprobante provisional nuevo.

## 2. Panel de avisos: alcance y fuentes

`GET /api/operational-alerts` es una lectura con `Cache-Control: no-store`, autenticación y autorización existentes. Tenant y rol efectivo vienen del principal autenticado; parámetros del cliente no los sustituyen. No hay cambios de esquema ni mutaciones de stock en esta ruta.

Los números de cada sección son conteos de BD completos para su filtro. Las muestras son hasta tres ejemplos, con orden estable y los mismos filtros; no son el total ni reemplazan una revisión del inventario. `checkedAt` indica el inicio de la consulta: conteos y ejemplos se consultan por separado, sin snapshot transaccional entre secciones.

| Sección | Fuente y definición |
|---|---|
| Sin existencia | `Product`, mismo tenant, `stock <= 0`. |
| En su mínimo | `Product`, mismo tenant, `stock > 0` y `stock <= minStock`; comparación entre columnas en BD. No solapa con sin existencia. |
| Lotes vencidos | `ProductBatch`, mismo tenant, existencia positiva y fecha civil anterior a hoy. |
| Por vencer | Lotes con existencia positiva desde hoy hasta el día 30 inclusive. Se usa límite superior exclusivo en el inicio del día 31. |
| Pedidos web | `PublicOrder`, mismo tenant y estado `PENDING`. Es un conteo; no hereda el límite de 100 filas del listado de pedidos. No expone nombres de clientes en este resumen. |

Las fechas de vencimiento son días civiles: se obtiene el día operativo de Managua y se compara con los días de lote almacenados en UTC. Un lote con fecha de hoy entra en **Por vencer**, no en **Vencidos**. La muestra conserva la fecha civil `AAAA-MM-DD`, sin desplazarla por la zona horaria del navegador.

| Rol efectivo | Secciones del negocio disponibles |
|---|---|
| OWNER, ADMIN, SUPER_ADMIN | Existencias, mínimos, vencimientos y pedidos. |
| MANAGER, CASHIER, VIEWER | Vencimientos y pedidos; no conteos administrativos de existencias. |
| EMPLOYEE, VENDEDOR, ACCOUNTANT, COLLECTOR | Vencimientos. |
| BODEGUERO o rol desconocido | Ruta de resumen denegada. Se conserva su flujo de inventario existente. |
| Negocio LENDER con rol admitido | Sin secciones de retail; no se consulta su inventario/pedidos como comercio. |

La visibilidad del aviso no otorga permiso para editar, ajustar o convertir. El destino aplica sus permisos existentes; VIEWER puede consultar pedidos sin convertirse en vendedor autorizado. Las alertas de stock reflejan `Product.stock`; las de lote, existencia positiva del lote. No afirman disponibilidad vendible, liberación de retenidos ni seguridad de dispensación farmacéutica.

Cada sección puede fallar sin ocultar las válidas. Un error se presenta como **sin comprobar**, con `count: null`, nunca como cero. La carga, el fallo y la ausencia de pendientes son estados distintos. La campana cuenta asuntos/secciones que requieren atención, no suma productos, lotes y ventas como si fueran una misma unidad. La cola local no legible también se señala como incierta.

El panel global muestra pendientes del negocio. **En esta caja**, con conexión y ventas de IndexedDB, está disponible únicamente dentro de POS. Un estado sin pendientes del panel global no comprueba la cola local; hay que abrir la caja correspondiente para revisarla.

Se consulta al montar/abrir, al cambiar datos/conexión, al volver a la pestaña y cada minuto mientras está visible. **Actualizar avisos** permite repetir la lectura. Respuestas tardías, cambios de sesión y desmontaje no conservan datos de otra identidad. Cerrar no resuelve ni marca leído un pendiente: desaparece cuando cambia su causa. Este panel no es historial, centro de mensajes leídos, notificación push ni alarma sonora.

## 3. Acciones y continuidad segura

Una muestra de producto o lote abre Inventario con `?search=` y el nombre codificado. Inventario carga esa búsqueda y la actualiza si llega otro aviso sin desmontar la pantalla. La muestra de lote orienta al producto; no abre automáticamente un lote ni lo retira de venta. **Ver pedidos web** dirige a Proformas (`/app/quotations`), que contiene Pedidos web; no se promete abrir una pestaña mediante un parámetro que el módulo no consume.

Si hay una venta en curso, un destino del panel **no navega**. Muestra **Terminá o aparcá la venta antes de abrir otro módulo** y ofrece **Seguir vendiendo**. El encabezado del aviso recibe foco. No existe en esta entrega una acción **Guardar y salir** ni se promete guardar un carrito sin cumplir las condiciones del flujo existente.

Los paneles utilizan controles nativos y `FluidSheet`: foco inicial, recorrido modal de teclado, Escape, retorno de foco y fondo bloqueado. Avisos se monta mediante portal para que la cabecera no recorte el panel. Los atajos globales de POS —incluidos F9 y F4— y el lector de códigos quedan bloqueados mientras está presente el panel de avisos. El buffer del lector se limpia; escribir un SKU y Enter con foco en **Cerrar avisos** no añade productos ni cobra. Enter conserva la acción nativa de ese botón. Al terminar de cerrar, el lector vuelve a funcionar en la caja.

La hoja de resultado enfoca el título; Escape o el fondo invocan la misma continuación **Hacer otra venta**, sin otro POST. El detalle puede desplazarse sin sacar del panel la acción principal. Esta conducta tiene pruebas de componente y recorrido; no equivale a certificación completa de accesibilidad o a prueba con todos los lectores de pantalla.

## 4. Reintento de ventas guardadas

`usePosOfflineQueue` es el único motor de reintento dentro del POS. Montar o abrir Avisos refresca conteos, sin enviar ventas. El evento de reconexión del POS y el botón **Reintentar confirmación** llaman a ese mismo motor; dos invocaciones simultáneas comparten la promesa del intento de la sesión. El hook, por sí solo, no registra otro listener que reenvíe al recibir `online`.

La cola se selecciona por tenant y usuario originales, con la sesión autenticada vigente. No se reatribuye una fila al cajero actual. Si cambia token, tenant o usuario, o se desmonta el consumidor, la respuesta antigua no elimina filas ni anuncia éxito a la nueva sesión.

`toOfflineSyncTransport` proyecta la fila persistida al contrato estricto de `/api/sales/sync`: omite metadatos locales y conserva `offlineId`, identidad, turno, versión fiscal, cantidades, presentaciones y mediciones. No genera IDs, no reconstruye precios, no confirma ventas ni escribe IndexedDB. Un saldo a favor que el contrato de sync no puede representar queda para revisión; solo ausencia o cero explícito permiten omitirlo sin inventar que no fue aplicado.

Los lotes HTTP tienen hasta 200 ventas. Solo resultados inequívocos `created/skipped` para IDs del lote enviado permiten retirar esas filas de la cola. Fallos, necesidad de conciliación, IDs ajenos, duplicados ambiguos y resultados ausentes no se convierten en confirmación. Un HTTP fallido, JSON ilegible o respuesta perdida conserva las filas y su identidad para reintentar. La aceptación final sigue en el backend autenticado y su contrato de replay/idempotencia.

Avisos distingue ventas reintentables, ventas que requieren revisión y conexión ausente. No ofrece reenvío sin internet ni mientras está sincronizando. La persona responsable debe conciliar los casos de revisión antes de volver a cobrar; cerrar el panel no los borra.

## 5. Modularidad y tamaño real

Medición del snapshot local al redactar, por saltos de línea; referencias `useState` incluyen la importación. Baseline: checkout original preservado, anterior a esta entrega.

| Archivo / indicador | Antes | Después | Delta |
|---|---:|---:|---:|
| POS, líneas | 7.245 | 7.081 | −164 |
| POS, referencias `useState` | 121 | 118 | −3 |
| Layout, líneas | 736 | 636 | −100 |
| Inventory, líneas | 3.472 | 3.476 | +4 |
| backend/server, líneas | 15.347 | 15.349 | +2 |
| Nueve módulos nuevos, líneas | 0 | 713 | +713 |
| **Conjunto runtime afectado, líneas** | **26.800** | **27.255** | **+455** |

Los módulos nuevos son `PosSaleHeader` (31), `PosSaleResultSheet` (57), `OperationalNotifications` (128), `useOperationalAlerts` (72), `usePosOfflineQueue` (183), `offlineSyncTransport` (80), tipos `operationalAlerts` (23), router (37) y servicio de avisos (102). La suma excluye pruebas, documentación, artefactos generados y herramientas de QA.

Baja la concentración en POS/Layout; **el código total afectado aumenta** por los controles y contratos añadidos. Tampoco se afirma que bajaron los estados globales o el bundle. Los presupuestos de los monolitos deben reflejar el tamaño extraído, sin ampliar excepciones para aprobar la suite. El integrador revisa el manifiesto del candidato final si cambian estos archivos después de esta medición.

## 6. Verificación local y límites

La ejecución usa Node 22.23.2 y la copia aislada `work/pos-final`. Las pruebas dirigidas pasan en sus ejecuciones registradas: POS real renderizado y fake IndexedDB, resultado/cabecera, navegación al producto, servicio/ruta de avisos, fallos parciales, roles/tenant, transporte y motor de cola. Cubren offline y fallo de red, ausencia de analítica de confirmación en cola, respuesta tardía, replay del mismo ID, lotes de más de 200, foco, atajos y lector. Los grupos dirigidos se solapan: sus conteos no deben sumarse como casos únicos.

El integrador confirmó la compuerta técnica final: **Prisma generate/validate, TypeScript, sistema de diseño y build aprobados; Vitest 3.597 pruebas aprobadas y 64 omitidas, con 279 archivos aprobados y 11 omitidos**. Se excluyó `tests/serverStartup.test.ts` para no iniciar servicios desde el checkout de auditoría. Dos contratos estáticos detectados en la primera pasada se ajustaron a la estructura nueva antes de esta ejecución final. Las omisiones y la exclusión no son pruebas aprobadas ni integración MySQL superada.

Con el entorno de QA (`NODE_ENV=test`, igual a la línea base comparada), el bundle POS queda en **535,40 kB**, frente a 534,48 kB de la entrega anterior; el chunk principal en **686,37 kB**, frente a 668,32 kB. Estas cifras describen ese build de QA, no el bundle desplegado. La separación de archivos no produjo una mejora de peso: ambos crecieron. La optimización de carga y su medición en dispositivos siguen pendientes.

El navegador local usa la aplicación real con API interceptada y fixtures propios: sin base de datos ni usuarios reales. El integrador verificó a **320×600**: panel de avisos en portal, venta de C$10 con recibido C$20 y vuelto C$10, confirmación online y otra venta con foco en búsqueda; offline con resultado pendiente, contador persistente y sin impresión definitiva. Las capturas están en `outputs/nortex-pos/capturas`. Se verificó también Inicio → POS en escritorio a 1280×600, con acceso a Avisos y sin desbordamiento horizontal (scrollWidth = clientWidth = 1280). Los controles nuevos usan los tokens táctiles de 44 píxeles, y el botón principal conserva el token de 56 píxeles. Una captura demuestra esa composición y esos datos, no persistencia MySQL ni una operación contable real. El acta de capturas debe identificar versión, ruta, viewport, tema y resultado; geometría, foco y contraste son evidencias distintas.

No se ejecutaron MySQL/EXPLAIN ni carga representativa: filtrar por tenant y limitar muestras no prueba el costo de los conteos o la suficiencia de índices. No se certifican matemáticas financieras completas, cumplimiento fiscal, seguridad farmacéutica global, accesibilidad integral, dispositivos físicos ni operación en producción. No hay deploy, mensajes externos, impresión real, push ni validación con los tres comercios habituales en esta entrega.

## 7. Próximas compuertas

1. **Cerrar la evidencia del candidato local.** Conservar el manifiesto exacto y los logs de la compuerta aprobada, conservar las capturas de móvil/escritorio y revisar los cambios de contratos estáticos. Registrar cada omisión; no convertir una prueba no ejecutada en aprobada.
2. **Integración aislada.** Probar venta y reconexión con MySQL efímero, respuesta perdida/replay, conciliación de venta-stock-caja-documento y permisos efectivos. Medir consultas con datos representativos y EXPLAIN; definir ajustes por evidencia.
3. **Piloto observado.** Invitar con autorización a los tres habituales de ferretería/farmacia. Pedir vender, cobrar, explicar confirmado/pendiente, abrir un aviso y hacer otra venta; registrar ayuda, errores y tiempos. Añadir después registrados con poco uso para investigar activación sin mezclar sus resultados con los de habituales. Probar teclado/lector/tiquetera en sus equipos; una simulación wedge no es hardware validado.
4. **Publicación separada.** Solo con QA y candidato identificados, CI/staging del mismo SHA, autorización de producción y humo autenticado correspondiente. Medir segunda venta y regreso en otra fecha por cohortes maduras; no atribuir retención o ingresos a la mejora visual antes de observarlos.
