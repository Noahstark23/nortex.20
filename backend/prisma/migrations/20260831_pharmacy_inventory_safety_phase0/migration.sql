-- Farmacias Bloque 0: activación opt-in, proyección de stock retenido y libro
-- append-only de cuarentenas/liberaciones por lote+bodega.
-- Migración expand-only para MySQL 8: no hace backfill ni activa tenants.

ALTER TABLE `Tenant`
  ADD COLUMN `pharmacyInventoryMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
  ADD COLUMN `pharmacyInventoryActivatedAt` DATETIME(3) NULL;

ALTER TABLE `ProductBatchWarehouseStock`
  ADD COLUMN `heldStock` DECIMAL(18, 4) NOT NULL DEFAULT 0;

CREATE TABLE `ProductBatchHold` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `quantityDelta` DECIMAL(18, 4) NOT NULL,
  `heldBefore` DECIMAL(18, 4) NOT NULL,
  `heldAfter` DECIMAL(18, 4) NOT NULL,
  `physicalStockSnapshot` DECIMAL(18, 4) NOT NULL,
  `sellableBefore` DECIMAL(18, 4) NOT NULL,
  `sellableAfter` DECIMAL(18, 4) NOT NULL,
  `holdReasonCode` VARCHAR(32) NOT NULL,
  `referenceId` VARCHAR(191) NULL,
  `referenceType` VARCHAR(64) NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `notes` TEXT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProductBatchHold_tenantId_sourceKey_key`(`tenantId`, `sourceKey`),
  INDEX `ProductBatchHold_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
  INDEX `ProductBatchHold_tenantId_batchId_warehouseId_createdAt_idx`(`tenantId`, `batchId`, `warehouseId`, `createdAt`),
  INDEX `ProductBatchHold_tenantId_productId_warehouseId_createdAt_idx`(`tenantId`, `productId`, `warehouseId`, `createdAt`),
  INDEX `ProductBatchHold_tenantId_referenceType_referenceId_idx`(`tenantId`, `referenceType`, `referenceId`),
  INDEX `ProductBatchHold_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductBatchHold`
  ADD CONSTRAINT `ProductBatchHold_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchHold_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchHold_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchHold_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchHold_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
