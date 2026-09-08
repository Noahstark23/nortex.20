# NortexGPT operativo — implementación local y operación

Implementación iniciada: 2026-09-05; cierre local: 2026-09-07. Candidato: `/tmp/nortexgpt-operativo-20260905`.

## Estado operativo

La implementación local incorpora consultas, reposición, vencimientos, propuestas de acciones, promociones del POS y transporte privado de WhatsApp. Conserva React/Vite, Express, Prisma 6.4.1, MySQL 8 y el cliente Prisma compartido. Los módulos nuevos se componen desde el servidor y el POS; no sustituyen los servicios de dominio.

**Código local y compuertas aprobados el 2026-09-07:** 298 casos MySQL obligatorios en 35 suites, sin omisiones; 4,752 pruebas generales aprobadas, con 284 omitidas fuera de esa compuerta. Prisma, TypeScript, diseño y build aprobados; mutación 99.8841%, umbral 99.85 conservado. [Evidencia verificable](evidence/nortexgpt/operational-verification.json) y [manifiesto de archivos](evidence/nortexgpt/operational-files.json). Los conjuntos se solapan: no se suman para inventar un total distinto. No se evaluó el modelo real de esta ampliación, no se ejecutó el piloto y no se acreditan CI remoto, staging, despliegue o producción. Una demostración con datos sintéticos tampoco acredita ahorro de tiempo ni comprensión universal.

Este documento describe los bloques de implementación del plan. La [entrega inicial](NORTEXGPT_IMPLEMENTACION_2026-09-05.md) y la [captura de compras por conversación](NORTEXGPT_CONVERSACION_2026-09-05.md) conservan su evidencia histórica; sus aprobaciones no se trasladan automáticamente a este candidato.

## Conversación, herramientas y continuidad

Una consulta operativa crea un `AssistantRun` privado de la conversación. El servidor conserva solicitud, estado, versión, pasos, evidencia y referencias de propuestas. La identidad procede de la sesión; el modelo recibe únicamente herramientas habilitadas para ese usuario y argumentos validados. No tiene SQL libre, acceso arbitrario a endpoints ni una herramienta de confirmación. Decir «sí» en el chat no registra una operación.

El orquestador permite **cuatro iteraciones y 60 segundos por ejecución**. Usa `claude-haiku-4-5-20251001`, sin reintentos automáticos del SDK, y persiste cada intento antes de invocar al proveedor. Los cálculos proceden de herramientas del servidor. Una respuesta final debe referenciar evidencia recibida; no se aceptan cifras sin respaldo. Se puede recuperar contexto de preguntas y resultados anteriores, pero sus fechas se conservan y se exige consultar información actual antes de preparar otra acción.

| Herramienta registrada | Alcance |
|---|---|
| `search_help` | Ayuda aprobada, filtrada por rol, con referencias. |
| `get_business_overview` | Ventas, gastos, saldos y existencias autorizados; distingue saldos actuales. |
| `audit_business_health` | Ventas, ticket y comparación; margen sólo para roles financieros. |
| `check_inventory_burn_rate` | Salidas netas, cobertura estimada y reposición. |
| `inspect_batch_expiry` | Existencias por lote, vencimientos y acciones permitidas. |
| `read_daily_brief` | Avisos privados del día; exige reconsultar antes de actuar. |
| `search_catalog` | Productos y proveedores existentes, sin crear equivalencias supuestas. |
| `prepare_purchase_order`, `prepare_batch_writeoff`, `prepare_supplier_return`, `prepare_promotion` | Crean propuestas DRAFT revisables; ninguna confirma el dominio. |

Después de reservar presupuesto se revalida el acceso antes de invocar al proveedor. Una revocación en ese intervalo produce cero llamadas y liquidación conocida cero. La preparación desde una herramienta queda vinculada al run. Dentro de la transacción se comprueban propietario, rol, conversación, estado RUNNING, lease y plazo; una consulta cancelada no puede crear después otro borrador. Si una propuesta ya quedó persistida antes de interrumpirse la respuesta, su referencia puede recuperarse sin repetir la preparación.

