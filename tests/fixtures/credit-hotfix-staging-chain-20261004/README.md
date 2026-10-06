# Procedencia de fixtures

Los ZIP son los bytes originales de los artifacts `credit-hotfix-staging-health`
descargados mediante GET del API de GitHub el 5 de octubre de 2026. No contienen
credenciales ni datos de negocio: sólo identidades y enlaces de release.

| Run, intento 1 | Artifact ID | SHA-256 del ZIP |
|---|---|---|
| 37164392068 | 11289156496 | 294a29adf1b194782df36831070e2e18b69448bcad83c5b34b5fa2a35c91bef7 |
| 37165601168 | 11288967947 | fc0b06f315cc7092a84f8c6546a16b4574af05794f79c4f3626c52106a48bb54 |
| 37166458396 | 11289344736 | 9a2eb61ffc425a83a59bf5e6b12d88bcc71790e1ed47dd9327db8a1c01fa1f02 |

`provenance.json` conserva campos seleccionados de
`actions/runs/{run}/attempts/1`, `actions/runs/{run}/attempts/1/jobs` y
`actions/runs/{run}/artifacts`, repositorio `Noahstark23/nortex.20`.
Sólo se conserva el job `deploy-staging` y el artifact de salud.
Las pruebas usan copias en memoria para adulteraciones. No consultan red ni
representan un despliegue nuevo. En ejecución real el controlador vuelve a leer
los metadatos, descarga los artifacts y verifica sus bytes; no usa estos fixtures.

`active-manifest.json` conserva los bytes del manifiesto antes de su cierre el
2026-10-06. Sólo las suites históricas lo sustituyen en memoria al leer la ruta
canónica; no se escribe sobre el manifiesto real ni se habilita la excepción.
`creditHotfixClosed.test.ts` usa el manifiesto real y prueba el rechazo antes de red.
