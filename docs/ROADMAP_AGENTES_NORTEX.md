# Roadmap de los agentes de Nortex

Corte: **2026-09-19**. Dirección: [meta](META_NORTEX_EQUIPO_ADMINISTRATIVO.md).
Estado: [fuentes y evidencia](ESTADO_ACTUAL_NORTEX.md). Esta secuencia organiza
trabajo pendiente; no acredita implementación ni fechas de entrega.

## Orden de ejecución

| Orden / ID existente | Entrega concreta | Responsable de dominio | Condición para avanzar |
|---|---|---|---|
| 0 · A00 | Elegir y reconciliar el candidato; ficha W01 y matriz de autoridad | Integrador + QA + Plataforma | Origen/manifiesto claros; cambios previos preservados; expected y alcance identificados. No copiar un candidato sobre otro |
| 1 · A01 mínimo | Guardar un encargo W01, pasos, excepciones, aportes y versiones | Plataforma + Inteligencia, archivos separados | Reinicio, doble evento, cancelación y revocación conservan estado; no producen efectos ni llamadas nuevas por recuperar una página |
| 2 · A02/W01 | Semana → investigar → pedir evidencia → retomar → informe → aceptación | Finanzas/Contabilidad + Inteligencia + POS | Comparación independiente; fuentes visibles; salir/vender/volver conserva trabajo; aceptación exacta, excepciones asignadas y cero escritura de caja |
| 3 · A07/W01 | Validar el trabajo con personas y medir utilidad/costo | Producto + QA + revisor humano | Expected revisados, calidad real del modelo, tiempo/correcciones/costo medidos; gates de operación y promoción por separado |
| 4 · A03/W02 | Planilla preparada y revisada | Dominio laboral + Finanzas | Cálculo separado de persistencia, permisos de campos, reglas vigentes revisadas, conceptos conciliados. Pago es otra entrega |
| 5 · A04/W03 | Plan de caja y compromisos 7/30 días | Finanzas | Fuentes y corte acreditados, cobros esperados separados, escenarios reproducibles y seguimiento del registro real |
| 6 · A05 | Conectar IA externa mediante MCP y autorización delegada | Inteligencia + Plataforma | Sólo capacidades aceptadas; consentimiento, scopes, revocación, aislamiento y carga probados con cliente real; confirmar en Nortex |
| 7 · A06/W04 | Evaluación de contratación y recurrencia consentida | Coordinación + dominios | W01–W03 aceptados; agenda durable; sólo datos/perfiles necesarios; pausa y resultado comprobables |
| Continuo · A07 | Valor, operación y ampliación por capacidad | Producto + Plataforma + QA | Evidencia de cada recorrido y vertical; costo sostenible, restore y límites; sin atribuir al conjunto una prueba parcial |

W03 puede preceder a W02 en negocios sin empleados. MCP se diseña sin bloquear
W01, pero su exposición externa viene después de acreditar los trabajos ofrecidos.
No desarrollar primero un motor universal, todos los especialistas o todos los
canales. A01 se limita a lo necesario para terminar W01.

## Próximo lote ejecutable

**H01-1 implementado y probado localmente; sigue A00 + A01/W01 mínimo.**

El [informe H01-1](NORTEXGPT_IDENTIDAD_CATALOGO_2026-09-19.md) registra su parche,
reproducciones, 324 pruebas deterministas y 26 comprobaciones de catálogo en MySQL.
No sustituye la consolidación de otros candidatos ni la QA financiera.

1. Reconciliar sólo las dependencias del lote elegido sin perder otros cambios.
   Presupuesto, W01/W01B, RAG/editorial y marca/cámara tienen procedencias distintas:
   registrar base/hashes y qué se usa o se difiere. No convertir su integración
   completa en requisito de W01; los frentes independientes conservan sus lotes.
   La documentación no realiza esa integración de producto.
2. Conservar la regresión H01-1 al consolidar: identidad por ID, datos visibles
   autorizados, texto original, cambios de ficha, lecturas acotadas y cola cancelable.
3. Definir la ficha W01: período, participantes autorizados, fuentes, excepciones,
   resultado, retención, criterios de aceptación y límites de llamadas.
4. Implementar A01/W01 con repositorio y servicio fuera del monolito; después UI
   de trabajo pendiente y aceptación. Integrar por contrato, con un editor por archivo.

No volver a pedir aprobación de las conductas A/B/C: ya fueron validadas con
precisiones. Sí falta demostrar su ejecución y revisar versiones completas de
artículos antes de publicarlas. La QA financiera previamente rechazada mantiene
su bloqueo; este plan no la reintenta ni permite cambiar de herramienta para eludirlo.

## Corte mínimo del encargo W01

