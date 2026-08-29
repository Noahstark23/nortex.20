# ADR-2026-08-27: Devoluciones a proveedor y notas de crédito

**Estado:** Aceptado para implementación incremental  
**Fecha:** 2026-08-27  
**Decisor:** Product owner de Nortex  

## Contexto

Nortex ya separa la recepción física de una orden de compra de la factura del
proveedor: `GoodsReceipt` mueve inventario, mientras `Purchase` contabiliza la
factura y crea la cuenta por pagar. El sistema no tiene GRNI, un subledger real
de créditos de proveedor ni evidencia suficiente para inferir con seguridad la
bodega o el lote de todas las compras históricas.

Una devolución al proveedor puede ocurrir antes o después de recibir la nota de
crédito. Mezclar ambos hechos en una sola fila haría imposible representar el
tránsito y provocaría dobles movimientos de inventario, IVA o CxP.

## Decisión

Separar tres hechos inmutables:

1. `SupplierReturn`: salida física de mercancía. Mueve stock, lote por bodega,
   Kardex y auditoría; no crea asiento contable.
2. `SupplierCreditNote`: documento financiero y fiscal emitido por el proveedor.
   Revierte Inventario, IVA acreditable y PPV, y debita CxP.
3. `SupplierCreditApplication`: aplicación explícita de la nota contra una o más
   facturas abiertas del mismo proveedor.

La versión inicial exige que las aplicaciones sumen exactamente el total de la
nota al postearla. No se habilita crédito abierto, reembolso de efectivo, FX,
nota solo por precio ni devolución de seriales hasta definir sus cuentas,
evidencia y política fiscal.

No se introduce GRNI en esta fase. La recepción sigue sin contabilizar dinero y
la factura `Purchase` conserva el único asiento original.

## Invariantes

- Cada lectura y escritura se limita por `tenantId` del JWT.
- UUID + hash canónico versionado: replay exacto devuelve el mismo resultado;
  UUID reutilizado con otro payload responde 409.
- Usuario `ACTIVE` antes del replay rápido y otra vez dentro de la transacción.
- Cantidades físicas son `Decimal(18,4)` y costos unitarios `Decimal(18,6)`.
- Importes legales y asientos se redondean una vez a 2 decimales, HALF_UP.
- Una devolución no edita `GoodsReceipt`, `quantityReceivedExact`, la OC ni la
  factura original.
- Rechazos durante recepción nunca entraron a stock y no son devoluciones.
- Una línea devuelta no puede superar su fuente neta de devoluciones anteriores.
- Un producto loteado requiere lote y bodega exactos. `SHADOW_GAP`, evidencia
  legacy ambigua o serial sin ubicación fallan cerrado antes de cualquier efecto.
- Una devolución loteada no corre con el ledger en `OFF`; en `SHADOW` solo se
  acepta si la ubicación ya produce `APPLIED`. Nortex nunca crea un saldo local
  supuesto para completar la devolución.
- Stock agregado, `ProductStock`, `ProductBatch`, sidecar, Kardex y auditoría
  viven en una sola transacción.
- La nota de crédito, sus líneas, aplicaciones, saldos CxP, asiento y auditoría
  viven en otra transacción atómica.
- En v1, una nota por devolución solo puede postearse contra devoluciones físicas
  `POSTED` del mismo proveedor; no puede anticipar ni duplicar la salida física.
- Una devolución de una recepción todavía no facturada puede existir como hecho
  físico, pero permanece `PENDING_INVOICE_LINK`: no es acreditable hasta quedar
  vinculada de forma exacta a una compra `POSTED` a crédito.
- Las aplicaciones solo aceptan compras `CREDIT`, `POSTED`, del mismo proveedor
  y con `balanceDue` materializado y suficiente. Compras de contado y saldos
  insuficientes fallan cerrado porque v1 no tiene reembolso ni crédito abierto.
