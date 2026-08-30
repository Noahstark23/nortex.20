# Release de reportes de ventas y cierre Z — 2026-08-30

## Resultado ejecutivo

Esta release incorpora reportes íntegros de ventas por período, producto y
método de pago, exportación HTML/XLSX y un snapshot Z inmutable al cerrar caja.
También corrige la entrada física de abonos en efectivo y la atribución de
devoluciones al turno que realmente las procesa.

La base integrada es `origin/main` en
`28e424430d76cf5ef758b2a57f5ac764b9252519`. El SHA candidato definitivo será
el `HEAD` final de esta rama y debe ser el mismo que aprueben CI, staging y
`/api/health`; no se escribe manualmente en este documento.

Estado de infraestructura comprobado el 30 de agosto de 2026:

- staging y producción responden `ok: true`, `db: "up"` y sirven `236e451`;
- el CI de esa base está verde;
- `NORTEX_DEPLOY_ENABLED=true`, por lo que un merge a `main` promoverá staging;
- existen los webhooks de ambos environments;
- `production` exige aprobación manual;
- no se disparó ningún webhook ni despliegue durante la preparación.

## Qué entra

- Reporte diario/mensual y por rango civil de Managua.
- Totales y detalle por producto, cantidad, método de pago, impuesto, costo y
  utilidad, excluyendo documentos anulados.
- Documento HTML imprimible con CSP y escape de contenido.
- Exportación XLSX con protección ante inyección de fórmulas y límites de filas.
- Cierre Z atómico e inmutable, con folio, versión, payload canónico y SHA-256.
- Inclusión de ventas, devoluciones, entradas/salidas, abonos de crédito en
  efectivo y diferencia de arqueo en el cierre.
- Verificación de integridad al releer o descargar un cierre ya almacenado.
- Atribución inequívoca de devoluciones: no efectivo solo a turno propio; CASH
  a turno propio o al único cajón abierto del tenant.
- UI de reportes, descarga y consulta del cierre desde Reportes, POS y Cajas.
- Compatibilidad con las correcciones de catálogo público, imágenes, interfaz
  espacial y lectura pública que ya forman parte de `28e4244`.

## Contrato de base de datos

El cambio es expand-only:

- crea `ShiftCloseReport`;
- agrega `ProductReturn.processedShiftId` nullable;
- agrega FKs e índices de consulta para turnos, ventas, movimientos y
  devoluciones;
- no elimina, renombra ni rellena datos históricos;
- una devolución legacy conserva `processedShiftId = NULL`;
- no usa `--accept-data-loss`.

El deploy productivo sincroniza el schema mediante el entrypoint state-based y
`prisma db push`, no mediante `migrate deploy`. El smoke de CI verifica la tabla,
columnas/defaults, PK, índices, FKs y reglas de borrado, además de preservar las
filas legacy.

Un rollback de aplicación no debe borrar la tabla, columna, índices o FKs. La
versión anterior los ignora; revertir DDL elevaría el riesgo sin recuperar
funcionalidad adicional.

## Checklist pre-deploy

- [x] Cambios consolidados en un commit local dedicado.
- [x] `origin/main` integrado y conflictos resueltos semánticamente.
- [x] Smoke de schema ampliado para el contrato de cierre Z.
- [x] `npm run release:preflight` verde sobre el `HEAD` final local.
- [ ] PR aprobado y jobs `verify`, `deploy-schema-smoke` y
      `backup-restore-smoke` verdes para el SHA exacto.
- [ ] Backup de producción verificado, con antigüedad menor de cuatro horas, y
      evidencia reciente de restauración.
- [ ] Sin transacciones largas, metadata locks ni presión crítica de disco en
      MySQL antes de promover.
- [ ] Confirmar que el merge a `main` debe disparar staging mientras
      `NORTEX_DEPLOY_ENABLED=true`.