Cancelar requiere la versión actual. Un run abandonado con lease vencido se marca interrumpido: la recuperación no vuelve a ejecutar sus herramientas. Un PENDING todavía no reclamado sí puede ser atendido por el worker. La ausencia de proveedor o presupuesto permite respuestas deterministas acotadas cuando hay herramientas disponibles; una respuesta parcial o degradada se muestra como tal.

Fuentes: [contratos compartidos](../shared/assistantOperations.ts), [registro de herramientas](../backend/services/assistant/operations/tools.ts), [orquestador](../backend/services/assistant/operations/orchestrator.ts), [ejecuciones durables](../backend/services/assistant/operations/runService.ts), [preparación y referencias](../backend/services/assistant/actions/service.ts).

## Negocio, reposición y vencimientos

Los resultados indican procedencia, período, corte y fecha de consulta. Se usan días civiles de Managua. El estado `unavailable` o `partial` conserva la ausencia de evidencia; no convierte un fallo en cero.

**Negocio.** Ventas vigentes y devoluciones se concilian con impuestos y costos históricos. El ticket promedio corresponde a tickets emitidos vigentes. El margen bruto resta costo histórico a ventas netas sin IVA: no es ganancia neta ni flujo de caja. La comparación exige igual cantidad de días y el mismo corte; para un día, el período predeterminado comparable es el mismo día de la semana anterior. Caja, empleado y vendedor consultan su operación; sus consultas no recuperan costos para enviarlos al modelo. No se atribuyen causas de una variación por simple correlación.

**Reposición.** La ventana predeterminada usa los últimos 30 días completos. Las cantidades históricas son BASE, incluso si se vendió PACK. Se excluyen anulaciones y se separa venta neta comercial de consumo de stock: sólo RESTOCK reduce este último; cuarentena y pérdida no se vuelven existencias vendibles por suposición. La sugerencia considera existencias vendibles verificadas, OC aprobadas pendientes y el paso de cantidad del catálogo. Las existencias y OC son actuales; un cutoff histórico es rechazado porque no reconstruye una foto histórica. Un rango pasado de ventas conserva su período y la fecha actual de consulta del stock. La cobertura de historial se contrasta con la antigüedad del producto y la ventana: con datos insuficientes no hay promedio ni días de agotamiento; sólo se puede sugerir completar el mínimo configurado, descontando existencias y OC, sin multiplicadores implícitos. Los mínimos y las advertencias se muestran junto al producto. Es una estimación basada en movimientos registrados: no modela horas de apertura, demanda perdida por agotamiento, estacionalidad ni una hora exacta de reposición. Una consulta por bodega no inventa velocidad o pendientes de OC de esa bodega cuando la evidencia es del negocio completo.

**Vencimientos.** El día de vencimiento se compara como día civil, sin adelantarlo por la zona del servidor. Un saldo de lote/bodega sin conciliar bloquea la propuesta operativa. Las acciones disponibles son baja física y devolución al proveedor según permisos y origen; no se ofrece una retención/liberación genérica de lotes. La cuarentena de devoluciones de clientes conserva su dominio propio.

El resumen diario se materializa por negocio, usuario, rol y día de Managua. Presenta hasta tres avisos priorizados y permite descartarlos sólo para esa persona. Revisa hasta diez productos y diez lotes prioritarios y advierte el alcance limitado; no representa una auditoría de todo el catálogo. La interfaz lo solicita al entrar y recupera el registro del día.

Fuentes: [períodos](../backend/services/assistant/operations/analyticsPeriod.ts), [métricas históricas](../backend/services/assistant/operations/analytics.ts), [inventario y lotes](../backend/services/assistant/operations/inventory.ts), [consultas de inventario](../backend/services/assistant/operations/inventoryQueries.ts), [resumen diario](../backend/services/assistant/operations/briefing.ts).

## Propuestas y confirmación de acciones

`AssistantActionProposal` es independiente de `Purchase` y del contrato de facturas. Su recorrido es preparar DRAFT → editar → calcular revisión READY → confirmar esa versión. Una edición incrementa versión e invalida la revisión. La vista previa expone resumen, líneas, efectos, advertencias y texto de confirmación; un dato faltante o incompatible impide READY.

