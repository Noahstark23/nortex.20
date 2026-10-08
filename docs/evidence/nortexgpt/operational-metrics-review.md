# Etapa A: revisión de cifras y estimación de reposición

Revisión: 2026-09-07, hora local del entorno. Candidato: `/tmp/nortexgpt-operativo-20260905`. Alcance inicial: lectura del código e informes. Los hallazgos de historial y disposición de devoluciones autorizaron después una reparación puntual de analítica de inventario y sus pruebas contra MySQL descartable. No se consultaron negocios reales ni se ejecutaron modelos o despliegues.

## Resultado

La etapa A tiene evidencia determinista y MySQL de aritmética, períodos, permisos y degradación ante datos inválidos. Los servicios compartidos consultan información de negocio sin modificarla. La estimación de reposición es una regla basada en ventas netas registradas y existencias actuales; **no existe evidencia revisada de precisión retrospectiva sin información futura**. El piloto y la calidad del modelo siguen pendientes.

La reparación distingue la antigüedad suficiente del producto de la calidad/completitud de su historial, separa devolución comercial de reintegro al stock y bloquea cortes históricos para existencias actuales. Una ventana de 30 días civiles y un producto antiguo todavía no prueban 30 días de registros completos ni demanda no atendida.

## Evidencia disponible y sus límites

| Evidencia revisada | Resultado registrado | Qué acredita |
|---|---|---|
| [Unitarias de analítica](../../../tests/assistantAnalytics.test.ts) y [de inventario](../../../tests/assistantInventory.test.ts) | 39 + 62 aprobadas; sin omitidas en estas suites | Reglas, fechas, cálculos, contratos y negativos con dependencias controladas |
| [Analítica MySQL](operational-verification.json) | 9/9, 0 fallidas, 0 pendientes | Agregaciones sobre filas sintéticas persistidas, aislamiento y resultados esperados independientes |
| [Inventario MySQL, reparación final](operational-inventory-after.json) | 15/15, 0 fallidas, 0 pendientes | Cantidades BASE, disposición de devoluciones, cobertura por antigüedad, OC parciales, fechas, lotes/bodegas y ausencia de siembra al consultar |
| [Corpus operativo](operational-corpus.json) | 120/120; 0 llamadas pagadas | Funciones reales con filas de repositorio sintéticas; no acredita SQL ni transacciones |
| [Evaluación del modelo](operational-model.json) | `not_run`, 0 llamadas pagadas; revisión humana `pending` | Consultas reservadas; ninguna precisión del modelo demostrada |

Las 39 unitarias de analítica y sus 9 casos MySQL constan en los informes existentes de la compuerta. La reproducción nueva dejó **5 fallos, 55 casos aprobados y 0 omitidos** en [el informe rojo](operational-inventory-before.json), incluido el producto creado hace siete días en MySQL. Después de reparar y ampliar límites, [el informe focal final](operational-inventory-after.json) registra **62 unitarias + 15 MySQL = 77/77, sin omitidos**. Las pruebas de analítica/inventario invocan los servicios contra MySQL; no se presentan como pruebas HTTP ni de contabilización de ventas. La compuerta global posterior corresponde al integrador y tiene evidencia separada.

El corpus inicial se generó el 2026-09-05 y se volvió a ejecutar tras la reparación del 2026-09-07; declara revisión humana pendiente, modelo no ejecutado y piloto no ejecutado. Las 120 expectativas no son 120 observaciones futuras de demanda. El [evaluador](../../../scripts/assistant-evaluation/operations-evaluate.mjs) compara contratos y cifras de casos sintéticos; no separa entrenamiento y futuro ni calcula error predictivo.

## Cifras comparables y datos históricos

