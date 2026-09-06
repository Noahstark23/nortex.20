# Compuerta explícita de producción — 2026-09-04

## Estado

**Parche local preparado; promoción de producción NO-GO.** No se ejecutaron push,
dispatch, aprobación de environment, webhook, cambios remotos ni despliegue para
probar esta reparación. Falta integrar y verificar el candidato completo, publicar
la compuerta mediante una release autorizada y verificar la fijación por SHA
en Coolify. El pin ausente o `HEAD` bloquea ahora el comando previo al webhook;
no depende solo de esta instrucción documental. Los resultados son del control local,
no acreditan producción ni el conjunto de cambios del POS.

La revisión remota del integrador registró staging y producción sanos en
`2834497f6090c2d55bcc48d5edb86887f6993ae3`. También registró:

| Control observado | Estado de la revisión |
| --- | --- |
| `NORTEX_DEPLOY_ENABLED` | `true` |
| Environment `production` | Revisor `Noahstark23`; permite autorrevisión |
| Políticas de ramas del environment | No configuradas |
| Protección de la rama `main` | No configurada |
| Auto deploy y fijación por commit de Coolify | No verificados en esta tarea |

Son observaciones previas del integrador, no una garantía permanente. Volver a
consultarlas al preparar la promoción concreta; este parche no modifica settings.

## Problema y comportamiento resultante

El workflow permitía que un `push` a main, incluido uno solo documental, avanzara
hasta producción tras staging y una aprobación genérica del environment. No había
intención separada ligada al commit. La documentación operativa por sí sola no
evitaba esa ruta.

El candidato conserva `verify`, `integration-required`, `deploy-schema-smoke` y
`backup-restore-smoke` antes de staging. `verify` construye ahora con `build:seo`,
igual que la imagen de producción. No se modificaron umbrales de mutación.

| Evento y condiciones | Resultado permitido |
| --- | --- |
| PR | Verificaciones; no staging ni producción |
| Push a main, incluso solo documentación | Verificaciones y staging; producción omitida |
| Dispatch con valores por defecto | Verificaciones y staging; producción omitida |
| Dispatch sin aprobación explícita | Producción omitida aunque el SHA coincida |
| Dispatch con SHA diferente al del workflow | Producción omitida |
| Dispatch en otra rama | Sin producción |
| Dispatch en main, aprobación explícita y SHA completo coincidente | Puede solicitar aprobación del environment; no dispara aún el webhook |
| Tras aprobación: staging caído, SHA distinto, main avanzó o consulta falló | Compuerta cerrada; webhook no ejecutado |
| Tras aprobación: staging y main coinciden, pero falta token/pin de Coolify o auto deploy no está desactivado | Compuerta cerrada; webhook no ejecutado |
| Tras aprobación: staging/main coinciden, la API confirma UUID, pin Git exacto, Dockerfile y auto deploy desactivado | Continúa al webhook y a la verificación final de salud/SHA |

