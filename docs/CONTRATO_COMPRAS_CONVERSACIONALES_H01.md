# H01: contrato de compras conversacionales

Fecha: **2026-09-19**. Conductas de ejemplos A, B y C validadas con precisiones por
el usuario de la conversación. No equivale a demostrar implementación, revisar
artículos completos, autorizar publicación o aprobar evaluación pagada.
Conservar el [registro original](/Users/stark/Developer/Nortex/handoffs/nortexgpt-human-review-20260919/batch01/CONTRATO_Y_BRECHAS_H01.md).
No atribuir una identidad editorial autenticada o una firma que no se registró.

## Criterios humanos aceptados

| Caso | Conducta requerida |
|---|---|
| A · «Compré 50 bolsas de cemento» | Conservar 50; ofrecer factura o captura por conversación; preguntar sólo faltantes. Identificar producto exacto, unidad, proveedor, costo y moneda. Separar compra/recepción/pago; desconocidos pendientes |
| A · Factura discrepante | Mostrar declaración y documento, sin sustituir silenciosamente cantidades. Separar comprado, facturado y recibido. Resolver por campo/renglón antes de confirmar efectos |
| B · Entrega mañana | Adjuntar factura sin ingresar stock ni acreditar pago. Verificar entrega efectiva; si falta saber el pago, preguntar. Una parcial recibe sólo lo aceptado y conserva pendiente |
| B · Anticipo o pago parcial | Preparar registro separado con revisión y confirmación, sin stock ni marcar todo pagado. Distinguir abono a factura de anticipo previo a factura y pago informado de pago nuevo |
| C · Identificación | Mostrar datos existentes que distingan producto: nombre, SKU, marca, presentación/medida, unidad. Proveedor: nombre, RUC y datos adicionales disponibles/autorizados; contacto enmascarado cuando corresponda |
| C · Elección | Producto y proveedor se eligen independientemente por ID exacto. Si dos registros siguen indistinguibles, pedir revisar fichas; no elegir primero/más usado ni crear duplicado |
| Transversal | Corregir conserva evidencia, actualiza borrador, invalida revisión anterior y muestra los efectos nuevos antes de confirmar |

No inventar marca, RUC, dirección, peso o dimensiones. `packSize` y `quantityStep`
no equivalen al peso de una bolsa. Campos deseados que no existen se declaran
faltantes; no se derivan automáticamente del nombre.

## Brechas y avance por lote

La revisión inicial fue estática sobre `nortexgpt-editorial-20260919`. H01-1 se
reprodujo, reparó y verificó después en una copia del checkout con marca existente:
[implementación, QA y parche](NORTEXGPT_IDENTIDAD_CATALOGO_2026-09-19.md).
Ese lote no da por completas las conductas A/B/C.

- **H01-1 reparado localmente:** no se elige el primer homónimo; catálogo y
  conversación comparten proyección autorizada. Selección exacta, texto original,
  advertencias, identidad al reabrir y cambios de ficha tienen regresiones ejecutadas.
  El detalle completo se muestra también debajo del selector en móvil.
- `purchaseDocumentContext.ts`: conserva advertencia de discrepancia, pero devuelve
  el valor documental antes de resolverla. Bloqueo visible no cumple conservar la
  cantidad humana propuesta hasta decisión explícita.
- `purchaseIntakeTypes.ts`: una cantidad y booleanos de recepción/pago no representan
  comprado/facturado/recibido ni montos parciales independientes.
- La recepción parcial existe en dominio de OC, no en el recorrido del asistente.
  Abono a factura existente no acredita un dominio de anticipos previos.
- H01-1 conserva `Product.brand` del checkout principal. El candidato editorial
  congelado no la tiene; su consolidación sigue requiriendo preservar ese cambio.

Las selecciones independientes por ID y la invalidación de propuestas ya aparecen
en código; su presencia no prueba todos estos escenarios. Las pruebas editoriales
de RAG no acreditan integridad de compras.

## Entrega y evaluación

Conservar H01-1 identidad, H01-2 hechos/conflictos, H01-3 recepción parcial, H01-4
abonos/anticipos y H01-5 ayuda/revisión, según el [roadmap](ROADMAP_AGENTES_NORTEX.md).

Pruebas esperadas: 50 declarado/40 facturado/30 recibido con unidades compatibles;
desconocido frente a cero explícito; proveedor homónimo; producto opción 2 y
proveedor opción 1; cambio de búsqueda que preserve identidad; revisión invalidada;
parcial/reintento sin stock duplicado; abono sin stock ni pago total supuesto.
Los casos de identidad y revisión de H01-1 sí tienen resultados en su informe;
los escenarios de conflictos, cantidades por fuente, parciales y abonos continúan
pendientes. No mezclar su estado ni acreditar integridad financiera por la QA de catálogo.

Revisar los artículos completos y sus nuevas versiones cuando el comportamiento
esté disponible. No copiar la aprobación de A/B/C a otro hash ni cambiar formularios
de evaluación real en nombre de esta validación. El artículo debe enseñar cómo
actúa el sistema disponible y declarar qué aún requiere el módulo del dominio.