- [analyticsPeriod.ts](../../../backend/services/assistant/operations/analyticsPeriod.ts) resuelve días de Managua con inicio a las 06:00 UTC. Salud usa hoy por defecto; inventario, los 30 días completos anteriores. Rechaza fechas inválidas, futuras, períodos invertidos y ventanas de inventario incompletas. Una consulta de un día compara con el mismo día de la semana anterior y el mismo tiempo transcurrido; varios días comparan con igual cantidad de días civiles y corte equivalente.
- [analytics.ts](../../../backend/services/assistant/operations/analytics.ts) usa `Sale.total`, `vatAmountAtSale`, precios/descuentos históricos y `SaleItem.costAtSale × quantity`. `quantity` ya representa BASE, incluso para PACK. No vuelve a multiplicar el paquete ni usa el costo o IVA vigente del catálogo para reconstruir el margen histórico.
- Las devoluciones se contabilizan en el período en que se registraron, aunque provengan de ventas anteriores. IVA y costo se atribuyen mediante las líneas normalizadas y la venta original. El ticket promedio divide documentos emitidos vigentes entre su cantidad de tickets; no descuenta devoluciones ajenas a ese conjunto. El flujo neto puede resultar negativo.
- Las ventas anuladas al corte quedan excluidas; la consulta de salud conserva una venta cuya `cancelledAt` es posterior a ese corte. IVA ausente/inválido, devoluciones sin atribución válida y costos negativos bloquean los indicadores derivados correspondientes con `null`/`unavailable`. Una consulta fallida no devuelve cero. Un período comparable de valor cero produce variación no disponible.
- `costAtSale` y `ProductReturnItem.costTotal` son campos obligatorios del [schema](../../../backend/prisma/schema.prisma). La revisión acredita los negativos implementados; **no acredita la procedencia de un cero importado como si fuera costo conocido**, ni la integridad de una migración histórica. Ese control necesita información de origen y revisión de datos.
- Dueño, administración, superadministración y contabilidad reciben costos según [access.ts](../../../backend/services/assistant/access.ts). Gerencia consulta ventas sin costos; caja y vendedores quedan limitados a sus ventas; bodega recibe información operativa sin costos. Se autoriza antes de leer, el SQL omite costos no autorizados y se vuelve a verificar la sesión antes de entregar resultados.

Ejemplo independiente ejecutado en [assistantAnalytics.integration.test.ts](../../../tests/assistantAnalytics.integration.test.ts): ventas emitidas 345 menos devoluciones 115 = 230; IVA 45 menos 15 = 30; venta neta sin IVA 200; costo neto 80; margen bruto 120, equivalente a 60%; ticket emitido 172.5. Otro caso PACK conserva costo BASE 48 y la foto fiscal a pesar de otros valores del catálogo.

El margen bruto no demuestra ganancia neta, disponibilidad de caja ni causalidad de una promoción. Los gastos son los registrados. Las dos agregaciones de períodos se ejecutan en paralelo; no comparten una única transacción de lectura. La evidencia revisada no prueba una misma fotografía de base de datos frente a cualquier modificación concurrente o carga histórica tardía.

## Qué significa la estimación de reposición

La implementación está en [inventory.ts](../../../backend/services/assistant/operations/inventory.ts) y [inventoryQueries.ts](../../../backend/services/assistant/operations/inventoryQueries.ts):

1. Conserva las unidades comerciales vendidas menos todas las devoluciones normalizadas en `netBaseQuantity`. Para `stockConsumptionBaseQuantity`, resta solamente reintegros `RESTOCK` a las unidades vendidas. Publica por separado `restockedBaseQuantity`, `quarantinedBaseQuantity` y `lostBaseQuantity`. Vínculos inválidos, cantidades incompatibles, disposición desconocida o un consumo neto negativo bloquean la tasa y la sugerencia.
2. Divide las salidas por venta menos reintegros registrados entre días civiles completos sólo si la antigüedad del producto cubre la ventana. El cálculo interno conserva Decimal; la respuesta serializa hasta cuatro decimales. Si la tasa es positiva, días estimados = stock vendible actual / tasa diaria. No calcula una hora exacta de agotamiento.
3. Con cobertura suficiente usa como objetivo `maxStock` positivo; en su ausencia, 15 veces la tasa diaria positiva; sin ella, el mínimo `reorderPoint` positivo. Con cobertura insuficiente sólo permite el mínimo explícito. Resta stock vendible y OC pendientes, limita el resultado a cero y redondea hacia arriba al paso válido. Nunca multiplica el mínimo por dos. Publica mínimos/máximos configurados y `suggestionBasis`: `CONFIGURED_MINIMUM`, `CONFIGURED_MAXIMUM` o `RECORDED_RATE`.
4. Las OC pendientes incluyen `APPROVED` y `PARTIALLY_RECEIVED`: ordenado menos recibido menos cierre por faltante. Excluyen borradores/anuladas. No se acredita que el proveedor entregue ese saldo antes del agotamiento.