- `SupplierPayment` nunca se usa con monto negativo.
- `paidAt` conserva el hecho de pago; una factura liquidada por crédito usa un
  `settledAt` separado.

## Contabilidad v1

Al postear una nota totalmente aplicada:

```text
Debe  2.1.1 Cuentas por pagar       total de la nota
Haber 1.1.5 IVA crédito             IVA acreditable revertido
Haber 1.1.4 Inventario              valor libro devuelto
Debe/Haber 5.1.3 PPV                residual documentado
```

El residual es `total - IVA acreditable - valor libro`. Un residual positivo
acredita PPV; uno negativo lo debita. En cuota fija, el IVA acreditable es cero.
No se reabre ni se reescribe el asiento de la compra original.

La fecha fiscal de la nota y su fecha contable deben pertenecer al mismo período
abierto en v1. Un período cerrado o un ajuste de retenciones responde
`FISCAL_ADJUSTMENT_REVIEW_REQUIRED` hasta validación contable expresa.

La nota debe conservar la referencia al documento original, la fecha de la
devolución, la base gravable y el IVA restituido. Nortex reducirá el crédito
fiscal en el período de la devolución; no inferirá ni revertirá automáticamente
retenciones IR o municipales sin una regla fiscal configurada y validada.

## Base fiscal verificada

- La DGI indica que quien devuelve mercadería y ya acreditó el IVA debe disminuir
  el crédito fiscal del período en que ocurre la devolución, y exige nota de
  crédito, devolución del IVA y reingreso documentado de la mercancía:
  <https://www.dgi.gob.ni/FAQ/credito_fiscal.htm>.
- El artículo 123 de la Ley de Concertación Tributaria establece la disminución
  del crédito fiscal en el período de la devolución:
  <https://legislacion.asamblea.gob.ni/Diariodebate.nsf/76ed72912dd57e570625698c00773f5d/29db3f80f66e1f5706257b5900630b21>.
- El artículo 86 del Reglamento exige factura, entrega, IVA cobrado, nota de
  crédito y contabilización/documentación del reingreso:
  <https://legislacion.asamblea.gob.ni/SILEG/Gacetas.nsf/15a7e7ceb5efa9c6062576eb0060b321/9c520cbf65bf930606257aec005d6802/%24FILE/2013-01-15-%20Decreto%20Ejecutivo%20No.%2001-2013%2C%20Reglamento%20de%20la%20Ley%20No.%20822%2C%20Ley%20de%20concertaci%C3%B3n%20tributaria.pdf>.

Estas fuentes respaldan la reversión del IVA por devolución. No se encontró en
ellas una regla general equivalente para deshacer automáticamente retenciones
IR/IMI; por eso ese ajuste queda fail-closed y requiere revisión contable.

## Evidencia física

Las compras directas nuevas guardarán de forma aditiva en `PurchaseItem`:

- `inventoryWarehouseId`;
- `inventoryBatchId`;
- `inventoryUnitCostExact`.

Los tres valores se persisten dentro de la misma transacción que crea la línea y
mueve el inventario. La ruta de devolución directa no se habilita si falta esa
evidencia o si fue inferida desde un histórico ambiguo.

El costo de origen demuestra procedencia, pero el valor libro de la salida se
congela con el costo promedio actual del producto bloqueado al devolver. La nota
usa ese snapshot para revertir Inventario y muestra cualquier diferencia contra
el documento del proveedor como PPV; no exige que el costo histórico y el costo
promedio actual sean iguales.

El histórico solo se usa cuando existe una única evidencia tenant-scoped. No se
infieren bodegas, lotes ni costos en escenarios ambiguos.

Una devolución puede originarse en:

- una línea de compra directa con evidencia exacta;
- una recepción formal aún no facturada;
- una asignación formal de matching ya facturada.

La segunda fuente permite registrar la salida física antes de la factura, pero
no autoriza una nota de crédito hasta que el matching provea la línea de compra
y una CxP abierta. Esa elegibilidad se deriva y se muestra; no reescribe el
documento físico inmutable.

