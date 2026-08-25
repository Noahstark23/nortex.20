-- NORTEX — Anulación fiscal de comprobantes (DGI-5, Disposición Técnica 09-2007)
--
-- ESTRICTAMENTE ADITIVA: tres columnas NULLABLE y un índice. `db push` la aplica
-- sin riesgo de pérdida de datos, y las filas existentes quedan con NULL, que
-- significa "venta vigente" — exactamente su comportamiento de hoy.
--
-- Una factura mal emitida NO se borra ni se edita: se ANULA. El comprobante
-- anulado sigue existiendo, visible y marcado, y su número NO se reutiliza. Un
-- correlativo con huecos o repetidos es justo lo que la norma prohíbe.
--
-- El valor de `status` para una venta anulada es 'VOIDED', que es el que el
-- sistema YA excluía en la declaración mensual de IVA y en el Libro de Ventas
-- (ver backend/services/nicaTax.ts) aunque nada lo escribiera todavía.

ALTER TABLE `Sale`
  ADD COLUMN `cancelledAt`   DATETIME(3) NULL,
  ADD COLUMN `cancelledById` VARCHAR(191) NULL,
  ADD COLUMN `cancelReason`  TEXT NULL;

-- Los reportes filtran por (tenantId, status) para excluir las anuladas; sin
-- índice, esa exclusión obliga a recorrer la tabla completa de ventas.
CREATE INDEX `Sale_tenantId_status_idx` ON `Sale`(`tenantId`, `status`);

-- Autor de la anulación. ON DELETE SET NULL: si se borra el usuario, la
-- anulación NO desaparece — el rastro fiscal sobrevive a la baja de la persona.
ALTER TABLE `Sale`
  ADD CONSTRAINT `Sale_cancelledById_fkey`
  FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
