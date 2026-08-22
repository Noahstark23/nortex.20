# Release de comercios medidos y balanzas — 2026-08-22

PR candidato: [#170](https://github.com/Noahstark23/nortex.20/pull/170)

Versión anterior observada en producción:
`ba7beb9bdf8d0af025652e613609fb55741553c7`.

El SHA objetivo no se copia a mano en este documento. La promoción usa el SHA
exacto de `main` entregado por GitHub Actions y `/api/health` debe devolver ese
mismo valor en `commit`.

## Estado de preparación

- TypeScript, Prisma 6.4.1, suite completa, diseño, mutación y build: aprobados.
- Suite integrada local: 94 archivos y 1,242 pruebas activas; 14 integraciones
  omitidas en esa corrida ya fueron validadas 14/14 con backend y MySQL 8.
- Mutación: 1,905 instrumentados; 1,873 `Killed`, 4 `Timeout`, 8 equivalentes
  históricos, 0 `NoCoverage`, umbral `99.57` aprobado.
- Upgrade MySQL 8 descartable: aprobado con fresh install, histórico, redeploy,
  carrera de dos entrypoints y estados adversariales fail-closed.
- Producción: sana, todavía en la versión anterior.
- Staging: responde `503`; no se puede promover hasta recuperarlo.
- `NORTEX_DEPLOY_ENABLED=false`: compuerta de despliegue deshabilitada de forma
  segura durante la preparación.
- Webhooks/secrets de Coolify: pendientes en los environments de GitHub.

## Contrato de base de datos

La expansión es compatible hacia atrás: agrega 36 columnas nullable, 7 tablas
y 18 FKs. No rellena evidencia histórica ni elimina columnas o filas.

El entrypoint ejecuta un preflight state-based antes de `prisma db push` para
los índices que Prisma clasifica como sensibles. En particular:

- agrega y valida `ProductReturn.clientEventId VARCHAR(128) NULL`;
- agrega y valida `ProductReturn.payloadHash VARCHAR(64) NULL`;
- rechaza duplicados no-null de `(tenantId, clientEventId)` sin corregir filas;
- crea el índice único solo después de validar los datos;
- converge desde estados parciales, redeploys y dos inicios concurrentes;
- nunca usa `--accept-data-loss`.

Un rollback de aplicación no debe intentar borrar estas columnas, tablas,
índices o FKs. El binario anterior las ignora y un rollback destructivo elevaría
innecesariamente el riesgo de pérdida de datos.

## Checklist antes de habilitar la promoción

- [ ] El PR final tiene `verify` y `deploy-schema-smoke` verdes para su SHA.
- [ ] Existe un backup reciente de MySQL y se probó que puede restaurarse.
- [ ] No hay transacciones largas, metadata locks ni falta de espacio en MySQL.
- [ ] Staging responde HTTPS y usa una base separada de producción.
- [ ] `COOLIFY_STAGING_WEBHOOK` está en el environment `staging`.
- [ ] `COOLIFY_PROD_WEBHOOK` está en el environment `production`.
- [ ] `Auto Deploy` está apagado en ambas aplicaciones de Coolify.
- [ ] `Include Source Commit in Build` está activo en ambas aplicaciones.
- [ ] Producción conserva aprobación manual antes de leer sus secrets.

Solo después de completar lo anterior se cambia
`NORTEX_DEPLOY_ENABLED=true` y se ejecuta el workflow sobre `main`.

## Smoke funcional de staging

1. Iniciar sesión como `BODEGUERO`; confirmar navegación operativa, ausencia de
   costos y `403` en administración, finanzas, POS y RRHH.
2. Contar y transferir una cantidad decimal en una bodega explícita; verificar
   stock local, agregado y Kardex.
3. Comprar una presentación `PACK` y confirmar factor, costo base y cantidad
   exacta en recepción parcial.
4. Vender `0.7500 kg`, imprimir ticket 80 mm y comprobar cantidad, unidad,
   precio unitario y total.
5. Escanear una etiqueta EAN-13 configurada; una etiqueta reconocida inválida no
   debe caer a SKU común y una versión revocada offline debe pedir conciliación.
6. Reintentar una venta offline idéntica y luego un payload divergente; solo el
   primero puede resolverse como replay.
7. Reintentar una devolución con el mismo `clientEventId`; debe devolver la
   misma operación sin duplicar stock, Kardex ni contabilidad. Un payload
   diferente debe responder `409 RETURN_IDEMPOTENCY_CONFLICT`.
8. Recorrer landing y Guest POS, porque esos cambios públicos forman parte del
   mismo candidato y amplían la superficie del release.

## Observación y rollback

Durante al menos 15 minutos después de cada promoción:

- vigilar `5xx`, reinicios y errores del preflight/Prisma;
- vigilar conciliaciones offline, `409` de idempotencia y aumentos inesperados
  de `403`;
- comparar stock local/agregado y Kardex tras ventas, compras, conteos,
  transferencias y devoluciones;
- confirmar que `/api/health` continúa sano y sirve el SHA aprobado.

Detener la promoción en staging ante cualquier diferencia. En producción,
volver desde Coolify al deployment conocido `ba7beb9` si falla salud, login,
autorización, stock, contabilidad, POS o impresión. Después del rollback,
repetir `/api/health`, login, POS, inventario y una lectura de las filas
históricas; conservar intacta la expansión aditiva del schema.
