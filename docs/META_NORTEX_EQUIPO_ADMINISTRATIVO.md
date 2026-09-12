# Meta de Nortex: un equipo administrativo accesible para cada negocio

Decisión de producto: 2026-09-09. Responsable: fundador de Nortex; integración técnica: equipo de desarrollo. **La visión está acordada con el fundador; la arquitectura y las entregas siguientes son propuestas de desarrollo.** Este documento dirige prioridades. El primer incremento W01 está implementado localmente en [su entrega verificable](NORTEXGPT_REVISION_SEMANAL_CAJA_2026-09-09.md); los especialistas completos, MCP y el coordinador duradero siguen pendientes.

## 1. Meta y propósito

**Dar a los pequeños negocios de Nicaragua acceso a trabajo de contabilidad, recursos humanos y finanzas coordinado desde Nortex, con un objetivo de precio de US$20 por negocio al mes.** La persona expresa lo que necesita; Nortex investiga con sus datos, prepara el trabajo, pide las decisiones necesarias y comprueba el resultado autorizado.

El propósito social es ayudar a conservar capital, evitar pérdidas administrativas, recuperar tiempo y tomar decisiones informadas. Contribuir a mejorar los ingresos familiares es una aspiración que exige medición; no se promete salir de la pobreza por usar software. El acceso económico debe sostenerse con calidad, soporte y costos conocidos.

El POS mantiene venta rápida y recuperación offline. NortexGPT ofrece una conversación con el equipo administrativo. «Conectá tu IA» permitirá acceder a capacidades autorizadas desde un cliente MCP compatible. Todos utilizarán los mismos servicios del negocio.

**La unidad de avance es un trabajo terminado y comprobado.** Una pantalla, un agente nombrado, un borrador o una respuesta convincente no sustituyen ese resultado. Un cierre explicado, una planilla revisada y una planificación de pagos son trabajos distintos de cerrar un período, pagar nómina o enviar dinero; la interfaz siempre distingue esas operaciones.

## 2. Para quién y cómo se usa

- Primer grupo: los cuatro negocios actuales indicados por el fundador; el piloto comparativo conserva una ferretería y una farmacia. Falta confirmar sus identificadores y revisores. No publicar contactos privados en estos documentos.
- Pensar primero en quien atiende, compra y administra con poco tiempo, desde teléfono o equipo económico. Un negocio sin empleados también recibe utilidad contable y financiera; RRHH se activa cuando corresponda, sin inventar personal.
- Entrada por texto; voz y documentos sólo donde el canal tenga soporte y evaluación. Voseo nicaragüense, cantidades/unidades claras, períodos Managua, preguntas breves y trabajo guardado.
- Mostrar una bandeja de encargos: qué se está haciendo, qué falta, quién debe decidir y qué quedó comprobado. Poder cerrar el panel, vender y retomar sin perder carrito ni encargo.
- La clasificación por especialistas es interna. La persona puede pedir «revisá mi semana» sin decidir a cuál agente corresponde.

## 3. Responsabilidades del equipo que usa el cliente

Estos papeles describen capacidades del producto; no son los agentes de ingeniería de [EQUIPO_DESARROLLO_NORTEX](EQUIPO_DESARROLLO_NORTEX.md), ni certifican una profesión regulada.

| Papel | Trabajo que debe completar | Fuente y resultado verificable | Límites |
|---|---|---|---|
| Contabilidad | Revisar ventas/cobros/gastos, reunir documentos, conciliar diferencias y preparar revisión del cierre. | Servicios contables, caja y documentos autorizados; expediente con período, movimientos relacionados, diferencias y pendientes. | No inventar facturas ni asientos; faltantes no son cero. Cierre de período, asientos o correcciones materiales requieren propuesta propia y aprobación. |
| Recursos humanos | Revisar incidencias, preparar planilla y documentos, seguir vacaciones y obligaciones del personal. | Expediente autorizado, relación/salario vigente, asistencia, motor laboral y versión de reglas; planilla con explicación por concepto e incidencias. | Salarios y datos sensibles no se comparten por tener rol gerente. Sin decisiones automáticas de contratación, despido, disciplina o crédito; pago requiere autorización humana y dominio íntegro. |
| Finanzas | Organizar compromisos de caja, evaluar cobros/compras, explicar márgenes y escenarios. | Caja, cuentas pendientes, costo histórico y compromisos conciliados; calendario y escenarios con supuestos explícitos. | Ventas no son ganancia; saldo contable no prueba disponibilidad bancaria. Proyección no es certeza. No prestar, transferir ni comprometer pagos automáticamente. |
| Coordinación | Mantener objetivo, pasos, dependencias, responsable y seguimiento; reunir sólo los resultados necesarios. | Encargo durable enlazado con evidencia, propuestas y comprobantes del dominio. | No suma privilegios de especialistas ni aprueba sus propias propuestas. No lanza tres modelos por cada pregunta. |

