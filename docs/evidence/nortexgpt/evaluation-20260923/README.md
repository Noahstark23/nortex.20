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
También permanece en `expectedOutcomesReviewed: false`; no es aprobación de
la fuente, del resultado ni de una llamada pagada. El evaluador enlaza el
consumo al mensaje y nunca reenvía un POST al recuperar, pero contacto y costo
no prueban por sí solos que el plan del modelo se aplicó.

Antes de una llamada pagada, una persona debe contrastar los formularios con
las filas de la fixture, completar revisor, fecha y juicio en cada JSON, y sólo
entonces marcar `expectedOutcomesReviewed: true`. Si se repite la evaluación
otro día civil de Managua, regenerar formularios y repetir la revisión: la
ventana y los vencimientos cambian con el día.
