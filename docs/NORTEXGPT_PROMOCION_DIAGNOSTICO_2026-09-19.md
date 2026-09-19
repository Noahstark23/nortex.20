# NortexGPT · diagnóstico de promoción autorizada — 2026-09-19

**Producción solicitada por el dueño; resultado actual NO-GO.** Este addendum
actualiza la investigación posterior a la entrega preparada. No modifica el
artefacto congelado, su evidencia de QA ni los controles del workflow.

## Autorización y candidato

El usuario pidió cerrar las cinco compuertas y continuar hasta desplegar. Esa
petición incluye la promoción de esta entrega dentro de sus condiciones; no falta
volver a pedir una autorización genérica de despliegue. La autorización no aprueba
pruebas faltantes ni elimina restricciones de la plataforma.

Candidato: `/Users/stark/Developer/Nortex/candidates/nortexgpt-release-ready-20260919`.
Base y main actual: `67f1832502ee68ef67ac12b0803bdbfce48a4cef`. Se volvieron a
comprobar los 1.769 hashes de fuente y el parche: cero diferencias. No se creó un
nuevo commit ni se disparó CI, porque todavía faltan sus compuertas previas.
El checkout con trabajo del usuario y el candidato congelado se conservan.

## Causa exacta de staging, ahora acreditada

