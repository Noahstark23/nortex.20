# Promoción detenida por contrato incorrecto de workflow_run.path

El 2026-09-08 la PR 207 se fusionó en `ca8e31da4d49f85a54817d0000d272cfec85bdc2`. Su árbol de archivos coincidía con el candidato aprobado `09a3b7716c94764d08be5fa7511f31156b5f88d3`; los cuatro jobs del [CI de main](https://github.com/Noahstark23/nortex.20/actions/runs/34290504701) terminaron exitosamente.

El [intento manual de staging](https://github.com/Noahstark23/nortex.20/actions/runs/34290980508) falló en `CI_TERMINAL_SUCCESS_REQUIRED`, antes de acceder al job de despliegue o llamar al webhook. La API REST devolvió `path: .github/workflows/ci.yml`, pero el verificador exigía un prefijo terminado en `@`. El test anterior inspeccionaba ese literal y no ejecutaba la validación con una respuesta representativa del proveedor.

La reparación exige igualdad con la ruta REST exacta en las seis comprobaciones de CI/staging. Conserva identidad del candidato, rama main, evento esperado, conclusión y revalidación tras la aprobación. Las pruebas ejecutan los scripts extraídos del YAML con resultados válidos y negativos; una ruta parecida no puede sustituir al workflow previsto. Referencia: [API oficial de workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).

## Estado de operación

- Producción sigue en `2834497f6090c2d55bcc48d5edb86887f6993ae3`, con API/base sanas. No se aprobó una promoción fallida ni se omitió la compuerta.
- Restauración del respaldo remoto real y actualización aislada del schema, repetida dos veces: aprobadas. Los recursos temporales se eliminaron. El schema de negocio no cambia en esta reparación.
- GitHub exige PR y cuatro checks en main; staging/production están limitados a main, sin bypass administrativo. El usuario designó expresamente Noahstark23 para revisar production; no constituye revisión independiente.
- Identidades HTTPS/UUID, webhooks y tokens separados verificados; Auto Deploy apagado. Al cambiar el candidato hay que renovar ambos pins y repetir CI/staging del SHA final.
- El manifiesto histórico de QA conserva los hashes de su candidato. Los workflows y su test cambian aquí; no afirmar que todos sus archivos permanecen idénticos. La lógica financiera conserva su evidencia, y la promoción exige nuevamente integración del candidato.
- La evidencia operativa saneada y scripts revisados permanecen en el expediente local de release, fuera del repositorio público. No contiene claves ni dumps.

Esta nota registra la reparación y sus condiciones. No acredita staging, producción, calidad de IA o piloto del nuevo candidato; esos estados requieren sus resultados posteriores.
