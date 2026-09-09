# Compatibilidad del panel Coolify y recuperación

## Hecho reproducido

El candidato `d51a948a4251b4b4a5676c5ff87ec982ac6e08d5` pasó los cuatro jobs del [CI de main](https://github.com/Noahstark23/nortex.20/actions/runs/34291897808). El [staging manual 34292339754](https://github.com/Noahstark23/nortex.20/actions/runs/34292339754) pasó `validate-staging-candidate` y se detuvo en `COOLIFY_AUTO_DEPLOY_NOT_DISABLED`, antes de solicitar un despliegue.

Coolify instalado: **4.1.2**. Auto Deploy está desmarcado en la interfaz, pero [GET application de esa versión](https://github.com/coollabsio/coolify/blob/v4.1.2/app/Http/Controllers/Api/ApplicationsController.php#L1963) no carga la relación `settings`. El modelo tampoco la precarga. Proyecto/environment, resources y MCP revisados no ofrecen una lectura alternativa del ajuste. Ampliar permisos no crea la relación; no se admite un booleano manual para sustituir la comprobación.

## Reparación de compatibilidad preparada

Los dos workflows usan POST explícito en las ramas con y sin bearer. [4.1.2 acepta POST](https://github.com/coollabsio/coolify/blob/v4.1.2/routes/api.php#L78); [4.2.0 lo exige](https://github.com/coollabsio/coolify/blob/v4.2.0/routes/api.php#L86). Se conservan URL/UUID, pin, token separado, timeout, salida descartada y ausencia de reintentos.

Cuatro casos reprodujeron el GET anterior; después del cambio, 176 pruebas pasan sin omisiones, incluida ejecución del shell con un doble de curl. Cubren método, URL/header, fallo HTTP y timeout sin segunda llamada ni fuga de credenciales sintéticas. TypeScript aprobado. Esto no acredita un despliegue ni el comportamiento de una instancia actualizada.

## Intervención de plataforma propuesta

Destino a evaluar: **4.3.18**, release estable publicado el 2026-09-08 y marcado no prerelease por GitHub al consultar. [Release oficial](https://github.com/coollabsio/coolify/releases/tag/v4.3.18). Su [GET application](https://github.com/coollabsio/coolify/blob/v4.3.18/app/Http/Controllers/Api/ApplicationsController.php#L2379) carga `settings`. No saltar a una versión implícita latest ni tratar el tag 4.2.0, marcado prerelease en la consulta, como una actualización estable acreditada.

Antes de cambiar el panel:

1. Comprobar acceso al servidor independiente de Coolify. El SSH directo intentado no autenticó; la consola dentro de Coolify no es recuperación independiente. DigitalOcean está abierto para verificar su Web Console desde un navegador que permita esa ventana. No se acreditó aún acceso root por esa vía.
2. Crear y verificar un respaldo privado del PostgreSQL **de Coolify**, conservar la clave de cifrado mediante el gestor autorizado y guardar copia fuera del host. Nunca imprimir la clave ni el contenido del dump. El restore MySQL de Nortex ya ejecutado no cubre estos datos del panel.
3. Registrar imagen/versión anteriores y configuración restaurable. Ensayar restauración aislada del panel; no iniciar workers o despliegues desde una copia con accesos a recursos reales. Revisar migraciones y cambios de roles/API de las versiones intermedias.
4. Revisar el procedimiento oficial de actualización para el tag fijado y una recuperación que funcione aunque el panel no arranque. No considerar un downgrade de imagen suficiente si cambió el schema del panel.
5. Con recuperación acreditada, ejecutar una única actualización controlada, comprobar acceso/API/tokens y roles. No iniciar simultáneamente el release de Nortex, no actualizar Docker/proxy/OS por inferencia ni modificar datos de comercios.
6. Verificar lectura autenticada del UUID, pin exacto y `settings.is_auto_deploy_enabled === false` en ambos destinos. Conservar Auto Deploy apagado.
7. Promover el nuevo SHA de Nortex mediante las rutas canónicas: CI final → staging manual → prueba financiera sintética conciliada → producción autorizada → salud/SHA y prueba financiera → observación mínima de 30 minutos.

[Procedimiento oficial de respaldo/restauración](https://coolify.io/docs/knowledge-base/how-to/backup-restore-coolify) y [actualización](https://coolify.io/docs/get-started/upgrade). La copia fuera del host y la clave de cifrado se manejan de forma privada, nunca en Git ni en el chat.

## Estado de cierre

**Preparado:** contrato POST, pruebas locales, fuente del proveedor, plan de recuperación y guion de prueba financiera con identidades persistentes.

**No ejecutado:** actualización de Coolify, respaldo/restauración de su panel, despliegue del nuevo Nortex en staging o producción, prueba financiera remota y observación. La producción continúa en `2834497f6090c2d55bcc48d5edb86887f6993ae3`; staging, en `38e9c6f2ae0809fecff9d6edd09204dc4c756fe8` en el último health observado. API y MySQL responden sanos.

No se retiró ninguna compuerta para publicar. Las capacidades IA/adjuntos/ejecución del asistente continúan sujetas a sus contratos, evaluación y habilitación independiente.

## Seguimiento posterior de esta misma promoción

El bloqueo descrito arriba se resolvió: Coolify fue actualizado realmente a 4.3.18 después de respaldar y ensayar su recuperación; la API satisfizo las guardas sin ampliar permisos. Staging y producción del SHA `07f30c9` terminaron exitosamente y sus pruebas financieras sintéticas pasaron. El apartado anterior «No ejecutado» conserva el estado del intento inicial; para el cierre y la observación posterior consultar el [expediente de producción](2026-09-08-production-verification.md).