Los inputs son `production_approved` booleano, predeterminado `false`, y
`production_sha` string, predeterminado vacío. En GitHub, la aprobación del
environment sigue siendo una etapa adicional. La intención debe venir de una
autorización humana concreta; un agente no debe rellenarla por una aprobación de
merge o staging. [Sintaxis oficial de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Después de la aprobación, `scripts/authorize-production-release.mjs` exige SHA
hexadecimal de 40 caracteres, evento manual y main; comprueba staging con un
intento HTTP acotado y consulta `git ls-remote origin refs/heads/main`. Finalmente,
`verify-coolify-production-target.mjs` comprueba el destino de Coolify por GET.
Solo luego puede ejecutarse el paso del webhook. Errores y respuestas ambiguas fallan;
el helper no imprime inputs, credenciales ni URLs privadas. Los inputs viajan por
variables de entorno, nunca interpolados como instrucciones shell.

## Comprobación de Coolify antes del webhook

El helper exige `COOLIFY_TOKEN` y un `COOLIFY_PROD_WEBHOOK` HTTPS cuya ruta sea
`/api/v1/deploy`, con un único `uuid` y, opcionalmente, `force=true|false`. Rechaza
tags, listas, UUID duplicados, parámetros desconocidos, PRs, credenciales en URL,
fragmentos y rutas alternativas. Deriva del mismo origen una sola lectura
`GET /api/v1/applications/{uuid}` con token Bearer, sin redirecciones y timeout de
cinco segundos. No ejecuta PATCH ni toca `/deploy` durante la comprobación.
[API de despliegue](https://coolify.io/docs/api-reference/api/deployments/deploy-by-tag-or-uuid).

La respuesta debe identificar ese UUID, declarar `git_commit_sha` exactamente igual
al SHA autorizado, `build_pack=dockerfile` y
`settings.is_auto_deploy_enabled === false`. No acepta equivalentes como `0`,
`"false"`, un campo omitido o `HEAD`. La referencia GET documenta `git_commit_sha`;
el controlador oficial carga la relación `settings` al consultar por UUID. Si la
versión instalada omite esa relación, el gate falla hasta verificar un contrato
compatible; no se supone auto deploy apagado por ausencia del campo.
[GET de aplicación](https://coolify.io/docs/api-reference/api/applications/get-application-by-uuid),
[controlador oficial](https://github.com/coollabsio/coolify/blob/main/app/Http/Controllers/Api/ApplicationsController.php).

La respuesta completa no se escribe en logs, archivos ni artifacts: puede contener
secretos. El paso de despliegue también exige token y descarta el cuerpo recibido;
los fallos muestran mensajes controlados sin exponer URL, token o cuerpo.

## Evidencia local

Comando con Node 22.23.2:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/productionReleaseGate.test.ts \
  tests/productionWorkflowGate.test.ts \
  tests/coolifyProductionTarget.test.ts \
  tests/qualityGateWiring.test.ts
```

Resultado: **113/113 pruebas aprobadas**, cuatro archivos, cero omitidas.
TypeScript específico de estos cuatro archivos también aprobado.

- 36 escenarios de intención, formato SHA, errores de red, salud/SHA de staging,
  main cambiado, respuesta git ambigua, orden de verificación y rechazo del CLI.
- 18 pruebas del YAML parseado: grafo obligatorio, defaults, environment, orden
  real antes del webhook, ausencia de vías alternativas y claves duplicadas.
  Incluyen 15 alteraciones negativas del workflow: permitir push, quitar aprobación,
  desligar SHA, activar por defecto, saltar staging/integración/environment,
  ignorar/saltar/eliminar el helper, hardcodear SHA, quitar token, cambiar destino,
  imprimir respuesta sensible o agregar otro webhook.
- 57 escenarios del destino Coolify: URL ambigua, UUID/lista/tag/PR, ausencia de
  token, GET exclusivo, redirección rechazada, errores HTTP/JSON, aplicación distinta,
  pin `HEAD`/rama/SHA incorrecto, auto deploy ausente o activo, pipeline distinto,
  CLI cerrado y ausencia de secretos en salida. Usan respuestas sintéticas; no
  se llamó la infraestructura de Nortex.
- Dos pruebas previas conservadas que exigen integración real antes de staging.

Se añadió `yaml@2.9.0` como dependencia de desarrollo exacta para inspeccionar el
YAML real, incluyendo rechazo de claves duplicadas. No se usa en el runtime de la
compuerta y se elimina de la imagen mediante `npm prune --omit=dev`.

## Alcance contable de mutación

La corrida previa mostró 100% pero el guardián rechazó `accounting: 199 < 212`.
Se comparó `2834497f6090c2d55bcc48d5edb86887f6993ae3` con el candidato usando
el instrumentador instalado, Stryker 9.6.1, y declaraciones completas del AST:

| Función | Main | Candidato previo a ampliar caja |
| --- | ---: | ---: |
| `canonicalJournalAccountLockOrder` | 7 | 7 |
| `buildSaleJournalLines` | 41 | 40 |
| `buildPaymentJournalLines` | 31 | 25 |
| `buildSupplierPaymentJournalLines` | 12 | 12 |
| `buildPurchaseJournalLines` | 64 | 64 |
| `returnMoney` | 10 | 10 |
| `buildReturnJournalLines` | 47 | 41 |
| Total | 212 | 199 |

Restaurar individualmente, solo en memoria, el selector anterior de venta produjo
200 mutantes; el de abonos, 205; el de devoluciones, 205. Las diferencias
**1 + 6 + 6 = 13** proceden de expresiones eliminadas al usar `settledPaymentAccount`,
que tiene 11 mutantes propios. La fuente contable del reporte era idéntica al
candidato; su SHA-256 es
`5cd52ebb2eb43181eec946e142ee896d1b609999cb1491c6ea96659679e9e8b0`.
No se compensó esa reducción sin revisar los cuerpos completos.

Se amplió explícitamente el alcance a `cashMovementJournalLines` (750–786), que
determina el asiento original de movimientos manuales: capital, gasto, pago a
proveedor y retiro. Sus pruebas comprueban cuentas e importes exactos y categorías
que no deben crear otro asiento. **33/33 mutantes nuevos killed**. El piso de
archivo sube de 212 a **232**, junto con pisos independientes por función.

La guardia AST exige firma y cuerpo completos en `mutate`, código del reporte
idéntico al archivo actual, declaración única y el piso propio de cada función.
Rechaza una función recortada aunque otras eleven el total, fuentes viejas,
rangos inválidos, exclusiones y mutantes ignorados/no compilables dentro de estas
funciones. Sus pruebas usan fixtures sintéticos, por lo que también pueden
ejecutarse durante el dry-run de Stryker sin comparar código instrumentado.

Verificación local: **42 pruebas aprobadas** entre `mutationFunctionScope` y
`cashMovementJournalLines`. Corrida dirigida de las cuatro fuentes protegidas:
**252/252 killed**, cero survived, timeout, NoCoverage, errores o ignores:
accounting 232, paymentAccounts 11, payload canónico de cierre 8 y moneyUsd 1.
El cierre quedó realineado a **833–845**. `moneyUsd` completo produce exactamente
un mutante ArrowFunction con esta versión de Stryker; su piso medido es 1 y su
declaración queda protegida por AST. No se eleva a un número ficticio.

El umbral global sigue en **100**. La corrida dirigida prueba este alcance;
**falta la corrida global final del candidato integrado** y las demás compuertas
de promoción. Los artifacts locales de esta medición están en
`work/cash-movement-mutation/` (config, log y reportes JSON/HTML).

## Límite de promoción pendiente

La cancelación por concurrencia, la consulta a main y la exigencia de pin Git
evitan autorizar desde este workflow una aplicación que siga la rama/`HEAD`.
**Aún no se probó el despliegue real**. Un cambio administrativo concurrente del pin
en Coolify podría invalidar la lectura previa; debe mantenerse la configuración
durante la promoción y comprobarse el SHA servido al terminar. No se sustituyó el
transporte por una imagen identificada mediante digest ni se modificó Coolify.

Antes de autorizar producción:

1. Con autorización para el candidato, fijar `git_commit_sha` al SHA completo y
   desactivar auto deploy en la aplicación correcta, sin despliegue instantáneo.
   Verificar por API la configuración y el comportamiento de pin en la versión
   instalada. La compuerta hace solo GET y nunca corrige estos valores automáticamente.
2. Confirmar auto deploy apagado y revisar protecciones reales de rama/environment;
   no declarar resuelto un control remoto por modificar YAML o Markdown.
3. Exigir CI y staging del candidato exacto, respaldo real restaurable y smoke
   autenticado de las operaciones financieras afectadas.
4. Obtener autorización explícita para ese SHA; tras promover, verificar salud,
   base, versión y operaciones y completar la observación de 30 minutos.

La publicación de este cambio puede desplegar staging al llegar a main, por el
contrato vigente. El nuevo workflow no debe solicitar producción en un push. La
reparación local no revoca ejecuciones antiguas ya pendientes ni reemplaza las
protecciones de infraestructura; deben inspeccionarse en la promoción autorizada.

## Documentación operativa reconciliada

La skill `nortex-deploy` refleja ahora `npm ci`, `build:seo`, poda de dependencias y
el entrypoint real con preflights. Se retiró la afirmación de que la instancia
anterior necesariamente sigue sirviendo ante un fallo de schema. La protección
frente a DDL destructivo y la disponibilidad son propiedades distintas.