- [ ] Staging sano en el SHA exacto y smoke funcional aprobado.
- [ ] Aprobador de `production` disponible durante la ventana.
- [ ] Responsable de observación disponible durante al menos 30 minutos.

## Secuencia de promoción

1. Push de `claude/reportes-ventas-cierre` y apertura del PR.
2. Esperar CI completo; no omitir mutación, schema ni backup/restore.
3. Revisar y fusionar a `main` únicamente si todos los jobs están verdes.
4. Confirmar que `deploy-staging` termina y que el health sirve el SHA esperado:

   ```bash
   npm run deploy:health -- https://staging.somosnortex.com <SHA>
   ```

5. Ejecutar el smoke funcional de staging.
6. Aprobar manualmente el environment `production`.
7. Confirmar producción en el mismo SHA:

   ```bash
   npm run deploy:health -- https://somosnortex.com <SHA>
   ```

## Smoke funcional obligatorio en staging

Usar un tenant sintético, nunca datos reales de producción.

1. Iniciar sesión como OWNER/ADMIN, abrir turno y registrar ventas CASH, CARD y
   CREDIT con productos distintos.
2. Registrar un abono CASH a la venta a crédito y otro no efectivo; solo el
   primero debe mover la gaveta.
3. Abrir Reportes y validar día, mes y rango personalizado contra las ventas
   creadas: totales, unidades, productos y métodos deben coincidir al centavo.
4. Descargar HTML y XLSX; ambos deben abrir, respetar el tenant y mostrar los
   mismos totales.
5. Procesar una devolución no efectiva con turno propio y comprobar que aparece
   en ese cierre. Sin turno propio debe responder `409` sin efectos parciales.
6. Procesar un reembolso CASH y confirmar un único `CashMovement OUT` firmado y
   `processedShiftId = refundShiftId`.
7. Cerrar caja, abrir el documento Z y validar ventas, devoluciones, abonos,
   efectivo esperado, contado y diferencia.
8. Descargar el mismo cierre dos veces: debe conservar folio, payload y hash.
9. Intentar consultar el reporte desde otro tenant y con un rol no autorizado;
   debe fallar sin filtrar existencia ni datos.
10. Repetir login, POS, catálogo con imágenes, compra y factura para cubrir las
    regresiones integradas desde `main`.

## Observación posterior

Durante al menos 30 minutos:

- `/api/health` debe permanecer sano y en el SHA aprobado;
- vigilar `5xx`, latencia p95, reinicios y errores Prisma/preflight;
- buscar `SHIFT_REPORT_INTEGRITY_FAILED`, `SHIFT_REPORT_DATA_INVALID`,
  `RETURN_OPEN_SHIFT_*` y fallos de descarga;
- confirmar que no crecen ventas, devoluciones, abonos o movimientos duplicados;
- comprobar al menos un reporte y un cierre ya almacenado después de 15 minutos.

## Disparadores de rollback

- El SHA esperado no aparece sano en ocho minutos.
- Cualquier discrepancia de un centavo entre venta, cierre Z, caja o reporte.
- Cualquier operación duplicada de venta, devolución, abono, stock o ledger.
- Un cierre almacenado falla su hash o no puede descargarse.
- El preflight/schema excede 120 segundos o detecta estado inseguro.
- Los endpoints nuevos superan 1% de `5xx` durante cinco minutos.
- Su p95 supera dos segundos durante 15 minutos respecto de una carga normal.
- Login, POS, compra, factura o aislamiento entre tenants falla en el smoke.

## Rollback

1. Si falla staging, detener la promoción y no aprobar producción.
2. Si falla producción, volver en Coolify al último deployment sano confirmado:
   `236e451086a89e454afc8d2e0e3c619cd7a02297`.
3. No revertir el schema aditivo.
4. Repetir health, login, POS, una lectura de reporte y los flujos financieros
   básicos con la versión anterior.
5. Conservar logs, SHA fallido y evidencia de smoke sin incluir datos de clientes.
