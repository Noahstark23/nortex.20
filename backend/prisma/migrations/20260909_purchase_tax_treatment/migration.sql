-- Traslación del IVA en la factura de compra + bases fiscales separadas.
--
-- Migración estrictamente aditiva para MySQL 8: solo agrega columnas, sin DML ni
-- reinterpretación de documentos existentes. No hay UNIQUE nuevo, así que no
-- requiere preflight DDL state-based y `db push` la aplica sin data loss.
--
-- `taxTreatment` nace con DEFAULT 'IVA_TRASLADADO' porque eso es exactamente lo
-- que se les cobró a las compras históricas: el default conserva su significado
-- en vez de reinterpretarlo. `noTaxReason` es NULL para todas ellas por la misma
-- razón — no hubo motivo de no traslación.
--
-- `taxableSubtotal`/`exemptSubtotal`/`taxableAtPurchase` quedan NULL en el
-- histórico a propósito: son ambiguos y NO se pueden derivar hacia atrás. Con
-- SIN_TRASLADO toda línea tiene IVA cero, así que `taxAmountExact = 0` ya no
-- distingue una base exenta de una gravada sin traslación. Los consumidores
-- tratan NULL como "no desglosado" por la ruta legacy declarada, nunca como cero.
--
-- Sin backfill: corregir una compra ya posteada es anulación + reemisión, no un
-- UPDATE que mueva mayor, CxP y libros por debajo.

ALTER TABLE `Purchase`
  ADD COLUMN `taxTreatment` VARCHAR(32) NOT NULL DEFAULT 'IVA_TRASLADADO',
  ADD COLUMN `noTaxReason` VARCHAR(32) NULL,
  ADD COLUMN `taxableSubtotal` DECIMAL(18, 4) NULL,
  ADD COLUMN `exemptSubtotal` DECIMAL(18, 4) NULL;

ALTER TABLE `PurchaseItem`
  ADD COLUMN `taxableAtPurchase` BOOLEAN NULL;
