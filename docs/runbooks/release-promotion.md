# Runbook canónico — promoción a producción

> **Regla vinculante.** Este documento define la única ruta de promoción a
> producción de Nortex. CI verde, un merge, staging sano, una aprobación de PR o
> la aprobación técnica de un environment son señales distintas; ninguna sustituye
> la autorización explícita del producto para producción.

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
| CI | `ci.yml` sobre el SHA candidato | Tests, build y controles técnicos | Staging ni producción |
| Staging | job de staging de `ci.yml` | Que staging sirve el SHA exacto y pasa smoke proporcional | Producción |
| Decisión de producto | Registro humano explícito | Que el responsable acepta alcance, SHA, ventana y rollback | Ejecutar un deployment por sí sola |
| Producción | `.github/workflows/release-production.yml`, solo manual | Que el mismo SHA vigente de `main` y staging sano siguen siendo el candidato | Una autorización futura o un SHA distinto |
| Environment `production` | Protección técnica dentro del workflow manual | Segunda revisión antes de acceder a secretos de producción | Autorización de producto por inferencia |

`ci.yml` puede desplegar staging cuando esté autorizado para ello, pero nunca debe
crear un job de producción. El único workflow con webhook o secretos de producción
es `release-production.yml`; no se activa por `push`, PR ni merge.

## Requisitos antes de solicitar producción

1. Identificá un SHA candidato completo de 40 caracteres que ya esté en `main`.
   Un SHA abreviado, una rama, un tag mutable o "el último" no son candidatos
   aceptables.
2. Conservá evidencia del CI terminal de ese mismo SHA y del estado limpio que se
   revisó. Si el alcance toca dinero, inventario, identidad o schema, aplicá las
   compuertas adicionales de `AGENTS.md` y `CLAUDE.md`.
3. Verificá que staging sirve exactamente ese SHA y que pasó el smoke proporcional
   al riesgo, con tenant sintético cuando corresponda. Un `503` transitorio, un
   health sin SHA o un SHA diferente detienen el proceso.
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
con `main`, si el despliegue de staging no es sano para ese SHA o si la compuerta de
despliegue está deshabilitada. No se corrige una falla cambiando el input por un SHA
nuevo: el nuevo SHA vuelve a CI y staging.

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
3. Salud de producción: API sana, base disponible y SHA exacto.
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
| Environment `production` | Política de ramas limitada a `main` (preferiblemente solo ramas protegidas) |
| Reviewer de producción | Revisor independiente del autor que inicia la promoción |
| Autoaprobación | `prevent-self-review=true` |
| Bypass administrativo | `can_admins_bypass=false` |
| Secretos de producción | Solo en el environment `production`, nunca expuestos a CI/staging |
| Variable de habilitación de producción | `NORTEX_PRODUCTION_DEPLOY_ENABLED` a nivel repo u organización; no dentro del environment porque el preflight no entra a él |
| Plataforma de despliegue | Sin ruta automática general desde un push que eluda `release-production.yml`; API habilitada si Coolify es self-hosted, app fijada manualmente al SHA candidato, build desde Git (`dockerfile` o `dockercompose`) y Auto Deploy explícitamente apagado |
| Tokens de Coolify | `COOLIFY_PROD_READ_TOKEN` obligatorio, solo lectura del destino; `COOLIFY_PROD_DEPLOY_TOKEN` separado y opcional solo si el webhook necesita bearer. No usar `write`, `read:sensitive` ni `root` |

Si cualquiera de estos controles no se puede verificar, el estado es
`LISTO PARA PRODUCCIÓN BLOQUEADO`, no una excepción implícita. Documentá el
bloqueo y escalalo al responsable de infraestructura.

Antes de iniciar el workflow manual, el responsable de infraestructura fija en
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
Staging: salud/SHA/smoke:
Autorización explícita de producto (responsable, fecha, ventana, rollback):
Run manual de release-production.yml:
Aprobación técnica del environment (quién/cuándo):
Revalidación posterior a la aprobación (main y staging):
Producción: salud/SHA/smoke/observación:
Estado final: PRODUCCIÓN VERIFICADA | BLOQUEADO | ROLLBACK AUTORIZADO
```

## Aprendizaje permanente

Un documento, un merge o un comentario no son una promoción. La prevención no
depende de que alguien recuerde no aprobar: la arquitectura del workflow elimina la
ruta automática a producción, exige intención humana inequívoca y vuelve a validar
el candidato después de la aprobación técnica. Cualquier cambio futuro de workflow,
environment o runbook debe conservar un test negativo de que un push docs-only no
puede crear ni ejecutar un job de producción.
