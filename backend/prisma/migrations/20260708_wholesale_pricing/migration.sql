-- Modelo distribuidora/miscelánea (Fase A): venta por mayor en el POS.
-- Cambios aditivos y no destructivos. El deploy usa `prisma db push`.

-- Precio de mayoreo por producto + cantidad mínima a partir de la cual aplica.
-- (Float para calzar con price/cost existentes; los tres migran juntos a
--  Decimal(18,4) en el sweep de precisión pendiente.)
ALTER TABLE `Product` ADD COLUMN `wholesalePrice` DOUBLE NULL;
ALTER TABLE `Product` ADD COLUMN `wholesaleMinQty` DOUBLE NULL;

-- Cliente mayorista: el POS le aplica precio de mayoreo desde la unidad 1.
ALTER TABLE `Customer` ADD COLUMN `isWholesale` BOOLEAN NOT NULL DEFAULT false;
