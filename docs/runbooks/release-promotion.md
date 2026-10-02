# Runbook canónico — staging y promoción a producción

> **Regla vinculante.** Este documento define las únicas rutas de staging y
> producción de Nortex. CI verde, un merge, staging sano, una aprobación de PR o
> la aprobación técnica de un environment son señales distintas; ninguna sustituye
> la autorización explícita del producto para producción.
>
> **Excepción de fundador único (2026-09-25).** El dueño confirmó que no dispone
> de otra persona para aprobar el environment. `Noahstark23` puede iniciar y
> aprobar la promoción, pero esa aprobación **no es independiente**. Se exige
> una aceptación escrita del riesgo para el SHA y alcance concretos, dos cadenas
> exactas en el dispatch, CI y staging manual sanos para el mismo SHA, pin de
> Coolify, aprobación del environment sin bypass, salud y observación posterior.
> Esta excepción de proceso no autoriza desplegar ningún SHA por sí sola.
>
> Este runbook tampoco configura proveedores externos. Las variables, UUIDs, tokens
> y apps reales de Coolify se habilitan solo con autorización externa separada; su
> ausencia o identidad no comprobada bloquea la promoción.

## Cuándo usarlo

Usalo para cualquier candidato que pueda alcanzar producción, incluidas correcciones
urgentes y cambios exclusivamente documentales. Los informes dentro de
`docs/releases/` son evidencia histórica: no son instrucciones ejecutables. Para
una auditoría de frontend, complementá este procedimiento con el
[runbook de preproducción](frontend-preprod-audit.md).

La preparación local del 2026-09-19 y la última observación remota constan en
[el expediente NortexGPT](../NORTEXGPT_PREPARACION_DEPLOY_2026-09-19.md). Sus SHAs
son una fotografía fechada, no valores para copiar en una promoción futura.
Preparar el expediente no autoriza ejecutar staging ni producción.

## El contrato que evita una promoción accidental

El incidente que motivó este cambio permitió que un push a `main`, incluso uno de
solo documentación, creara un job de producción dentro de `ci.yml`. Eso era un
defecto de control: la posibilidad de aprobar un environment no era una autorización
de producto y un candidato de documentación no debía tener ruta a producción.

Después de esta reparación, las rutas son deliberadamente separadas:

| Etapa | Mecanismo | Qué prueba | Qué no autoriza |
|---|---|---|---|
| CI | `ci.yml` sobre el SHA candidato | Tests, build, schema smoke e integración aislada obligatoria | Staging ni producción |
| Staging | `.github/workflows/release-staging.yml`, solo manual | Procedencia manual, destino Coolify validado y API/base/SHA exactos de staging | Producción ni el smoke funcional |
| Decisión de producto | Registro humano explícito | Que el responsable acepta alcance, SHA, ventana y rollback | Ejecutar un deployment por sí sola |
| Producción | `.github/workflows/release-production.yml`, solo manual | Que el mismo SHA vigente de `main`, un staging manual exitoso y su salud siguen siendo el candidato | Una autorización futura o un SHA distinto |
| Environment `production` | Protección técnica dentro del workflow manual | Confirmación deliberada antes de acceder a secretos; en modo fundador único puede ser la misma persona | Autorización de producto por inferencia o revisión independiente inexistente |

`ci.yml` solo verifica código: no puede invocar ningún webhook ni crear jobs de
staging o producción, ni siquiera con `workflow_dispatch`. El único workflow con
webhook o secretos de staging es `release-staging.yml`; el único con webhook o
secretos de producción es `release-production.yml`. Ninguno se activa por
`push`, PR ni merge.

La mutación de lógica monetaria es una compuerta adicional y explícita: solo se
ejecuta en un `workflow_dispatch` de CI cuando `NORTEX_CI_MUTATION=true`. No se
usa para acreditar cambios visuales, documentación o workflow; cuando cambia
lógica monetaria pura, el responsable debe pedirla y registrar su resultado por
separado. Un timeout o una ejecución cancelada nunca se presenta como verde.

## Ejecutar staging manual

Antes de usar staging, identificá un SHA completo de 40 caracteres que sea el tip
vigente de `main` y que ya tenga CI terminal para ese mismo SHA. Un SHA abreviado,
una rama, un tag mutable o “el último” no son candidatos aceptables.

Un responsable inicia **Promote staging candidate** en GitHub Actions, selecciona la
rama `main` e introduce:

