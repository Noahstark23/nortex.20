# NortexGPT: preparar compras conversando

> Evidencia histórica de la entrega anterior. La ampliación operativa posterior modifica parte de estas fuentes; su estado y sus compuertas se consultan en [NortexGPT operativo](NORTEXGPT_OPERATIVO_2026-09-05.md). Los manifiestos anteriores se conservan y no acreditan automáticamente el candidato nuevo.

Estado: implementación local terminada y compuerta final aprobada. Este informe amplía la primera entrega de NortexGPT; no reemplaza su evidencia histórica. No habilita un piloto, WhatsApp, un proveedor pagado, staging ni producción.

## Recorrido

Una persona escribe «Nortex, compré 50 bolsas de cemento». El asistente conserva cantidad, presentación y descripción, y ofrece **Adjuntar factura** o **Completar por aquí**. La foto es opcional para capturar los datos; la compra sigue necesitando los campos que exige Compras, incluido el número real de factura.

Al continuar por texto se eligen productos y proveedor existentes, se aclara la unidad del catálogo o empaque y se solicitan costos, total, fecha y condiciones que falten. La recepción física y el pago se preguntan por separado. Farmacia pide lote y vencimiento cuando el producto lo requiere. Los valores no se calculan ni se inventan para completar la conversación.

Cuando están los datos, se crea una propuesta DRAFT. **Revisar compra** abre los datos declarados y permite calcular sus efectos con el servicio de Compras. Sólo el botón de confirmación registra esa versión; responder «sí», «agregalo» o «confirmar» en el chat no registra dinero ni inventario. Cambiar una cantidad o costo vuelve a exigir revisión. Las correcciones sobre facturas adjuntas se realizan en esa revisión para conservar el vínculo al documento.

Si se adjunta una factura durante la captura, el worker extrae el documento por separado y luego compara lo declarado. Por ejemplo, 50 en el chat y 40 en la factura dejan una diferencia visible y bloqueante. Un archivo ilegible o incompatible conserva la alternativa manual. La lectura real de campos obligatorios ilegibles sigue fallando: no se declara lectura parcial del proveedor como demostrada.

## Contratos

- `purchaseIntake*.ts`: hechos, preguntas pendientes, elecciones de catálogo y estado privado. El estado vive en `AssistantConversation.metadata`, con `stateVersion` para concurrencia.
- Cada mensaje conserva su `requestId`: una respuesta perdida se reintenta con la misma identidad. Mensajes, versión de captura y creación/corrección de propuesta se guardan juntos. La llamada al modelo ocurre fuera de esa transacción.
- La fuente MANUAL se crea exclusivamente en el servidor e identifica conversación, captura y respaldo textual. No se inventan adjuntos. Las propuestas DOCUMENT anteriores siguen requiriendo sus archivos. El cliente no puede cambiar la fuente en una revisión.
- `purchasePrepare` expresa permisos actuales de Compras para la captura manual; no depende del interruptor de OCR. Registrar sigue requiriendo el interruptor de ejecución. `accessScope` invalida los datos locales si cambia el rol aunque algunos permisos booleanos sean iguales.
- El adaptador opcional de lenguaje propone hechos tipados y respaldados por el mensaje. No aporta IDs, permisos, recepción, pago ni confirmación. Los campos ambiguos permanecen pendientes. El modo determinista cubre los recorridos probados; no acredita comprensión universal de texto libre.
- `AssistantJob.intakeContext` conserva el contexto de captura obtenido por el servidor. No se envía al proveedor de documentos. Se revalida antes de leer y antes de publicar una propuesta. Una captura que ya tiene propuesta no se vuelve a usar para otra factura.
- Stock, caja/deuda, asiento, auditoría y comprobante siguen pasando por Compras y su idempotencia persistente. Ningún chat o worker llama a confirmación.
- La limpieza elimina hasta 100 propuestas no confirmadas vencidas por pasada, incluidas sus copias del texto declarado. Revalida negocio, estado y vencimiento al borrar; las confirmadas conservan su evidencia. Una conversación de 30 días puede continuar después de que venza su propuesta de 7 días.

La migración aditiva `20260905_nortex_assistant_purchase_conversation` añade cuatro columnas a las tablas existentes del asistente. Su nombre ordena la creación inicial de esas tablas antes de la ampliación. No cambia tablas financieras ni el transporte actual de WhatsApp.

## WhatsApp privado del negocio

La aclaración del usuario define el canal futuro: **dueño y equipo conversando en privado con Nortex**. No es el WhatsApp que responde a clientes de la tienda. El núcleo conversacional y Compras son reutilizables; conectar ese transporte exige identidad verificada de cada miembro, permisos vigentes, aislamiento de historial, entrada/salida durable y confirmación humana de la propuesta exacta. No se envió ningún mensaje ni se activó ese canal.

