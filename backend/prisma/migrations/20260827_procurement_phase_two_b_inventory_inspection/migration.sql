-- Procurement Fase 2B.0 + 2B.1: ledger de lotes por bodega, inspección
-- de recepción y cierre corto. Migración expand-only para MySQL 8.
-- No reparte stock histórico ni activa modos SHADOW/ENFORCED.

ALTER TABLE `Tenant`
  ADD COLUMN `batchWarehouseLedgerMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
  ADD COLUMN `batchWarehouseLedgerActivatedAt` DATETIME(3) NULL;

ALTER TABLE `StockTransfer`
  ADD COLUMN `clientEventId` VARCHAR(128) NULL,
  ADD COLUMN `payloadHash` VARCHAR(64) NULL,
  ADD COLUMN `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `batchLedgerMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
  ADD COLUMN `batchTransferStatus` VARCHAR(32) NOT NULL DEFAULT 'OFF',
  ADD COLUMN `batchSnapshot` JSON NULL;

-- El preflight valida duplicados non-null y converge este UNIQUE antes de db push.
CREATE UNIQUE INDEX `StockTransfer_tenantId_clientEventId_key`
  ON `StockTransfer`(`tenantId`, `clientEventId`);

ALTER TABLE `PurchaseOrderItem`
  ADD COLUMN `quantityRejectedExact` DECIMAL(18, 4) NULL,
  ADD COLUMN `quantityClosedShortExact` DECIMAL(18, 4) NULL;

ALTER TABLE `GoodsReceipt`
  ADD COLUMN `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `inspectionOutcome` VARCHAR(32) NOT NULL DEFAULT 'FULL_ACCEPT',
  ADD COLUMN `inspectedLineCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `rejectedLineCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `hasSupplierFault` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `GoodsReceiptItem`
  ADD COLUMN `deliveredQuantityExact` DECIMAL(18, 4) NULL,
  ADD COLUMN `rejectedQuantityExact` DECIMAL(18, 4) NULL,
  ADD COLUMN `rejectionReasonCode` VARCHAR(32) NULL,
  ADD COLUMN `rejectionNotes` TEXT NULL,
  ADD COLUMN `supplierFault` BOOLEAN NULL;

ALTER TABLE `SaleItemBatchAllocation`
  ADD COLUMN `warehouseId` VARCHAR(191) NULL;

CREATE INDEX `SaleItemBatchAllocation_tenantId_warehouseId_idx`
  ON `SaleItemBatchAllocation`(`tenantId`, `warehouseId`);

CREATE TABLE `ProductBatchWarehouseStock` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `stock` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ProductBatchWarehouseStock_tenantId_batchId_idx`(`tenantId`, `batchId`),
  INDEX `ProductBatchWarehouseStock_tenantId_productId_warehouseId_idx`(`tenantId`, `productId`, `warehouseId`),
  INDEX `ProductBatchWarehouseStock_tenantId_warehouseId_productId_idx`(`tenantId`, `warehouseId`, `productId`),
  UNIQUE INDEX `ProductBatchWarehouseStock_tenantId_batchId_warehouseId_key`(`tenantId`, `batchId`, `warehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductBatchLedgerEntry` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `quantityDelta` DECIMAL(18, 4) NOT NULL,
  `stockBefore` DECIMAL(18, 4) NOT NULL,
  `stockAfter` DECIMAL(18, 4) NOT NULL,
  `movementType` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'APPLIED',
  `referenceId` VARCHAR(191) NULL,
  `referenceType` VARCHAR(64) NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `reason` TEXT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ProductBatchLedgerEntry_tenantId_batchId_createdAt_idx`(`tenantId`, `batchId`, `createdAt`),
  INDEX `ProductBatchLedgerEntry_tenantId_warehouseId_createdAt_idx`(`tenantId`, `warehouseId`, `createdAt`),
  INDEX `ProductBatchLedgerEntry_tenantId_productId_warehouseId_creat_idx`(`tenantId`, `productId`, `warehouseId`, `createdAt`),
  INDEX `ProductBatchLedgerEntry_tenantId_referenceType_referenceId_idx`(`tenantId`, `referenceType`, `referenceId`),
  INDEX `ProductBatchLedgerEntry_userId_idx`(`userId`),
  UNIQUE INDEX `ProductBatchLedgerEntry_tenantId_sourceKey_key`(`tenantId`, `sourceKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderCloseShort` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `closedBy` VARCHAR(191) NOT NULL,
  `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lineCount` INTEGER NOT NULL DEFAULT 0,
  `closedLineCount` INTEGER NOT NULL DEFAULT 0,
  `hasSupplierFault` BOOLEAN NOT NULL DEFAULT false,
  `reasonSummaryCode` VARCHAR(32) NULL,
  `note` TEXT NULL,

  INDEX `PurchaseOrderCloseShort_tenantId_purchaseOrderId_closedAt_idx`(`tenantId`, `purchaseOrderId`, `closedAt`),
  INDEX `PurchaseOrderCloseShort_closedBy_idx`(`closedBy`),
  UNIQUE INDEX `PurchaseOrderCloseShort_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderCloseShortItem` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `closeShortId` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `quantityExact` DECIMAL(18, 4) NOT NULL,
  `reasonCode` VARCHAR(32) NOT NULL,
  `supplierFault` BOOLEAN NULL,
  `note` TEXT NULL,
  `orderedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
  `acceptedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
  `rejectedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
  `remainingBeforeExact` DECIMAL(18, 4) NOT NULL,
  `remainingAfterExact` DECIMAL(18, 4) NOT NULL,
  `unitSnapshot` VARCHAR(32) NOT NULL,
  `saleModeSnapshot` VARCHAR(32) NULL,
  `quantityStepSnapshot` DECIMAL(18, 4) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PurchaseOrderCloseShortItem_tenantId_closeShortId_idx`(`tenantId`, `closeShortId`),
  INDEX `PurchaseOrderCloseShortItem_tenantId_purchaseOrderItemId_idx`(`tenantId`, `purchaseOrderItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SaleItemBatchAllocation`
  ADD CONSTRAINT `SaleItemBatchAllocation_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductBatchWarehouseStock`
  ADD CONSTRAINT `ProductBatchWarehouseStock_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchWarehouseStock_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchWarehouseStock_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchWarehouseStock_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductBatchLedgerEntry`
  ADD CONSTRAINT `ProductBatchLedgerEntry_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchLedgerEntry_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchLedgerEntry_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchLedgerEntry_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProductBatchLedgerEntry_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderCloseShort`
  ADD CONSTRAINT `PurchaseOrderCloseShort_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseOrderCloseShort_purchaseOrderId_fkey`
    FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseOrderCloseShort_closedBy_fkey`
    FOREIGN KEY (`closedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderCloseShortItem`
  ADD CONSTRAINT `PurchaseOrderCloseShortItem_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseOrderCloseShortItem_closeShortId_fkey`
    FOREIGN KEY (`closeShortId`) REFERENCES `PurchaseOrderCloseShort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseOrderCloseShortItem_purchaseOrderItemId_fkey`
    FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