| Tipo | Permisos vigentes | Efecto al confirmar |
|---|---|---|
| `PURCHASE_ORDER_DRAFT` | OWNER, ADMIN, SUPER_ADMIN, MANAGER | Crea una OC DRAFT con correlativo e idempotencia. No aprueba, recibe, paga ni crea deuda. |
| `BATCH_WRITEOFF` | OWNER, ADMIN, SUPER_ADMIN | Registra baja de lote/bodega, stock, Kardex y asiento de pérdida. Exige confirmación de retiro físico y período abierto. |
| `SUPPLIER_RETURN` | Permisos de recepción/devolución, incluida BODEGUERO | Registra salida física contra un origen admitido. No crea nota de crédito ni reduce deuda automáticamente. |
| `PROMOTION` | OWNER, ADMIN, SUPER_ADMIN | Publica o cancela una promoción exacta, sin mover inventario o deuda al publicarla. |

El modelo no puede certificar retiro o envío físico: la preparación fuerza esos campos a falso y la persona los revisa en el formulario. Una devolución resuelve líneas de compra directa, recepción sin conciliar o asignación de conciliación admitidas por el servicio existente; no supone proveedor, lote ni cantidad disponible. Bodega recibe datos operativos sin costos.

La confirmación recibe el identificador en la ruta y **sólo `{version, requestKey}` en el cuerpo**. Rechaza productos, cantidades o totales adicionales. Se bloquean y revalidan usuario activo, rol, habilitación y propuesta; se recalculan las condiciones del dominio y se compara la revisión exacta. Efecto, auditoría y `AssistantActionCommand` quedan en la misma transacción, sin llamadas a IA. El doble clic y una respuesta perdida recuperan el mismo resultado; una clave reutilizada con otra solicitud falla. GET de la propuesta confirmada devuelve su comprobante autorizado.

Venta y cierre de caja comparten el orden User → Shift: el cierre toma un bloqueo compartido del actor antes del turno y comprueba su estado y rol vigentes. Esto evita el deadlock reproducido con promociones. Los formularios habituales se conservan. OC usa el servicio compartido de creación; la merma utiliza `applyStockDelta` y el registro por lote/bodega; devoluciones reutilizan `supplierReturnService`. Las compras manuales o desde factura siguen por `purchaseRegistrationService`, su idempotencia y las reglas actuales de caja, crédito, impuestos, recepción y lotes. No hay un segundo motor contable.

Fuentes: [rutas y cuerpos estrictos](../backend/routes/assistantActions.ts), [servicio de propuestas](../backend/services/assistant/actions/service.ts), [adaptadores](../backend/services/assistant/actions/adapters.ts), [creación de OC](../backend/services/purchaseOrderDraftService.ts), [merma](../backend/services/batchWriteoffService.ts), [devoluciones](../backend/services/supplierReturnService.ts), [Compras](../backend/services/purchaseRegistrationService.ts).

## Promociones temporales y cobro seguro

La promoción se aplica a productos explícitos y sus lotes vendibles, no a un lote individual. Define porcentaje mayor que cero y menor que cien, inicio y fin obligatorios; el editor interpreta fecha/hora local en Managua. La revisión muestra detalle BASE, PACK y mayoreo existentes. El backend rechaza solapamientos del mismo producto y mantiene excluidos los lotes vencidos. No acumula la promoción con descuentos manuales ni cotizaciones incompatibles.

Publicar conserva una copia de la configuración comercial y fiscal. Un cambio material de precio, presentación, unidad o condición fiscal impide reutilizar la promoción como si siguiera intacta; el cobro informa el precio normal y la necesidad de revisión administrativa. La versión comercial es monotónica: cambiar un precio y devolverlo al anterior no recupera su versión vieja. La edición masiva de productos conserva el redondeo Decimal y registra precio, categoría, versión y auditoría en una transacción; dos porcentajes concurrentes leen el precio bloqueado y no pierden el ajuste anterior.

El alcance de venta es **POS con conexión**. El servidor cotiza el carrito y la caja; la persona acepta el total antes de cobrar. La revisión dura como máximo dos minutos o hasta el fin de la promoción, lo que ocurra antes. Cambios del carrito, precio, promoción o régimen fiscal exigen otra revisión. Las ventas registradas conservan precio e impuestos históricos para devoluciones y anulaciones.

