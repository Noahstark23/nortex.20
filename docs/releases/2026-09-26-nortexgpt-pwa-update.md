# NortexGPT: actualización del panel PWA

Fecha: 2026-09-26. Candidato aislado: `nortexgpt-pwa-update-20260926`, base `a7bcca71e83b25d6254e7a095d7b52f44db7a179`. El checkout original y sus cambios permanecen intactos.

## Defecto observado

Tras la promoción del SHA base, `/admin` en Chrome seguía ejecutando `index-CYIgXKeU.js` y no mostraba el panel «Pilotos de NortexGPT». El HTML servido por la red referenciaba `index-ByBOyfJd.js`, y el bundle `SuperAdmin-Bd1yq1FP.js` publicado sí incluía el panel. Recargar la pestaña, incluso sin caché, no cambió el bundle observado. `/sw.js` respondía con `Cache-Control: public, max-age=14400` y `cf-cache-status: REVALIDATED`. El panel mostró además «La sesión cambió»; no se inspeccionó ni modificó ninguna cuenta piloto.

La diferencia entre el bundle de red y el ejecutado es evidencia de una versión PWA antigua en esa pestaña. Las cabeceras del service worker pueden retrasar su actualización; todavía no está acreditado qué regla de Cloudflare las fijó ni que este parche la supere.

## Reparación local

`backend/middleware/pwaEntrypointCache.ts` fija `no-store` para `sw.js` y `registerSW.js`, tanto en navegador como en CDN. `backend/productionFrontend.ts` conserva la composición de landing, HTML prerenderizado, SPA y assets con hash; `backend/server.ts` sólo registra ese módulo. No se cambiaron permisos, sesiones, dinero, inventario ni flags del asistente.

Antes de la extracción se caracterizaron por HTTP las rutas publicadas: `/` landing, `/admin` SPA, `/ferreterias` HTML, `/assets/index-ByBOyfJd.js` con un año de caché y `/api/nonexistent-qa` con 404. La prueba local posterior reproduce esos contratos con archivos sintéticos. El presupuesto de `server.ts` baja de 13 027 a 12 991 líneas (−36); los dos módulos destino suman 43 líneas, de modo que el conjunto afectado crece 7. El trinquete se redujo al nuevo tamaño.

Prueba antes del cambio: `tests/pwaEntrypointCache.test.ts` fallaba al faltar la política; la caracterización del frontend publicado mostró el contrato de rutas existente. Después: las pruebas focalizadas de caché, rutas y presupuesto pasaron 4/4. La prueba sirve los archivos por Express; no prueba la configuración externa de Cloudflare.

Compuerta local final: `mise exec -- sh scripts/ci-local-safe.sh` terminó con salida 0. Prisma generate, TypeScript, Vitest (7 114 aprobadas, 545 omitidas), sistema de diseño y build PWA pasaron. Las pruebas omitidas no acreditan comportamiento. No se ejecutó la integración MySQL porque este cambio no modifica dinero, inventario ni esquema.

## Condición para cerrar el defecto

Tras CI y una promoción autorizada del mismo SHA, comprobar `Cache-Control: no-store` y `cf-cache-status` de `/sw.js` y `/registerSW.js` desde la red, y verificar en una sesión real que una pestaña con el PWA anterior recibe el bundle nuevo sin borrar datos ni perder trabajo. Si Cloudflare mantiene `max-age=14400`, corregir su Cache Rule para estas dos rutas y repetir la prueba. La promoción y la activación del piloto son compuertas separadas.