| Campo | Valor aceptado |
|---|---|
| `candidate_sha` | El SHA completo de 40 caracteres, actual en `main` y con CI terminal |
| `confirmation` | Exactamente `STAGE <candidate_sha>` |

El preflight falla cerrado si el evento no es manual, la rama no es `main`, el SHA
no coincide con `GITHUB_SHA` ni con `origin/main`, la confirmación no es exacta
o `NORTEX_DEPLOY_ENABLED` no vale `true`. Después de la aprobación técnica del
environment `staging`, el job repite esas comparaciones antes de leer el webhook.
Si `main` avanzó mientras se esperaba la aprobación, no se llama a Coolify.

El checkout, el health y la evidencia se fijan al `candidate_sha` introducido; un
webhook aceptado no prueba el despliegue. El run solo queda sano cuando staging
responde con API y base disponibles para ese SHA exacto. Una aprobación de staging
no autoriza producción ni sustituye el smoke con tenant sintético ni la autorización
explícita descrita abajo. El smoke funcional es una compuerta separada y proporcional
al riesgo, realizada sin datos de clientes.

## Contrato de identidad Coolify (falla cerrada)

Antes de llamar un webhook, el workflow valida por separado el destino de cada
environment. La URL pública y el webhook no se aceptan como una identidad implícita:
la lectura de Coolify se construye solo desde el origen API confiable y el UUID
configurados para ese environment.

| Elemento por environment | Requisito que falla cerrada |
|---|---|
| Origen de API | `COOLIFY_STAGING_API_ORIGIN` o `COOLIFY_PROD_API_ORIGIN`: origen HTTPS raíz exacto, sin ruta, credenciales, query, fragmento ni espacios. |
| Aplicación | `COOLIFY_*_APPLICATION_UUID`: UUID exacto de la única app que puede consultarse. |
| Lectura | `COOLIFY_*_READ_TOKEN`: secreto de solo lectura y mínimo alcance, guardado únicamente en su environment; nunca es un token de deploy ni llega a CI u otro environment. |
| Webhook | `COOLIFY_*_WEBHOOK`: HTTPS en el mismo origen API, ruta `/api/v1/deploy` y query con el mismo `uuid`; solo se admite `force=true|false` adicional. Es una capacidad de escritura, no una fuente de identidad. |
| Respuesta de Coolify | La app devuelta debe tener ese UUID, `git_commit_sha` igual al candidato, build desde Git (`dockerfile` o `dockercompose`) y Auto Deploy explícitamente apagado. |

La falta, URL ambigua, token ausente o cualquier desacuerdo entre esos elementos
detiene el run antes del webhook. El workflow nunca escribe el pin de Coolify ni
intenta adivinar la app correcta.

**Compatibilidad comprobada el 2026-09-08:** Coolify 4.1.2 no carga la relación
`settings` en `GET /applications/{uuid}`. Su interfaz puede mostrar Auto Deploy
apagado mientras la API omite el campo; eso bloquea correctamente esta compuerta.
No aceptar `undefined`, `null`, `0` o cadenas como `false`, ni ampliar el token a
`read:sensitive`. Comprobar una versión del proveedor que exponga el booleano
antes de promover. La fuente de 4.3.18 sí carga `settings`. Posteriormente se ejecutó esa
actualización y las guardas de staging y producción pasaron; el [expediente
de producción](../releases/2026-09-08-production-verification.md) separa respaldo,
ensayos y observación. Revalidar la instancia en cada release; la versión por sí
sola no acredita configuración ni salud.

Los webhooks se invocan mediante **POST**, con y sin bearer. Coolify 4.1.2 admite
ese método y las versiones nuevas rechazan el GET que cambiaba estado. Un fallo
o timeout no provoca reintentos automáticos: consultar la operación antes de
volver a solicitar despliegue. [Compatibilidad y recuperación del panel](../releases/2026-09-08-coolify-compatibility.md).

`STAGING_URL` y `PROD_URL` son además orígenes públicos HTTPS raíz, sin
credenciales, query ni fragmento. El verificador de salud rechaza redirecciones y
solo acepta API/base sanas con el SHA esperado y una respuesta que incluya
`Cache-Control: no-store`; solicitar `no-cache` no compensa una respuesta almacenada.

