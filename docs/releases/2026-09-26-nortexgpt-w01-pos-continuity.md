# W01: conservar el carrito al salir durante una revisión guardada

Fecha: 2026-09-26. Candidato aislado basado en GitHub `main` `bd476ebb31aff89074b576ae0cbbd7a43541ef1e`.

## Defecto reproducido

El POS espera 300 ms antes de escribir el carrito en `localStorage`. Al navegar inmediatamente, React desmonta el POS y la limpieza del efecto cancelaba el temporizador. En el recorrido W01 guardado → salir del asistente → agregar un producto → navegar → volver, la línea desaparecía. La nueva prueba de `tests/assistantPanel.test.tsx` falló con el código anterior tanto en el archivo completo como al ejecutarla aislada tras ordenar el escenario para navegar justo después de agregar la línea.

## Reparación

El mismo serializador de carrito se ejecuta al limpiar el efecto y en `pagehide`; el temporizador de 300 ms sigue vigente mientras la pantalla permanece abierta. Se conserva el `shiftId`, la identidad tenant/usuario y la validación de turno existentes. No hay venta, caja, stock ni llamada de IA en este cambio. `POS.tsx` mantiene **5.895 líneas**, igual que su presupuesto vigente.

## Evidencia local

- Recorrido de interfaz en jsdom con el POS real: guardar W01, guardar nota, cerrar NortexGPT, agregar producto, salir del POS, volver y recuperar la nota y la línea. La prueba comprueba que no se llamó a `/api/sales`.
- Evento `pagehide` durante la venta en curso: el carrito queda en su clave privada antes de navegar.
- `mise exec -- sh scripts/ci-local-safe.sh`: salida 0; Prisma generate, TypeScript, **7.130 Vitest aprobadas / 551 omitidas**, sistema de diseño y build.
- `mise exec -- npm run test:integration:required`: salida 0 sobre MySQL 8 descartable; todas las suites requeridas, incluida W01, aprobaron sin omisiones.
- `git diff --check`: salida 0.

La prueba jsdom no sustituye un recorrido en navegador/dispositivo ni un piloto real. Esta reparación no acredita staging o producción ni cambia los flags de NortexGPT.
