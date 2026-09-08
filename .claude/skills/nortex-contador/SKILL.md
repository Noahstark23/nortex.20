---
name: nortex-contador
description: "Revisar contabilidad, fiscalidad y movimientos financieros de Nortex contra servicios, políticas y pruebas actuales, preservando auditoría atómica y conciliación."
---

# Contabilidad y fiscalidad de Nortex

Leer `AGENTS.md` y `CLAUDE.md` antes de modificar. Esta guía describe contratos de
código; no certifica cumplimiento tributario. Las tasas, plazos y criterios
legales requieren fuente oficial vigente y revisión del responsable contable.

## Mapa de dominio

- `backend/services/accounting.ts`: catálogo, resolución de cuentas, asientos,
  reportes, retenciones y depreciación. `getAccount` recibe la transacción y el
  autoseed usa ese mismo cliente; conservar la prueba de una conexión.
- `backend/services/journalPosting.ts`: publicación/reverso idempotente.
- `backend/services/salesService.ts`: `executeSale`, cálculo autoritativo,
  identidad de venta y asiento dentro de la transacción.
- `backend/services/purchaseRegistrationService.ts`,
  `purchaseRegistrationAuthority.ts`, `purchaseRegistrationPreparation.ts` y
  `purchaseRegistrationPreview.ts`: contrato compartido por Compras y asistente.
- `backend/services/saleCancellation.ts`: reglas puras de anulación; la ruta
  `POST /api/sales/:id/cancel` en `backend/server.ts` aplica su reversa contable.
  `manualCashMovementVoidService.ts` revierte caja; no borrar historia.
- `backend/services/ledger.ts`: cadena firmada de caja. Una firma válida no
  demuestra por sí misma que todos los efectos económicos estén conciliados.
- `utils/fiscalRegime.ts`, `backend/services/nicaTax.ts`: régimen fiscal,
  snapshots y cálculos. Consultar el schema y los consumidores actuales.
- `backend/middleware/accessPolicies.ts`: permisos por operación. No inferir
  que poder ver un reporte permite pagar, anular o editar configuración.

## Contratos que deben conservarse

1. Tenant e identidad del contexto autenticado; revalidar permisos y pertenencia
   también al recuperar operaciones y confirmar propuestas.
2. Dinero nuevo en Decimal. Stock mediante `applyStockDelta`. Validar signo,
   escala, unidad y moneda sin eliminar cantidades fraccionarias legítimas.
3. Compra/venta, stock, finanzas, auditoría y comprobante se confirman atómicamente.
   `executeSale` espera `recordSale`: un error contable revierte la venta.
   No reintroducir una captura que solo registre el error y confirme igualmente.
4. Resolver/sembrar cuentas dentro de un asiento usando la transacción recibida.
   Existen seeds previos legacy; no convertirlos en requisito para abrir otra
   conexión desde una transacción ni sembrar en nuevos endpoints de lectura.
5. Reintentos recuperan la misma operación. Verificar clave, contenido y
   concurrencia; un `if` previo a la transacción no acredita exclusión mutua.
6. Respetar períodos cerrados y las excepciones explícitas de cada reversa.
   No generalizar `allowClosedPeriod` ni mover fechas para evitar un bloqueo.

## Efectos económicos

- Venta: Caja `1.1.1` para CASH, Bancos `1.1.2` para CARD/TRANSFER/QR, CxC
  `1.1.3` para CREDIT; ingreso, IVA y costo según snapshot y reglas del dominio.
  `buildSaleJournalLines` y `backend/lib/paymentAccounts.ts` son las referencias.
- Abonos: `buildPaymentJournalLines` distingue Caja/Bancos y reduce CxC; un pago
  a proveedor reduce CxP. No registrarlo además como gasto operativo.
- Compra directa: `buildPurchaseJournalLines` distingue inventario e IVA
  acreditable. Una factura asociada a recepción de OC no vuelve a ingresar stock.
  Aplicar reglas de caja/crédito, unidades, lotes y duplicados del servicio.
- CUOTA_FIJA está implementado. No trasladar IVA ni asumir crédito fiscal como
  en régimen general; conservar régimen/versión/importes históricos de la venta.
- Anulación de caja: `voidManualCashMovement` conserva referencia al reverso
  y, cuando corresponde, gasto compensatorio. No borrar el gasto original.
- Anulación/devolución de venta: usar sus servicios y contrato de conciliación;
  filtrar VOIDED en reportes no sustituye una reversa contable.
- Cierre de turno: arqueo operativo por moneda, distinto del cierre fiscal.
  Verificar `shiftCloseService.ts` y `legacyShiftCloseService.ts` según la ruta.
- Cierre fiscal/anual, retenciones y depreciación: leer implementación completa,
  incluidos período económico, fecha de contabilización y referencias previas.
  No derivar impuestos únicamente dividiendo toda venta entre 1.15.

## Deuda y límites de evidencia

Revalidar cada pendiente antes de llamarlo defecto vigente. Informes antiguos no
son inventarios actuales. La existencia de cuota fija, reversas y pruebas de
asientos invalida las antiguas afirmaciones de que faltan por completo.

El pago de nómina conserva manejo legacy de omisiones contables; ver
`nortex-rrhh`. Es deuda específica a caracterizar, no un patrón para copiar.
La migración de campos Float debe hacerse por agregado con backfill y
conciliación, nunca como cambio masivo sin comprobar contratos.
`utils/tasas.ts` mantiene un indicador de revisión de tasas: consultarlo antes de
publicar cambios, sin confundir código compilado con validación jurídica.

## Verificación

Aplicar la compuerta canónica de `AGENTS.md` y
`docs/runbooks/integration-required.md`, con MySQL 8 descartable. Cambios de dinero
requieren mutación pertinente; consultar `stryker.config.json` y
`scripts/check-mutation-scope.cjs` actuales, sin bajar umbrales ni ampliar rangos
sin cubrir la función correspondiente.

Existen pruebas como `tests/journalPosting.test.ts`,
`tests/journalSingleConnection.mysql.test.ts`, `tests/cashMovementJournalLines.test.ts`
y `tests/fiscalFlow.integration.test.ts`. Identificar cuáles cubren el cambio y
agregar escenarios de rollback, período cerrado, doble envío y permisos revocados
cuando correspondan. No afirmar cobertura de todo el dominio por un total verde.

Entregar por separado: cambio, conciliación esperada, pruebas ejecutadas y
pendientes humanos/operativos. No publicar ni modificar producción por esta skill.
