# Nortex: informe de despliegue y prevención — 6 de octubre de 2026

Estado: candidato desplegado en producción y smoke aprobado. Observación de 30 minutos en curso desde 19:51:40 UTC; el cierre final se completará con esa evidencia.

## Alcance autorizado

El propietario autorizó integrar y desplegar la versión revisada y preparar este informe. PR #254 se integró a las 19:12:49 UTC: `67bc53092c21679565c0c62934d5de8f3b7bc51a`. Alcance: correcciones de crédito POS, alta rápida de existencias, bodegas, checkout móvil, código comercial de WhatsApp con envío apagado, dependencias y protección del despliegue. No se incluyen las demás PR abiertas ni capacidades nuevas de PayPal/Meta.

## Por qué se acumuló el retraso

1. **Identidades distintas:** el pin de Git, el SHA declarado por una variable manual y la confirmación del arranque no coincidían. Una imagen correcta podía ser rechazada después del corte.
2. **Cliente y esquema desalineados:** el cliente nuevo esperaba 153 modelos; producción todavía tenía 143 tablas. El contrato histórico no representaba la expansión comercial pendiente.
3. **Pruebas incompletas del despliegue:** compilar y pasar pruebas de código no había acreditado el CMD real ni el comportamiento de Coolify ante un fallo de preparación.
4. **Configuración manual y recetas desactualizadas:** comandos temporales, rutas históricas y pasos repartidos entre informes provocaban reintentos que no corregían la misma causa.
5. **Entregas acumuladas:** UI, migraciones y reparación de infraestructura llegaron juntas al momento de desplegar, ampliando el diagnóstico y la recuperación.

## Correcciones implementadas

- PR #253 alineó contratos de cliente/fuentes, sellado de imagen, dependencias y compilación Android.
- PR #254 incorpora en CI la imagen real AMD64, CMD, migración sintética y fallo de preparación que conserva el contenedor anterior.
- `prepare` comprueba identidad y compatibilidad de la imagen antes de que Coolify retire la aplicación viva; el arranque repite el control sin aplicar DDL.
- En el despliegue real de staging, `prepare` produjo PASS con 153 modelos, 1.855 columnas y cero DDL antes de retirar los contenedores anteriores.
- Gestión temporal de `.env` con modo 0600, limpieza al salir y conservación de archivos existentes.
- Comandos estables `nortex-release.sh <entorno> prepare/start`; identidad automática de Coolify y pin exacto.
- No se habilita `--accept-data-loss`, no se reducen pruebas ni se desactivan aprobaciones.

## Evidencia de esta intervención