El POS conserva su cola habitual para ventas ordinarias sin conexión. Una venta con revisión promocional ya enviada no se incorpora a esa cola cuando la respuesta es incierta. Conserva carrito e identidad `offlineId`, también tras recarga, y consulta el comprobante. Un GET sin resultado no autoriza otro cobro. La cancelación explícita consulta bajo bloqueo y usa la identidad persistida por Ventas: devuelve la venta si ya quedó registrada o invalida el intento pendiente; sólo ese resultado permite liberarlo.

Fuentes: [gestión](../backend/services/promotions/management.ts), [precios](../backend/services/promotions/pricing.ts), [revisión de cobro](../backend/services/promotions/checkout.ts), [recuperación/cancelación](../backend/services/promotions/receipt.ts), [versión comercial](../backend/services/promotions/productVersion.ts), [edición masiva](../backend/services/productBulkEditService.ts), [control del POS](../hooks/usePromotionCheckout.ts).

## WhatsApp privado del equipo

El transporte privado es independiente del agente comercial que responde a clientes. La persona obtiene un código con su sesión de Nortex y lo envía desde su teléfono al número privado configurado. El código es de un uso, dura diez minutos y sólo se almacena su hash. Un teléfono asociado a otro usuario requiere revisión administrativa; no se transfiere por suposición.

El webhook verifica firma sobre el cuerpo original y confirma recepción después de persistir. Inbox conserva identidad del mensaje y orden por remitente; el worker usa leases e invoca el núcleo con una solicitud estable. Si existe un run operativo en curso, espera su resultado durable antes de preparar la respuesta. Las propuestas se revisan mediante enlace autenticado de Nortex: WhatsApp no habilita confirmación textual.

Outbox registra SENDING antes de enviar. La respuesta verificada produce SENT; pérdida de respuesta o lease vencido produce UNKNOWN. UNKNOWN no se reenvía automáticamente. Las salidas requieren permisos vigentes y ventana de respuesta admitida; apagar el canal o revocar el vínculo no retira un mensaje que el proveedor ya aceptó.

Acepta una imagen JPEG/PNG o PDF por mensaje mediante el descargador restringido. Usa el almacenamiento, worker de extracción y presupuesto del asistente; no crea otra bolsa de IA. No hay envío real, número activado ni recepción real acreditados para este candidato. El procedimiento completo y sus límites están en el [runbook privado](runbooks/assistant-private-whatsapp.md).

Fuentes: [rutas privadas](../backend/routes/assistantPrivateWhatsapp.ts), [identidad](../backend/services/assistant/privateWhatsapp/identity.ts), [inbox](../backend/services/assistant/privateWhatsapp/inbox.ts), [procesamiento](../backend/services/assistant/privateWhatsapp/processor.ts), [outbox](../backend/services/assistant/privateWhatsapp/outbox.ts), [worker](../backend/workers/assistantPrivateWhatsapp.ts).

## Configuración, presupuesto y operación

Los interruptores globales sólo se habilitan con el texto exacto `true`. Los campos booleanos de `AssistantTenantConfig` nacen apagados; la migración no incorpora negocios al piloto. Las capacidades también requieren usuario activo y rol vigente. No existe aquí una instrucción para activar producción.

| Variable global | Control adicional por negocio | Función |
|---|---|---|
| `NORTEX_ASSISTANT_ENABLED` | `enabled` | Entrada general del asistente. |
| `NORTEX_ASSISTANT_LANGUAGE_ENABLED` | Permisos de captura y asistente habilitado | Adaptador opcional de hechos conversacionales; no es el interruptor del orquestador operativo. |
| `NORTEX_ASSISTANT_EXTRACTION_ENABLED` | `extractionEnabled` | Extracción documental; la captura manual no depende de OCR. |
| `NORTEX_ASSISTANT_EXECUTION_ENABLED` | `executionEnabled` | Confirmación de compras y acciones. |
| `NORTEX_ASSISTANT_OPERATIONS_ENABLED` | `operationsEnabled` | Ejecuciones con herramientas y resumen diario. |
| `NORTEX_ASSISTANT_ACTIONS_ENABLED` | `actionsEnabled` | Preparación/revisión de acciones; confirmar exige además ejecución. |
| `NORTEX_PROMOTIONS_ENABLED` | `promotionsEnabled` | Promociones y su validación de cobro; su recuperación conserva acceso a operaciones registradas. |
| `NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED` | `privateWhatsappEnabled` | Canal privado; envío real exige además `NORTEX_PRIVATE_WA_SENDING_ENABLED`. |