| Incremento | Incluye | Evidencia requerida |
|---|---|---|
| A01.W01.1 · persistencia | Objetivo, período, responsable, estados, versión, aporte humano y referencia al run existente | Dos negocios; permisos revocados; eventos repetidos; recuperar tras reinicio sin perder aportes ni volver a preparar |
| A01.W01.2 · continuidad | Espera sin llamadas, reanudación explícita/evento permitido, cancelación y operación incierta | No gasto por esperar/recargar; autoridad revalidada; checkpoint; resultado incierto recuperado por identidad |
| A02.W01.3 · informe | Enlazar revisión semanal/investigación, evidencias históricas/actuales, excepciones y versión de informe | Cifras independientes; fallo distinto de cero; evidencia obsoleta invalida aceptación; causa no sustentada se declara hipótesis |
| A02.W01.4 · experiencia | Bandeja mínima, aportar dato, volver al encargo, revisar/aceptar | Móvil/escritorio, lector/atajos bloqueados detrás del panel, carrito y trabajo conservados incluso al navegar/reiniciar |
| A07.W01.5 · valor | Revisión humana, modelo real acotado y comparación manual | Denominador de tareas, fallos/correcciones, tiempos humano/total y costo; ningún caso crítico abierto |

Son subdivisiones de A01/A02/A07, no nuevos programas. El primer contrato no
incluye contabilizar, cerrar período, corregir efectivo ni pagar. Si W01 necesita
una corrección, deja referencia al flujo del dominio y espera su comprobante.

## Compras y RAG en paralelo

Los [criterios H01](CONTRATO_COMPRAS_CONVERSACIONALES_H01.md) conservan su orden:

| Lote | Resultado | Dependencia y límite |
|---|---|---|
| H01-1 | Implementado localmente: producto/proveedor exactos, etiquetas coherentes, texto conservado y revisión invalidada | 324 pruebas deterministas y 26 MySQL de catálogo; ver informe. No acredita registro financiero o despliegue |
| H01-2 | Cantidades por fuente y resolución explícita de conflictos | Mantener 50 declarado frente a 40 facturado hasta aclaración; edición invalida revisión |
| H01-3 | Propuesta de recepción parcial | Reutilizar dominio de OC, lotes/bodega; no reinterpretar compra directa ni duplicar stock |
| H01-4 | Abono a factura; contrato separado para anticipo previo | Distinguir pago informado/registrado de pago nuevo; conciliación financiera obligatoria |
| H01-5 / D02 | Ayuda ajustada a capacidades disponibles y revisión completa | A/B/C no aprueban artículo ni hash; publicación editorial autenticada separada |
| D01/D03 | Consolidar citas/biblioteca/editor ya probados en candidato aislado | Preservar manifiestos; comprobar integración. La UI editorial aún puede perder borradores al abandonar SuperAdmin |
| D04/D05 | Benchmark léxico, respuestas sustentadas y costo por ejecución | Corpus revisado/congelado y expected humanos; evaluar modelo real aparte; embeddings sólo con mejora medida |

La compra puede ser evidencia de un encargo; no se obliga a W01 a registrar una
compra para terminar una revisión. H01-3/4 no bloquean el W01 de lectura cuando
los límites de cada flujo estén comprobados.

## Infraestructura y deuda que acompañan cada fase

El [plan de estabilidad/RAG](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md)
conserva el detalle de C00/D00–D14. Sus mediciones históricas no describen por sí
solas la máquina actual.

| Dependencia | Cuándo resulta obligatoria |
|---|---|
| C00/D00 · baseline y protección POS | Al elegir candidato y antes de medir aceptación; no afirmar capacidad por tener cuatro clientes |
| D06/D09 · Prisma, pools, consultas y observabilidad | Al añadir consultas/workers: cliente compartido por proceso, índices, paginación y medición conjunta |
| D08 · SQL + originales + trabajo durable | Antes de habilitar persistencia/adjuntos en el entorno objetivo: restore aislado, referencias y permisos, pérdida/tiempo medidos |
| D10 · modularidad | Cada extracción: prueba conductual antes/después, delta origen/destinos/total, reducción del presupuesto de origen |
| D11 · integridad heredada | Antes de exponer/ampliar el recorrido afectado; reproducir y reparar por dominio, no duplicar servicios |
| D07/D12 · canales y operaciones | Antes de activar el canal o acción: identidad, inbox/outbox, duplicados, respuesta incierta y comprobantes |
| D13 · piloto/promoción | Calidad, utilidad y operación acreditadas; CI y staging del mismo candidato; producción con autorización propia |
| D14 · vectores/escalado | Sólo por necesidad y mejora medidas; no condición inicial para tener agentes útiles |

No ampliar el monolito ni comprar infraestructura para reemplazar un diagnóstico.
Medir latencia del POS, conexiones, memoria, cola y recuperación con el asistente
activo/apagado. Un límite o alerta propuesto requiere configuración y ensayo antes
de considerarlo protección existente.

## Regla de cierre de una fase

Usar la [ficha de trabajo](templates/CONTRATO_TRABAJO_AGENTE.md). Registrar por
separado implementación, QA determinista, integración real, revisión humana,
calidad del modelo, piloto, CI, staging y producción. Un bloqueo afecta al flujo
que depende de él; no se disfraza de aprobación ni impide trabajo independiente.

La compuerta de código mantiene Prisma generate/validate, TypeScript, Vitest,
diseño y build; dinero/inventario/presupuesto necesitan MySQL 8 descartable sin
omisiones y mutación pertinente. El plan inicial fue documental; la ejecución
H01-1 posterior está registrada en su informe y no cambia flags ni inicia llamadas
pagadas. Las fechas se estiman por lote después
de su caracterización y de contar con los revisores requeridos.
