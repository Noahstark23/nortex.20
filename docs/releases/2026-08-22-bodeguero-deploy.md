# Despliegue del rol BODEGUERO — 2026-08-22

Release de aplicación: `ec8018443d3d1d00954823d1845d9e4ebf51b226`  
Versión anterior conocida en producción: `ba7beb9bdf8d0af025652e613609fb55741553c7`

## Estado actual

- CI de la release: aprobado (`32596136522`).
- Android: aprobado (`32596136523`).
- Producción: sana, pero todavía sirve `ba7beb9`.
- Staging: responde `503` y debe recuperarse antes de habilitar despliegues.
- Variables públicas: cargadas; `NORTEX_DEPLOY_ENABLED=false` mantiene el deploy deshabilitado.
- Environments: `staging` creado; `production` creado con aprobación requerida de `Noahstark23`.
- Secrets de Coolify: todavía no configurados.

## Configuración requerida

Variables públicas del repositorio:

- `NORTEX_DEPLOY_ENABLED`: mantener en `false` hasta completar este checklist; cambiar a `true` para habilitar la compuerta.
- `STAGING_URL`: `https://staging.somosnortex.com`
- `PROD_URL`: `https://somosnortex.com`

Secrets de GitHub Actions:

- `COOLIFY_STAGING_WEBHOOK`
- `COOLIFY_PROD_WEBHOOK`
- `COOLIFY_TOKEN` solo si los webhooks requieren bearer token

En Coolify, `Auto Deploy` debe quedar apagado para staging y producción. GitHub Actions es la única ruta autorizada para promover esta release.

## Pre-deploy

- [x] Typecheck, tests, auditoría de dependencias, mutación y build aprobados.
- [x] Upgrade de schema probado contra MySQL 8 con datos legados.
- [x] Migración aditiva; los conteos históricos no se reasignan a una bodega inventada.
- [x] QA real con un usuario `BODEGUERO` y dos bodegas.
- [x] Variables públicas del repositorio cargadas con el deploy deshabilitado.
- [x] Environments `staging` y `production` creados; producción requiere aprobación.
- [ ] Tomar y verificar un backup de MySQL antes de la primera promoción.
- [ ] Confirmar espacio disponible y ausencia de transacciones largas o metadata locks.
- [ ] Staging vuelve a responder por HTTPS.
- [ ] Secrets de Coolify cargados.
- [ ] `Auto Deploy` apagado en ambas aplicaciones de Coolify.

## Ejecución

1. Mantener `NORTEX_DEPLOY_ENABLED=false` mientras se carga y valida la configuración.
2. Recuperar staging y comprobar que su dominio apunta a la aplicación correcta de Coolify.
3. Cargar los webhooks como secrets y las URLs como variables del repositorio.
4. Cambiar `NORTEX_DEPLOY_ENABLED=true`.
5. Ejecutar manualmente el workflow `CI` sobre `main`.
6. Confirmar que `deploy-staging` observa simultáneamente:
   - HTTP `200`;
   - `ok: true`;
   - `db: "up"`;
   - `commit` igual al SHA exacto del workflow.
7. Aprobar el environment `production` solo después del smoke funcional de staging.
8. Confirmar las mismas cuatro condiciones en `deploy-production`.

## Smoke funcional

En staging, y luego en producción:

- Iniciar sesión como `BODEGUERO` y confirmar aterrizaje en Bodegas.
- Confirmar que solo aparecen Bodegas, Conteo físico y Recibir mercadería.
- Consultar existencias sin precios ni costos.
- Ajustar pérdida/merma y ganancia/hallazgo indicando bodega.
- Crear y cerrar un conteo entero por bodega.
- Recibir parcialmente una orden de compra indicando destino.
- Confirmar `403` en equipo, finanzas, POS, RRHH y administración.
- Hacer una venta con un rol autorizado e imprimir el ticket de 80 mm.

## Observación posterior

Durante al menos 15 minutos:

- vigilar respuestas `5xx` y reinicios del contenedor;
- vigilar errores del preflight o Prisma;
- revisar incrementos inesperados de `403` para rutas operativas;
- comprobar que stock local y agregado coinciden después de ajustes, conteos y recepciones.

## Disparadores de rollback

- `/api/health` no queda sano con el SHA esperado en ocho minutos;
- login o navegación del `BODEGUERO` falla;
- una ruta prohibida deja de responder `403`;
- una mutación escribe en una bodega distinta a la seleccionada;
- conteos o recepciones dejan stock local y agregado incoherentes;
- el POS o la impresión de 80 mm dejan de funcionar para roles autorizados.

## Rollback

1. Detener la promoción si el fallo ocurre en staging.
2. En producción, volver desde Coolify al deployment conocido `ba7beb9` o revertir los cuatro commits de la release en orden inverso.
3. No eliminar las columnas, índices ni la FK agregados a `StockCount`: son aditivos y compatibles con la aplicación anterior. Un rollback destructivo del schema convertiría una recuperación de aplicación en riesgo de pérdida de datos.
4. Repetir `/api/health`, login, POS y lectura de inventario después de volver a la versión anterior.
