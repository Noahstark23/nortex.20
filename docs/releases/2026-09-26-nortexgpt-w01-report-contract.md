# Ficha A02.W01.3–4 · informe de revisión semanal

Fecha: 2026-09-26. Base aislada `e0d2ef360b3b271548062c86d23ee7c4e37df06f`, derivada de `main` `a7bcca71e83b25d6254e7a095d7b52f44db7a179`. El checkout original conserva su trabajo.

## Resultado y autoridad

- Solicitud: «Revisá mi semana y ayudame a aclarar las diferencias de caja».
- Resultado completo: informe versionado con período/corte Managua, fuentes, diferencias y excepciones asignadas; revisión y aceptación humana de un hash exacto. La aceptación no cierra caja, corrige importes ni asienta dinero.
- Este lote implementa la **vista previa determinista** del informe desde un encargo W01 vigente. La aceptación y la navegación móvil/POS se entregan después y permanecen abiertas.
- Producto: fundador de Nortex. Revisor humano de los informes piloto: pendiente de identificar. Sólo el usuario autorizado para la fuente puede leer su informe; tenant, usuario y rol vienen de JWT. Canal: web interno. No hay consentimiento nuevo ni mensajes externos.
- Efectos de este lote: lectura autorizada únicamente. El modelo no calcula cifras ni confirma.

## Fuentes y contrato

- Cifras: `review_weekly_cash` guardado en un `AssistantRun` exitoso, validado por `readWorkItemSource`; cada fila conserva referencia al `ShiftCloseReport` histórico si existe. W01B y estado actual son fuentes separadas y no se atribuyen sin enlace comprobado.
- Semana: fechas civiles y corte `America/Managua` de la fuente, no del reloj del navegador. Desconocido permanece `null`; causas no documentadas permanecen excepciones. Una nota humana no demuestra una causa.
- Entrada: ID de encargo propio; el servidor revalida permiso y hash del run. Salida: informe tipado con ID/versión del encargo, hash de la fuente, filas, totales, advertencias y excepciones pendientes asignadas al responsable del encargo. No se aceptan cifras ni tenant del cliente.
- Excepción: una fila con diferencia, reporte faltante/inválido o turno abierto requiere atención; una fuente parcial/truncada conserva una excepción general. Asignarla al responsable no la resuelve.
- Identidad del informe: hash SHA-256 de una representación construida en orden estable por el servidor; misma fuente y versión producen el mismo hash. Un cambio del encargo o fuente cambia o invalida la vista previa. Sin nuevas llamadas al proveedor, gasto o escritura por GET.
- Retención y revocación: la vista previa no se almacena en esta fase; sigue la caducidad y los permisos del encargo/run. Un 404/409/403 no provoca reconstrucción ni nueva ejecución. Cancelación impide aceptar; las notas previas permanecen según el contrato A01.
- Fuentes de ayuda: ninguna. Límites: 30 filas de la fuente y hasta 31 excepciones (una por turno más cobertura); no se inicia otro run. Presupuesto IA: US$0 para la vista previa.

## Responsabilidad de edición

Un solo integrador edita `shared/assistantWorkReport.ts`, `backend/services/assistant/workItems/report.ts`, `backend/routes/assistantWorkItems.ts`, `components/assistant/AssistantWorkItems.tsx`, y las pruebas de esos módulos. `backend/server.ts`, `components/POS.tsx` y el schema quedan fuera de este lote. Antes de extracción no aplica: se añade módulo de lectura y la ruta compone ese módulo.

## Evidencia y salida

| Comprobación | Estado requerido |
|---|---|
| QA determinista | Mismo hash para misma fuente/versión, null distinto de cero, excepciones asignadas sin declarar causa |
| HTTP/MySQL | Tenant/rol revocado bloqueados, hash de fuente cambiada bloqueado, GET sin escritura de caja/IA |
| Modelo, revisión humana, piloto | Pendientes; esta fase no los simula |
| UI móvil/escritorio y carrito | Pendiente de A02.W01.4 |
| CI, staging, producción | Pendientes del mismo SHA y autorizaciones separadas |

La siguiente salida es un POST de aceptación con versión/hash exactos, comprobante durable y revocación revalidada, más la experiencia de volver al encargo sin perder carrito. Un informe preliminar no se llama aceptado.

## Resultado local de este lote

El informe preliminar se devuelve en el `GET` autorizado del encargo. El hash incorpora versión, fuente, importes y estados visibles, excepciones, advertencias, evidencia y contenido de las notas visibles. Si el corte está truncado, los conteos no corresponden a los turnos, hay advertencias o el período está en curso, el informe oculta los acumulados y mantiene una excepción de cobertura. Cada diferencia conserva su referencia histórica cuando existe y permanece pendiente.

Prueba roja previa: `tests/assistantWorkReport.test.ts` falló al faltar el módulo. Después, las pruebas focalizadas pasaron 54/54 y TypeScript pasó. `mise exec -- sh scripts/ci-local-safe.sh` terminó con 7 116 pruebas aprobadas, 547 omitidas, diseño y build aprobados. `npm run test:integration:required` terminó con 52 suites y 561 casos MySQL aprobados, cero omitidos; la suite W01 comprobó que el hash de la vista cambia tras guardar una nota y permanece estable en una lectura posterior. Los omitidos de la compuerta rápida no se cuentan como aprobados por ella.