Las normas laborales y fiscales variables necesitan fuentes oficiales, jurisdicción, vigencia, revisión humana y pruebas del motor. Un texto recuperado no puede cambiar una fórmula. Los casos fuera de cobertura se remiten a una persona identificada con el expediente necesario, sin enviar información externamente por defecto.

## 4. Tres trabajos iniciales y uno coordinado

| ID | Solicitud y recorrido | Qué significa terminar | Qué no se presume |
|---|---|---|---|
| W01 — Mi semana con cuentas claras | «Revisá mi cierre y explicame las diferencias». Elegir período/turnos; consultar ventas, devoluciones, pagos, gastos y cierre; relacionar evidencia; pedir documentos faltantes; reconsultar tras corrección humana. | Informe de revisión aceptado con diferencias resueltas o excepciones explícitas asignadas. Para declarar **conciliado**, ninguna diferencia queda sin explicación verificable. | Revisar un cierre no lo ejecuta, no ajusta efectivo, no modifica saldos ni cierra un período fiscal. |
| W02 — Mi planilla revisada | «Prepará la planilla de este mes». Comprobar empleados y salarios vigentes, incidencias y reglas; calcular con el motor; presentar variaciones; corregir mediante herramientas autorizadas; revisar versión exacta. | Planilla preparada y revisada, con pendientes bloqueantes vacíos. Sólo una fase posterior puede registrar pago con su comprobante y todos los efectos conciliados. | Preparar no paga ni acredita cumplimiento de todas las obligaciones. La ruta legacy debe endurecerse antes de exponer pago. |
| W03 — Mis pagos y compras próximos | «Organizame lo que tengo que pagar y qué puedo comprar». Verificar caja y compromisos; separar cobros confirmados de esperados; modelar 7/30 días; mostrar alternativas y dejar decisiones pendientes. | Plan de caja con corte, supuestos y compromisos revisados; seguimiento posterior de pagos registrados. Cada pago ejecutado requiere su propia evidencia. | No se asume cuenta bancaria conciliada, cobranza futura ni datos que el negocio aún no registra. |
| W04 — Evaluar una contratación | «¿Puedo contratar a otra persona?». RRHH calcula escenario; contabilidad informa calidad de datos; finanzas compara caja en escenarios. Cada papel comparte sólo el agregado autorizado. | Comparación entendible, supuestos y límites, para decisión del dueño; no crea contrato ni decide empleo. | Depende de W01–W03 y revisión de reglas. Es posterior; no constituye el primer piloto. |

Compras conversacionales, reposición, vencimientos y promociones conservan sus contratos y backlog. Aportan documentos, compromisos e inventario a estos trabajos; la nueva meta no autoriza reescribirlos ni dar sus pilotos por terminados.

## 5. Distancia contra el código revisado

Corte: copia persistente `~/Developer/Nortex/candidates/release-20260908`, base `ead043c2aa27e25e6522e97b3cdc2c3a4e585783` más cambios locales identificados por los expedientes. Revisión de código de esta meta: **sólo lectura, sin nuevas pruebas de producto**. [Estado y evidencia por candidato](ESTADO_ACTUAL_NORTEX.md).