Ejemplo MySQL de [assistantInventory.integration.test.ts](../../../tests/assistantInventory.integration.test.ts): 60 vendidas − 10 devueltas = 50; 50/30 = 1.6667 por día; stock 10 → 6 días; objetivo 100 − stock 10 − OC pendientes 20 = 70 sugeridas. Las expectativas se fijaron independientemente de la respuesta. Esto acredita la regla, no que 70 sea la mejor compra futura.

**Historial insuficiente, reparación comprobada:** el SQL calcula días completos desde `Product.createdAt` dentro de la ventana. `historyStatus: INSUFFICIENT`, `historyAvailableDays` y `historyRequiredDays` dejan explícito el límite; `dailyAverage` y `estimatedDaysRemaining` son `null`. Con integridad verificable, la fila es `partial` y sólo puede sugerir el mínimo configurado. Sin mínimo positivo no inventa sugerencia. En MySQL, alta hace siete días, 30 ventas, mínimo 20 y stock 10 producen sugerencia 10 por mínimo, nunca agotamiento; alta justo al comienzo de la ventana da 30 días, un milisegundo después da 29 y alta hoy da cero. Una cobertura ausente/ inválida tampoco se considera suficiente.

**Calidad del historial, pendiente:** `SUFFICIENT` acredita antigüedad para la ventana; no verifica cobertura de importaciones, cierres temporales ni registros offline faltantes. Esa limitación se muestra en las advertencias. El piloto necesita información de origen para distinguir cero observado de historia incompleta.

**Devoluciones físicas, reparación comprobada:** con 60 unidades vendidas, reintegro 6, cuarentena 3 y pérdida 1, la devolución comercial es 10 y el neto comercial 50, pero las salidas por venta menos reintegros son 54 y su promedio de 30 días es 1.8. Una disposición desconocida bloquea la sugerencia aun con stock conciliado. Esta tasa aún excluye merma, traslados y otros movimientos; no se presenta como consumo físico completo ni demanda no satisfecha.

## Lotes, bodegas y alcance de la lectura

Para productos con lote, el stock vendible sólo se acredita si la suma de lotes concilia con `Product.stock` y no existen saldos negativos. Se excluyen lotes cuya fecha civil sea anterior a hoy en Managua; vencer hoy no equivale a estar vencido. El ejemplo MySQL de 3 unidades vencidas y 7 con vencimiento hoy devuelve 7 vendibles.

En una bodega sin seguimiento por lote se exige conciliación global de `ProductStock`, ausencia de negativos y existencia de la fila de destino. No se crea una fila para completar el dato. La tasa y las OC no se atribuyen a una bodega sin historia verificable: la proyección queda no disponible. Para lotes por bodega, la consulta de vencimientos exige registro `ENFORCED` y conciliación entre lote, registro por bodega y `ProductStock`; sin esa evidencia no habilita acciones.

`inspectBatchExpiry` consulta existencias actuales y rechaza un corte histórico distinto de `now`. No ofrece retención/liberación genérica de lotes: la cuarentena de devoluciones de clientes tiene otro alcance. La consulta devuelve candidatos, cuya elegibilidad debe revisarse otra vez en el dominio antes de confirmar una acción.

Las consultas limitan resultados a 20 por defecto, máximo 50. El resumen diario pide hasta 10 productos y 10 lotes y conserva hasta tres hallazgos, con advertencia de alcance cuando alcanza el límite. Un resumen sin hallazgos no acredita revisión completa del catálogo.

## Lecturas sin efectos de negocio

Los tres servicios analíticos, el overview, las búsquedas GET de catálogo y la consulta de estado utilizan lecturas/agregaciones y autorización. En los caminos revisados no siembran cuentas, reparan stock ni llaman a `applyStockDelta`. La prueba MySQL «inconsistencia de lotes y devolución antigua quedan unavailable sin reparar datos» verifica que `ProductStock` conserve su número de filas y que el stock continúe en 10 después de consultar.

Se separan estas excepciones explícitas del ciclo de trabajo:

- [briefing.ts](../../../backend/services/assistant/operations/briefing.ts) guarda `AssistantDailyBrief` por usuario/día y los avisos descartados. Es metadata del resumen, sin efectos financieros o de inventario.
- Conversar y ejecutar un trabajo guarda mensajes, estado, checkpoints y consumo/reservas; una solicitud de preparación puede crear un borrador. Eso no convierte todos los endpoints del chat en lecturas puras.
- Aprobar un alias es una mutación POST con auditoría transaccional, separada de buscar en el catálogo.

