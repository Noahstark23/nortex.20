# NortexGPT: preparación del candidato para despliegue — 2026-09-19

**Estado: preparación local, sin despliegue.** Este expediente reúne la base del
candidato, los controles de promoción y la evidencia pendiente. No acredita que
NortexGPT esté habilitado para clientes ni sustituye el
[runbook de promoción](runbooks/release-promotion.md).

## Identidad y alcance

| Elemento | Evidencia |
|---|---|
| Base de `main` leída en GitHub | `67f1832502ee68ef67ac12b0803bdbfce48a4cef` |
| Candidato de integración local | `/Users/stark/Developer/Nortex/candidates/nortexgpt-release-ready-20260919` |
| Naturaleza del candidato | Copia ordinaria de esa base, sin `.git`; no es un commit ni un worktree nuevo |
| Registro inicial | `/Users/stark/Developer/Nortex/release-evidence/ready-20260919/main-baseline.json`, creado el 2026-09-19 a las 22:04:48 UTC |
| Integración | Selectiva y con manifiesto del integrador; la base no incluye automáticamente todo lo presente en los candidatos anteriores |
| Fuentes preservadas | Checkout original, candidato editorial congelado y candidato de identidad de catálogo |
| Autorización de este trabajo | Preparar y verificar localmente; sin push, merge, dispatch de CI, staging ni producción |

El SHA de la base identifica el punto de partida, **no** las modificaciones de
este directorio. El [expediente consolidado](NORTEXGPT_ENTREGA_PREPARACION_2026-09-19.md) registra
los hashes finales y el diff; todavía no existe un nuevo commit candidato. Las pruebas de un
candidato anterior no pasan a ser evidencia del conjunto integrado por copiar
sus archivos.

El checkout original estaba en `codex/caja-nica-retention`, con cambios sin
confirmar y 93 commits detrás de su upstream durante el inventario. La integración
parte de `main` para conservar los avances remotos. No sustituir su schema por el
schema completo del checkout anterior: la base ya contiene `ProductBatchHold` y
`ShiftCloseReport`. Los cambios de schema se concilian de manera aditiva.

## Estado remoto observado

Lecturas del 2026-09-19; no se iniciaron workflows ni se modificó GitHub o Coolify.