| Base encontrada | Reutilizar | Falta para esta meta |
|---|---|---|
| [Herramientas del asistente](../backend/services/assistant/operations/tools.ts) | Ayuda, cifras, comparación de ventas, inventario, catálogo y preparación de acciones con autorización. | Caja incorpora `review_weekly_cash` en el incremento W01 posterior. Contabilidad completa, RRHH y asignación de excepciones siguen pendientes. |
| [Ejecuciones](../backend/services/assistant/operations/runService.ts) y [orquestador](../backend/services/assistant/operations/orchestrator.ts) | Intentos, checkpoints, evidencia, cuatro llamadas/60 segundos y control de presupuesto. | Encargos de varios días, dependencias y seguimiento con agenda durable. Un run abandonado no equivale a reanudación automática. |
| [Propuestas de acciones](../backend/services/assistant/actions/service.ts) y [compras](../backend/services/assistant/proposals.ts) | Versiones, revisión, idempotencia y comprobantes; confirmar desde sesión autorizada. | Contrato propio para planilla, asientos, cierre y otras acciones nuevas; no usar un borrador genérico financiero. |
| [Contabilidad](../backend/services/accounting.ts), [reporte de cierre](../backend/services/salesReportService.ts) y [cierre de caja](../backend/services/shiftCloseService.ts) | `getShiftSnapshot` lee el reporte persistido; `closeShiftWithReport` realiza el cierre. | Lecturas de conciliación sin siembra, cobertura contable/financiera y revisión profesional para W01/W03. `getEstadoResultados`/`getBalanceGeneral` siembran cuentas al leer; no reutilizarlos sin separar ese efecto. |
| [Motor laboral](../backend/services/nicaLabor.ts), [rutas HR](../backend/routes/hr.ts) y nómina en [server](../backend/server.ts) | Cálculos, asistencia, expediente, planilla y capacidades ya existentes. | Servicios modulares y herramientas; reproducir y reparar pago/concurrencia/fallo de asiento antes de habilitarlo. No duplicar fórmulas. |
| [Ayuda](../backend/services/assistant/knowledge.ts) | Doce artículos y recuperación léxica con referencias. | Pasajes consultables, publicación/retirada y colección administrativa revisada; hoy no es una biblioteca laboral/fiscal. |
| MCP | Servicios compartidos aptos para un adaptador controlado. | Servidor remoto, OAuth delegado, consentimiento, scopes, revocación y contexto de ejecución externo. |
| Presupuesto local | US$2 por negocio/mes, ampliación aprobada hasta US$10, techo global US$20. | Medir economía del servicio y cerrar coordinación del gasto entre entornos/canales; [evidencia del lote](NORTEXGPT_PRESUPUESTO_Y_QA_2026-09-09.md). |

El patrón de pago de nómina observado permite capturar el fallo contable y continuar, y lee el estado pagado antes de la transacción. Es un **riesgo confirmado por lectura**, pendiente de reproducción de sus efectos; no afirmar incidentes en clientes ni corregirlo sólo cambiando documentación. Se mantiene D11 y [plan RRHH](PLAN_RRHH_NICARAGUA.md).

`POST /api/payroll/calculate` persiste planilla y adelantos: necesita separar cálculo de escritura antes de ofrecer una vista previa. Los reportes administrativos también requieren validar corte Managua y consultas acotadas. Una marca de obligación declarada o de nómina pagada dentro de Nortex no acredita declaración ni transferencia a un tercero.

## 6. Arquitectura y presupuesto

Contrato completo: [arquitectura del equipo administrativo](ARQUITECTURA_EQUIPO_ADMINISTRATIVO_2026-09-09.md). Conservar React/Vite, Express, Prisma 6.4.1, MySQL 8, Node 22.23.2 y npm. Las reglas de dominio permanecen en servicios; el coordinador mantiene trabajo pendiente, no una contabilidad paralela.

Separar cuatro objetos: conversación privada, encargo durable, intento acotado de IA y propuesta/comprobante del dominio. El vencimiento de una conversación no puede borrar la evidencia de una operación confirmada. La retención de encargos exige un contrato explícito antes de persistir datos nuevos; no extenderla indefinidamente por llamarla memoria.

Cada especialista recibe sólo datos autorizados para ese paso. Revocar un permiso impide recuperar también historiales, evidencia derivada y adjuntos sensibles. Confirmar recibe identificador/versionado/idempotencia y revalida condiciones desde el servidor. Un «sí» en el chat, una instrucción en factura o el consenso de agentes no autoriza mover dinero, stock o nómina.

| Importe | Significado | Decisión actual |
|---|---|---|
| US$20 por negocio/mes | Objetivo de precio del servicio administrativo. | Validar alcance y sostenibilidad; no cambia precios, suscripciones ni cobros actuales. |
| US$2 por negocio/mes | Presupuesto inicial de llamadas IA pagadas por Nortex, compartido por usuarios y especialistas. | Lote implementado/validado localmente; ampliación por solicitud y aprobación de Nortex hasta US$10. No equivale a tareas ilimitadas. |
| US$20 globales/mes | Límite total de IA acordado para la etapa actual. | No se incrementa con esta meta. El control de código es por MySQL; asignaciones entre entornos/canales siguen pendientes de D05. |
| Infraestructura, soporte y canales | Costos adicionales al modelo. | Medir por negocio activo/pagador y por trabajo completado, con supuestos de reparto visibles. No están absorbidos automáticamente por los US$2. |

Margen de contribución a medir: ingreso neto cobrado menos IA, canales, infraestructura atribuible, cobro y soporte directo. Informar aparte desarrollo/costos fijos; cuatro negocios no permiten inferir rentabilidad a escala. Sin consumo medido no prometer un número de tareas por mes. Presupuesto agotado conserva funciones habituales, datos y consultas deterministas permitidas.