**Registro externo:** la presencia del contrato en Git no acredita configuración
real. El estado observado se conserva en `docs/ESTADO_ACTUAL_NORTEX.md` y el
expediente del candidato. Revalidar variables, UUID, token, relación URL↔app y pin
antes de cada promoción. Tokens separados en GitHub no implican ACL por app en
Coolify: si el proveedor los limita al equipo, registrar ese alcance y mantener la
validación del UUID; no atribuir aislamiento por aplicación que el token no ofrece.
La identidad pública no comprobada sigue bloqueando el webhook.

## Requisitos antes de solicitar producción

1. Identificá un SHA candidato completo de 40 caracteres que ya esté en `main`.
   Un SHA abreviado, una rama, un tag mutable o "el último" no son candidatos
   aceptables.
2. Conservá evidencia del CI terminal de ese mismo SHA y del estado limpio que se
   revisó. Si el alcance toca dinero, inventario, identidad o schema, aplicá las
   compuertas adicionales de `AGENTS.md` y `CLAUDE.md`.
3. Verificá la procedencia de un run manual exitoso de `release-staging.yml` para
   exactamente ese SHA, que staging sirve API y base sanas y que su health fresco
   trae ese SHA y `Cache-Control: no-store`. Ejecutá por separado el smoke
   proporcional al riesgo con tenant sintético cuando corresponda. Un `503`
   transitorio, un health sin SHA, una política de caché ausente, un SHA diferente,
   una procedencia manual ausente o un smoke omitido detienen el proceso.
4. Registrá una autorización explícita de producto independiente de GitHub, por
   ejemplo:

   ```text
   AUTORIZO PRODUCCIÓN: SHA <sha-completo>; alcance <resumen>; ventana <fecha/hora>;
   rollback <referencia>; responsable <nombre>.
   ```

   “Aprobado”, la aprobación de un PR, una demostración local, CI verde, staging
   sano o el visto bueno de un environment no cumplen este requisito si no nombran
   producción, SHA y alcance.
   En modo fundador único, el mismo registro debe reconocer expresamente que
   `Noahstark23` inicia y aprueba el environment sin segunda persona. No presentar
   esa excepción como una revisión independiente; si el dueño no acepta ese riesgo
   para el SHA exacto, la promoción queda bloqueada.
5. Confirmá responsable de la observación posterior y la decisión de rollback. No
   uses este runbook para inferir una autorización que no quedó registrada.

## Ejecutar la promoción manual

Con los requisitos anteriores satisfechos, un responsable autorizado abre el
workflow **Promote production** en GitHub Actions, selecciona la rama `main` y lo
inicia manualmente. Debe introducir:

| Campo | Valor aceptado |
|---|---|
| `candidate_sha` | El SHA completo de 40 caracteres ya verificado en `main` y staging |
| `confirmation` | Exactamente `PROMOTE <candidate_sha>` |
| `sole_owner_confirmation` | Exactamente `SOLE_OWNER <candidate_sha>`; reconoce la excepción de fundador único para ese SHA |

El workflow falla cerrado si los valores no son exactos, si el SHA ya no coincide
con `main`, si no existe un staging **manual exitoso** y sano para ese SHA o si la
compuerta de despliegue está deshabilitada. Vuelve a comprobar esa procedencia
después de la aprobación técnica del environment, por lo que un health aislado o
un run de otra rama no puede reemplazar staging. No se corrige una falla cambiando
el input por un SHA nuevo: el nuevo SHA vuelve a CI y staging.

El job que llega al environment `production` vuelve a comprobar **después** de la
aprobación técnica que `main` y staging siguen en el SHA candidato. Si alguien
mergea otro cambio mientras espera la aprobación, el job debe terminar sin invocar
el webhook de producción. La aprobación del environment es un segundo acto
deliberado; en la excepción de fundador único la hace la misma persona y no se
presenta como revisión independiente. Tampoco reemplaza la autorización de
producto registrada arriba.

## Verificación posterior y cierre

Después de que el workflow termine, registrá por separado:

1. URL/identificador del run manual y SHA solicitado.
2. Resultado de la revalidación posterior a la aprobación (`main` y staging).
3. Salud de producción: API sana, base disponible, SHA exacto y `Cache-Control: no-store`.
4. Smoke funcional de las rutas afectadas; para dinero, stock o identidad, tenant
   sintético, idempotencia y ausencia de movimientos inesperados.
5. Observación definida por el riesgo y decisión explícita de cierre o rollback.

