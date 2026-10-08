# NortexGPT · preflight del evaluador sin proveedor

Fecha: 2026-09-23. El lanzador se probó con una clave **sintética** en un
servicio separado del llavero real de macOS. La prueba no leyó la credencial
del proveedor, no llamó a Haiku y no gastó presupuesto.

`nortexgpt-launcher-selftest.mjs` aprobó 21/21 comprobaciones: propagación al
proceso hijo, ausencia del valor sintético en las salidas y archivos permitidos,
retirada de la clave de prueba y fallo cerrado cuando falta. El método de
guardado observado fue `stdin`; el informe privado está en
`/private/tmp/nortexgpt-activation.fHY9Xs/launcher-selftest-20260923.json`.
La primera ejecución dentro del sandbox no pudo escribir en el llavero; la
repetición con acceso autorizado pasó. El resultado no certifica que el
entorno de un proceso sea secreto para otros procesos del mismo usuario.

El CLI de evaluación pagada también se invocó con el formulario de ferretería
actual (`expectedOutcomesReviewed: false`). Rechazó el lote antes de leer una
sesión o abrir una conexión y no creó informe de consulta. Esta negativa es
correcta: los expected y los doce textos de ayuda esperan revisión humana.

Quedan pendientes la credencial de proveedor disponible en el entorno QA,
la revisión de contenido/expected, una respuesta real, la atribución de
consumo por `runId` y el juicio humano de calidad. Ninguna cuenta real quedó
activada por este preflight.