| Superficie | Resultado observado | Límite de la evidencia |
|---|---|---|
| CI de la base `67f1832…` | [Run 35130299385](https://github.com/Noahstark23/nortex.20/actions/runs/35130299385), exitoso: `verify`, `deploy-schema-smoke`, `backup-restore-smoke`, `integration-required` | Acredita ese SHA, no el nuevo conjunto local |
| Staging de esa base | [Run 35306106496](https://github.com/Noahstark23/nortex.20/actions/runs/35306106496), fallido el 2026-09-18 en la verificación del destino Coolify; webhook y health omitidos | No se leyó una causa técnica saneada del fallo; no atribuirlo a token, pin o versión por suposición |
| Último staging exitoso observado | [Run 34722202338](https://github.com/Noahstark23/nortex.20/actions/runs/34722202338), SHA `98e54afad4bfa7a0ef5ae99c902102d40d0400ff` | Versión anterior a la base de integración |
| Última producción exitosa observada | [Run 34722485583](https://github.com/Noahstark23/nortex.20/actions/runs/34722485583), mismo SHA `98e54af…` | No acredita la promoción de `67f1832…` ni del candidato local |
| Health de staging, 22:02:52 UTC | HTTP 200, `ok:true`, `db:"up"`, commit `98e54afad4bfa7a0ef5ae99c902102d40d0400ff`, `Cache-Control` con `no-store` | Lectura puntual de infraestructura; no es smoke funcional |
| Health de producción, 22:02:53 UTC | HTTP 200, `ok:true`, `db:"up"`, mismo commit `98e54af…`, `Cache-Control` con `no-store` | No acredita capacidad, flags, calidad de IA ni salud futura |
| Environments | Ambos limitados a `main`; producción tiene a `Noahstark23` como reviewer y `prevent_self_review=false`; staging sin reviewer requerido | No se acreditaron protección de rama, bypass administrativo ni alcance real de tokens |

Las dos lecturas de health usaron HTTPS con validación TLS y sin seguir
redirecciones. No se consultaron datos privados de clientes. El fallo separado de
[Android 35130299457](https://github.com/Noahstark23/nortex.20/actions/runs/35130299457)
ocurrió en el SDK: se conserva como pendiente de Android y no se presenta como
fallo ni aprobación del candidato web.

El usuario ya eligió su cuenta para revisar producción. Se respeta esa decisión;
no falta que vuelva a nombrar un revisor. Sigue siendo necesario registrar para
el run concreto quién inicia y quién aprueba, sin presentar autoaprobación como
revisión independiente ni cambiar protecciones por cuenta del agente. Esta
elección anterior no autoriza desplegar el nuevo candidato.

## Controles conservados y QA de esta preparación

Los workflows manuales, verificadores y pruebas de promoción ya estaban en la
base `main`; no se portan desde un checkout más antiguo ni se reescriben. CI sigue
sin ruta a webhooks. Staging y producción requieren intención manual, SHA
completo, CI terminal, identidad del destino y revalidación tras aprobación.

**Controles de promoción: 340/340 pruebas aprobadas, ocho archivos, cero omitidas.**
Están incluidos en la corrida final del conjunto: **1.877/1.877**, 84 archivos,
sin omitidos. Prisma validate/generate, TypeScript, diseño y build/SEO aprobados;
[detalle y límites](NORTEXGPT_ENTREGA_PREPARACION_2026-09-19.md).
Se ejecutaron con Node 22.23.2 mediante `mise exec -- npx --no-install vitest run`,
seleccionando únicamente los archivos de la tabla. No se ejecutó un workflow,
un webhook, una integración de dinero ni una llamada al proveedor de IA.

| Archivo | Contrato comprobado |
|---|---|
| `tests/productionReleaseGate.test.ts` | Evento manual, candidato exacto y salud del staging esperado; rechazo previo a llamadas ante inputs inválidos |
| `tests/releaseProductionWorkflow.test.ts` | Separación CI/promoción, procedencia del candidato, validaciones y webhook sin reintento automático |
| `tests/productionWorkflowGate.test.ts` | Ausencia de despliegue y secretos de producción dentro de CI |
| `tests/coolifyStagingTarget.test.ts` | Identidad, origen, pin y Auto Deploy del destino staging usando respuestas simuladas |
| `tests/coolifyProductionTarget.test.ts` | Mismo contrato para producción y errores saneados, sin credenciales reales |
| `tests/verifyDeployedRelease.test.ts` | SHA/API/base/no-store, plazos y rechazo de respuestas inválidas usando dobles de red |
| `tests/ciWorkflowHardening.test.ts` | Permisos mínimos, toolchain y activación explícita de mutación |
| `tests/qualityGateWiring.test.ts` | Declaración de integración aislada obligatoria y ausencia de jobs de despliegue en CI; no ejecuta la integración |

Resultados locales:
`/Users/stark/Developer/Nortex/release-evidence/ready-20260919/release-control-tests.json`
y `.log`. Estas pruebas no verifican una cuenta real de Coolify ni sustituyen las
compuertas del producto, schema, seguridad o integración financiera.

No se ejecuta `release:preflight` en esta preparación: el wrapper invoca la
compuerta financiera que fue rechazada por revisión automática de permisos en
esta sesión. Ese bloqueo se conserva; no se reintenta por otra herramienta, un
wrapper o CI. Su resultado queda **no ejecutado**, nunca aprobado por inferencia.

## Comprobación manual del destino, sin desplegar

La revisión siguiente es de lectura. No pulsar Deploy, redeploy, save o webhook
para comprobar un dato. Las correcciones externas requieren el alcance autorizado
correspondiente; no se cambian silenciosamente para que pase una prueba.

1. Identificar por separado las apps de staging y producción en Coolify y su
   relación con el dominio público. Registrar referencia saneada, UUID y entorno;
   no copiar tokens, URLs completas de webhooks ni respuestas con variables.
2. Contrastar el origen raíz HTTPS confiable y el UUID con las variables del
   environment de GitHub. El origen no admite credenciales, ruta, query,
   fragmento ni espacios. No derivarlo del webhook.
3. Comprobar que los nombres de secretos existen en su environment y registrar
   quién administra su vigencia, sin leer valores: `COOLIFY_STAGING_READ_TOKEN`
   y `COOLIFY_STAGING_WEBHOOK` para staging; `COOLIFY_PROD_READ_TOKEN` y
   `COOLIFY_PROD_WEBHOOK` para producción. Si exige bearer, staging consume
   `COOLIFY_TOKEN` y producción `COOLIFY_PROD_DEPLOY_TOKEN`.
4. Comprobar en el gestor del proveedor el alcance efectivo de lectura. No pedir
   `write`, `read:sensitive` ni `root` para inspección. Tokens distintos no
   demuestran ACL distinta por app si Coolify los limita al equipo.
5. Registrar fuente de Git, build `dockerfile` o `dockercompose`, Auto Deploy
   apagado y pin de commit. La verificación API debe obtener el UUID esperado,
   `git_commit_sha` exactamente igual al candidato y
   `settings.is_auto_deploy_enabled === false`. Un checkbox visible no suple el
   booleano ausente en la API; no aceptar `HEAD`, rama, `null`, `0` o `"false"`.
6. Registrar si el pin observado difiere del candidato; no escribirlo durante
   esta lectura. Los verificadores existentes solo leen y fallan cerrado. El pin
   se fija después dentro de una promoción autorizada, sin ampliar el token de
   lectura.
7. Verificar la relación URL pública ↔ app y un health fresco HTTPS sin
   redirecciones: HTTP 200, API/base sanas, SHA completo y `no-store`. Una versión
   vieja sana sigue siendo un candidato distinto.
8. Revalidar política de ramas, reviewers, autoaprobación, bypass, separación de
   secretos y flags de habilitación. Registrar observaciones y diferencias; no
   activar una ruta de despliegue para probarla.

El paso fallido del run 35306106496 debe investigarse con su mensaje de error
saneado y la configuración viva antes de solicitar un nuevo staging. La presencia
de los contratos en Git no resuelve ese fallo externo.

## Trabajo pendiente antes de promover

| Entrega requerida | Evidencia necesaria para cerrarla |
|---|---|
| Identidad del candidato | Manifiesto, parche y dependencias preparados contra `67f1832…`; falta commit/SHA nuevo tras revisión. Avances remotos y modelos preservados |
| QA del conjunto | Prisma validate/generate, TypeScript, 1.877 pruebas deterministas, diseño y build/SEO aprobados. Integración real, dispositivos y modelo separados abajo |
| Dominio financiero e inventario | Integración MySQL 8 obligatoria sin omisiones y mutación pertinente cuando aplique; actualmente no ejecutadas para este conjunto, con el bloqueo indicado arriba |
| Schema y arranque | Upgrade desde el schema desplegado, reejecución y fallos parciales; `db push` no ejecuta los SQL de migración ni backfills |
| Destinos y control externo | Comprobaciones manuales anteriores y causa del staging fallido resuelta; no se acreditó el estado vivo de Coolify en esta preparación |
| Recuperación | Respaldo real reciente y restore vigente conforme a [backup/recovery](../.claude/skills/nortex-backup-recovery/SKILL.md); restauración conjunta de MySQL y originales privados si se habilitan adjuntos |
| Workers y archivos privados | Procesos durables, salud, volumen persistente compartido y `NORTEX_ASSISTANT_STORAGE_DIR` absoluto fuera del proyecto; el Compose base no los acredita |
| Activación de NortexGPT | Verificar interruptores por capacidad y permisos; la presencia de Haiku no habilita extracción, ejecución, promociones o WhatsApp por sí sola |
| Presupuesto | Validar en el candidato integrado US$2 mensuales por negocio y aumento mediante solicitud/aprobación de Nortex; conservar control global y reservas. No cambiar límites reales ni prometer cobro automático |
| Ayuda y calidad del modelo | Revisión humana por artículo/versión, evaluación reservada y piloto; la aceptación de conductas A/B/C no publica artículos ni acredita respuestas del proveedor |
| CI y staging | CI terminal del **nuevo SHA** y promoción manual a staging autorizada, con health y smoke de ese SHA; la CI de la base y el staging viejo no bastan |
| Producción | Alcance y autorización vigentes del candidato concreto, responsable de observación/recuperación y controles externos documentados; no solicitados ni ejecutados en esta preparación |

La revisión de las capacidades se mantiene en los contratos y planes de NortexGPT;
esta tabla es la lista de evidencias de release, no un segundo backlog de producto.
Después de cerrar los pendientes se aplica el runbook canónico. Una respuesta
incierta de un webhook no autoriza repetirlo: primero se recupera su estado.

