# NortexGPT · resultados esperados sintéticos para revisión

Generado el 2026-09-23 a las 16:08 UTC con MySQL 8 descartable y la fixture
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

Los seis productos se crearon el día de la fixture; por tanto tienen cero días
de historial disponible dentro del período aunque haya ventas históricas
sintéticas. Una respuesta no debe convertir esas salidas en una fecha cierta de
agotamiento. Debe distinguir stock físico de vendible y no recomendar vender
lotes vencidos. No hay órdenes de compra pendientes ni compras nuevas ejecutadas
por la pregunta.

Antes de una llamada pagada, una persona debe contrastar los formularios con
las filas de la fixture, completar revisor, fecha y juicio en cada JSON, y sólo
entonces marcar `expectedOutcomesReviewed: true`. Si se repite la evaluación
otro día civil de Managua, regenerar formularios y repetir la revisión: la
ventana y los vencimientos cambian con el día.