Un run terminado no equivale por sí solo a `PRODUCCIÓN VERIFICADA`. Si la salud,
el SHA, el smoke o la observación no coinciden, detené el cierre, preservá la
evidencia y pedí una decisión de rollback al responsable autorizado. No ejecutes un
rollback, un webhook ni un cambio de secretos por inferencia.

## Configuración externa que debe quedar comprobada

Esta reparación de código no cambia configuraciones de GitHub ni de la plataforma
de despliegue. El dueño del repositorio debe verificar y registrar, antes de usar la
ruta manual, lo siguiente:

| Control externo | Estado exigido |
|---|---|
| Rama `main` | Protección que exige PR y checks requeridos antes del merge |
| Environment `staging` | Política de ramas limitada a `main`; aprobación técnica si el riesgo lo exige |
| Identidad Coolify de staging | `COOLIFY_STAGING_API_ORIGIN` y `COOLIFY_STAGING_APPLICATION_UUID` configurados como variables; `COOLIFY_STAGING_READ_TOKEN` y `COOLIFY_STAGING_WEBHOOK` solo en `staging`, más `COOLIFY_TOKEN` opcional si el webhook exige bearer. Los cuatro deben concordar según el contrato anterior y no ser accesibles desde CI. |
| Variable de habilitación de staging | `NORTEX_DEPLOY_ENABLED=true` en repo u organización antes del preflight; un push no la usa para desplegar |
| Environment `production` | Política de ramas limitada a `main` (preferiblemente solo ramas protegidas) |
| Reviewer de producción | `Noahstark23` en la excepción de fundador único; registrar que coincide con el iniciador y que no hubo revisión independiente |
| Autoaprobación | `prevent-self-review=false` solo para la excepción de fundador único, con las dos confirmaciones exactas y autorización de producto separada |
| Bypass administrativo | `can_admins_bypass=false` |
| Identidad Coolify de producción | `COOLIFY_PROD_API_ORIGIN` y `COOLIFY_PROD_APPLICATION_UUID` configurados como variables; `COOLIFY_PROD_READ_TOKEN` y `COOLIFY_PROD_WEBHOOK` solo en `production`, nunca expuestos a CI/staging. `COOLIFY_PROD_DEPLOY_TOKEN` es separado y opcional solo si el webhook exige bearer. |
| Variable de habilitación de producción | `NORTEX_PRODUCTION_DEPLOY_ENABLED` a nivel repo u organización; no dentro del environment porque el preflight no entra a él |
| Plataforma de despliegue | Sin ruta automática general desde un push que eluda `release-production.yml`; API habilitada si Coolify es self-hosted, app fijada manualmente al SHA candidato, build desde Git (`dockerfile` o `dockercompose`) y Auto Deploy explícitamente apagado |
| Identidad de origen público | La relación entre la app Coolify verificada y cada `STAGING_URL`/`PROD_URL` debe estar documentada con un contrato/fixture saneado y comprobarse antes del webhook; mientras no exista, infraestructura la registra por separado y staging/producción quedan bloqueados |
| Tokens de Coolify | Los tokens de lectura son obligatorios, de mínimo alcance y separados por environment. No usar `write`, `read:sensitive` ni `root`; nunca guardar token ni URL completa del webhook en la evidencia. |

Si cualquiera de estos controles no se puede verificar, el estado es
`LISTO PARA PRODUCCIÓN BLOQUEADO`, no una excepción implícita. Documentá el
bloqueo y escalalo al responsable de infraestructura.

**Identidad y límite de la excepción:** el dueño eligió `Noahstark23` como
revisor y confirmó que no hay otra persona disponible. GitHub muestra esa cuenta
como único reviewer, `prevent_self_review=false` y bypass administrativo apagado.
La excepción acepta expresamente la falta de independencia, sin cambiar las
protecciones externas ni atribuir una aprobación a Claude, Codex u otra IA. El
responsable debe registrar iniciador, aprobador, SHA, alcance y autorización de
producto antes del dispatch. Si aparece una segunda persona autorizada, se
restaura la regla de revisión independiente mediante una decisión y cambio
controlados; nunca se asume por la existencia de otra cuenta del mismo dueño.

Solo con autorización externa registrada, el responsable de infraestructura fija en
Coolify `git_commit_sha` al candidato autorizado. El workflow no escribe esa
configuración —solo la lee y la rechaza si apunta a `HEAD`, una rama mutable u otro
SHA—, de modo que no puede esconder un cambio de destino detrás de sus propios
secretos.

