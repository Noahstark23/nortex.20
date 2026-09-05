# Stock, cámara y RAG: siguiente entrega de Nortex

Fecha: 2026-09-04. Estado: plan de implementación posterior al candidato POS. No atribuye implementación ni validación física a esta propuesta.

## Resultado que buscamos

Que una persona que atiende una ferretería o farmacia pueda identificar un producto, conocer lo que puede vender, recibir mercadería y comprobar el movimiento sin conocer la estructura del ERP. La referencia de supermercado es velocidad, legibilidad y una acción clara por paso. El estilo aprobado del POS es la base visual.

El fundador reporta 45 registros y tres usuarios habituales, de ferreterías y farmacias. Son indicios de interés; no prueban retención, rentabilidad ni liderazgo nacional. Medir primera venta confirmada, segunda jornada con ventas, correcciones, incidencias y continuidad semanal por cohortes. No contar registros o recomendaciones de ChatGPT como clientes retenidos.

## Orden y criterios de salida

| Bloque | Entrega concreta | Evidencia requerida |
| --- | --- | --- |
| S1 — Identificar sin errores | Mis productos: búsqueda y código exactos, bodega visible, estado encontrado/desconocido/error distinto; una ficha clara | 503 no abre alta; código ajeno o ambiguo no se selecciona; cero vendible no usa físico como fallback; no perder filtros ni trabajo |
| S2 — Contar cantidades correctas | Corregir lector de Conteo: producto medido enfoca cantidad; piezas suman solo con intención explícita; ningún lector actúa detrás de un diálogo | 1.5 no se trunca; dos capturas concurrentes no pierden intención; cierre/cancelación bloquean escáner; cantidades y pasos válidos en MySQL |
| S3 — Recibir y recuperar | OC → bodega → escanear/buscar → cantidad aceptada/rechazada → lote/vencimiento → confirmar → Kardex | UUID y borrador sobreviven a respuesta incierta; mismo reintento no duplica stock/costo; factura de OC no vuelve a recibir; rechazo/retención conserva trazabilidad |
| S4 — Cámara de códigos | Botón Escanear código, permiso al tocar, una lectura y ficha; escribir código y lector físico siempre disponibles | Cámara se apaga en éxito/cancelación/background; sin frames persistidos; ensayo físico en teléfono real, 30 intentos válidos por primera celda; pruebas de poca luz y etiquetas deterioradas |
| S5 — RAG operativo autenticado | Preguntar existencias y consultar instrucciones de recepción con fuente, bodega y hora | Herramienta reutiliza disponibilidad autoritativa; solo tenant/rol autorizado; documento obsoleto no manda sobre stock actual; cero efectos por preguntar |
| S6 — WhatsApp | Vinculación verificada, consultas permitidas, inbox/outbox durables y derivación humana | Aislamiento entre comercios; duplicación/reinicio/respuesta incierta probados sin mensajes reales; no exponer costos, deudas o identidad por coincidencia parcial |
| S7 — Fotografía de factura | Propuesta de líneas desde foto, revisión humana de productos/unidades/impuestos y confirmación por comando existente | OCR no mueve dinero ni stock; reconciliación de total y cantidades; original y correcciones trazables; prueba con documentos nicaragüenses autorizados |

Se asume cámara de códigos primero; fotografía de facturas se integra después de tener recepción e identidad de productos confiables. No se solicitó acceso a la cámara de un dispositivo en esta preparación.

## Una sola fuente para los números

El servidor obtiene tenant y rol de la sesión. Las operaciones existentes de venta, recepción, conteo, devolución, retención y cierre conservan su autoridad. Toda escritura de stock pasa por applyStockDelta, junto con Kardex y auditoría dentro de la transacción; dinero utiliza Decimal. No crear otro motor de inventario dentro del asistente o la cámara.

Main ya aporta ProductBatchHold, heldStock, pharmacyInventoryMode y resolvePharmacyProductAvailability. Reutilizar esos servicios: físico, retenido y vendible no son intercambiables. La pantalla distingue bodega seleccionada del agregado; fechas de vencimiento siguen día civil de Managua. Los modos OFF/SHADOW/ENFORCED mantienen sus contratos.

La primera cámara solo identifica: un frame no es una unidad recibida ni una venta. El callback entrega valor efímero y simbología, y se cierra antes de mostrar la ficha. Productos medidos y empaques requieren cantidad/unidad explícitas. Nunca elegir el primer resultado de búsqueda parcial.

## Todo conectado al RAG, con límites claros

Dos clases de fuentes: documentos aprobados con versión y vigencia; datos operativos consultados en el momento con autorización. Inventario, caja, compras, clientes, contabilidad y ayuda publican contratos de consulta y referencias, no copias indiscriminadas de sus tablas.

Cada respuesta operativa identifica alcance, fuente y hora; si no puede verificar datos, lo dice. La recuperación se invalida después del commit de una operación confirmada. Stock y saldos cambian con frecuencia: una respuesta almacenada no puede prometer disponibilidad actual. Reusar proyecciones seguras para cada rol y canal.

Las instrucciones recuperadas, PDFs, fotos y mensajes no pueden cambiar permisos ni invocar comandos financieros por sí solos. Consultar y ejecutar son capacidades separadas. Una acción propuesta muestra producto, bodega, cantidad e impacto y necesita la confirmación y el comando idempotente existentes. WhatsApp necesita su propia vinculación autorizada; no se le presta el userId del dueño.

## Roles de trabajo y límites de deuda

- Producto/UX: flujo completo, lenguaje del comerciante, una tarea principal, estados vacíos/error/carga y comparación antes/después del mismo escenario.
- Dominio/contabilidad: contratos Decimal, unidad, fecha, tenant, cierres y reversas; números oro y pruebas concurrentes con MySQL.
- Integración/cámara: adaptación del arnés existente, resolución exacta y ciclo de vida; evidencia software separada de prueba física.
- RAG/seguridad: fuentes autorizadas, trazabilidad, frescura, redacción y contrato durable del canal.
- Integrador: un responsable por archivo compartido, componentes/rutas/servicios pequeños; presupuesto del POS no aumenta. Ningún agente publica por completar su subtrabajo.

No se certifica cumplimiento fiscal ni calidad contable total por compilar. Los libros y casos de conciliación deben revisarse con evidencia del ciclo completo y validación profesional aplicable. El objetivo comercial se prueba en uso repetido por negocios reales, sin prometer ser el mejor antes de medirlo.

## Evidencia base de esta preparación

Las inspecciones de Stock, cámara y RAG del 4 de septiembre fueron de código. El arnés de cámara pasó simulación software (9 escenarios de ciclo de vida y 6 decisiones), sin prueba óptica ni dispositivo real. El candidato POS conserva los controles actuales de main2834497 y se valida por separado. Los cambios S1–S7 no forman parte de su release.