El adaptador privado exige configuración independiente para identificador de número, firma, verificación, acceso y versión API; sus **nombres**, nunca sus valores, se detallan en el runbook. `NORTEX_ASSISTANT_STORAGE_DIR` debe apuntar a almacenamiento privado persistente fuera del contenido público. La IA usa el adaptador configurado del repositorio, sin cambiar automáticamente a modelos más caros.

El presupuesto de IA compartido es **US$20 mensuales globales** y como máximo **US$10 por negocio piloto**, limitado también por `monthlyBudgetUsd`. La reserva ocurre antes de cada llamada; reintentos y consumo incierto conservan su reserva. El costo conocido se liquida con Decimal. Si el costo supera la reserva, se contabiliza y se bloquean nuevas llamadas. `UNKNOWN` no significa gratis ni permite liberar fondos por suposición.

La reserva conservadora actual cubre hasta 200.000 tokens de entrada y 16.384 de salida: US$0.281920 por llamada, hasta US$1.127680 por consulta de cuatro iteraciones. Las 60 consultas reservadas para evaluación podrían superar el presupuesto mensual; deben programarse por lotes según consumo disponible, sin elevar el límite para completar la muestra. Estos importes describen la política del código y no acreditan una factura real del proveedor. Los cargos de WhatsApp necesitan evaluación separada.

Fuentes: [interruptores](../backend/services/assistant/config.ts), [capacidades](../backend/services/assistant/access.ts), [presupuesto](../backend/services/assistant/budget.ts), [schema](../backend/prisma/schema.prisma), [configuración privada](../backend/services/assistant/privateWhatsapp/config.ts).

### Endpoints para soporte y recuperación

Todas las rutas privadas usan la sesión y el negocio autenticados y responden con `Cache-Control: private, no-store`.

| Ruta | Contrato operativo |
|---|---|
| `GET /api/assistant/capabilities` | Capacidades efectivas del usuario; la UI no concede permisos. |
| `POST /api/assistant/conversations/:id/runs` | `{requestId,text}`; conserva identidad para reintentos. |
| `GET /api/assistant/conversations/:id/runs`, `GET /api/assistant/runs/:id` | Recuperación privada de pasos, fuentes y propuestas. |
| `POST /api/assistant/runs/:id/cancel`, `/recover` | Cancelar con `{version}`; recuperar con `{}` sin reiniciar herramientas. |
| `GET /api/assistant/daily-brief`, `POST /daily-brief/:id/dismiss` | Resumen del usuario; descarte con `{itemId}`. |
| `POST /api/assistant/action-proposals` | `{kind,draft,requestKey}`; crea propuesta independiente. |
| `PATCH /api/assistant/action-proposals/:id` | `{version,draft}`; invalida revisión. |
| `POST /api/assistant/action-proposals/:id/preview`, `/confirm` | Revisar con `{version}`; confirmar con `{version,requestKey}`. |
| `GET /api/assistant/action-proposals/:id` | Recupera propuesta y comprobante sin reconstruir efectos. |
| `POST /api/promotions/checkout/quote` | `{shiftId,sale}`; revisión autorizada del carrito. |
| `GET /api/promotions/checkout/operations/:offlineId`, `POST .../cancel` | Recuperación o cancelación explícita del mismo intento. |
| `GET /api/assistant/status` | Diagnóstico administrativo del negocio, sin filtros de cliente. |

`/status` está reservado a OWNER, ADMIN y SUPER_ADMIN. Informa capacidades, interruptores, ejecuciones de las últimas 24 horas, latencia con muestras conocidas, consumo del mes de Managua, colas retenidas y comandos. Su presupuesto es **sólo del negocio**, sin exponer consumo de otros. Devuelve `disabled`, `ok`, `partial` o `unavailable`; sin presupuesto materializado o conciliado no informa saldo cero. El contador de replays permanece no disponible porque no existe evidencia persistente suficiente. La latencia excluye la espera en cola. Este endpoint no sustituye la salud general de MySQL o del backend.

Fuente: [router de estado](../backend/routes/assistantStatus.ts) y [agregaciones operativas](../backend/services/assistant/operations/healthStatus.ts).