## Evidencia mínima del expediente de release

Conservá estos campos sin secretos ni datos de clientes:

```text
SHA candidato completo:
Alcance y riesgo:
CI del mismo SHA:
Run manual de release-staging.yml:
Staging: procedencia manual, identidad Coolify saneada, salud/SHA/no-store/smoke:
Autorización explícita de producto (responsable, fecha, ventana, rollback):
Excepción fundador único aceptada para el SHA exacto, con iniciador y aprobador:
Run manual de release-production.yml:
Aprobación técnica del environment (quién/cuándo):
Revalidación posterior a la aprobación (main y staging):
Producción: identidad Coolify saneada, salud/SHA/no-store/smoke/observación:
Relación pública URL↔Coolify: verificada | bloqueada, con referencia saneada:
Estado final: PRODUCCIÓN VERIFICADA | BLOQUEADO | ROLLBACK AUTORIZADO
```

## Aprendizaje permanente

Un documento, un merge o un comentario no son una promoción. La prevención no
depende de que alguien recuerde no aprobar: la arquitectura elimina las rutas
automáticas a staging y producción, exige intención humana inequívoca y vuelve a
validar el candidato después de cada aprobación técnica. Cualquier cambio futuro de
workflow, environment o runbook debe conservar un test negativo de que un push
docs-only no puede crear ni ejecutar un job de staging o producción.

## Excepción puntual autorizada: crédito 2026-10-01 y recuperación

Esta excepción se aprobó expresamente el 2026-10-02 para el arreglo y su recuperación. No convierte una autorización genérica en permiso para otros SHAs. Sólo existe mientras `docs/releases/credit-hotfix-20261001.json` tiene active=true. Las reglas anteriores siguen vigentes cuando `credit_hotfix_20261001=false`, valor por defecto.

Identidades fijas: C=`d563c750dd62c9192df1d078c4c13308748f69bd`, B=`bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4`; C tiene un único padre B y árbol `8038a539d7b4479625f9eadfd7885c43a914a154`. El manifiesto registra exactamente las nueve fuentes de producto/QA y hashes, y conserva backend/schema/migraciones/lockfile/Docker/Compose/.github de B. Publicar C en `codex/hotfix-pos-credit-20261001` sin alterar el commit. Si se necesita CI nuevo de B, publicar B en `codex/credit-hotfix-recovery-20261001`. No integrar el árbol de producto C en main para desplegar luego los cambios ajenos de main.

M es el SHA revisado de controles en main. Los **mismos** release-staging.yml y release-production.yml se despachan siempre desde main M; los environments siguen admitiendo sólo main. M debe seguir siendo el tip antes y después de aprobar el environment. En la excepción, el checkout del job es M y todos los scripts con acceso a secretos se ejecutan desde M. C/B se inspeccionan como objetos Git y Coolify construye el SHA fijado; no se ejecutan sus scripts de promoción con secretos. La ruta normal conserva su checkout y su igualdad candidato=M.

Inputs añadidos a ambos workflows:

| Input | Valor de promoción | Valor de recuperación |
|---|---|---|
| credit_hotfix_20261001 | true | true |
| credit_hotfix_action | promote | recover |
| candidate_sha | C completo | B completo |
| confirmation de staging | STAGE C | STAGE B |
| confirmation de producción | PROMOTE C | PROMOTE B |
| sole_owner_confirmation | SOLE_OWNER C | SOLE_OWNER B |

No se aceptan otras bases, hashes ni acciones. Mode/referencia/evento/repositorio/origen, padre/árbol/diff/hashes y HEAD de la rama se verifican ejecutablemente. Promover exige producción fresca B sana, con no-store. La selección de recuperación no exige que el C averiado esté sano: exige un recibo de POST aceptado de C emitido por el mismo controlador, workflow y aplicación aprobada, junto con CI y staging B sano. No interpreta un request, un timeout o un run cancelado como una release saludable.

### Secuencia operacional obligatoria

