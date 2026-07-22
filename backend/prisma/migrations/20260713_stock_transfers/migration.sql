-- Fase 3: transferencias entre bodegas. Aditivo; el deploy usa db push.
CREATE TABLE `StockTransfer` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `fromWarehouseId` VARCHAR(191) NOT NULL,
  `toWarehouseId` VARCHAR(191) NOT NULL,
  `notes` TEXT NULL,
  `items` JSON NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `StockTransfer_tenantId_idx`(`tenantId`),
  INDEX `StockTransfer_fromWarehouseId_idx`(`fromWarehouseId`),
  INDEX `StockTransfer_toWarehouseId_idx`(`toWarehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_fromWarehouseId_fkey` FOREIGN KEY (`fromWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_toWarehouseId_fkey` FOREIGN KEY (`toWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
