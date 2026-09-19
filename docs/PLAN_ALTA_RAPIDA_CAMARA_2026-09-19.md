# Alta rápida de productos con cámara

Fecha: 2026-09-19. Estado: investigación y plan; no implementación nueva.

## Decisión

Crear un recorrido continuo **Escanear → completar → guardar → siguiente**, dentro de una sola pantalla móvil. El usuario confirmó **código de barras primero y foto del empaque cuando falten datos**. La foto sugerirá nombre, marca y presentación; una persona confirmará la ficha antes de guardarla.

El resultado buscado es poder registrar una tanda de productos sin volver al catálogo, abrir repetidamente la cámara ni aprender el formulario avanzado. La simplicidad se medirá completando tareas, no por la apariencia de la pantalla.

## 1. Investigación y patrones aplicables

| Referencia oficial | Patrón observado | Aplicación en Nortex |
|---|---|---|
| [Square: creación mediante códigos](https://squareup.com/help/us/en/article/7992-automate-item-creation-with-square-for-retail) | Escaneo, búsqueda de información, revisión y guardado; aviso ante un GTIN duplicado. | Mostrar sugerencias editables y resolver duplicados antes de crear. No asumir cobertura del catálogo externo en Nicaragua. |
| [Shopify: escáner de inventario](https://help.shopify.com/en/manual/shopify-admin/shopify-app/inventory-scanner) | Distingue asignar códigos, aumentar unidades y establecer cantidades; contempla ubicación y revisión. | El propósito debe estar definido al entrar: agregar una ficha o recibir mercadería. El mismo escaneo no debe significar ambas cosas. |
| [Odoo 18: configuración de Barcode](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/barcode/setup/software.html) | Permite crear ante un código desconocido; la ficha y la recepción son entidades separadas. Variantes y empaques requieren identidad propia. | Volver a la recepción después del alta sin inventar existencias; no confundir una unidad con una caja. |
| [GS1: descripción y precio en códigos](https://support.gs1.org/support/solutions/articles/43000734158/) | El código comercial habitual sirve para consultar información vinculada a un identificador. | Escanear no proporciona por sí solo nombre, marca y precio local. Los códigos estructurados o de balanza requieren sus reglas específicas. |
| [Open Food Facts: API](https://openfoodfacts.github.io/openfoodfacts-server/api/) | Datos comunitarios de alimentos, sin garantía de exactitud o completitud, con límites de uso y condiciones de reutilización. | Posible fuente auxiliar para alimentos; no una dependencia obligatoria ni una solución universal para ferretería y farmacia. |
| [MDN: acceso a cámara](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) y [detección de códigos](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector/detect) | La cámara exige contexto seguro y permisos; BarcodeDetector tiene disponibilidad limitada. | HTTPS, ingreso manual y conservación de ZXing como alternativa. No reemplazar el lector por una API nativa sin compatibilidad comprobada. |

Estas fuentes describen patrones y capacidades, no demuestran que una alternativa sea más rápida para los clientes de Nortex. La cobertura de productos nicaragüenses y el ahorro de tiempo quedan pendientes de medición.

## 2. Cómo funciona Nortex hoy

Base de revisión: candidato `55704ddee09d143d76168e5a70055996233f8c7c`, cuyo árbol corresponde al release `98e54afad4bfa7a0ef5ae99c902102d40d0400ff`. La salud de producción informó este último commit durante la investigación. Se contrastaron los archivos principales de cámara, alta rápida, inventario, lookup y schema con `main` remoto `67f1832502ee68ef67ac12b0803bdbfce48a4cef`, sin diferencias en esos archivos. Las ubicaciones siguientes corresponden al candidato revisado, no al árbol local con cambios previos.

| Evidencia en código | Consecuencia |
|---|---|
| `components/ui/CameraScanButton.tsx:21–29,47–56` detiene la captura al aceptar un código y cierra después del callback satisfactorio. | Hay lectura individual segura, pero no una sesión de altas consecutivas. |
| `components/Inventory.tsx:1679,2803–2811` abre `QuickAddProduct` con el código desconocido. | La cámara y el formulario son recorridos distintos. |
| `components/QuickAddProduct.tsx:165–186,305` incluye **«Guardar y seguir agregando productos»**, pero vuelve al campo SKU. | El modo continuo existe; falta que continúe con la cámara. |
| El reinicio anterior conserva `...formData` y limpia solo algunos campos. | Marca, descripción y otras opciones pueden heredarse sin una elección explícita. Es un riesgo observado en código; no un error reproducido con usuarios en esta auditoría. |
| `components/ImageUploader.tsx` adjunta una fotografía. | No extrae nombre, marca ni presentación. |
| `backend/routes/productLookup.ts` busca por SKU dentro del tenant; `Product` tiene unicidad `[tenantId, sku]`. | Hoy SKU y código escaneado comparten campo. Asociar un código comercial a un SKU interno necesita un contrato adicional, no reemplazar el SKU. |
| `backend/server.ts:6012–6174` crea producto y auditoría en transacción; verifica SKU previamente, sin identidad durable del intento en este endpoint. | La protección local contra doble clic no resuelve una respuesta perdida. La carrera por SKU puede terminar en error genérico aunque la restricción evite duplicar datos. |
| `utils/productForm.ts:60–85` transforma costo vacío en `0`. | No debemos presentar un costo desconocido como si hubiera sido confirmado mediante la cámara. |
| `components/pos/PosCatalogPane.tsx:242` usa cámara sin callback de alta. | El POS identifica productos existentes; el alta desde ese contexto requiere integración específica. |

### Lo que conviene conservar

Lookup exacto por tenant autenticado; solo un `404 PRODUCT_NOT_FOUND` permite ofrecer alta; errores de conexión o autorización no significan ausencia. También deben conservarse el descarte de respuestas después de cambiar de sesión, la liberación de cámara, el ingreso manual y la aceptación de una captura por intención.

Se leyeron `bodegaCatalogQuickAdd.test.tsx`, `cameraScanExperience.test.tsx` e `inventoryCameraLookup.test.tsx`: contienen casos para doble envío, marca, cantidades, lotes, permisos, repetición de fotogramas y aislamiento de sesión. **No se ejecutaron pruebas en esta tarea de planificación**. Tampoco se hizo una prueba visual o física de este nuevo recorrido.

## 3. Recorrido propuesto

### Entrada y escaneo

En Productos: **«Agregar con cámara»**. Un toque abre la cámara trasera y una instrucción breve: «Apuntá al código del producto». Mantener alternativa «Escribir código» y «No tiene código». Linterna únicamente cuando el dispositivo la soporte.

El escaneo consulta primero el catálogo propio. Mientras busca, bloquea nuevas detecciones y muestra actividad sin borrar el código.

- **Existe:** tarjeta con nombre, marca y presentación; aviso «Ya está registrado». Permitir abrir la ficha o continuar con otro producto. No sumar stock.
- **No existe, confirmado:** mostrar la ficha compacta dentro de la misma pantalla.
- **No se pudo comprobar:** conservar el intento y ofrecer reintento. No habilitar creación como si hubiera un resultado negativo.

### Completar con foto cuando haga falta

En la ficha: **«Fotografiar empaque»**, con encuadre, vista previa y opción de repetir. Extraer como propuestas separadas nombre, marca y presentación. Si una lectura es ambigua, dejar el campo pendiente; no rellenarlo con una conjetura presentada como dato cierto.

Mostrar los datos sugeridos como editables y permitir corregirlos antes de guardar. La extracción puede fallar o tardar: el formulario manual debe seguir funcionando. No enviar video continuo al proveedor.

Campos principales:

1. Nombre del producto.
2. Marca, con opción explícita «Sin marca / no identificada».
3. Presentación visible: por ejemplo, «500 ml». Para el primer alcance se compone de forma controlada en el nombre, sin crear una segunda fuente de verdad oculta; un campo estructurado futuro requiere schema y migración definidos.
4. Precio de venta en C$, confirmado por el comercio.
5. Unidad de venta, inicialmente visible y editable.

Código capturado visible en segundo plano. Categoría y opciones especializadas se despliegan cuando hacen falta. La fotografía no determina costo, precio, impuesto, cantidad, lote ni vencimiento automáticamente.

**«Botella de 500 ml» no significa venta fraccionaria:** puede venderse por unidad. Respetar reglas de cantidades, familias, empaques y lotes ya existentes.

### Guardar y continuar

Acción principal: **«Guardar y escanear otro»**. Secundaria: «Guardar y salir».

Después de la confirmación del servidor: mensaje breve «Guardado», contador de la tanda y cámara lista para el siguiente producto. Una franja permite revisar los confirmados sin perder el borrador actual.

Limpiar todos los datos específicos del producto anterior, incluida la marca. Solo conservar valores elegidos como preferencias de la tanda, visibles y desactivables; por ejemplo, categoría y unidad. Nunca heredar silenciosamente costo, impuesto, marca, lote o empaque.

Rearmar el lector después del guardado confirmado. Si sigue frente a la cámara el mismo código, no volver a crear ni agregar unidades. Repetirlo requiere una acción explícita. No deducir que salió del encuadre por recibir eventos vacíos.

### Sin código y código de producto existente

- Sin código: foto y captura manual; identificador interno generado por el servidor. No inventar un GTIN comercial. Impresión de etiqueta interna queda como ampliación independiente.
- Producto existente con SKU interno: buscar y seleccionar la ficha; nunca sobrescribir su SKU para vincular el código. La vinculación se habilita cuando exista el modelo de códigos alternativos de la fase 3. Hasta entonces, informar la limitación y permitir salir hacia la ficha sin crear duplicados.

## 4. Guardado, existencias y recuperación

**Crear ficha desde catálogo inicia con stock cero.** No ofrecer existencia inicial dentro de este nuevo recorrido. La recepción sigue siendo el lugar para confirmar bodega, cantidad, costo y, cuando corresponda, lote y vencimiento.

Si se entra desde una recepción, devolver el producto creado a su borrador conservando lo que ya estaba capturado. La confirmación de esa recepción usa el servicio vigente y `applyStockDelta`; no crear una segunda ruta para ingresar stock.

El costo no informado queda identificado como pendiente durante la captura. Antes de persistir un estado durable de «costo desconocido» hay que resolver su representación compatible con el contrato legacy que usa cero. La foto nunca confirmará ese costo y una entrada valorizada exigirá su captura explícita.

Estados de la sesión: **borrador → comprobando → completando → guardando → confirmado**, con estados separados de **sin conexión**, **resultado incierto** y **conflicto**.

- Borradores locales separados por usuario y tenant; restauración solo bajo la sesión autorizada. No exponerlos al cambiar de cuenta.
- Conservar identificador estable y contenido del intento enviado. Un timeout no permite crear otro intento a ciegas.
- Backend: identidad durable de operación, hash del contenido, resultado confirmado y consulta de estado, con índices y unicidad por tenant. Repetir la misma operación devuelve el mismo producto; reutilizarla con otro contenido devuelve conflicto.
- SKU duplicado concurrente: respuesta tipada, con acceso únicamente a la ficha del tenant autorizado. Una coincidencia por SKU no prueba que nuestro intento haya sido el que lo creó.
- Sin conexión se puede conservar un borrador, pero no mostrar «Producto guardado». El alta pendiente no se vuelve vendible automáticamente.
- Creación y auditoría atómicas; ninguna llamada a OCR o catálogo externo dentro de la transacción.

Roles: conservar OWNER/ADMIN para crear; no ampliar permisos de bodeguero o vendedor por agregar una pantalla. Una eventual solicitud de alta para otros roles será un flujo separado.

## 5. Foto y catálogos externos

La foto asistida forma parte del alcance solicitado, aunque se entregue después del circuito de guardado seguro. La elección de OCR local o servicio remoto se decidirá con una muestra de empaques: precisión de nombre/marca, tiempo en teléfonos modestos, tamaño del bundle y costo por alta. No hay proveedor elegido ni contratación autorizada por este plan.

Preferir recorte y reducción de imagen antes del análisis. Si se usa servicio remoto: acceso autenticado, límites de tamaño y frecuencia, timeout, retención mínima definida y borrado de capturas temporales. El texto extraído es entrada no confiable y nunca instruye herramientas o mutaciones. La foto destinada a OCR no se publica automáticamente como imagen de catálogo ni se envía a una base pública.

Los catálogos externos son una mejora opcional: evaluar primero una muestra autorizada de 200 productos representativos de pulpería, ferretería y farmacia. Medir coincidencia exacta de código, marca y presentación, no solo «encontró un nombre». Usar un adaptador con caché, límites y fallback; revisar condiciones de reutilización antes de persistir datos o imágenes. No depender exclusivamente de Open Food Facts ni prometer reconocimiento universal.

## 6. Implementación por entregas

| Entrega | Alcance y módulos propuestos | Condición de cierre |
|---|---|---|
| 0. Línea base | Caracterizar el alta actual, reinicio de campos, retorno a recepción y contrato HTTP. Medir el mismo lote de productos en móvil. | Video antes y tiempos por tarea; pruebas que detecten regresiones del contrato. |
| 1. Alta continua segura | Nuevo `components/products/CameraProductEnrollment.tsx`, estado en `hooks/useCameraProductEnrollment.ts`; reutilizar captura y validadores. Servicio/ruta de creación fuera de `backend/server.ts`, idempotencia durable y borradores recuperables. | Escanear, completar manualmente, guardar y siguiente sin salir; duplicados y resultado incierto resueltos; stock cero. Esta entrega sola no completa la foto asistida. |
| 2. Foto asistida | Componente de captura y servicio/adaptador de extracción separados; revisión de nombre, marca y presentación, fallback manual. | Prueba real de precisión y latencia; ninguna sugerencia se persiste sin confirmación; catálogo y stock sin efectos colaterales. |
| 3. Integración y códigos alternativos | Retorno a recepción; integración POS preservando carrito; modelo aditivo de códigos por producto y tenant para enlazar código comercial sin cambiar SKU. Evaluar catálogos externos después del piloto. | Recepción sin doble ingreso, carrito intacto, conflictos de códigos tipados y migración compatible. |

Antes de implementar se debe verificar nuevamente la base de código. No agregar lógica nueva a los monolitos `POS.tsx` y `backend/server.ts`; solo composición. Una extracción requiere prueba conductual previa y reducción del presupuesto correspondiente, sin ampliar excepciones.

El modelo de códigos alternativos debe conservar ceros iniciales y distinguir identificador interno, GTIN y empaque. Equivalencias UPC/EAN solo bajo validación explícita; nunca normalizar códigos arbitrarios como si todos fueran GTIN. Cada variante y nivel de empaque conserva identidad y cantidad asociada.

## 7. Validación y criterio de aceptación

Los siguientes son **objetivos propuestos**, no resultados medidos:

- Entrada a cámara en un toque desde Productos; siguiente producto sin reabrir el modal. Formulario utilizable con teclado móvil y lector manual, etiquetas accesibles y foco predecible.
- Comparación antes/después con cinco usuarios y una tanda equivalente de 20 productos: al menos 90% de tareas completadas sin ayuda y reducción objetivo del 50% del tiempo mediano. Separar productos conocidos, nuevos y foto necesaria.
- Android e iPhone físicos: al menos 30 intentos por combinación relevante de dispositivo/formato; medir luz baja, reflejos y empaques curvos. Meta inicial: 95% de lectura al primer intento y p95 de lectura menor a tres segundos en etiquetas legibles. Ajustar objetivos con la línea base, no declarar éxito desde simulación.
- Evaluar foto por campo: porcentaje de nombre/marca/presentación correctos, correcciones, omisiones y tiempo total hasta guardar. Una sugerencia rápida pero equivocada no cuenta como mejora.
- Diez detecciones repetidas no generan diez altas. Dos teléfonos y reintentos simultáneos conservan unicidad. Respuesta perdida se reconcilia por identidad de operación.
- Pruebas de tenant, roles, 401/403/500, cambio de sesión, permisos denegados, segundo plano, cierre y recuperación. Ningún fallo de lookup habilita alta por falsa ausencia.
- Crear ficha no mueve stock; recibir mueve exactamente lo confirmado. Probar cantidades medidas, empaques, lotes y bodegas con HTTP y MySQL 8 descartable, mediante `npm run test:integration:required`.
- Si se integra en POS: escanear, abrir alta, cancelar o guardar conserva carrito y turno; el lector y los atajos del fondo quedan bloqueados mientras el panel está activo.
- Compuerta de implementación: Prisma generate, TypeScript, Vitest, sistema de diseño y build; integración obligatoria para inventario, mutación cuando cambie lógica de dinero. No contar casos omitidos como aprobados.

Usar métricas agregadas por fase y tipo de error, sin imágenes, códigos comerciales ni datos privados en telemetría. Una duplicación, pérdida de borrador/carrito, acceso entre tenants o movimiento de stock inesperado bloquea la entrega afectada.

## 8. Estado de esta entrega

**Demostrado por lectura:** desconexión entre cámara y alta continua, ausencia de extracción en la foto actual, campos conservados al reiniciar, contrato de SKU y límites de idempotencia del endpoint revisado.

**Pendiente de reproducir y medir:** equivocaciones causadas por herencia de marca, número real de toques, tiempos actuales, calidad de cámara/OCR y mejora con usuarios.

**Entregado:** investigación de fuentes oficiales, comparación con el código y plan técnico/UX. No se modificó el producto, no se ejecutaron pruebas del nuevo flujo y no se realizó un despliegue en esta tarea.