1. Revisar e integrar por PR sólo los controles, respetando checks/protección sin bypass. Registrar M y CI terminal de sus cuatro checks. Preservar la revisión independiente del producto C.
2. Publicar las referencias fijas y obtener CI terminal del código C por ci.yml/workflow_dispatch en su rama; B necesita CI terminal histórico push/main o dispatch en su referencia de recuperación. Cada identidad exige verify, integration-required, deploy-schema-smoke y backup-restore-smoke ejecutados y aprobados. Los CI de M, C, B y un merge SHA de PR no son intercambiables. Mantener la evidencia de mutación monetaria de C; no cambiar CI, pisos o umbrales.
3. Por una superficie operativa autorizada, revalidar UUID/origen/URL/app/build y pin de Coolify, Auto Deploy false, digest/estrategia de reemplazo y compatibilidad real del schema de staging. Fijar pin=C para staging; no cambiar app, git_branch, ACL, variables o secrets. Si no puede construir el SHA sin esos cambios, detener y registrar la necesidad exacta.
4. Staging manual C (promote): health C con API/base/no-store; smoke sintético de crédito, exceso/centavos/replay y actualización PWA.
5. Fijar pin=B en la misma app de staging; staging manual B (recover). Registrar restablecimiento de imagen/health/assets/PWA y recuperación ordinaria. El artefacto de B sólo acredita un drill de C sano si enlaza el run sano de C anterior. Una recuperación tras C nunca sano se permite para restablecer servicio, pero no acredita ese drill.
6. Fijar nuevamente pin=C; staging manual C (promote), repetir smoke/PWA y comprobar que los artefactos enlazan C sano → B sano → C sano del mismo M/app. El health no sustituye el smoke funcional; registrar sus resultados aparte y detener producción si falla o falta.
7. Revalidar protecciones y el destino productivo; fijar pin=C, autorizar/aprobar el environment y ejecutar producción manual C sólo cuando estén completas las condiciones anteriores. El expediente de autorización ya cubre este C y recuperación B, sin repetir una petición genérica. La aceptación de la excepción fundador único se conserva explícita para el SHA/operación del dispatch.
8. Verificar health C, frontend/assets/PWA, smoke proporcional sin datos/clientes reales y observar al menos30 minutos. No cerrar por el solo status del workflow.
9. Si la recuperación resulta necesaria, fijar B para staging, usar recover B y comprobar staging B sano. Fijar pin=B en la misma app productiva y ejecutar release-production desde M con recover, candidate=B, PROMOTE B y SOLE_OWNER B. La compuerta exige el recibo productivo de solicitud C de ese mismo M/app y su cadena de staging probada. Esto cubre health C fallido; no autoriza otra app, imagen, SHA o assets directos. Verificar B y su funcionamiento antes de cerrar la recuperación. No se reintenta automáticamente un POST de resultado incierto.
10. Deshabilitar la excepción por PR tras cerrar incidente/recuperación. No usarla para otro arreglo ni avanzar las referencias fijas.

### Evidencia, permisos y límites

Los workflows guardan artifacts pequeños requested/healthy inmediatamente después del POST aceptado y después de health respectivamente. Sólo contienen caso, operación, M/C/B, digest del manifiesto, run_id/run_attempt, links del drill y hashes de origen/UUID. Nunca tokens, URLs de webhook, UUID en texto ni datos financieros. La identidad pública y hashes de apps se fijaron desde las variables públicas existentes antes de implementar; ello no sustituye verificar su relación real URL↔app.

Producción acepta únicamente CI fuente correcto y evidencia de workflow manual desde main M. Los artifacts deben pertenecer al run y attempt correctos, tener digest SHA256 válido, ZIP de un solo JSON acotado/esquema estricto, identidad exacta, POST probado y health exitoso donde corresponda. La cadena requiere timestamps y referencias ordenadas C→B→C. No basta un run verde de M que desplegara M. Todas las comprobaciones se repiten post-environment.

No se crean workflows, secretos, permisos de GitHub o reglas de Environment nuevos. permissions sigue contents:read/actions:read; upload-artifact usa la capacidad de runtime ya disponible. Producción conserva reviewer, prevent_self_review y can_admins_bypass=false. Los verificadores Coolify/health, el POST y el entrypoint siguen intactos. No usar SSH/assets como ruta alternativa. El entrypoint ejecuta preflight/db push incluso sin diff de schema: si staging tiene un schema ajeno posterior a B, no borrar tablas ni relajar data-loss guards para conseguir el drill. Ese desacuerdo bloquea la operación y debe resolverse con alcance aprobado aparte.

Implementación ejecutable: scripts/verify-credit-hotfix-release.mjs, scripts/verify-credit-hotfix-run-evidence.mjs y authorize-production-release.mjs. Pruebas: tests/creditHotfixReleaseGate.test.ts más los contratos normales preservados.
