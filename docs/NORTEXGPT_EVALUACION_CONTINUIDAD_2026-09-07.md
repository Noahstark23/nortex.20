# NortexGPT: continuidad de evaluación y piloto — 7 de septiembre de 2026

La continuación corrige la recuperación del evaluador de IA y entrega instrumentos ejecutables para medir el piloto y la estimación de reposición. **No hubo llamadas a Haiku, datos reales de negocios, mensajes externos ni despliegue.** El usuario indicó que Haiku todavía no está configurado. Hay una referencia de contacto de la ferretería en la conversación; faltan farmacia y responsables de revisión. El correo no se incorpora a fixtures ni a evidencias públicas del repositorio.

## Entrega y límites

| Estado | Evidencia |
|---|---|
| Reparado y probado | El evaluador conserva la identidad de consulta ante respuesta perdida, impide reemplazar informes y recupera por GET autenticado. |
| Implementado y probado con datos sintéticos | Comparación de tiempos, errores y correcciones de las 60 tareas; backtest con 90 días anteriores y horizontes de 7/14 días. |
| Preparado, sin ejecutar | [Planilla del piloto](evidence/nortexgpt/evaluation-20260907/pilot-worksheet.json), [revisión de ferretería](evidence/nortexgpt/evaluation-20260907/model-review-ferreteria.json) y [revisión de farmacia](evidence/nortexgpt/evaluation-20260907/model-review-farmacia.json). |
| Pendiente | Configuración privada de Haiku, revisión humana, consultas reales reservadas, datos históricos autorizados y trabajo con los negocios. |
| Sin ejecutar | CI remoto, staging y producción. |

Los formularios de revisión tienen `expectedOutcomesReviewed: false` y campos vacíos. No son aprobaciones. El [estado inicial del modelo](evidence/nortexgpt/evaluation-20260907/model-pending.json) registra cero llamadas; el [estado inicial del piloto](evidence/nortexgpt/evaluation-20260907/pilot-baseline.json) registra cero tareas ejecutadas.

## Recuperación del evaluador

El defecto anterior se reprodujo ejecutando `runOperationsModelEvaluation`: un segundo inicio reemplazaba evidencia y podía crear nuevas consultas. La prueba inicial tuvo siete fallos de ocho; la reparación pasa las diez pruebas finales de recuperación, incluidas dos incorporadas después de la reproducción.

- El archivo de informe es exclusivo: un inicio normal, incluso sin proveedor, rechaza una ruta existente. Una nueva consulta deliberada requiere otra ruta.
- `--resume` verifica la misma sesión, backend, revisión, preguntas y reserva máxima mediante una huella; obtiene las capacidades nuevamente. Cada consulta al resultado atraviesa la autorización del backend.
- La recuperación sólo hace GET. Busca el `runId` guardado o, si se perdió la respuesta inicial, la coincidencia exacta por `requestId` en la conversación guardada. Ausencia, 403, interrupción o un trabajo incompleto no autorizan reenviar ni recuperar ejecución mediante POST.
- No inicia las preguntas que quedaron sin enviar en un lote. Una llamada repetida podría consumir presupuesto; se conserva la incertidumbre hasta investigar.
- Se guarda identidad antes del POST inicial y cada informe mediante archivo temporal privado, sincronización y renombrado atómico. Un `.lock` impide dos escritores. Una terminación abrupta puede dejarlo: comprobar el PID y conservar el informe antes de retirar únicamente ese lock. No hay desbloqueo automático por antigüedad.
- Los archivos usan permisos 0600. No se persiste el token ni texto de errores de transporte/proveedor. El informe sí contiene respuestas privadas y debe permanecer fuera de contenido público.
- La huella vincula la sesión exacta: renovar el token impide la reanudación automática con este CLI. Requiere consultar la operación con acceso autenticado y conservar el informe original; no iniciar una consulta sustituta como mecanismo de recuperación. Los informes antiguos versión 1 no se migran por suposición.

Una recuperación correcta produce `executed_pending_human_review`, no una certificación de calidad del modelo. El contador real de consumo sigue siendo `AssistantUsage`/`AssistantBudget`; el CLI no reserva nuevamente ni deduce precio de la duración.

## Primera evaluación de Haiku

