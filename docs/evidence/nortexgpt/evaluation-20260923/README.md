# NortexGPT · resultados esperados sintéticos para revisión

Generado el 2026-09-23 a las 16:13 UTC con MySQL 8 descartable y la fixture
`operativo-demo-20260905`. Los formularios completos son
[`model-review-ferreteria.json`](model-review-ferreteria.json) y
[`model-review-farmacia.json`](model-review-farmacia.json). Ambos conservan
`expectedOutcomesReviewed: false`, `reviewer: null` y el juicio humano vacío.
No se llamó a Haiku ni se usaron datos de los dos negocios piloto.

Pregunta propuesta: «¿Qué productos debo reponer esta semana y por qué?»
Período de salidas: 24 de agosto al 22 de septiembre de 2026, 30 días civiles
completos de Managua. Las ventas del 23 de septiembre no entran. Cada negocio
sintético tiene límite inicial y aprobado de US$2; acciones, ejecución,
extracción, promociones y WhatsApp privado están apagados.

| Negocio sintético | Producto | Físico | Vendible | Vencido | Salidas BASE del período | OC pendiente |
|---|---|---:|---:|---:|---:|---:|
| Ferretería | Cemento Holcim 42.5, bolsa | 5 | 5 | 0 | 35 | 0 |
| Ferretería | Pintura látex blanca QA, litro | 12 | 0 | 12 | 0 | 0 |
| Ferretería | Tornillos galvanizados, unidad | 250 | 250 | 0 | 0 | 0 |
| Farmacia | Acetaminofén 500 mg QA, tableta | 5 | 5 | 0 | 35 | 0 |
| Farmacia | Alcohol antiséptico QA, frasco | 12 | 0 | 12 | 0 | 0 |
| Farmacia | Sales de rehidratación QA, sobre | 80 | 80 | 0 | 0 | 0 |

Los seis productos se fechan 35 días antes de la ejecución y tienen 30 días
de historial disponible en el período. Sólo dos ventas históricas de cemento
y acetaminofén caen dentro de esa ventana; la tercera se hizo el día vigente
y queda excluida. Una respuesta puede calcular una tasa observada, pero no
presentarla como fecha cierta de agotamiento. Debe distinguir stock físico de
vendible y no recomendar vender lotes vencidos. No hay órdenes de compra
pendientes ni compras nuevas ejecutadas por la pregunta.

Estos formularios ensayan el orquestador con `operations=true` y acciones,
ejecución y extracción apagadas. El CLI del primer piloto deja
`operationsEnabled=false`; por tanto, una buena respuesta en esta evaluación
no acredita que el mismo pedido de reposición funcione en los dos pilotos.
El recorrido inicial necesita su propia prueba de ayuda, conversación y
consultas deterministas con los flags efectivos. Habilitar operaciones después
requiere evaluación y aprobación separadas, con gasto medido.

[`first-cut-help-review.json`](first-cut-help-review.json) prepara precisamente
una pregunta de ayuda del primer corte con `operations=false` y
`language=true`. Exige la cita `reposicion` `web3` del manifiesto
`debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`.
El formulario de esta prueba tiene `expectedOutcomesReviewed: true` y atribuye
la revisión de los resultados esperados a Jose Noel Pineda Alfaro. Esto no
constituye revisión editorial autenticada ni aprobación del resultado del modelo. El evaluador enlaza el
consumo al mensaje y nunca reenvía un POST al recuperar, pero contacto y costo
no prueban por sí solos que el plan del modelo se aplicó.

En la conversación de Codex del 24 de septiembre, el usuario confirmó que
«stark» y «Jose Noel Pineda Alfaro» son la misma persona y pidió documentar
esa equivalencia. Esta constancia conserva el nombre usado al ejecutar el
ensayo; no es una verificación de identidad del producto.

El evaluador exige `expectedMode: "help_without_operations"` y compara capturas
antes/después, acotadas al negocio sintético, de propuestas, compras, órdenes,
Kardex, existencias y registros de dinero. Un cambio deja el ensayo incompleto.
El estado `executed_pending_human_review` sólo acredita esas comprobaciones
automáticas: la persona revisora debe juzgar si la respuesta orienta a
existencias y recepciones pendientes, distingue unidades vencidas o retenidas,
limita Compras Inteligentes a administración y no promete cobertura calculada
por NortexGPT.

El 24 de septiembre se ejecutó una consulta real de Haiku para la pregunta de
ayuda del primer corte contra un backend local y una base MySQL desechable,
con el manifiesto exacto `debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`.
El [reporte](first-cut-model-ferreteria-20260924.json) conserva la respuesta y
la cita `reposicion` `2026-09-23.web3`, una única reserva liquidada por
US$0,002015, cero ejecuciones operativas y cero cambios en los modelos de
negocio capturados. Su estado es `executed_pending_human_review`: falta el
juicio humano formal sobre la respuesta. La publicación del corpus fue sólo
una simulación dentro de QA, no la aprobación editorial del manifiesto real.
No autoriza fusionar ni desplegar.

Antes de una llamada pagada, una persona debe contrastar los formularios con
las filas de la fixture, completar revisor, fecha y juicio en cada JSON, y sólo
entonces marcar `expectedOutcomesReviewed: true`. Si se repite la evaluación
otro día civil de Managua, regenerar formularios y repetir la revisión: la
ventana y los vencimientos cambian con el día.
