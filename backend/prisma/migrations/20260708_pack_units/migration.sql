-- Mayoreo Fase B: unidades de empaque (caja/fardo/docena).
-- El empaque es un atajo de cantidad en el POS + tercer nivel de precio
-- (detalle → mayoreo@minQty → empaque@packSize). Stock/Kardex siguen en
-- unidades base. Cambios aditivos; el deploy usa `prisma db push`.
ALTER TABLE `Product` ADD COLUMN `packUnit` VARCHAR(191) NULL;
ALTER TABLE `Product` ADD COLUMN `packSize` DOUBLE NULL;
ALTER TABLE `Product` ADD COLUMN `packPrice` DOUBLE NULL;
