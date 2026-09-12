# W01: primera revisión semanal de caja

Incremento local del 2026-09-09, dentro de A00/A02 de la [meta administrativa](META_NORTEX_EQUIPO_ADMINISTRATIVO.md). Candidato persistente `release-20260908`, HEAD `ead043c2aa27e25e6522e97b3cdc2c3a4e585783` más cambios locales identificados en el manifiesto. **Es la primera parte de W01; no acredita su piloto, aceptación humana ni resolución de diferencias.**

## Resultado disponible

La persona puede escribir «Revisá mis cierres de caja de la última semana», pedir hoy/ayer, esta semana, semana pasada o un rango explícito de 1–7 días. Nortex muestra:

- Período, corte y consulta en Managua; día en curso señalado. Sin fechas usa los siete días completos anteriores.
- Cada cierre íntegro: folio, esperado, contado y diferencia en NIO y USD. Faltantes y sobrantes se acumulan por separado; los fondos de sucesivos turnos no se suman como saldo disponible.
- Cierres sin reporte, reportes inválidos y turnos actualmente abiertos antes del corte. Estos últimos no reconstruyen el estado histórico de la caja.
- Fuente/versionado/hash plegados para revisión. Diferencia sin causa acreditada queda explícitamente pendiente; no se atribuye robo, pérdida o error de una persona.

El acceso sugerido «Revisar cierres de caja» aparece según capacidades. La revisión se conserva con su fecha en el historial operativo privado existente; recuperar el mismo run devuelve la evidencia guardada, y una nueva consulta vuelve a leer las fuentes. No se crea una agenda genérica ni se declara resuelto un encargo por mostrar un informe.

## Contrato técnico e integridad

`review_weekly_cash` es READ en [el registro](../backend/services/assistant/operations/tools.ts), con servicio en [weeklyCashReview.ts](../backend/services/assistant/operations/weeklyCashReview.ts) y contrato [compartido](../shared/assistantWeeklyCashReview.ts). No acepta identidad, SQL, endpoints ni efectos enviados por el modelo. Revalida usuario activo, tenant, rol y capacidad antes/después; caja/empleado/vendedor sólo ven turnos cuyo `Shift.userId` les pertenece. Gerencia y roles de reportes conservan el alcance del servicio existente; bodega no obtiene esta herramienta ni sus datos.

Dos SELECT consolidados en transacción de lectura RepeatableRead: cierres por `endTime` y turnos abiertos actuales. Límites de 20 cierres, 10 abiertos, 256 KiB por snapshot antes de cargar JSON y 18.000 caracteres de respuesta. Superar un límite hace explícita la lista incompleta y deja acumulados `null`. No tener cierres tampoco equivale a caja en cero. Un cierre comprobado con cero sí conserva ese cero.

El verificador de snapshots se comparte con el documento Z existente después de caracterizarlo. W01 añade comprobación de fechas, precisión NIO 2/USD 4 y ecuación contado−esperado; un hash coincidente acredita correspondencia interna, no firma externa, conciliación contable ni verdad del conteo físico. No envía nombres, notas, costos o snapshots completos al modelo. Las correcciones posteriores no reescriben el reporte original.

No llama a cerrar caja, sembrar cuentas, reconstruir asientos o registrar compras. No hay llamada de IA dentro de la transacción. Sin proveedor o presupuesto, el fallback ejecuta esta misma lectura sin reserva de IA; conserva diferencias e indisponibilidad. El clasificador acotado rechaza períodos ambiguos y preserva respuestas sobre cajas/presentaciones de compras.

Schema: únicamente el índice aditivo `Shift(tenantId,status,endTime)`, con [SQL espejo](../backend/prisma/migrations/20260909020000_weekly_cash_review_index/migration.sql). El arranque existente usa `db push`, no ejecuta ese archivo como migración versionada. El ensayo MySQL retira sólo ese índice en su base descartable, conserva cierres preexistentes, aplica el schema y repite la operación. No se aplicó DDL remoto.

## Evidencia y límites

