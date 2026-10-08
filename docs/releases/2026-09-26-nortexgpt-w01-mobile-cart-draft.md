# W01 móvil: conservar el carrito antes de abrir caja

Fecha: 2026-09-26. Candidato aislado basado en GitHub `main` `bd476ebb31aff89074b576ae0cbbd7a43541ef1e`.

## Defecto y reparación

En navegador a 390 × 844 px, un negocio sintético recién registrado podía agregar un producto con la caja cerrada. Al salir del POS con Atrás y volver, el carrito aparecía vacío. La persistencia exigía `shiftId` aun cuando la interfaz permitía armar la venta antes de abrir caja.

La clave privada por tenant y usuario ahora conserva un borrador v2 con `shiftId: null`. Sólo se restaura automáticamente si sigue sin caja y tiene hasta 12 horas. Si se abrió un turno, se ofrece recuperación explícita; la persona decide antes de atribuir las líneas a esa caja. Un carrito de otro turno permanece guardado mientras espera esa decisión, y no se pueden agregar líneas nuevas que lo pisen. Los payloads v1 sin turno siguen siendo inválidos. Cobrar continúa exigiendo un turno real y no se generó venta durante esta prueba.

`POS.tsx` conserva 5.895 líneas, igual que su presupuesto; no se amplió la excepción. Se preservan identidad local, validación de turno, serialización de líneas y protección contra reguardar una venta cobrada. No cambia schema ni las rutas de caja, stock o ventas.

## Evidencia

- Prueba nueva de POS: falló antes del arreglo por clave ausente y pasó después, verificando línea recuperada y ningún POST de venta.
- Prueba nueva de carrito de otro turno: falló tras el debounce por borrado de la clave; después comprobó que espera intacto, bloquea otra adición y sólo al pulsar **Recuperar** queda como borrador sin turno.
- Navegador real, build local, backend y MySQL 8 descartables: a 390 × 844 px se creó un producto sintético de C$25, se salió del POS sin abrir caja ni cobrar y se volvió; la línea y el total seguían presentes. El entorno temporal se apagó.
- `scripts/ci-local-safe.sh`: salida 0; Prisma generate, TypeScript, 7.133 pruebas aprobadas y 551 omitidas, sistema de diseño y build.
- `npm run test:integration:required`: salida 0; todas las suites obligatorias en MySQL 8 efímero, sin casos omitidos. Las 551 omisiones del conjunto rápido no cuentan como aprobadas.
- `git diff --check`: salida 0 antes de cerrar el candidato.

Quedan pendientes prueba en dispositivo físico, evaluación humana del trabajo W01, modelo real y piloto, CI remoto, staging y promoción autorizada. Esta prueba no confirma una venta ni resultados en clientes.