MCP permite que la IA externa del cliente consuma herramientas deterministas sin requerir otra llamada a Haiku. Cada canal sigue necesitando límites de carga, consentimiento sobre datos compartidos y permisos vigentes. El gasto de la IA externa depende del proveedor/plan del cliente; cualquier OCR o síntesis pagada por Nortex conserva reserva y trazabilidad propias.

## 7. Entregas y condiciones de avance

Los IDs A00–A07 agrupan resultados nuevos. C00 y D00–D14 del [plan de estabilidad/RAG](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) siguen siendo el backlog técnico; no crear dos implementaciones para la misma tarea. Fechas de entrega se estiman después de caracterizar cada lote y tener sus revisores.

| ID / orden | Entrega y responsable | Dependencias | Condición observable |
|---|---|---|---|
| A00 / inmediato | Base verificable y ficha W01. Integración + Plataforma + QA. | C00/D00/D06/D08/D09; dueño humano W01. | Baseline de fuente/carga/recuperación, matrices de permisos y expected revisados; alcance de cada riesgo adjudicado. El diseño puede avanzar mientras se mide. |
| A01 / cuando el trabajo lo requiera | Encargos durables, pasos, evidencia, agenda y bandeja. Inteligencia + Plataforma; integrador de schema. | Contratos A00; reusar runs, propuestas y canal privado. | Crear/retomar/cancelar tras reinicio, dedupe por encargo/paso, versión y permisos revocados; ninguna recuperación ejecuta efectos sin autorización. |
| A02 / primera entrega útil | W01: revisión explicada de cierre semanal. Finanzas/Contabilidad + Inteligencia + QA. | A00, persistencia mínima ya existente y lecturas deterministas; D01–D04 pertinentes. A01 completo no bloquea la primera prueba de valor. | Comparación independiente por turno/período; error distinto de cero; informe y pendientes persistidos, sin modificar caja/asientos/cierre. |
| A03 / segundo dominio | W02: planilla preparada y revisada. RRHH + Finanzas + QA. | Riesgos D11 pertinentes al cálculo/datos/privacidad; reglas laborales revisadas y A01. Pago en lote separado. | Conciliación independiente por empleado/concepto, correcciones versionadas y datos mínimos. Registrar pago sólo en un lote separado tras demostrar atomicidad, concurrencia y rollback. |
| A04 / tercer dominio | W03: plan de caja y compromisos. Finanzas + QA. | Fuentes A02/A03 cuando se usen, CxP y bancos adjudicados en D11. | Escenarios reproducibles, cobros esperados separados, fuentes incompletas bloqueantes y seguimiento de lo efectivamente registrado. |
| A05 / acceso externo | MCP consultar/preparar con OAuth y propuesta abierta en Nortex. Inteligencia + Seguridad/Plataforma. | Identidad/contratos A01; cada herramienta sólo tras su propia aceptación. | ChatGPT/Claude probados por canal, scopes negativos/revocación/duplicados, auditoría y límite de carga. Conector no obtiene herramienta de confirmación. |
| A06 / coordinación | W04 y encargos recurrentes consentidos. Inteligencia + dueños de dominio. | W01–W03 aceptados, agenda durable, presupuesto/observabilidad. | Sólo especialistas necesarios; resumen sin salarios ajenos; pausa/cancelación; comprobar resultado posterior sin nuevas llamadas por recargar. |
| A07 / junto a cada entrega | Utilidad, costo y operación por vertical. Producto + QA + revisores humanos. | Gates de cada trabajo, modelo real, entorno/restore y aprobación de despliegue. | Métricas de sección 8 y costo medido; ningún incidente crítico sin resolver; ampliar por capacidad acreditada. |

**Primer incremento A00/A02 implementado localmente:** `review_weekly_cash` revisa snapshots de cierres, conserva diferencias/fuentes en los runs privados existentes y permite reconsultar por período. [Alcance y QA](NORTEXGPT_REVISION_SEMANAL_CAJA_2026-09-09.md). No acredita W01 completo: faltan investigación de causas con documentos, excepciones asignadas, aceptación humana y medición del trabajo real. A01 se construye sólo en la medida en que estos recorridos necesiten encargos de varios días. El piloto y los costos se miden desde cada entrega útil; W03 puede preceder a W02 para negocios sin empleados. No conectar pago de nómina para demostrar este primer valor.

## 8. Criterio para decir que funciona

**Continuación W01B local, 2026-09-12:** [investigar el soporte de un cierre](NORTEXGPT_INVESTIGACION_CIERRES_2026-09-12.md) conecta la referencia seleccionada con su desglose histórico, movimientos actuales y comprobaciones humanas pendientes. No completa asignaciones, aceptación, conciliación ni piloto. La evidencia detallada permite definir las excepciones del siguiente incremento sin inventar causas.

