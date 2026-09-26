# NortexGPT W01: persistencia en MySQL real

Fecha: 2026-09-26. Candidato aislado desde `main` `a7bcca71e83b25d6254e7a095d7b52f44db7a179`. El checkout original permanece intacto.

## Brecha cubierta

`tests/assistantWorkItems.test.ts` verificaba la continuidad con un doble de base de datos. Ninguna suite MySQL registrada ejecutaba los endpoints de `AssistantWorkItem` y `AssistantWorkEvent`. Esta entrega registra `tests/assistantWorkItems.integration.test.ts` como suite obligatoria, de modo que una falla u omisión bloquea la compuerta.

La suite usa exclusivamente MySQL 8 descartable y el backend HTTP local del wrapper `scripts/qa-integration-required.sh`. Verifica creación concurrente de un único encargo y evento, nota y reintento con el mismo UUID, rechazo de reutilizar ese UUID con otro contenido, recuperación por GET y lista, identidad de otro negocio, cambio de rol, invalidez de la fuente original, limpieza de item/eventos y conservación del run. Comprueba que el recorrido no crea turnos, movimientos, asientos, auditoría ni consumo de IA.

## Evidencia ejecutada

- `mise exec -- npx tsc --noEmit`: aprobado.
- Registro de suites y `tests/requiredIntegrationGate.test.ts`: aprobados.
- `npm run test:integration:required`: **52 suites, 561 casos aprobados, cero omitidos**; la nueva suite aportó 2 casos. La base se creó en contenedor efímero y se eliminó al terminar.
- `mise exec -- sh scripts/ci-local-safe.sh`: Prisma generate, TypeScript, Vitest (7 112 aprobadas, 547 omitidas), diseño y build pasaron. Las omitidas son suites de integración y no se cuentan como aprobadas por esta compuerta rápida.

La prueba inicial esperaba 403 tras cambiar el rol de un usuario. El transporte real deriva el rol vigente de la base y devuelve 404 para ese encargo privado; se corrigió la expectativa al contrato observado. No se cambió el servicio para adaptar el resultado.

## Alcance pendiente

La recuperación se probó en solicitudes HTTP separadas al mismo backend, no tras reiniciar ese proceso. La suite no implementa informe versionado, aceptación exacta ni experiencia móvil/escritorio de A02.W01.3–4; tampoco acredita calidad del modelo, piloto o despliegue. Esas compuertas siguen abiertas.
