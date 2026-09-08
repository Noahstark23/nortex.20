# NortexGPT: evidencia local del panel

Fecha: 2026-09-05. Candidato: `/tmp/nortexgpt-implementation-20260905`.
Entorno descartable servido exclusivamente en `127.0.0.1`, con ferretería y farmacia sintéticas preparadas por QA. No se usaron datos, credenciales ni servicios de producción.

## Demostrado

- Navegador real, escritorio 1280 × 720: abrir NortexGPT desde el POS; consultar «¿Cómo va mi negocio hoy?»; mostrar cifras de MySQL, período y horario de Managua, procedencia y diferencia explícita entre ventas y utilidad. La respuesta mantiene indicadores no disponibles separados de cero.
- Navegador real, móvil 320 × 740: pestañas Consultar/Factura, límites de archivo, acceso a Compras y recuperación de referencias legibles. Medición DOM: sin desbordamiento horizontal (`document.documentElement.scrollWidth <= innerWidth`).
- Navegador real: pasar de la ferretería a la farmacia sintética abre una conversación vacía y la pestaña Factura no conserva el documento ni el trabajo de la ferretería.
- Navegador real: el panel aplica temporalmente `inert` al contenedor de la app. El árbol de accesibilidad queda limitado a NortexGPT mientras está abierto, incluido después de cambiar el tamaño de pantalla. Al cerrar restaura el estado anterior.
- Navegador real, móvil: carga de `tests/fixtures/assistant/corpus/ferreteria-001.pdf`, archivo sintético. El servidor devuelve adjunto y trabajo persistido; la interfaz muestra espera de lectura sin afirmar registro de compra. Abrir el original obtiene un enlace `blob:` desde una descarga autenticada y privada.
- Prueba renderizada con el POS real: lector y F9/F4 no cambian la venta detrás del asistente; cerrar devuelve el funcionamiento del lector conservando cantidad y carrito.
- Pruebas renderizadas: correcciones y referencia UUID sobreviven a cambiar pestaña, cerrar y volver a montar la revisión; un reintento incierto conserva la misma referencia y no presenta comprobante hasta recuperarlo del servidor.
- Pruebas renderizadas: cambios de sesión y revocación de permisos descartan respuestas antiguas; una falla temporal de acceso oculta datos pero conserva correcciones en memoria hasta volver a comprobar permisos. Se reprodujo y reparó una carrera entre una respuesta financiera pendiente y reducción de permisos.
- Prueba del interruptor de ejecución: apagar sólo ejecución/confirmación conserva la cantidad corregida y la revisión pendiente, permite guardarla y oculta la confirmación. Revocar lectura conserva la política de ocultar y descartar datos.
- Pruebas renderizadas: el egreso en efectivo muestra la identidad exacta de la caja. La confirmación se bloquea si falta esa identidad. Un rechazo definitivo permite corregir la factura; timeout o error indeterminado conservan el intento original.

## Defectos detectados y reparados durante revisión

Se repararon pérdida de borrador al desmontar la pestaña, regeneración del UUID de reintento, borrado de trabajo ante fallas temporales de acceso, respuestas tardías tras revocación, mezcla de documentos al recuperar otra propuesta, contexto de trabajo anterior durante recuperación, consulta de catálogo sin permiso de edición y bloqueo permanente al fallar la descarga privada. Se separaron rechazos definitivos de resultados inciertos. Los códigos de error de lectura se presentan como mensajes de negocio; errores desconocidos reciben un mensaje seguro.

La primera consulta real detectó indicadores de inventario no disponibles pese a existir producto sintético. Se reportó al responsable del backend, quien corrigió la consulta. Tras reiniciar el backend, se repitió el recorrido real a las 15:03 de Managua: catálogo = 1, sin existencias = 0, en o bajo mínimo = 0, cada cifra con procedencia. La reparación quedó comprobada en el navegador; no se confundió la falla inicial con ausencia de productos.

## Verificación ejecutada

Node 22.23.2 mediante mise: TypeScript sin errores, sistema de diseño sin infracciones. La corrida conjunta de panel/revisión/POS crítico/activación aprobó 67/67 casos. Después de traducir códigos de lectura se repitieron las dos suites de NortexGPT: 37/37 casos aprobados, incluyendo apagar ejecución sin perder correcciones. El integrador ejecuta la compuerta global y build sobre el conjunto final.

## Límites de esta evidencia

Las capturas de escritorio y móvil se observaron y emitieron inline mediante CUA. Esa API devuelve imágenes y no expone guardar archivos; no se exportaron mediante herramientas ajenas al navegador autorizado.

No se acredita aquí extracción mediante el proveedor real, precisión del corpus, calidad de una cámara física, uso por comercios reales, mejora de tiempos o retención, ni despliegue. El escenario de carga comprueba adjunto/cola/descarga privada; la lectura y compra requieren sus pruebas independientes. QA confirmó que el worker separado no estaba iniciado en esa demo, por lo que el estado PENDING observado no representa un fallo del producto. Una factura que permanece en espera no se presenta como leída ni registrada.

No se crearon compras mediante el navegador en este recorrido. Las comprobaciones financieras y de concurrencia corresponden a las suites HTTP/MySQL y a la evidencia del integrador.
