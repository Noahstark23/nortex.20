# Evaluación operativa de NortexGPT — 2026-09-05

## Estado y alcance

Candidato local: `/tmp/nortexgpt-operativo-20260905`. Esta entrega añade **120 escenarios deterministas**, **60 consultas reservadas para IA real** y **60 tareas manuales**: reposición, vencimientos y ventas/promociones, en ferretería y farmacia. No sustituye el corpus existente de 100 facturas; ese directorio permanece intacto.

| Evidencia | Resultado de esta entrega | Límite |
|---|---|---|
| Contratos operativos | 120/120 ejecutados por CLI; Vitest 124/124, incluidos cuatro controles del corpus/harness | Respuestas de repositorio sintéticas, funciones del producto reales |
| IA real | 60 consultas reservadas, **0 llamadas ejecutadas** | No acredita comprensión, precisión, latencia ni utilidad del modelo |
| Revisión humana de esperados | **Pendiente** | Los esperados fueron escritos independientemente por agente; no se grabaron de las funciones evaluadas |
| Piloto | 10 tareas por área y vertical, **sin ejecutar** | Meta de 20% de mejora; ningún resultado observado |
| MySQL, concurrencia, cobro y despliegue | Fuera de este corpus | Exigen sus suites de integración y compuertas independientes; un doble de repositorio no acredita transacciones |

Resultados locales: `reports/assistant-evaluation/operations-report.json`, `operations-vitest.json` y `operations-model-report.json`. El último registra `not_run`, no una aprobación del proveedor. Regenerar o ejecutar evaluaciones no autoriza producción.

## Qué compara el corpus

La matriz tiene 20 escenarios por cada combinación de área y vertical. El runner importa directamente `inventory.ts`, `analytics.ts`, `actions/service.ts` y los servicios `promotions/{management,pricing,checkout,totals}.ts`. No reemplaza sus funciones con mocks. Sus límites de persistencia reciben filas sintéticas; las expectativas numéricas y de estado están escritas en `operations-corpus.mjs` y persistidas en `tests/fixtures/assistant/operations/deterministic.json`.

- **Reposición:** ventas BASE menos reintegros RESTOCK, con devolución comercial separada, fracciones, días completos de Managua, OC pendientes, ausencia de información, conciliación de lotes, permisos y pertenencia de bodega. Preparar conserva DRAFT, no recibe ni paga; repetir recupera el borrador; cambiar contenido con la misma clave o confirmar versiones vencidas falla.
- **Vencimientos:** el día de vencimiento todavía no es ayer; verifica Managua, saldos de lote/bodega, modos del registro por bodega, datos ausentes y consulta fallida. Los permisos distinguen lectura de baja. Preparar desde el modelo fuerza retiro/entrega física a falso; editar invalida la revisión, historial ajeno queda bloqueado.
- **Ventas/promociones:** ventas, devoluciones e IVA histórico; costos ausentes no se vuelven cero y caja no recibe margen/costos. Preparación autorizada, fechas de Managua, producto ajeno y contenido adversario; precio promocional real, conflictos con descuentos, cambios de catálogo y cotizaciones. Cobro requiere revisión vigente del carrito y promoción, con totales gravados y exentos.

Ejemplos independientes: 60 unidades vendidas − 10 reintegradas como RESTOCK = 50; en 30 días, 1.6667 por día. Objetivo 100 − stock vendible 10 − OC pendientes 20 = 70; farmacia con sólo 7 unidades vendibles requiere 73. Ventas 460 − devoluciones 57.50 = 402.50; IVA neto 60 − 7.50 = 52.50; ventas netas sin IVA 350, costo neto 240 − 30 = 210 y margen bruto 140. Dos unidades de 115 con 10% dan 207; IVA incluido de mercancía gravada 27 y producto exento 0.

La adaptación sintética comprueba que las consultas liguen el negocio autenticado; para caja también el operador, y para bodega que no consulten costos. Eso complementa, pero **no demuestra**, que el SQL agregue correctamente filas reales, que un bloqueo serialice concurrencia o que una transacción revierta efectos. Los escenarios de bloqueo se detienen antes de ejecutar el dominio: no afirman haber contabilizado bajas, compras ni ventas.

## Reproducir sin proveedor ni credenciales

Desde la raíz del candidato, con Node 22.23.2 y dependencias instaladas:

```sh
mise exec -- node scripts/assistant-evaluation/operations-generate.mjs
mise exec -- node --import tsx scripts/assistant-evaluation/operations-evaluate.mjs
mise exec -- node node_modules/vitest/vitest.mjs run tests/assistantOperationalCorpus.test.ts --maxWorkers=1
mise exec -- node --import tsx scripts/assistant-evaluation/operations-model.mjs
```

El generador sólo escribe el subdirectorio `operations`; nunca modifica las 100 facturas. El evaluador registra SHA-256 del corpus y de las fuentes principales, informa fallos con identificador estable y termina con error si falla un contrato. `operations-model.mjs` sin `--allow-paid-model` sólo escribe un informe de consultas reservadas; no abre conexiones ni lee claves.

## Evaluación del modelo real: pendiente y presupuestada

`model-reserved.json` contiene 60 preguntas separadas (10 por área/vertical), incluidas ambigüedad, memoria de una conversación, solicitud de privilegios, fuentes insuficientes, revisión y acciones. Antes de ejecutarlas, una persona debe montar el catálogo/datos sintéticos, concretar referencias de los productos mencionados y escribir el resultado esperado de cada pregunta. No se deben utilizar como evidencia historias o permisos inventados. Las preguntas de continuidad necesitan una conversación preparada y un ensayo manual de varios turnos; el harness inicial crea una conversación nueva por pregunta y **no acredita memoria multitur­no**.

