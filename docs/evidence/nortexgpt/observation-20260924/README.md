# NortexGPT · observación del despliegue existente

Fecha local: 24 de septiembre de 2026 (PDT). Se observó **sólo lectura**
`https://somosnortex.com/api/health`, que sirvió el commit
`dadc81975811850226a6bd7b560a3522068b995a`. El candidato del PR #225
no estaba desplegado.

Entre `2026-09-25T02:16:00.418Z` y `2026-09-25T02:46:00.421Z` se obtuvieron
31 respuestas HTTP 200, separadas por 59,980 a 60,015 segundos. Todas
declararon API sana, MySQL `up`, el SHA esperado, `Cache-Control: no-store`
y uptime sin retrocesos (131.839 a 133.639 segundos). El intervalo entre la
primera y última muestra fue de 1.800,003 segundos; el proceso terminó a
`2026-09-25T02:46:00.644Z` con estado `complete`.

La [captura de las 31 muestras](production-health-dadc819.json) tiene SHA-256
`a0f8521368e39f294bbba85dc73b5d167a525a3f587f872269c033a5e94ae5b3`.
El [script exacto usado](observe-existing-release.mjs) tiene SHA-256
`a3df69fffeb7911d8f8f83a3e3967eddcf6450fcc9b7c2ba4259cf5a3270bd76`.
Fue un script temporal de ejecución local; su import y salida apuntan al
checkout aislado de esa sesión. Cada solicitud pidió no usar caché, rechazó
redirecciones y tuvo timeout de diez segundos. El script guardó el resultado
después de cada muestra y terminaba al primer fallo.

Esto acredita la salud muestreada del despliegue **anterior** durante treinta
minutos. No acredita disponibilidad continua, carga, worker, respaldo remoto,
publicación del manifiesto, funcionamiento autenticado del asistente ni piloto
real. Esas compuertas conservan su evidencia y autorización propias.