### Procedimiento ante fallos

1. Conservar identificador de run, propuesta, versión, requestKey u offlineId y hora del incidente. No guardar documentos completos, códigos de vínculo ni credenciales en logs o tickets.
2. Consultar capacidades y `/status` con una sesión administrativa vigente. Distinguir presupuesto bloqueado, fuente no disponible y cola pendiente; no interpretar ausencia de datos como éxito o saldo cero.
3. Ante una confirmación incierta, recuperar la propuesta/comprobante con la misma identidad. Ante venta promocional incierta, usar su recuperación del POS; no crear otra venta ni convertir un 404 en cancelación.
4. Para detener efectos nuevos, apagar ejecución global o del negocio. Consultas, acciones preparatorias, promociones y canal privado tienen controles separados. Si se requiere detener promociones vigentes, usar su interruptor específico: apagar sólo la ejecución del asistente no cancela una promoción ya publicada. Detener envíos privados requiere su interruptor de envío; una llamada externa ya invocada puede seguir incierta.
5. Revisar leases y estados persistidos. El worker principal procesa documentos y runs pendientes; un run abandonado se marca interrumpido. El worker privado recupera SENDING como UNKNOWN y nunca lo vuelve a enviar por suposición.
6. Tras una corrección, volver a comprobar los efectos en el dominio y la misma referencia. Rehabilitar requiere el procedimiento autorizado del entorno y evidencia del candidato; este runbook no concede permiso de despliegue.

Workers del repositorio: `mise exec -- npm run assistant:worker` y `mise exec -- npm run assistant:whatsapp-worker`, únicamente en un entorno ya configurado y autorizado. La limpieza del worker principal es periódica y acotada a cien candidatos por categoría: no borra leases vivos, propuestas registradas ni comprobantes. Runs siguen la vigencia de su conversación; conversaciones duran 30 días, propuestas operativas sin confirmar 7 días y resumen diario 2 días. Adjuntos no confirmados duran 7 días; los originales vinculados a compras registradas conservan su evidencia. El transporte privado retiene cuerpos 30 días y conserva vínculos revocados para impedir reasignaciones supuestas.

Respaldo/restauración debe coordinar MySQL y el volumen privado de adjuntos. Restaurar con extracción, ejecución, promociones y envíos apagados; verificar identidades, referencias y archivos antes de habilitar workers. Una restauración de archivo sintético o una prueba local anterior no acredita recuperación completa de este candidato.

Fuentes: [worker principal](../backend/workers/assistant.ts), [retención operativa](../backend/services/assistant/operations/retention.ts), [almacenamiento y limpieza](../backend/services/assistant/attachments.ts), [retención privada](../backend/services/assistant/privateWhatsapp/retention.ts).

## Evaluación pendiente y evidencia definitiva

El [plan de evaluación operativo](NORTEXGPT_EVALUACION_OPERATIVA_2026-09-05.md) mantiene tres conjuntos separados: **120 escenarios deterministas cuyos esperados requieren revisión humana**, **60 consultas reservadas para el modelo real** y **60 tareas de piloto**. Los conjuntos no sustituyen las 100 facturas sintéticas existentes. Deben evaluarse ferretería y farmacia, todos los roles y las tres áreas: reposición, vencimientos y ventas/promociones.

La meta de tiempo del piloto es una hipótesis a medir contra registro manual equivalente, incluyendo errores y correcciones. No hay un resultado de mejora observado en este documento. La [evidencia del panel](evidence/nortexgpt/operational-panel.md) describe sus escenarios sintéticos y límites de dispositivo; el [runbook de WhatsApp](runbooks/assistant-private-whatsapp.md) separa proveedor inyectado de entrega real.

