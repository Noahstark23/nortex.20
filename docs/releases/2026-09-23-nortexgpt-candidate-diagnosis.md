# Diagnóstico del candidato NortexGPT integrado — 2026-09-23

> **Superado a las 13:31 UTC.** Lo que sigue es el corte de las 09:03 UTC y se
> conserva como registro histórico. El estado posterior está en
> [Actualización 14:15 UTC](#actualización-1415-utc).

Expediente documental. No ejecuta pruebas, no promueve ni autoriza despliegue,
no repite la tarea de QA rechazada y no modifica controles. Corte de la
consulta: 2026-09-23, contra `origin` de GitHub y el API de Actions.

## Identidad de los SHA

| Referencia | SHA completo | Relación |
|---|---|---|
| Candidato publicado | `c0ec6e90f8e1f49b09ba373a704c1a0a7fe60b71` | Merge de `e4de9d7` (NortexGPT) + `8776be7` (main). Árbol `470c54c051578616998c91d3ea85590a04501b5f`. Rama `codex/nortexgpt-integrated-20260923`. |
| Tip de `main` | `8776be7241f46a1611f472c72d8a8ce2f0633570` | fix(camera) #220. CI `push` success (run 35631411113). Sin staging ni producción registrados. |
| Producción/staging observados | `20fda8dc196b808b0508e53d1253510cacd7096b` | `main~1` (#219). No incluye #220 ni NortexGPT. |
| Rama NortexGPT previa | `e4de9d738d092e751344d292d7ffb119e209fc5a` | Padre 1 del candidato; no está en `main`. |

Diferencia candidato vs `main`: 191 archivos, +13.576/−382. Incluye 7
migraciones (tablas nuevas `AssistantBudgetRequest`, `AssistantKnowledge*`,
`AssistantWorkItem/Event`; columnas con default en `AssistantTenantConfig`,
`User`, `AssistantWaOutbox`, `AssistantRun`; índices en `Shift` y
`CashMovement`), cambios en `stryker.config.json` y
`scripts/check-mutation-scope.cjs`. Por lectura del SQL, los `UNIQUE` nuevos
están en tablas nuevas y las columnas agregadas son nullable o tienen default:
el DDL parece aditivo. Esa lectura no sustituye el preflight ni el upgrade
sobre una copia con datos.

## 1. Rechazo de la plataforma

**Hecho (según el expediente recibido; sin acceso aquí al registro original):**
el 2026-09-12 18:58:56 UTC, `list_agents` de Codex mostró `/root/final_qa` en
`errored` con el aviso de posible riesgo de ciberseguridad.

**Desconocido:** el prompt rechazado, la regla o señal que lo activó, qué parte
de la tarea alcanzó a ejecutarse antes del error y si el agente produjo algún
artefacto parcial.

**Inferencias que NO se sostienen con esta evidencia:**

- Que la QA de Nortex esté bloqueada por la plataforma. Es un solo agente, un
  solo evento, once días antes del candidato actual.
- Que el rechazo se refiera a `c0ec6e9`. El candidato se creó el 2026-09-23;
  el rechazo es del 2026-09-12. Ningún registro vincula ese evento a este SHA.
- Que una prueba MySQL o financiera haya fallado. No consta ninguna.

**Conclusión:** el rechazo explica por qué ese agente no entregó resultado; no
explica por qué faltan las comprobaciones de `c0ec6e9`. Esas simplemente no se
ejecutaron (sección 2). No corresponde reintentar la tarea por otra vía ni
reformularla para evitar el filtro; si se quiere aclarar, el camino es el canal
de soporte del proveedor con el prompt original.

## 2. Comprobaciones no ejecutadas para `c0ec6e9`

**Declarado por el integrador** (commit message de `c0ec6e9` y expediente;
los JSON de `release-evidence/status-20260923/` están en la estación local y no
fueron legibles desde este análisis, así que su contenido no está contrastado):
Prisma 6.4.1 validate/generate, `tsc`, sistema de diseño, build/SEO con
Node 22.23.2, 1.803 archivos contra sus blobs y revisión de la integración.

**Verificado aquí en GitHub:**

- No existe PR con head `codex/nortexgpt-integrated-20260923`.
- No hay ninguna ejecución de workflow para esa rama (`total_count: 0`).
- `ci.yml` se dispara con `pull_request`, `push` a `main` o `workflow_dispatch`.
  Sin PR ni dispatch, la ausencia de CI es esperable: **no es un rechazo**.

**No acreditado para ese SHA** (ninguna ejecución registrada):

| Comprobación | Estado | Nota |
|---|---|---|
| Vitest completo | No ejecutado | El "6318 pruebas" del commit de #219 corresponde a `20fda8d`, no a este árbol. |
| `npm run test:integration:required` (MySQL) | No ejecutado | Obligatorio: el diff toca caja (`Shift`, `CashMovement`) y presupuesto en dinero. |
| Mutación (`npm run test:mutation`) | No ejecutado | El diff modifica `stryker.config.json` y el alcance de mutación; hay que confirmar que el umbral no bajó. |
| Upgrade/reintento y restore | No ejecutado | 7 migraciones; existe `scripts/qa/test-assistant-budget-upgrade.mjs` en el candidato. |
| CI terminal | No ejecutado | Requiere PR o dispatch. |
| Staging del mismo SHA | No ejecutado | Además bloqueado por identidad (sección 3). |
| Smoke funcional, workers, piloto | No ejecutado | — |

## 3. Condiciones técnicas pendientes para la promoción

Según `docs/runbooks/release-promotion.md`:

1. **El candidato no está en `main`.** Producción y staging solo aceptan el tip
   vigente de `main`. Merging `c0ec6e9` vía PR crea otro SHA (merge o squash):
   la evidencia local se refiere a `c0ec6e9` y habrá que repetir CI y staging
   sobre el SHA resultante. El árbol `470c54c…` sirve para comprobar que el
   contenido es igual; el SHA nuevo igual necesita sus propios CI y staging.
2. **CI terminal y verde** del SHA de `main` resultante, incluida la integración
   MySQL obligatoria.
3. **Staging manual** (`release-staging.yml`) exitoso y sano para ese SHA, con
   smoke separado.
4. **Autorización de producto** con SHA completo, alcance, ventana y rollback.
   La autorización genérica del dueño no nombra el SHA nuevo; hay que
   emitirla para ese SHA.
5. **Respaldo y restore** antes de aplicar las 7 migraciones (Capa 6).
6. **Coolify** con Auto Deploy expuesto y apagado, según
   `docs/releases/2026-09-08-coolify-compatibility.md`.

### Hallazgo adicional: la promoción de `20fda8d` quedó registrada como fallida

- `Promote production` run 35500798414 (2026-09-20 08:53 UTC): validación, CI,
  staging y webhook OK; el paso *Verificar PROD sano y en el candidato
  esperado* terminó a las 09:02:17 con `COMMIT_MISMATCH` después de 8 minutos.
- La observación del 23 de septiembre muestra producción en `20fda8d`. Lo
  compatible con ambos datos es que el despliegue terminó después de la
  ventana de verificación. No hay registro de cuándo ni de un cierre posterior.
- Por lo tanto, la release actual de producción **no tiene cierre acreditado**
  por el workflow. Conviene registrarlo antes de la próxima promoción.
- Hubo además 12 corridas fallidas de `Promote staging candidate` para
  `67f1832` (16–18 sep) y `Android (APK/AAB)` falla en cada push a `main`. Son
  ajenas a este candidato, pero siguen pendientes.

## Diagnóstico

| Categoría | Qué es | ¿Bloquea `c0ec6e9`? |
|---|---|---|
| Rechazo de plataforma | Un agente de Codex, 2026-09-12, causa desconocida | No demostrado. No hay vínculo con este SHA. |
| Comprobaciones no ejecutadas | Vitest, MySQL, mutación, upgrade/restore, CI, staging, smoke, workers, piloto | Sí. Faltan porque no se ejecutaron. |
| Condiciones de promoción | Candidato fuera de `main`, SHA distinto tras merge, autorización por SHA, respaldo, Coolify | Sí, por diseño del runbook. |
| Deuda de release previa | `20fda8d` sin cierre (COMMIT_MISMATCH), staging `67f1832` y Android en rojo | No bloquea el candidato, pero debe registrarse. |

**Estado del candidato:** integración compilable según lo declarado por el
integrador. Sin pruebas de comportamiento, integración ni operación
acreditadas. No es promovible a producción.

**Siguiente paso de menor riesgo:** abrir un PR draft desde
`codex/nortexgpt-integrated-20260923` para que CI corra sobre `c0ec6e9` y
ejecutar localmente `npm run test:integration:required` y `npm run
test:mutation` sobre ese árbol. Guardar cada resultado junto con su SHA.

## Actualización 14:15 UTC

Contrastado con git y el API de GitHub Actions. Registra lo que hizo el
integrador después del corte anterior; este expediente no ejecutó nada.

| Hora UTC | Evento | SHA | Resultado |
|---|---|---|---|
| 09:08 | CI del PR #224 | `c0ec6e9` | success (run 35841213694) |
| 09:41 | CI del PR #224 tras reparar espejo SQL y cobertura | `d9abca8` | success (run 35844441736) |
| 13:10 | Merge de #224 a `main` | `dadc81975811850226a6bd7b560a3522068b995a` | merge commit (padres `8776be7`, `d9abca8`) |
| 13:10 | CI `push` de `main` | `dadc819` | success (run 35865270441) |
| 13:10 | Android (APK/AAB) | `dadc819` | **failure** (run 35865270416), igual que en los push anteriores |
| 13:22 | Promote staging candidate | `dadc819` | success (run 35866557630) |
| 13:31 | Promote production | `dadc819` | success (run 35867609699) |

Qué cambia respecto del diagnóstico:

- Las comprobaciones de la sección 2 se ejecutaron, pero sobre `d9abca8`, no
  sobre `c0ec6e9`. El PR #224 y `docs/releases/2026-09-23-nortexgpt-qa-repairs.md`
  declaran: Vitest 7.076/0 fallidas/545 omitidas, integración MySQL 51 suites y
  559 casos, mutación 100 % (6.000 evaluados) y 5/5 escenarios de presupuesto
  con upgrade, reintento y restore sintéticos. La mutación consta como
  **local**; el CI la omitió. Esos resultados locales no se reprodujeron aquí.
- El candidato se fusionó a `main` y, como se anticipó en la sección 3, el
  SHA resultante es distinto (`dadc819`). Para ese SHA constan CI, staging y
  producción exitosos.
- La promoción de `20fda8d` sigue sin cierre propio, pero producción ya fue
  reemplazada por `dadc819`, que sí completó la verificación del workflow.
- Sigue pendiente: Android en rojo en `main`; calidad del modelo, piloto,
  operación de workers y respaldo real vigente, que el propio PR #224 declara
  sin evidencia. El rechazo del 2026-09-12 sigue sin causa conocida y no
  impidió la promoción.
