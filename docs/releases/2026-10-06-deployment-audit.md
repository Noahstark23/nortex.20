# Auditoría de despliegue — 2026-10-06

Responsable de la reparación: Codex. Responsable de promoción: Noahstark23.
Base revisada: `a0f05a0a36a5cac94adf6a828ca575d0146b8bca`.
Alcance: bloqueo de empaquetado, auditoría de dependencias, workflow Android y
clasificación de los 14 PR abiertos. No es una auditoría funcional completa de
todos los módulos ni autoriza producción.

## Hallazgos reproducidos

1. **P1 — CI verde no verificaba el paquete real.** El run de staging
   [37394096621](https://github.com/Noahstark23/nortex.20/actions/runs/37394096621)
   validó el pin y solicitó el despliegue, pero terminó con `COMMIT_MISMATCH`.
   El log de Coolify del despliegue `oivfoazoloo4z2ueyoauxnjt` identifica la causa:
   `NORTEX_BUILD_CLIENT_MISMATCH` en el sellador, después de build/SEO y prune.
   Los contratos esperaban el cliente del hotfix: 143 modelos, 1.735 columnas.
   El cliente Prisma 6.4.1 generado por main tiene 153 modelos, 1.855 columnas y
   SHA-256 `01ea9516c27d0cf279e539b44b6e28c9de82f32d3a652366e49c389412639da4`.
   Una prueba contra el checkout real reprodujo el mismo error antes de corregir
   los contratos; las ocho pruebas anteriores con fixtures seguían pasando.

2. **P1 — tres dependencias de producción vulnerables.** El CI reciente del
   candidato antiguo [37497771316](https://github.com/Noahstark23/nortex.20/actions/runs/37497771316)
   falla en `npm audit`. La auditoría del lockfile de main reproduce dos críticas
   y una alta: [Capacitor](https://github.com/advisories/GHSA-rvm3-566m-v7fv),
   [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) y
   [compression](https://github.com/advisories/GHSA-vc2v-76pw-4v95).
   Reparación acotada: Android 6.2.2, compression 1.8.2, proxy-addr 2.0.8.
   La auditoría de producción posterior devuelve cero vulnerabilidades.
   Esto no cambia el lockfile de los candidatos históricos C′/B′.
   La auditoría completa, incluyendo herramientas de desarrollo, aún reporta 16
   paquetes afectados (1 crítico, 11 altos, 4 moderados). Incluye `tar` bajo
   Capacitor CLI, el árbol de Tailwind 3 y dependencias de pruebas/build. No se
   afirma cero vulnerabilidades globales: `npm audit fix --force` propone cambios
   mayores de Capacitor y Tailwind que requieren una entrega y validación propias.
   La imagen elimina devDependencies con `npm prune --omit=dev`.

3. **P2 — Android intenta instalar un paquete retirado.**
   [37381305010](https://github.com/Noahstark23/nortex.20/actions/runs/37381305010)
   termina en `Failed to find package 'tools'`. Se configura explícitamente
   `packages: platform-tools`, conservando setup-android v3; el paquete `tools`
   ya no es necesario según la [documentación del proveedor](https://github.com/android-actions/setup-android#the-deprecated-tools-package).
   Se fija Node 22.23.2 y se impide que npx descargue Prisma/Capacitor distintos.

4. **P1 — main y la excepción del hotfix tienen alcances de schema distintos.**
   La diferencia incluye diez modelos de WhatsApp y tres campos de WhatsAppChannel.
   Staging conserva un fingerprint de schema expandido; producción conserva otro,
   anterior. La reparación actualiza únicamente el contrato del cliente construido.
   No acredita que producción soporte esos modelos, no altera fingerprints de BD
   ni habilita DDL. La promoción de main requiere resolver esa compatibilidad,
   acreditar backup off-site/restauración y pasar staging y smoke del SHA exacto.

5. **P1 — producción todavía usa los comandos anteriores al paquete.**
   Coolify muestra `docker compose --profile assistant-worker build` y
   `docker compose --profile assistant-worker up -d`. El Dockerfile actual exige
   la identidad creada por `nortex-release.sh` y el overlay que conserva imágenes,
   volúmenes y schema. Antes de promover un paquete hay que preparar los comandos
   `sh scripts/nortex-release.sh production prepare` y
   `sh scripts/nortex-release.sh production start`, comprobar variables/pins y
   resolver la disponibilidad del env-file sin imprimirlo. El pin productivo sigue
   en `bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4`; Auto Deploy está desactivado y
   Source Commit está disponible durante build. No se modificó el panel.

## Estado vivo observado

El 6 de octubre, ambos `/api/health` respondieron HTTP 200, `ok=true`, `db=up`
y `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.

| Entorno | SHA servido |
|---|---|
| Staging | `df6fc095fe8da39b4829336e79b78e4454997046` |
| Producción | `bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4` |

Esto acredita disponibilidad básica, no el smoke autenticado ni una release nueva.
El main más reciente tiene CI histórico verde, pero no alcanzó staging.
Staging en Coolify muestra cambios pendientes y un comando build que copia
temporalmente el env-file del proveedor. No se guardó ni modificó esa configuración.
La pantalla Storage backups de producción muestra cero programaciones y ejecuciones;
eso no audita el servicio `backup` del Compose ni demuestra ausencia de copias S3.
No se obtuvo evidencia actual de backup off-site/restauración real. El smoke de CI
usa datos sintéticos y no sustituye esa evidencia.

`DEPLOY_GUIDE.md`, `CLAUDE.md` y la skill de deploy contenían recetas anteriores al
paquete (entrypoint con DDL y candidatos C/B originales). Se reconciliaron con el
Dockerfile, el manifiesto C′/B′ y el runbook vigentes para evitar repetirlas.

## Cola de PR

Todos estaban en draft al inspeccionarlos. Los checks verdes son históricos y
no acreditan que su integración actual pase ni que su contenido esté desplegado.

| PR | Resultado de la clasificación | Tratamiento |
|---|---|---|
| #248 | Una línea de verificación GSC; CI verde | Independiente del bloqueo de release |
| #244 | Contrato OAuth, solo documentación | Independiente; no implementa OAuth |
| #241 | Su HEAD ya es ancestro de main; CI reciente falla por dependencias | Conservar como expediente de C′, no volver a integrarlo ni avanzar la referencia inmutable |
| #238 | Integra admin/fiscal/laboral, 64 archivos | Revisar como entrega propia con schema y QA; contiene #234/#236/#237 |
| #237 | Ancestro de #238 | Evitar integrar dos veces la misma entrega |
| #236 | Ancestro de #238; base #234 | Prueba fiscal apilada, no un bloqueo independiente |
| #234 | Ancestro de #236 y #238 | Revisar dentro de la entrega fiscal |
| #223 | Diagnóstico histórico, solo documentación | Conservar su fecha y candidato |
| #222 | 82 archivos y conflicto con main | Requiere reparación/revisión funcional propia; no mezclar con infraestructura |
| #218 | Descuento POS, 6 archivos | Entrega de producto independiente |
| #52 | Manual histórico, sin checks | Reconciliar con el producto antes de integrar |
| #15 | Plan contable histórico, sin checks | Documento de planificación |
| #6 | Dockerfile/PWA antiguos y conflicto | Reconciliar con el sistema de release/PWA vigente |
| #3 | Automatización headless antigua, sin checks | Revisar permisos y compatibilidad antes de habilitar |

Ningún PR fue cerrado ni integrado como parte de esta clasificación.

## Prevención implementada

- Verificar manifiesto de fuentes y cliente real en la suite normal.
- Comparar modelo/columnas/versión del cliente generado con ambos contratos.
- Ejecutar build SEO y el sellador de imagen en `verify`, además de los fixtures.
- Mantener CI sin acceso a staging/producción, sin webhooks ni DDL remoto.
- Mantener las referencias y manifiesto de la excepción C′/B′ sin modificaciones.

## Verificación de la reparación

La evidencia final de pruebas y el SHA del candidato se registran en el PR de
esta reparación. La reproducción inicial queda identificada arriba. Un build
corregido no equivale a staging, autorización, producción ni observación de 30 min.