El harness llama al mismo endpoint autenticado de ejecuciones, que usa `reserveAssistantBudget`/`settleAssistantBudget` desde el orquestador del producto. No crea una segunda contabilidad de gasto ni envía claves al navegador. Máximo cuatro iteraciones por consulta, sin confirmación del dominio. Global US$20/mes, por negocio piloto US$10/mes; comparte ese presupuesto con el resto de NortexGPT.

La reserva conservadora actual es US$0.281920 por llamada y hasta **US$1.127680 por consulta**. Las 60 preguntas podrían reservar hasta **US$67.660800**: no se pueden prometer todas en un mes dentro de US$20. Ejecutar por lotes pequeños, observar el gasto real documentado y planificar otro mes si hace falta. No aumentar límites ni cambiar a un modelo caro para terminar la muestra.

El modo pagado exige explícitamente backend de QA en loopback, negocio sintético, archivo de sesión autenticada 0600, rol coincidente, vertical y archivo de revisión humana. Ese archivo debe declarar `synthetic: true`, `expectedOutcomesReviewed: true`, `reviewer`, `reviewedAt`, `vertical`, `role` y `scenarioIds` revisados. **No se entrega un archivo falsamente aprobado.**

Ejemplo para una consulta, sólo después de autorizar y completar esos requisitos:

```sh
mise exec -- node --import tsx scripts/assistant-evaluation/operations-model.mjs \
  --allow-paid-model --synthetic-tenant \
  --base-url http://127.0.0.1:3210 \
  --session-token-file /ruta/privada/sesion-qa \
  --review-file /ruta/privada/revision-real.json \
  --vertical ferreteria --role OWNER --limit 1 --max-reserved-usd 2
```

El límite por invocación es de 1–5 consultas y además se compara contra el máximo monetario conservador solicitado. El tope del CLI no concede crédito: la autoridad final sigue en MySQL. Se conserva requestId antes de solicitar el run; una respuesta perdida se marca incierta y no se reemplaza por otro intento. Los únicos endpoints permitidos son capacidades, creación de conversación y creación/lectura del run. No llama rutas de confirmar ni cobrar. Una respuesta degradada, fallo o presupuesto agotado detiene el lote. Los informes se crean privados (0600), nunca contienen el token, y dejan los juicios semánticos pendientes.

Evaluar manualmente por pregunta: fuente y período correctos; cifras concordantes con servicio independiente; respeto del rol; incertidumbre explícita; preservación de hechos; siguiente paso útil; borrador exacto y ausencia de ejecución sin revisión. Conservar runId, modelo/snapshot, consumo de `AssistantUsage`, versión del candidato y resultado humano. Una respuesta `SUCCEEDED` no equivale a correcta. Los fallos de seguridad, cifras, stock o duplicación bloquean esa capacidad.

## Piloto manual: meta, no resultado

`pilot-tasks.json` contiene 10 tareas laborales por área y vertical, distintas de las preguntas adversarias del modelo. Conservar operador/rol, tarea, candidato y evidencia. Registrar tiempo manual de referencia y tiempo con asistente, errores, correcciones, abandono y éxito. El orden debe alternarse para limitar aprendizaje; comparar tareas equivalentes con datos sintéticos o datos autorizados y operadores del equipo. Reiniciar sólo el montaje de QA documentado entre ensayos, nunca evidencias reales.

Para una tarea válida: mejora porcentual = `(tiempo manual − tiempo asistente) / tiempo manual × 100`. La **meta inicial es 20%**, manteniendo exactitud y sin errores críticos. Reportar medianas y distribución por área/vertical; registrar los fracasos, no excluirlos para mejorar el promedio. No atribuir retención, mejor experiencia o ahorro al conteo de pruebas. Las confirmaciones manuales sólo se ensayan en el negocio sintético, con verificación de efectos y recuperación del comprobante.

Antes de ampliar el piloto deben quedar revisados los esperados, evaluado el modelo real, conciliados los flujos con MySQL 8, ensayados desactivación/retención/restauración y aprobadas las compuertas del mismo candidato. Implementación, pruebas deterministas, evaluación real, piloto y despliegue conservan estados separados.

## Estado operativo

`GET /api/assistant/status` permite a administración comprobar consumo, ejecuciones de las últimas 24 horas y colas retenidas de su negocio, sin contenido de conversaciones. Procedimiento e interpretación: [estado operativo y recuperación](NORTEXGPT_OPERATIVO_2026-09-05.md#estado-operativo). Un campo no disponible o una reserva UNKNOWN requiere verificación; no equivale a cero ni autoriza reintentar una operación financiera.

## Reposición: corrección y validación retrospectiva

La [revisión de métricas](evidence/nortexgpt/operational-metrics-review.md) registra el defecto y la reparación de historial insuficiente y destino de devoluciones. Cero ventas con mínimo5 y stock2 sugiere3; no se multiplica el mínimo por2. El corpus de120 conserva ese esperado independiente actualizado. Con antigüedad insuficiente no se calcula agotamiento y sólo se muestra el mínimo configurado. Verificar antigüedad no demuestra integridad de cargas históricas ni calidad predictiva.

La precisión retrospectiva sigue pendiente: requiere datos autorizados y fotografías conocidas al corte, separando los resultados futuros de7/14días. No se puede medir usando existencias/OC actuales con una fecha vieja. El protocolo completo queda en la revisión; las pruebas sintéticas de aritmética no lo sustituyen.