- [PR #254](https://github.com/Noahstark23/nortex.20/pull/254): fusionada.
- [CI de main](https://github.com/Noahstark23/nortex.20/actions/runs/37517256477): SUCCESS: verify, deploy-schema-smoke, backup-restore-smoke e integration-required.
- Respaldo nuevo off-site: ejecución finalizada con código 0.
- Descarga desde el almacenamiento externo y SHA-256 coincidente antes del restore.
- `verify-backup-restore.sh`: PASS en MySQL temporal sin red, 143 tablas y 53.698 filas recuperadas; no se restauró sobre producción. El ensayo usa 768 MiB y 0,75 CPU como límites.
- Ensayo de las tres migraciones sobre la copia real restaurada: PASS; 143 tablas y 53.698 filas originales conservaron sus conteos. Fingerprint resultante `7941abbd1ab5a72d5df3028c8ef755427bdf8e85042bff37bd224964502b8bb2`.
- Recuperación ensayada: el código de producción anterior arrancó sobre la copia ampliada usando un adaptador con gate de solo lectura y sin `db push`; se conserva como imagen local para recuperación. No se desplegó ese adaptador a clientes.
- [Staging del candidato](https://github.com/Noahstark23/nortex.20/actions/runs/37518794196): SUCCESS; health del SHA exacto, siete controles del smoke sintético y cinco comprobaciones públicas aprobados.
- Producción: migraciones aplicadas entre 19:38:14 y 19:38:24 UTC, fingerprint final exacto. La aplicación anterior continuó respondiendo.
- [Promoción productiva](https://github.com/Noahstark23/nortex.20/actions/runs/37520527985): SUCCESS a las 19:51:35 UTC; environment aprobado bajo la excepción de fundador único. Siete controles funcionales y cinco públicos aprobados en producción. Observación posterior en curso.

La preparación productiva acreditó el gate a las 19:49:42 UTC antes de retirar los contenedores (19:49:45). El stack nuevo quedó sano a las 19:51:29. El reemplazo produjo una interrupción temporal observada durante el corte; no se midió su duración exacta ni se afirma cero downtime.

Imagen productiva: `sha256:3fc32a7506306d38822bbba47295593037764da93a7db61de878f9ea698164fe`.

Respaldo posterior: 19:56:43 UTC, 153 tablas, carga off-site verificada; su recibo está adjunto. La restauración ensayada corresponde al respaldo previo, seguido de las migraciones sobre esa copia.

## Cadencia operativa para las próximas entregas

Objetivo operativo: cambios pequeños a producción en 24–48 horas desde que están listos; **cinco días es el límite de escalamiento, no el tiempo normal de despliegue**. Es una política de trabajo, no una garantía de ausencia de fallos.

| Momento | Acción | Responsable |
|---|---|---|
| Durante desarrollo | Una capacidad por PR; identificar desde el inicio migración, flag, prueba y recuperación. | Implementador |
| Al abrir la PR | CI, imagen real y prueba de la ruta afectada; resolver el primer fallo antes de volver a disparar. | Implementador |
| Mismo día de integración | Staging del SHA exacto y smoke sintético documentado. | Responsable de release |
| 24 h bloqueado | Registrar error exacto, dueño y reparación concreta; escalar al fundador. | Responsable de release |
| 48 h bloqueado | Dividir el lote y entregar lo independiente que esté verificado; mantener la parte insegura desactivada. | Fundador + implementador |
| Antes de 5 días | Decidir y ejecutar entrega acotada, corrección o reversión. No continuar reintentando sin diagnóstico. | Fundador |
| Producción | Backup/restauración cuando cambia schema, aprobación vigente, SHA/health, smoke y observación. | Responsable de release |

Para PayPal y Meta: trabajar en incrementos independientes, demostrables y con flags; registrar para cada uno demo, aceptación, bloqueo y siguiente entrega. Este informe no certifica inscripciones, fechas límite ni funcionalidades de esos hackatones.

## Límites que deben permanecer visibles

CI sintético no prueba clientes reales. Health acredita infraestructura, no una venta. Código de WhatsApp desplegado no significa conexión, recepción ni envío comercial habilitados. La protección evita los fallos reproducidos; no permite prometer que ningún despliegue volverá a fallar.

## Rendimiento y deuda pendiente

Coolify v4.3.18 inyecta argumentos de build al Dockerfile. Su propio código indica que desactivar esa inyección preserva la caché; la configuración revisada todavía la mantiene activa. Este release registró recompilación de paquetes del sistema y `npm ci`, aunque se trataba de una corrección de scripts. La mejora de caché debe probarse con las variables públicas realmente necesarias antes de modificar esa configuración.

La imagen final auditó 249 paquetes de runtime y reportó cero vulnerabilidades conocidas. Permanecen 16 avisos en herramientas de desarrollo (1 crítico, 11 altos y 4 moderados), ya documentados: no están corregidos por esta entrega. Actualizarlos por lotes compatibles, sin `npm audit fix --force`.

El servidor compartido tiene aproximadamente 4 GiB de RAM; durante el build se observaron 1,8 GiB disponibles y 1,9 GiB de swap usados. El ensayo temporal quedó detenido al terminar. Separar o limitar la construcción es una mejora posterior; no se contrató infraestructura nueva.

## Recuperación preparada

Imagen local retenida: `nortex-recovery:20261006`, ID `sha256:38eff864084e56ef0edf561ecc447d7375c9af895a2d5c77d54174c4710bf62e`. Conserva el producto de `bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4` y agrega el launcher/gate que comprueba el esquema expandido sin ejecutar DDL. La base de esa imagen fue la imagen productiva retenida `sha256:74f0c5041c8adc9e0ab5c2fa39217fef7aeee04d23ca3631fb3cdcf57218a433`.

El ensayo aislado devolvió HTTP 200, `db=up`, commit anterior correcto y `Cache-Control: no-store`. No es una reversión ya ejecutada ni una imagen publicada en un registro. No usar automáticamente el botón antiguo de rollback: el entrypoint histórico intenta sincronizar schema y no es el procedimiento ensayado. Una recuperación debe conservar la expansión y pasar por la decisión y controles de release correspondientes.

Ventana de intervención: sesión autorizada del 6 de octubre, desde la integración de PR #254 hasta el cierre de la observación posterior. Propietario y cuenta GitHub iniciadora/aprobadora: Noahstark23. Ejecución asistida por Codex; no hubo revisión humana independiente.

## Evidencia adjunta

- [CI exacto de main](../evidence/release-20261006/ci-main-67bc530.json).
- [Respaldo y recuperación](../evidence/release-20261006/respaldo-y-recuperacion-20261006.json).
- [Migraciones productivas](../evidence/release-20261006/migracion-produccion-20261006.json).
- [Smoke funcional de staging](../evidence/release-20261006/staging-67bc530-functional-smoke.json).
- [Páginas y assets de staging](../evidence/release-20261006/staging-67bc530-public-smoke.json).

- [Promoción GitHub](../evidence/release-20261006/promocion-produccion-67bc530.json).
- [Smoke funcional productivo](../evidence/release-20261006/production-67bc530-functional-smoke.json).
- [Páginas y assets productivos](../evidence/release-20261006/production-67bc530-public-smoke.json).

## Trabajo que sigue abierto

La consulta de GitHub durante el cierre encontró 14 PR abiertas, todas en borrador. No equivalen a 14 fallos del servicio: reúnen propuestas antiguas, documentación e incrementos de producto todavía sin integrar. Este release no las certifica ni las despliega por su sola presencia.

- Admin/fiscal/laboral: #234, #236, #237 y #238; revisar dependencias y entregar por capacidad.
- OAuth y SEO: #244 y #248; separar contrato de proveedor y verificación externa.
- Crédito histórico #241: el release normal contiene la corrección; revisar y archivar el borrador redundante sin reutilizar sus receipts.
- UX/documentación/PWA/automatización: #222, #223, #218, #52, #15, #6 y #3; reconciliar contra main antes de rescatar o cerrar.

Inventario fechado: [PR pendientes](../evidence/release-20261006/pr-pendientes-20261006.json). No se hizo una revisión exhaustiva de sus diffs en este cierre.

Los runs también muestran advertencias de mantenimiento de `actions/checkout@v4` y `actions/setup-node@v4`, ejecutadas por GitHub sobre Node 24, y un aviso de cambio futuro de `ubuntu-latest`. La ejecución de hoy pasó; preparar una actualización independiente de Actions/runner con sus pruebas antes de la siguiente tanda grande. No se atribuyen estos avisos al runtime Node 22 de Nortex.

- [Respaldo posterior](../evidence/release-20261006/respaldo-posterior-20261006.json).
- [Estado de servicios y flags](../evidence/release-20261006/runtime-produccion-67bc530.json).

## Cierre del controlador histórico

Esta PR desactiva `credit_hotfix_20261001` en el manifiesto. Los escenarios históricos siguen ejecutándose con una copia fija del manifiesto activo, disponible sólo en sus dos suites; el código de producción del verificador no cambia. Una prueba separada con el manifiesto real inactivo rechaza promover/recuperar antes de Git, HTTP o REST. La ruta normal de main conserva sus controles.

Validación local del cierre: 408 pruebas en cinco suites aprobadas dentro de Docker con Node 22.23.2, sin red. La prueba nativa de macOS quedó impedida por la política de carga del binario Rollup; TypeScript en el contenedor local agotó memoria. El resultado integral se acreditará con el CI remoto del commit final, sin presentar estos intentos como aprobados.
