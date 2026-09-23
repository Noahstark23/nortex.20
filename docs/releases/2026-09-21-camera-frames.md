# Corrección del lector de cámara — 2026-09-21

## Problema y alcance

El usuario informa que el iPhone 15 Plus abre la cámara pero no reconoce códigos,
ni de cerca ni de lejos. No se atribuye el fallo a la distancia como causa confirmada.

La reproducción local con el adaptador anterior mantiene un video activo al pasar
640 × 480 → 1280 × 720, pero deja de leer un código visible. La superficie de
captura de ZXing conserva las dimensiones iniciales. También se detectó que su
fuente de luminancia rotada conserva ancho/alto anteriores en imágenes rectangulares.
Las pruebas previas de píxeles no ejercitaban esa fuente real del navegador.

`CameraFrameReader` conserva la apertura y reproducción de video de ZXing, pero
actualiza la captura por fotograma, espera dimensiones válidas, rota píxeles con
las dimensiones correctas y termina con error visible si no recibe fotogramas.
La búsqueda de códigos girados/descentrados se habilita mediante TRY_HARDER.
Los errores fatales ya no dejan la pantalla esperando; las lecturas incompletas
siguen intentando. Se solicita resolución HD preferida y enfoque continuo sólo
cuando el dispositivo lo expone. Tras ocho segundos se orienta al usuario sin
cerrar el lector. El cierre/captura cancela callbacks y recursos pendientes.

No cambia schema, API, SKU, catálogo, stock, ventas, auditoría ni permisos.
No modifica NortexGPT. Una captura sigue siendo una sola entrada al flujo existente.

## Reproducción y evidencia local

`tools/barcode-debug` alimenta el adaptador real con un MediaStream de canvas.
El caso de cambio de tamaño pasa de no leer tras cinco segundos con track vivo
a devolver exactamente `7501055363018`. El build minificado también reconoce
la fotografía de envase curvo `8413000065504`, horizontal y vertical sintéticos.
La fotografía proviene del fixture Apache-2.0 de ZXing, con fuente en el README.

Pruebas importan el lector y la fuente de luminancia del producto: redimensión,
espera de fotogramas, terminación por falta de fotogramas, cierre desde callback,
rotación rectangular, lectura, ausencia de duplicados y mensajes tardíos cancelados.
La compuerta local del candidato previo a integración en main aprobó 6333 casos;
407 omitidos no cuentan como aprobados. Prisma, TypeScript, diseño y build pasaron.
CI, staging y producción deben registrarse por SHA aparte.

## Límites y recuperación

El iPhone físico todavía no está validado. Reproducir un mecanismo compatible con
el síntoma no prueba que sea su única causa. La verificación de video sintético y
fotografía en escritorio no acredita foco, permisos o rendimiento del teléfono.

La aplicación anterior es `20fda8dc196b808b0508e53d1253510cacd7096b`.
Un rollback de aplicación no requiere cambios de datos ni schema.
Fuentes técnicas consultadas: código instalado de `@zxing/browser@0.1.5`,
`@zxing/library@0.21.3` y documentación de restricciones de cámara:
https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/width
https://developer.chrome.com/blog/imagecapture

Verificación repetida sobre el checkout limpio basado en producción: 6333 pruebas
aprobadas y 407 omitidas; integración requerida 421 casos/47 suites, cero omitidos;
Prisma, TypeScript, diseño, build y build:seo (71 rutas) aprobados. `npm audit
--omit=dev` informa cero vulnerabilidades. El lockfile no cambia.
