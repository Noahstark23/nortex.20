-- Inventario Fase 2 (fundación): multi-bodega.
-- Product.stock sigue siendo el AGREGADO autoritativo; ProductStock es el desglose.
-- El backfill de datos es PEREZOSO en la aplicación (la bodega "Principal" absorbe
-- el total legado al primer movimiento) porque el deploy usa `prisma db push`,
-- que solo sincroniza DDL. Cambios aditivos y no destructivos.

CREATE TABLE `Warehouse` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `address` VARCHAR(191) NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `Warehouse_tenantId_name_key`(`tenantId`, `name`),
  INDEX `Warehouse_tenantId_idx`(`tenantId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductStock` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `stock` DOUBLE NOT NULL DEFAULT 0,
  UNIQUE INDEX `ProductStock_productId_warehouseId_key`(`productId`, `warehouseId`),
  INDEX `ProductStock_tenantId_idx`(`tenantId`),
  INDEX `ProductStock_warehouseId_idx`(`warehouseId`),
  INDEX `ProductStock_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `KardexMovement` ADD COLUMN `warehouseId` VARCHAR(191) NULL;
CREATE INDEX `KardexMovement_warehouseId_idx` ON `KardexMovement`(`warehouseId`);

ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