## Evidencia de esta ampliación

Resultados del candidato `/tmp/nortexgpt-conversation-20260905`:

- Prisma 6.4.1 generate/validate, TypeScript, sistema de diseño y build aprobados.
- **4.222 pruebas generales aprobadas**, 150 omitidas fuera de la compuerta obligatoria; las omitidas no cuentan como aprobación. La primera corrida detectó una expectativa anterior que clasificaba toda compra como `prepare`; se actualizó explícitamente a `purchase_intake`, conservando el rechazo de ejecución por chat, y se repitió la suite completa.
- **164/164 pruebas con MySQL en 21 suites obligatorias**, sin omisiones. La suite nueva aporta 10 recorridos HTTP reales: compra por texto, repetición, propiedad, permisos revocados, cierre fiscal, flete conservado, cancelación y carreras entre cancelar/confirmar. [Evidencia de conversación](evidence/nortexgpt/conversation-qa.json).
- **Migración SQL exacta** aplicada en una nueva base MySQL descartable: 118 tablas conservadas, cuatro columnas añadidas, registro sintético preservado y comparación contra schema final sin diferencias. También se verificó el orden creación → ampliación. [Evidencia](evidence/nortexgpt/conversation-migration.json).
- Pruebas de captura reproducen y reparan: cantidad confundida con costo, corrección del primer producto sin elegir entre varios, pérdida de flete/notas/fechas/advertencias al corregir por chat y propuesta READY que sobrevivía a cancelar la captura. La corrección conserva el borrador completo; los datos ambiguos permanecen pendientes.
- 65 pruebas de panel/revisión verifican conservación del carrito, atajos y lector del POS, respuesta perdida, correcciones pendientes, aislamiento al cambiar rol y separación entre capturas. La prueba visual reprodujo un control que marcaba crédito como pagado; el servidor lo rechazó sin efectos. La UI reparada mantiene crédito pendiente y permite calcular un DRAFT intacto. Una regresión ejecutable del componente anterior falla con las reglas reales del dominio y pasa tras la reparación.
- Farmacia: la captura pide lote y vencimiento válido. Contado: recepción y pago se preguntan por separado. El resumen refleja la cantidad revisada y la unidad elegida, conservando los mensajes históricos.
- **Mutación global 99,88356 %**: 5.173 instrumentados; 5.143 detectados por pruebas, cuatro por timeout, seis sobrevivientes históricos idénticos y 20 ignorados preexistentes. Sin casos sin cobertura, sin bajar el umbral 99.85 ni ampliar exclusiones. El alcance de 49 módulos monetarios permanece intacto.
- QA visual completada: propuesta READY sin registrar, vista previa a crédito correcta y carrito conservado. La lectura de MySQL confirma cero compras y cero movimientos para esa factura. [Recorrido visual](evidence/nortexgpt/conversation-panel.md) y [comprobación persistida](evidence/nortexgpt/conversation-visual-persistence.json).

La compuerta y la huella final de archivos están en [conversation-verification.json](evidence/nortexgpt/conversation-verification.json). Los informes completos permanecen en `reports/` del candidato local; no son CI remoto. La evidencia enfocada anterior conserva su propia huella; la compuerta completa se repitió sobre el candidato final.

La captura determinista inicial resuelve un producto por recorrido. Si la revisión incorpora varias líneas, las correcciones de cantidades/costos requieren elegir el renglón en el formulario. Estas pruebas no acreditan comprensión universal de lenguaje libre, evaluación del modelo real, revisión humana del corpus, piloto de ferretería/farmacia ni dispositivos físicos.

## Preservación y modularidad

Se desarrolla en una copia aislada del checkout existente, sin modificar ramas, worktrees ni historial. La reintegración compara los hashes de los archivos originales y copia únicamente los cambios de esta ampliación. `backend/server.ts` y `components/POS.tsx` sólo conservan su composición previa; no se añaden flujos a los monolitos ni se elevan presupuestos de líneas/estado.

No se extrajo un flujo de los monolitos en esta ampliación. Los módulos nuevos de captura, tipos, interpretación, procedencia y contexto de documentos suman 515 líneas; el componente nuevo de captura suma 29. El conjunto de archivos de producto afectados, incluido schema/migración, pasa de 4.491 a 5.299 líneas (**+808**). `conversations.ts` pasa de 167 a 247; el hook de UI, de 172 a 191; el panel, de 86 a 112. El servidor conserva 14.638 líneas y el POS 6.949, sin crecimiento. La reducción previa de Compras sigue documentada en la primera entrega.

Integración local completada: 46 archivos copiados (19 nuevos), sin conflictos de hashes. TypeScript también pasó en el checkout integrado. Se conservaron la rama, los cambios anteriores, los monolitos y los presupuestos. No se aplicó la migración a bases de usuarios.
