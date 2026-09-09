# Runbook canónico — staging y promoción a producción

> **Regla vinculante.** Este documento define las únicas rutas de staging y
> producción de Nortex. CI verde, un merge, staging sano, una aprobación de PR o
> la aprobación técnica de un environment son señales distintas; ninguna sustituye
> la autorización explícita del producto para producción.
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
| Environment `production` | Protección técnica dentro del workflow manual | Segunda revisión antes de acceder a secretos de producción | Autorización de producto por inferencia |

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

El workflow falla cerrado si los valores no son exactos, si el SHA ya no coincide
con `main`, si no existe un staging **manual exitoso** y sano para ese SHA o si la
compuerta de despliegue está deshabilitada. Vuelve a comprobar esa procedencia
después de la aprobación técnica del environment, por lo que un health aislado o
un run de otra rama no puede reemplazar staging. No se corrige una falla cambiando
el input por un SHA nuevo: el nuevo SHA vuelve a CI y staging.

El job que llega al environment `production` vuelve a comprobar **después** de la
aprobación técnica que `main` y staging siguen en el SHA candidato. Si alguien
mergea otro cambio mientras espera la aprobación, el job debe terminar sin invocar
el webhook de producción. La persona que aprobó el environment actúa como segunda
línea de defensa; esa acción no reemplaza la autorización de producto registrada
arriba.

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
| Reviewer de producción | Revisor independiente del autor que inicia la promoción |
| Autoaprobación | `prevent-self-review=true` |
| Bypass administrativo | `can_admins_bypass=false` |
| Identidad Coolify de producción | `COOLIFY_PROD_API_ORIGIN` y `COOLIFY_PROD_APPLICATION_UUID` configurados como variables; `COOLIFY_PROD_READ_TOKEN` y `COOLIFY_PROD_WEBHOOK` solo en `production`, nunca expuestos a CI/staging. `COOLIFY_PROD_DEPLOY_TOKEN` es separado y opcional solo si el webhook exige bearer. |
| Variable de habilitación de producción | `NORTEX_PRODUCTION_DEPLOY_ENABLED` a nivel repo u organización; no dentro del environment porque el preflight no entra a él |
| Plataforma de despliegue | Sin ruta automática general desde un push que eluda `release-production.yml`; API habilitada si Coolify es self-hosted, app fijada manualmente al SHA candidato, build desde Git (`dockerfile` o `dockercompose`) y Auto Deploy explícitamente apagado |
| Identidad de origen público | La relación entre la app Coolify verificada y cada `STAGING_URL`/`PROD_URL` debe estar documentada con un contrato/fixture saneado y comprobarse antes del webhook; mientras no exista, infraestructura la registra por separado y staging/producción quedan bloqueados |
| Tokens de Coolify | Los tokens de lectura son obligatorios, de mínimo alcance y separados por environment. No usar `write`, `read:sensitive` ni `root`; nunca guardar token ni URL completa del webhook en la evidencia. |

Si cualquiera de estos controles no se puede verificar, el estado es
`LISTO PARA PRODUCCIÓN BLOQUEADO`, no una excepción implícita. Documentá el
bloqueo y escalalo al responsable de infraestructura.

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