1. Configurar `ANTHROPIC_API_KEY` exclusivamente en el proceso del backend de QA mediante un mecanismo privado. No enviarla al chat, argumentos de terminal, frontend, fixtures ni informes. La sesión del CLI es la sesión autenticada de Nortex, nunca la clave del proveedor. El adaptador existente usa `claude-haiku-4-5-20251001`; en ausencia de clave conserva la respuesta determinista.
2. Usar los negocios sintéticos de la demostración en MySQL 8 descartable. Mantener las políticas, permisos y presupuestos del servidor. El envoltorio de QA anterior no propaga claves del proveedor: no asumir que configurar una clave en otra terminal lo habilita.
3. Una persona revisa por vertical el montaje, productos, lotes, fechas, período, existencias vendibles, salidas BASE y OC pendientes. Completa el formulario con resultados esperados y evidencia independiente. La pregunta inicial de ambos formularios es: «¿Qué productos debo reponer esta semana y por qué?». Aprobar sólo después de comparar esos datos.
4. Guardar una sesión local de Nortex en archivo privado 0600. Ejecutar un caso por vertical y detenerse para revisión. El CLI sólo acepta backend HTTP en loopback y rol coincidente. La condición de negocio sintético necesita validación del montaje: no se demuestra sólo con una bandera.
5. Registrar el juicio humano por fuente, permisos, información faltante, ausencia de ejecución sin confirmar y utilidad del siguiente paso. Consultar el consumo real del servidor antes de otro lote.

Plantilla de comando, reemplazando las rutas de la revisión completada, la sesión privada y el puerto de QA:

```sh
mise exec -- node --import tsx scripts/assistant-evaluation/operations-model.mjs \
  --allow-paid-model --synthetic-tenant --base-url http://127.0.0.1:3210 \
  --vertical ferreteria --role OWNER --limit 1 --max-reserved-usd 2 \
  --review-file /ruta/privada/revision-ferreteria.json \
  --session-token-file /ruta/privada/sesion-qa \
  --report reports/assistant-evaluation/ferreteria-lote-01.json
```

Agregar `--resume` a **esos mismos argumentos** para recuperar mediante lecturas. El nombre `--allow-paid-model` se conserva por compatibilidad, pero la rama de reanudación no inicia llamadas. La reserva máxima conservadora vigente es US$1,127680 por consulta de hasta cuatro iteraciones; una consulta por cada vertical suma US$2,255360 como techo, no como gasto observado. Los límites globales US$20 y por negocio US$10 siguen en el servidor.

## Medición del piloto

La planilla versión 2 conserva las 60 tareas: diez por cada combinación de tres áreas y dos verticales. Mantiene alternancia manual primero/asistente primero. Se rellenan sobre el mismo candidato y casos equivalentes:

- Identificador del operador, fecha y referencias a evidencia privada.
- Tiempo manual y del asistente, errores y correcciones por cada método, incidentes críticos y éxito. `corrections` del formato anterior no sustituye las dos mediciones separadas.
- Una tarea fallida se registra con `status: completed` y `success: false`; no se borra ni se oculta como pendiente. Las observaciones requieren ambas duraciones y los conteos explícitos.
- `synthetic` distingue una simulación de trabajo real. `candidateSha` identifica un commit de 40 hexadecimales o un manifiesto de 64, útil para este checkout con cambios. Revisión humana posterior a las observaciones, con responsable y fecha.

```sh
mise exec -- node scripts/assistant-evaluation/pilot-analyze.mjs \
  --template --report reports/assistant-evaluation/piloto-para-completar.json
mise exec -- node scripts/assistant-evaluation/pilot-analyze.mjs \
  --input /ruta/privada/piloto-completado.json \
  --report reports/assistant-evaluation/piloto-resultado.json
```

La mejora se calcula como `(mediana manual − mediana asistente) / mediana manual × 100` en cada grupo. Se requieren diez pares, al menos 20%, ningún aumento agregado de errores/correcciones, cero incidentes críticos y éxito de todas las tareas. Un grupo que no cumple impide el criterio global. Los datos ausentes no son cero y las tareas incompletas no desaparecen del denominador. Una simulación siempre se rotula `simulation_only`; una revisión declarada no sustituye verificar la evidencia del negocio. El informe no autoriza despliegue ni ampliación de usuarios.

## Backtest de la estimación

`forecast-backtest.mjs` invoca `inventoryBurnRateRow` del producto, sin consultar MySQL ni reutilizar existencias actuales. Recibe JSON versión 1 con `synthetic` y casos independientes:

| Campo | Contrato |
|---|---|
| `id`, `businessRef`, `vertical`, `productId` | Identificadores únicos y negocio anonimizado; vertical ferretería/farmacia. No se puntúa dos veces el mismo producto/corte. |
| `cutoff` | ISO UTC canónico, `T06:00:00.000Z`, equivalente a 00:00 Managua. |
| `snapshot` | `asOf` igual al corte, `recordedAt` conocido entonces, `productCreatedAt`, referencias `evidence` y `row` del catálogo/stock/lotes/OC conocido entonces. |
| `history` | 90 filas consecutivas anteriores. Cada fila tiene `day`, `recordedAt`, `complete`, `stockout` y cantidades BASE `soldQuantity`, `returnedQuantity`, `restockedQuantity`, `quarantinedQuantity`, `lostQuantity`. |
| `outcomes`, `observedAt` | 14 filas posteriores, separadas del entrenamiento; el horizonte debe estar terminado. |
| `manual` | Opcional: estimaciones BASE para claves `7` y `14`, `recordedAt` anterior/al corte y referencia `evidence`. Si falta, queda sin puntuar. |

Las cantidades son strings decimales no negativos con hasta cuatro posiciones. Un día incompleto declara `complete: false` y las cinco cantidades `null`. Conservar filas explícitas evita convertir ausencias en ceros. Los registros diarios se conocen después de su cierre y antes del corte aplicable. La procedencia, cancelaciones y modificaciones conocidas entonces deben verificarse con la persona responsable; una fecha declarada no prueba por sí sola un snapshot histórico.

Se reconstruyen los últimos 30 días de entradas del calculador real; el snapshot no puede inyectar agregados de ventas futuros. Las predicciones no cambian al modificar resultados posteriores. Se comparan tasa del producto, promedio de siete días, referencia de cuatro semanas por día de semana y estimación manual. En horizontes completos de 7/14 días, la referencia semanal suma los cuatro antecedentes de cada día, equivalente al promedio de 28 días.

```sh
mise exec -- node --import tsx scripts/assistant-evaluation/forecast-backtest.mjs \
  --input /ruta/privada/snapshots-revisados.json \
  --report reports/assistant-evaluation/backtest-resultado.json
```

El informe conserva cada producto/corte, exclusiones, MAE, sesgo y WAPE por vertical/horizonte/método. WAPE es `null` cuando el total observado es cero. Historia insuficiente, devoluciones incompatibles, estimación no disponible, resultados incompletos o faltantes de stock se muestran o bloquean explícitamente. No interpretar un MAE agregado de productos con unidades distintas como KPI del negocio. Los cortes solapados tampoco son muestras independientes.

La prueba CLI sintética de esta entrega obtuvo, para siete días, estimación 56, observado 70, MAE 14, sesgo −14 y WAPE 20%. **Es una comprobación aritmética fabricada, no un resultado de ferretería ni una precisión acreditada.** La validación retrospectiva real y de prevención de faltantes sigue pendiente, al igual que el protocolo de 20–30 productos representativos por vertical.

## Verificación y preservación

Candidato aislado: `/tmp/nortexgpt-operativo-20260905`, sobre los cambios locales existentes. Rama y worktrees sin cambios. Reintegración limitada a archivos listados y con comparación de hashes del origen. La copia de resguardo de la integración anterior se conservó fuera del árbol de TypeScript para no compilar fuentes duplicadas; no se cambiaron exclusiones de compilación.

- Pruebas focales: **157 aprobadas**, cero omitidas, cuatro archivos; incluyen las 124 previas del corpus operativo y 33 nuevas.
- Vitest general: **4.785 aprobadas, 284 omitidas, cero fallidas**; 343 archivos aprobados y 34 omitidos. Las omisiones no se contabilizan como aprobadas.
- TypeScript, Prisma 6.4.1 generate/validate, sistema de diseño y build: aprobados con Node 22.23.2.
- No se modificaron dominios de dinero/inventario, schema, endpoints ni UI. Las 298 pruebas obligatorias MySQL y la mutación de la entrega anterior conservan su estado histórico; **no se ejecutaron nuevamente ni se atribuyen a esta continuación**. El backtest sólo lee la función pura; las pruebas del transporte son simuladas y no acreditan calidad de Haiku.
- Sin variación de `backend/server.ts` ni `components/POS.tsx`. No se elevaron presupuestos. El delta de líneas de scripts y pruebas está en el manifiesto de esta continuación.

El [manifiesto y evidencia de esta continuación](evidence/nortexgpt/evaluation-20260907/verification.json) identifica los archivos y registros de prueba. `operational-files.json` conserva la fotografía histórica anterior; sólo su entrada `operations-model.mjs` queda sustituida por el hash de esta continuación. No se reescribe evidencia antigua para hacerla pasar por pruebas nuevas.