El [run 35306106496, job 105478540313](https://github.com/Noahstark23/nortex.20/actions/runs/35306106496/job/105478540313)
registró **`COOLIFY_COMMIT_NOT_PINNED`** el 2026-09-18 a las 04:13:15 UTC.
La API respondió con la app correcta, pero `git_commit_sha` no era el candidato
`67f1832…`. El mensaje no acredita el valor recibido aquel día. Webhook y health
fueron omitidos; build y Auto Deploy se verifican después de ese punto y no se
pueden dar por aprobados mediante el run fallido.

La lectura de la interfaz autenticada de hoy muestra **`98e54afad4bfa7a0ef5ae99c902102d40d0400ff`**
fijado tanto en staging como producción. Los UUID de ambas apps coinciden con
las variables de sus environments GitHub. Ambas usan Compose; la UI muestra
`Manual deployments only`. El dominio staging pertenece a su app, y
`somosnortex.com` a producción, servicio `app`/puerto 3000.

Esto cierra la causa desconocida del expediente anterior; no cierra la promoción.
Hay que fijar cada app al SHA NUEVO exacto una vez que esté revisado, vigente y con
CI aprobada, y ejecutar las guardas API completas. No sirve repetir el workflow
fallido ni cambiar hoy el pin a la base antigua para simular avance.

Los health frescos del 2026-09-19 a las 23:00 UTC respondieron HTTP 200, API/base
sanas, `no-store` y `98e54af…` en ambos entornos. La versión actual continúa sana;
no es el nuevo NortexGPT. No se pulsaron Save, Reset, Deploy o webhooks. La UI
mostraba avisos de cambios no guardados al abrir formularios, antes de editar;
se conservaron y no se usaron para afirmar que una escritura hubiera ocurrido.

## Operación y respaldo

| Comprobación | Resultado observado | Límite |
|---|---|---|
| Volúmenes de ambas apps | Solo `/var/lib/mysql` y `/var/backups/nortex` | No aparece un volumen privado de originales de facturas |
| Arranque de staging | Custom build `docker compose build app`; start `docker compose up -d app` | No materializa workers ni el servicio backup mediante ese comando |
| Arranque de producción | Compose, comandos custom vacíos; consola lista app, backup y db | No aparece worker del asistente en esos contenedores. No se auditó todo proceso externo del host |
| Workers en el candidato | Dockerfile/entrypoint inicia API; Compose no define workers de asistente/WhatsApp privado | Faltan servicios/volumen/permisos/salud antes de habilitar esas capacidades |
| Storage backups de Coolify | Cero schedules/ejecuciones configurados en esa superficie | No equivale a ausencia del planificador SQL propio |
| Backup SQL propio | Último comprobante local y remoto: `2026-09-19T09:15:08Z`, 1.673.206 bytes, 135 tablas, verificado | Metadata del respaldo; no se exponen filas, destino ni credenciales |
| Integridad off-site | Se leyó el objeto exacto como flujo opaco y su SHA-256 coincide con el comprobante: `2b35fefd…5085643e` | No se guardó ni mostró su contenido. No acredita restauración |
| DigitalOcean | Droplet activo, 2 vCPU/4 GB/80 GB; no figura feature de Automated Backups | Distinto del respaldo SQL off-site, que sí se verificó. No es ensayo de carga/capacidad |

El primer intento de leer el dump usó una ruta sin el prefijo año/mes y falló; no
se aceptó su hash de flujo vacío. Se corrigió usando el destino exacto del
comprobante, dentro del bucket configurado; el flujo completo sí coincidió.
No se generó otro backup, no se restauró base alguna y la sesión de terminal se
cerró. No se inició un worker.

El informe de operación señala una condición de recuperación concreta: el worker
principal ejecuta limpieza aunque las llamadas IA estén desactivadas. Debe estar
**detenido** mientras se valida SQL + originales restaurados; apagar flags de IA
no basta. La copia SQL actual no contiene por sí sola los archivos de facturas.

## Bloqueo de plataforma: precisión de la evidencia

El registro original localizado corresponde al agente `final_qa`, mostrado como
`errored` el 2026-09-12 a las 18:58:56 UTC. Motivo textual:

> This content was flagged for possible cybersecurity risk.

El aviso remitía al acceso autorizado de ciberseguridad de la plataforma. Esto es
un rechazo del agente de QA, **no una aserción MySQL fallida ni evidencia de que
un comando financiero llegara a ejecutarse**. No hay confirmación registrada de
que esa restricción se haya levantado. El texto original de la tarea estaba
cifrado en el registro y no se intentó decodificarlo.

No se lanzó la misma comprobación mediante otro agente, CLI, wrapper o CI. El
mandato de producción del dueño y la sesión de Coolify no levantan ese bloqueo.
Se solicitó confirmar si el acceso de plataforma fue resuelto desde entonces.

## Orden que queda pendiente

1. Resolver el bloqueo de plataforma para retomar la comprobación rechazada. La
   QA MySQL obligatoria del candidato, mutación pertinente y upgrade/restore
   conservan estado **no ejecutado**, no verde por los tests simulados anteriores.
2. Materializar y probar workers/volumen privado/permisos/retención y recuperación
   coordinada, con límites y servicios detenidos durante el drill. Hay contrato
   explícito en `operation-contract.json`; no arrancar workers contra clientes
   para probar esa configuración.
3. Completar QA de experiencia, artículos/expected y evaluación/piloto de cada
   capacidad que se habilite; aceptar el informe W01 en su entrega propia.
4. Crear el nuevo SHA sobre main vigente; CI terminal, pin de staging correcto,
   guardas API, despliegue y smoke del mismo SHA; después promoción a producción,
   salud, conciliación y observación conforme al runbook. No modificar protecciones
   ni repetir un webhook de resultado incierto.

La continuación está autorizada, pero un bucle no puede convertir estas
condiciones en aprobadas. El estado es **NO-GO**, con producción anterior sana.

## Preparación independiente completada después del diagnóstico

Se preparó `operations-draft/docker-compose.assistant.yml` en el directorio de
evidencia, acompañado por `README.md` y `ACCEPTANCE.md`. Es un borrador separado:
no modifica el candidato congelado, no está integrado en Git y no se aplicó a Coolify.
Añade volumen privado por entorno, imagen compartida y dos workers con perfiles
fuera del arranque normal; conserva el CMD de la API que sincroniza el schema.

La combinación estática con Compose 5.5.0 pasó **28/28 comprobaciones** utilizando
solo valores sintéticos y un entorno aislado, sin leer `.env` ni iniciar servicios.
Se verificaron preservación de DB/backup/API, perfiles, volumen, imagen y defaults
apagados. La primera invocación no encontró el plugin en el entorno aislado; se
usó el binario Compose ya instalado. Una aserción inicial esperaba claves ausentes,
pero Compose representa `command` y `entrypoint` heredados con `null` en ambas
configuraciones; se contrastó base y overlay y se corrigió la aserción. Ambos
antecedentes se conservan en `operations-draft/static-validation.json`.

Esto no sustituye la QA bloqueada. Siguen faltando heartbeat operativo, ensayo de
colas/reinicio/permisos, límites bajo carga y respaldo/restore de originales antes
de activar los workers. La inspección también mostró que el extractor reclama
jobs antes de comprobar capacidades; no basta con apagar flags para conservar una
cola durante restore: se debe detener el proceso. No se reprodujo este escenario.

## Evidencia saneada

Directorio: `/Users/stark/Developer/Nortex/release-evidence/promotion-20260919/`.

- `promotion-status.json`: autorización, candidato y procedencia del bloqueo.
- `staging-failure-sanitized.json`: causa exacta del run fallido.
- `github-target-match.json`: UUIDs y main actual.
- `coolify-ui-observations.json`: configuración observada, sin valores secretos.
- `public-health.json`: salud y SHA de ambos entornos.
- `backup-readonly-verification.json`: metadata y hash remoto, con límites.
- `droplet-metadata.json`: recursos del servidor y límite de esta lectura.
- `operation-contract.json`: diez componentes, seis pasos y 41 fuentes del candidato
  verificadas contra el manifiesto, sin diferencias.