Para una devolución creada antes de facturar, v1 solo deriva el vínculo si existe
exactamente una asignación formal que cubre toda su cantidad. Cero o varias
asignaciones dejan el caso en reconciliación manual; el cliente no elige una FK
para forzar la acreditación y la devolución original nunca se reescribe.

El tipo de fuente es una unión discriminada; el cliente no puede combinar FKs
opcionales libremente.

Cada línea de nota apunta a una única línea de devolución, copia todos sus
snapshots y, en v1, acredita su cantidad completa. La referencia es única global:
no se fracciona ni se reutiliza una salida física entre dos notas. Esto se podrá
generalizar con un subledger de cantidades acreditadas en una fase posterior.

Los importes tampoco son libres: la base, el IVA y el crédito fiscal acumulados
por línea de compra no pueden superar sus snapshots originales. Las devoluciones
parciales prorratean a centavos y la última absorbe únicamente el residual de
redondeo disponible; nunca pueden crear más crédito que la factura fuente.

## Orden de locks

### Devolución física

1. Usuario activo y proveedor.
2. Compra, OC, recepción y líneas fuente ordenadas.
3. Claim idempotente.
4. Productos ordenados.
5. `ProductStock` por producto+bodega.
6. `ProductBatch` por ID.
7. Sidecar lote+bodega y ledger.
8. Kardex y auditoría.

### Nota y aplicaciones

1. Usuario activo y proveedor.
2. Facturas fuente/destino por ID ascendente.
3. Devolución, líneas, asignaciones y créditos previos.
4. Claim idempotente.
5. Aplicaciones y `balanceDue` por el mismo orden.
6. Cuentas contables en orden canónico.
7. Asiento y auditoría.

## Opciones consideradas

### A. Pago negativo a proveedor

- Complejidad inicial baja.
- Rechazada: falsea el subledger de pagos, el canal de liquidación y el asiento.

### B. Documento único de devolución y crédito

- UX aparentemente simple.
- Rechazada: acopla dos fechas y hechos distintos, impide tránsito y favorece
  dobles efectos ante reintentos.

### C. Documentos físico, fiscal y de aplicación separados

- Mayor trabajo de modelo y UI.
- Aceptada: preserva trazabilidad, permite idempotencia por comando y mantiene
  stock y contabilidad en fronteras transaccionales claras.

### D. Introducir GRNI ahora

- Mejor devengo entre recepción y factura.
- Diferida: requiere cuentas nuevas, backfill, reversión de asientos actuales y
  conciliación completa de inventario/mayor.

## Consecuencias

- Supplier 360 podrá mostrar devoluciones, notas y CxP neta reales.
- El campo derivado actual `unappliedCredit` no se reutiliza como crédito real.
- BODEGUERO podrá registrar el hecho físico sin ver costos o CxP.
- Solo `OWNER`, `ADMIN`, `SUPER_ADMIN` y `ACCOUNTANT` podrán postear la nota.
- Los casos históricos ambiguos quedarán visibles como reconciliación requerida,
  no se repararán automáticamente.
- Crédito abierto, seriales, multi-moneda, notas solo por precio, GRNI y ajustes
  automáticos de retenciones quedan como decisiones posteriores.

## Plan de implementación

1. Schema, migración expand-only, preflight y smoke MySQL.
2. Comandos puros, hashes, límites Decimal y mutation gate.
3. Servicio de devolución física y evidencia de compras directas.
4. Servicio de nota, aplicaciones CxP, asiento y fiscalidad fail-closed.
5. Matching/disponibilidad y Supplier 360.
6. Routers, roles, DTOs y UI.
7. HTTP/MySQL real, concurrencia, rollback, full suite, build y gate oficial.

No se activa automáticamente `SHADOW` o `ENFORCED`, ni se despliega desde esta
fase de implementación.