La [verificación del incremento](evidence/nortexgpt/weekly-cash-review-20260909/verification.json) registra comandos, huellas y resultados finales. Pruebas focales, compuerta general, integración MySQL y mutación se acreditan allí por separado. Las omisiones de la suite general no cuentan como aprobadas; la integración obligatoria exige cero omisiones.

Resultados ejecutados el 2026-09-09, con comprobación final de artefactos el 2026-09-12:

| Compuerta local | Resultado |
| --- | --- |
| Prisma 6.4.1 generate/validate, TypeScript, diseño y build | Aprobados; 110 archivos revisados por diseño. |
| Vitest general | 6.024 aprobadas; 390 omitidas, sin acreditarlas como aprobadas. |
| Integración obligatoria MySQL 8 descartable | 39 suites, 404 casos aprobados, cero omisiones; 36 casos específicos de W01. |
| Mutación dirigida W01 | 89/89 mutantes detectados por pruebas, cero supervivientes. |
| Mutación completa configurada | 100% sobre el alcance protegido de 66 módulos: 5.868 detectados por pruebas y 4 por timeout; 20 ignorados preexistentes. Cero supervivientes o mutantes sin cobertura. |

Las fuentes incluidas en el informe de mutación coinciden con el candidato actual. El 100% corresponde a ese alcance configurado, no a todo el repositorio. Estas son pruebas locales; no acreditan CI remoto ni staging.

La revisión independiente reprodujo y se repararon: desvío de frases sobre cajas de productos, selección incorrecta de períodos mezclados y corte parcial invisible. Mutación dirigida encontró huecos de frontera y códigos de error; se añadieron pruebas y se eliminó una condición redundante de ausencia, conservando los cuerpos completos y el umbral de 100%.

Vista con componentes reales y datos sintéticos: [escritorio](evidence/nortexgpt/weekly-cash-review-20260909/desktop.png), [móvil](evidence/nortexgpt/weekly-cash-review-20260909/mobile.png) y [referencia expandida](evidence/nortexgpt/weekly-cash-review-20260909/mobile-reference.png). No sustituye navegador contra un negocio real, dispositivos físicos, evaluación de Haiku ni comparación de tiempo humano. Las pruebas del panel verifican conservar carrito/ruta al consultar; los escenarios HTTP prueban el backend con MySQL, separadamente de esta demostración visual.

Extracción: `salesReportService.ts` 994→933 líneas (−61); `shiftSnapshotValidation.ts` +95; conjunto +34. Son verificaciones/tipos trasladados a un módulo compartido, no una reducción total del sistema. `backend/server.ts` permanece en 14.118 y `components/POS.tsx` en 5.924 líneas. Sin nuevas dependencias, clientes Prisma ni aumento de presupuestos.

## Siguiente prueba de valor

1. Elegir una semana y un revisor de la ferretería en un entorno privado autorizado. Confirmar que los turnos/documentos disponibles representan el trabajo que hoy le cuesta tiempo al dueño.
2. Comparar tareas equivalentes manual/asistente: tiempo humano, esperas, correcciones, pendientes y aceptación. Objetivo inicial ≥20% de reducción de mediana, sin más correcciones ni incidentes críticos; no es un resultado obtenido.
3. A partir de diferencias reales, añadir investigación determinista de sus movimientos/documentos y excepciones asignadas con revisión humana. Conservar evidencia original y relación a correcciones. Esto completa partes de W01 que este incremento aún no implementa.
4. Crear estados/agenda de varios días sólo donde la prueba anterior los necesite; ampliar hacia W03 si el negocio necesita planificar pagos, o W02 cuando necesite planilla. Piloto y costo acompañan cada entrega útil.

Haiku real, revisión humana de expected, ahorro observado y despliegue siguen pendientes. Cero llamadas pagadas, cero mensajes a clientes y cero cambios productivos en este incremento. Precio objetivo del servicio US$20, presupuesto inicial IA US$2 por negocio y ampliación por solicitud/aprobación se conservan sin cambios.