Objetivos iniciales del programa, **aún no resultados**, a congelar por recorrido antes de evaluar:

- Resultado principal: proporción de encargos elegibles cuyo resultado fue comprobado por el dominio y aceptado por la persona. Objetivo piloto ≥90%; publicar denominador y causas de no elegibilidad, sin ocultar bloqueos como éxitos.
- Diez tareas comparables por cada W01/W02/W03 y por vertical: 60 pares manual/asistente, 120 ejecuciones si ambos caminos se realizan. Alternar orden y usar casos equivalentes para reducir aprendizaje. No contar estos pares como las pruebas de software o los corpus anteriores.
- Reducir ≥20% la mediana del tiempo humano para completar cada trabajo, sin aumentar correcciones; informar también tiempo total, espera y casos que no terminaron.
- Cero duplicaciones, acceso indebido, efectos parciales, errores críticos de dinero/stock/nómina o ejecución sin aprobación en escenarios aceptados. Una media verde no compensa un caso crítico.
- Contabilidad/finanzas/RRHH: expected independiente y revisión humana de supuestos/reglas; cálculos Decimal, períodos Managua y situaciones con datos faltantes. Cero respuestas que presenten ventas como utilidad o proyecciones como certeza.
- Retomar tras reinicio, desconexión, expiración, revocación, proveedor caído y presupuesto agotado; recuperar operaciones inciertas por identidad antes de reintentar.
- Pruebas por candidato: Prisma generate/validate, TypeScript, Vitest, diseño y build. Cambios financieros: integración obligatoria MySQL 8 descartable sin omisiones y mutación pertinente. Conservar corpora anteriores de 120 escenarios operativos, 60 consultas reservadas y 50 facturas por vertical; ampliar cobertura administrativa con etiquetas humanas y conjuntos separados.
- Calidad de modelo, piloto y despliegue se acreditan aparte de mocks y QA determinista. Evaluar español cotidiano, ambigüedad, fuentes contradictorias/retiradas e instrucciones maliciosas en documentos.
- Medir costo por encargo terminado y por negocio, soporte, carga sobre POS, cola y recuperación. No anunciar US$20 con alcance ilimitado antes de conocerlos.

Mejoras sociales se observan con consentimiento y agregados: horas recuperadas, pérdidas evitadas respaldadas, cobros conciliados y estabilidad de caja. No atribuir causalidad sobre ingresos o pobreza a una muestra pequeña ni recopilar datos familiares innecesarios.

## 9. Responsables, decisiones abiertas y autoridad

Producto define prioridad y alcance; integración conserva contratos/candidato; responsables contable/laboral revisan reglas; QA contrasta expected; plataforma acredita recuperación/carga; seguridad revisa datos y conexión delegada. El equipo de ingeniería se organiza en [su documento](EQUIPO_DESARROLLO_NORTEX.md). Un perfil de agente no acredita disponibilidad de un profesional humano.

Pendientes que no impiden diseñar: identificar farmacia y revisores de ambos negocios; fijar alcance comercial incluido; validar reglas por sector/régimen; medir uso/costo; preparar QA privado y revisión humana de Haiku. Se resuelven antes de las capacidades que dependan de ellos. El fundador puede revisar producto; eso no acredita por sí solo revisión contable/laboral especializada.

Orden documental: esta meta decide resultados y prioridad; arquitectura define contratos propuestos; plan C00/D00–D14 y planes de dominio definen deuda/entregas; estado y evidencia describen lo demostrado; AGENTS/CLAUDE mantienen integridad y QA. Los informes antiguos conservan fecha y resultados. Esta meta no modifica infraestructura productiva, precios ni permisos, y no autoriza envíos, inversión, push o despliegue.

## 10. Evidencia de esta actualización documental

[Verificación y huellas del lote](evidence/administrative-goal-20260909/verification.json): dos documentos nuevos y trece Markdown existentes reconciliados, referencias locales comprobadas y revisión independiente. Los 35 archivos no Markdown presentes en la captura previa de preservación conservan su contenido. Se preservan HEAD, rama y estado Git del repositorio original. Esta comprobación no es una auditoría exhaustiva de todos los MD ni nuevas pruebas de producto.

El manifiesto de presupuesto del 09/09 conserva la huella de su momento; sus documentos modificados ahora se identifican en el lote nuevo, sin reescribir resultados históricos. QA de producto, IA real, piloto, inversión y despliegue siguen acreditándose por separado.