| Compuerta | Resultado ejecutado | Límite de la evidencia |
|---|---|---|
| Identidad y preservación | Hashes de archivos originales y finales en el manifiesto; rama conservada | Sin commit, push, merge o despliegue; checkout tenía cambios previos |
| Prisma 6.4.1 | Generate y validate aprobados; migración aditiva aplicada | MySQL8 descartable, ninguna base real modificada |
| TypeScript | Sin errores | Comprobación estática |
| Vitest general | 4,752 aprobadas, 0 fallidas, 284 omitidas | Las omisiones no cuentan como aprobadas |
| `test:integration:required` | 298/298, 35 suites, 0 omitidas | MySQL8 real con negocios sintéticos; incluye compras previas, cajas, acciones, promociones y transporte privado |
| Sistema de diseño y build | Diseño:97 archivos sin infracciones; build aprobado | Advertencia existente de tamaño de chunks; no demuestra rendimiento en dispositivos físicos |
| Mutación | 99.8841% ≥99.85; 5,167 detectados por tests, 4 por timeout, 6 sobrevivientes históricos, 20 ignorados históricos | Los 53 archivos protegidos coinciden byte a byte con las fuentes del informe; no se elevaron umbrales ni excepciones |
| Migración/restauración | 15 tablas nuevas, ventas/compras históricas conservadas, restoreMySQL y adjunto privado verificados | Ensayo sintético; el intento interrumpido por memoria insuficiente no contó como aprobado |
| Experiencia | Recorrido escritorio/móvil320px, carrito y revisiones; regresiones de render para nuevas advertencias | Emulación y QA sintética; sin lector/dispositivo físico ni nueva captura visual de los últimos campos |
| Corpus | 120/120 contratos operativos; 60 consultas reales reservadas y 60 tareas de piloto preparadas; 100 facturas conservadas | Esperados pendientes de revisión humana; cero llamadas pagadas |
| Modelo real, calidad de estimación y piloto | No ejecutados | No se acreditan precisión de IA, pronóstico ni ahorro de20% |
| CI, staging y producción | No ejecutados | Deben corresponder al mismo candidato; producción requiere autorización separada |

Reparaciones reproducidas antes del cierre: auditoría de edición masiva fuera de la transacción; conflicto venta/cierre de caja; cancelación que no encontraba la identidad persistida de una venta; revocación durante reserva; pérdida de referencia al cancelar; historial insuficiente, destino de devoluciones y advertencias ocultas por fila. Las pruebas finales comprueban sus regresiones, además de los contratos habituales. Ver [revisión independiente](evidence/nortexgpt/operational-independent-review.md), [métricas y pendientes del pronóstico](evidence/nortexgpt/operational-metrics-review.md) y [panel](evidence/nortexgpt/operational-panel.md).

### Extracciones y tamaño

Medido contra la copia del checkout que ya contenía las compras conversacionales, preservando sus cambios. Los monolitos sólo componen; el aumento de módulos refleja nueva funcionalidad y no se presenta como reducción total de código.

| Alcance | Origen antes → después | Destinos | Total afectado |
|---|---|---|---|
| Creación de OC | `purchaseOrders.ts` 762 → 670 (−92) | `purchaseOrderDraft*.ts` 213 nuevas | 762 → 883 (+121) |
| Ruta de merma y recuperación compartida | Handler 250 → 16 (−234); helper compartido 89 → import de 1 (−88) | `batchWriteoff*.ts` 417 nuevas | 339 → 434 (+95); import adicional de servicio en composición aparte |
| Edición masiva | Handler 80 → 13 (−67) | `productBulkEdit*.ts` 65 nuevas | 80 → 78 (−2); import en composición aparte |
| Cobro del POS | `POS.tsx` 6,949 → 6,892 (−57), estados 114 → 114 | Seis helpers/componente y hook: 184 nuevas | 6,949 → 7,076 (+127) |
| Servidor completo | `server.ts` 14,638 → 14,266 (−372) | Incluye extracción y composición de rutas nuevas | Presupuesto máximo fijado en 14,266; POS bajado a 6,892 |

Caracterización y regresión: `purchaseOrderDraft*.test.ts`, `batchWarehouseManualMovements.test.ts`, `batchWriteoff*.test.ts`, `productBulkEdit*.test.ts`, `posVentaCritica.test.tsx` y `promotionCheckout.test.tsx`. La edición masiva tuvo cinco pruebas HTTP previas, reprodujo la auditoría fuera de la transacción y pasó diez pruebas HTTP posteriores de aislamiento, rollback y concurrencia. Las regresiones de Compras preexistentes volvieron a ejecutarse con el candidato actual. El manifiesto final registra tamaño y hash de cada archivo, incluidos los módulos nuevos; no se subieron presupuestos ni excepciones.
