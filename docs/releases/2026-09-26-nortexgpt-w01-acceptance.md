# NortexGPT W01: aceptación exacta del informe

Fecha: 2026-09-26. Continúa el candidato aislado de [vista previa W01](2026-09-26-nortexgpt-w01-report-contract.md), commit base `6c63e911af0d2de09b981bb07611e030781f5866`. El checkout original conserva su trabajo.

## Contrato implementado

`POST /api/assistant/work-items/:id/accept` recibe UUID, versión del encargo y SHA-256 del informe visto. La identidad procede del JWT. El servidor bloquea el encargo, vuelve a comprobar usuario, rol, permiso, vigencia y fuente, reconstruye el informe y exige que el hash coincida. Sólo acepta un encargo `IN_REVIEW` con historial completo. Un evento `ACCEPT_REPORT` y el comprobante (`acceptedAt`, actor, versión, hash y UUID) se guardan en la misma transacción mediante CAS. El mismo UUID y contenido recupera el comprobante; otro UUID o contenido no duplica la decisión.

El estado `ACCEPTED` conserva el informe reconstruible por su fuente y eventos anteriores; su hash se verifica en cada lectura. La interfaz requiere una marca explícita de revisión, muestra **aceptado con excepciones** cuando las hay, y conserva UUID/hash si la respuesta queda incierta. La aceptación no modifica turnos, efectivo, asientos, inventario ni consumo de IA. Una nota humana no convierte una causa en comprobada; este lote no declara «conciliado».

Las cinco columnas nuevas de `AssistantWorkItem` son opcionales. El SQL espejo está en `backend/prisma/migrations/20260926010000_assistant_work_report_acceptance/migration.sql`; el arranque vigente usa `db push`, no ejecuta ese archivo. Un rollback de aplicación debe conservar esas columnas. No se agregaron índices porque ninguna consulta nueva filtra u ordena por ellas.

## Evidencia local

- Prisma 6.4.1 `validate` y `generate` con URL dummy: aprobados.
- Pruebas focalizadas de ruta, servicio e interfaz: 75 aprobadas; TypeScript aprobó.
- MySQL 8 efímero: `npm run test:integration:required` aprobó **52 suites, 565 casos, cero omitidos**. La suite W01 pasó 6 casos: upgrade de tabla poblada y estado parcial con `db push` repetido, concurrencia, hash exacto, replay del comprobante, identidad/revocación/fuente y cero escrituras de caja/IA. Un segundo proceso backend recuperó por HTTP la nota y el hash aceptado desde la misma base, sin nueva llamada ni gasto de IA.
- `mise exec -- sh scripts/ci-local-safe.sh` en el candidato con prueba entre procesos: Prisma generate, TypeScript, Vitest (7 122 aprobadas, 551 omitidas), diseño y build pasaron. Las omitidas se verificaron por la compuerta MySQL obligatoria cuando aplicaba.
- CI remoto, staging, restauración real y navegador físico: pendientes de su propia evidencia.

La prueba de upgrade se ejecutó sólo sobre la base descartable. Antes de cualquier promoción con schema siguen siendo necesarios un respaldo off-site reciente y un restore drill vigente de la base real, CI y staging del mismo SHA y autorización separada de producción. La lectura desde otro proceso acredita persistencia entre procesos, pero no una interrupción del backend original ni la recuperación operativa después de un crash. El trabajo W01 aún requiere navegación con carrito y evaluación humana/modelo/piloto.
