-- T2 — Exoneración de IVA (canasta básica, medicamentos). LCT 822 art. 127.
-- Estrictamente ADITIVO: ninguna columna se borra, renombra ni se estrecha.
--
-- Compatibilidad hacia atrás garantizada por los defaults:
--   · Product.ivaExento  = 0 → todo producto existente sigue GRAVADO.
--   · SaleItem.ivaExento = 0 → toda línea histórica sigue gravada.
--   · Sale.exemptTotal   = NULL → las ventas anteriores a T2 se tratan como
--     100% gravadas (backfill perezoso: el motor fiscal lee NULL como 0
--     exonerado, que es exactamente el comportamiento previo). NO se hace
--     UPDATE masivo sobre Sale.

-- AlterTable: clasificación fiscal del producto (la define el negocio, no el sistema)
ALTER TABLE `Product` ADD COLUMN `ivaExento` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: foto del trato fiscal AL MOMENTO de vender (como costAtSale),
-- para que reclasificar un producto no altere las ventas ya registradas
ALTER TABLE `SaleItem` ADD COLUMN `ivaExento` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: porción exonerada del total de la venta. NULLABLE a propósito
ALTER TABLE `Sale` ADD COLUMN `exemptTotal` DECIMAL(18, 4) NULL;
