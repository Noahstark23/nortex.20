# W01B: investigar el soporte de un cierre

Segundo incremento local de W01, en el candidato persistente `release-20260908`, base `ead043c2aa27e25e6522e97b3cdc2c3a4e585783` más cambios locales. Continúa la [revisión semanal](NORTEXGPT_REVISION_SEMANAL_CAJA_2026-09-09.md). La entrega reúne evidencia y pendientes humanos; no acepta conciliaciones ni acredita por sí sola la causa de una diferencia.

## Recorrido y resultado

Desde una revisión semanal, elegir **Investigar este cierre**. Nortex conserva la referencia del turno y el hash del reporte seleccionado, consulta las fuentes autorizadas y presenta:

- El desglose guardado al cerrar: apertura, ventas brutas por forma de pago, entradas, salidas y reembolsos, esperado, contado y diferencia por moneda.
- Los movimientos que existen al consultar, con fecha y estado de anulación. Son evidencia actual, separada del reporte histórico; no se afirma que cada fila integró aquel cierre.
- Comprobaciones que requieren una persona y referencias para buscar los documentos en los módulos habituales.

Una consulta nueva lee las fuentes de nuevo. Recuperar el run conserva su evidencia y fecha originales dentro de la retención privada existente. El botón usa el envío de mensajes del panel, mantiene carrito y captura, y se bloquea ante trabajo o confirmaciones pendientes. No crea otra cola ni navega fuera del POS.

## Hallazgo que limita la explicación

`shiftCloseService` resta `storeCreditApplied` al calcular el efectivo esperado. Sin embargo, `buildShiftCloseReport` guarda `cash.cashSalesNio` como suma bruta de ventas CASH y no conserva aquel crédito aplicado. Por eso no se usa la fórmula apertura + ventas brutas + entradas − salidas para reconstruir el esperado. Tampoco se inventa el crédito aplicado como diferencia residual entre cifras.

El snapshot no identifica todos los movimientos que lo integraron ni una cabeza del libro firmado al cierre. Coincidencias de importes o categorías no prueban correspondencia individual, integridad de la cadena, conciliación contable, pago bancario ni responsabilidad de una persona. No se llama a `verifyTenantLedger` como si acreditara el pasado ni se reconstruye el reporte con ventas actuales.

## Contratos y límites

Herramienta READ `inspect_cash_close`: identidad del JWT, `shiftId` y hash opcional de referencia. Permisos de reportes iguales a W01; caja/empleado/vendedor sólo sobre `Shift.userId`. Revalidación antes/después y aislamiento de historial por negocio, usuario y rol. Sin notas, nombres, costos, salarios o descripciones libres enviados al modelo.

La orden exacta generada por el botón se procesa de forma determinista incluso con proveedor configurado; no reserva ni consume IA. Un hash cambiado devuelve conflicto y pide nueva revisión. No se interpreta un “sí” ni una declaración en chat como prueba de causa o aprobación.

Lecturas acotadas en transacción RepeatableRead, sin llamadas externas ni efectos de negocio. Snapshot limitado a 256 KiB, máximo 20 grupos y 10 formas de pago; hasta 30 movimientos actuales con detección de truncamiento. Los datos inválidos, ausentes o incompletos se señalan; nunca se convierten en cero ni en una suma aparentemente completa. Fallo de base se diferencia de lista vacía.

Índice aditivo `CashMovement(tenantId,shiftId,createdAt,id)` con SQL espejo; el arranque existente aplica el schema por `db push`. No hay nueva tabla, cliente Prisma, dependencia o aumento de presupuesto. Los monolitos `backend/server.ts` y `components/POS.tsx` sólo conservan su estado previo.

## Verificación

Los resultados finales, archivos y hashes se registran en [el manifiesto de esta entrega](evidence/nortexgpt/cash-close-investigation-20260912/verification.json). QA local, MySQL descartable, mutación pertinente y evidencia visual se acreditan por separado. Las omisiones no cuentan como pruebas aprobadas.

- Prisma generate/validate 6.4.1, TypeScript, sistema de diseño (111 archivos) y build: aprobados.
- Vitest general: 6.154 pruebas aprobadas en 419 archivos; 422 casos omitidos en 39 archivos, sin acreditarlos como aprobados.
- Integración obligatoria: 40 suites, 436 casos MySQL 8 aprobados, cero omisiones. W01B aporta 32, incluyendo cierre real con crédito de tienda, índice aditivo sobre datos previos, permisos, ausencia de efectos y recuperación HTTP.
- Mutación dirigida: 26/26 mutantes detectados sobre la función completa de validación/formato monetario. Umbral 100% y piso por función incorporados al guard existente; no es cobertura de todo el servicio o repositorio.
- Mutación general configurada: 100% en 67 módulos protegidos; 5.894 mutantes detectados por pruebas, 4 por timeout y 20 ignorados preexistentes. Cero supervivientes o casos sin cobertura. El guard comprueba 14 funciones completas y las fuentes del informe coinciden con el candidato final.

Se reprodujeron y repararon dos bordes del comando directo: normalizar tildes no debe alterar IDs/hashes, y una herramienta que termina pasado el plazo no puede publicar evidencia aunque el temporizador se retrase. Ambos tienen regresión determinista. La mutación agregó rechazo probado de importes numéricos y objetos coercibles; no se aceptan coerciones como dinero verificado.

Vista con componentes reales y datos sintéticos: [escritorio](evidence/nortexgpt/cash-close-investigation-20260912/desktop.png), [móvil](evidence/nortexgpt/cash-close-investigation-20260912/mobile.png) y [referencia expandida](evidence/nortexgpt/cash-close-investigation-20260912/mobile-reference.png). Se comprobó el botón hacia la investigación, el desplegable y ausencia de desbordamiento horizontal en anchos solicitados 1280 y 390. El arnés usa el material `--nx-shell` del panel; no representa una sesión autenticada completa ni dispositivos físicos. Una captura inicial sin ese ancestro no era representativa y se sustituyó. Los recorridos HTTP/MySQL y las pruebas del panel acreditan sus respectivos contratos por separado.

Modularidad: nuevos módulos de producto de 139 líneas (servicio), 8 (parser), 34 (contrato/helper compartido) y 85 (vista). No se extrajo un flujo existente en W01B; servidor permanece en 14.118 líneas y POS en 5.924. El nuevo índice no se aplicó a ningún entorno remoto.

## Qué sigue para completar W01

Los `pendingChecks` se conservan con la investigación privada. Todavía no constituyen excepciones asignadas, recordatorios o aceptación humana. El siguiente incremento necesita un contrato de responsables, evidencia de resolución y versión de revisión; no debe modificar snapshots ni usar “descartar aviso” como conciliación.

La prueba con revisor del negocio y tareas manual/asistente continúa pendiente. Haiku real, ahorro observado, alcance contable profesional, CI remoto, staging y producción no se acreditan con esta entrega local. Se conservan precio objetivo US$20, IA inicial US$2 por negocio y ampliación mediante aprobación de Nortex.