Esta revisión está acotada a los servicios y caminos citados. No reemplaza una prueba general de ausencia de escrituras en todos los endpoints del sistema.

## Evaluación retrospectiva sin futuro: pendiente concreto

La reparación rechaza un `cutoff` distinto de `now` tanto en reposición como en vencimientos: no simula una fotografía histórica. Elegir un período de ventas anterior sigue permitido y se rotula expresamente que existencias, lotes y OC corresponden al momento actual. El SQL consulta cancelaciones vigentes, configuración, stock y recepciones actuales. Por eso una evaluación retrospectiva necesita fotografías congeladas o una reconstrucción validada de información conocida entonces; cambiar sólo fechas no cumple el criterio.

Protocolo propuesto, **no ejecutado ni aprobado como resultado del piloto**:

1. Obtener datos autorizados de una ferretería y una farmacia, con 20–30 productos representativos por vertical: rotación alta/baja/intermitente, nuevos, fracciones/PACK y lotes próximos a vencer. Incluir fechas de evento y de conocimiento por el sistema, ventas/devoluciones/anulaciones, disposición, stock, lotes, movimientos, cambios de catálogo y revisiones/recepciones de OC. La persona responsable valida integridad, permisos y esperados.
2. Registrar al menos 90 días consecutivos verificables. Calendario propuesto si la captura inicia el **2026-09-09**: historia inicial del 9 de septiembre al 8 de octubre; cortes diarios del **9 de octubre al 23 de noviembre**; resultados de horizontes de 7 y 14 días hasta el **6 de diciembre de 2026**. Si no hay datos completos, mover el calendario; estas fechas no representan observaciones existentes.
3. Congelar en cada corte a las 00:00 Managua la fotografía conocida entonces y usar sólo los 30 días completos anteriores. Guardar por separado los resultados de los 7/14 días siguientes. No aplicar retroactivamente anulaciones, recepción de OC, existencias o cargas offline conocidas después del corte. Pasar una fecha anterior sin congelar/reconstruir estos estados no cumple este criterio.
4. Comparar la regla vigente con promedio de 7 días, referencia semanal y decisión manual registrada antes de conocer el resultado. Definir baselines y umbrales con el negocio antes de puntuar. Medir error absoluto medio en unidades BASE y sesgo por producto/vertical; WAPE agregado sólo si el total observado es positivo. Reportar explícitamente historia insuficiente, ceros, faltantes de stock y casos no estimados; evitar porcentajes por producto con demanda cero.
5. Separar error al estimar ventas netas de utilidad al prevenir faltantes. Las ventas con stock agotado no revelan toda la demanda. Para valorar faltantes/reposición hacen falta inventarios y recepciones observados, disposición de devoluciones y plazos reales. No prometer hora exacta de agotamiento ni atribuir incrementos de ingresos a la recomendación.
6. Medir valor frente al trabajo manual con tareas equivalentes y orden alternado: tiempo, éxito, errores, correcciones y abandono por vertical. La meta de 20% del [protocolo de evaluación](../../NORTEXGPT_EVALUACION_OPERATIVA_2026-09-05.md) es una meta pendiente, no una mejora observada. Los fallos críticos de acceso, cifras, dinero o inventario bloquean la capacidad afectada.

La comprensión y síntesis del modelo se evalúan por separado con las 60 consultas reservadas y revisión humana, dentro de US$20 mensuales totales/US$10 por negocio. Un proveedor simulado o una respuesta `SUCCEEDED` no demuestra exactitud. Tampoco este protocolo autoriza llamadas pagadas o despliegue.

## Identidad de las fuentes revisadas

SHA-256 leídos del candidato; permiten detectar cambios posteriores a esta revisión:

| Archivo | SHA-256 |
|---|---|
| `analytics.ts` | `e64e1303bff84844e4c7a5342e9fc740d4d0e7025a43cf6d5091ac1ffa24908b` |
| `analyticsPeriod.ts` | `80c98eddf54a8e492d5deca4e386c72f759231f404254be172fe4867207fedb9` |
| `inventory.ts` | `5f966c83ad400f1dd6db0d929d28c3c1e0399352316b06909d1c786758e3ac78` |
| `inventoryQueries.ts` | `c7579d906381a4108ba0756b9aafafc5368db3ac47eaac3204dc95b52a6269c4` |
