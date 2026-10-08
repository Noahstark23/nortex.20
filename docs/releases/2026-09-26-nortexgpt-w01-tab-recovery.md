# W01: recuperar una revisión interrumpida en la misma pestaña

Fecha: 2026-09-26. Candidato aislado para el PR borrador #230.

## Defecto y contrato

Al desmontar NortexGPT o recargar la página se perdían la nota sin enviar y el UUID/hash de un evento o aceptación con respuesta incierta. Una prueba de desmontaje y montaje reprodujo la pérdida de la revisión seleccionada.

La pestaña conserva en `sessionStorage` sólo la referencia del encargo, la nota y la identidad/cuerpo de los intentos pendientes, aislados por tenant, usuario y alcance de permisos. No guarda el JWT ni el informe de caja. Al volver consulta el servidor por GET y reconcilia el comprobante o evento con la misma identidad; nunca reenvía un POST automáticamente. Antes de enviar un evento o una aceptación persiste su identidad de forma comprobada. Si la recuperación está corrupta o el almacenamiento falla, bloquea nuevas escrituras y permite consultas de solo lectura. Un 401/403 conserva la nota en la pestaña y exige volver a comprobar la sesión. La nota y el intento de otra cuenta quedan separados.

## Evidencia local

- Prueba roja previa: la revisión seleccionada desaparecía tras desmontar y montar el hook.
- 63 casos focalizados aprobados: nota tras remontar, UUID/cuerpo idénticos en reintento manual, aceptación ya aplicada descubierta por GET, separación entre cuentas, 401 y almacenamiento corrupto sin POST.
- `mise exec -- sh scripts/ci-local-safe.sh`: Prisma generate, TypeScript, **7.148 aprobadas / 557 omitidas**, sistema de diseño y build. Registro: `fast-w01-tab-recovery-final.log` en el handoff local.
- Una ejecución integral previa descubrió una carrera de la prueba de checkbox al cargar el encargo. Se corrigió la espera de disponibilidad del control; el recorrido integral final pasó.

La recuperación del navegador no acredita staging, dispositivo físico ni piloto. La aceptación humana y la evaluación A07 siguen pendientes.
