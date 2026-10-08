-- Procurement Fase 2: recepción formal y matching de tres vías.
-- Migración expand-only para MySQL 8: no borra, reescribe ni reinterpreta históricos.

ALTER TABLE `Purchase`
  ADD COLUMN `postingDate` DATETIME(3) NULL,
  ADD COLUMN `documentStatus` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  ADD COLUMN `matchStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN `paymentHold` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `matchResolvedBy` VARCHAR(191) NULL,
  ADD COLUMN `matchResolvedAt` DATETIME(3) NULL,
  ADD COLUMN `matchResolutionNote` TEXT NULL,
  ADD COLUMN `matchResolutionClientEventId` VARCHAR(128) NULL,
  ADD COLUMN `matchResolutionPayloadHash` VARCHAR(64) NULL;

CREATE INDEX `Purchase_tenantId_documentStatus_postingDate_idx`
  ON `Purchase`(`tenantId`, `documentStatus`, `postingDate`);

CREATE INDEX `Purchase_tenantId_matchStatus_paymentHold_date_idx`
  ON `Purchase`(`tenantId`, `matchStatus`, `paymentHold`, `date`);

CREATE INDEX `Purchase_matchResolvedBy_idx`
  ON `Purchase`(`matchResolvedBy`);

-- El preflight de despliegue converge este UNIQUE desde instalaciones pobladas
-- y valida su definición exacta antes de que Prisma ejecute db push.
CREATE UNIQUE INDEX `Purchase_tenantId_matchResolutionClientEventId_key`
  ON `Purchase`(`tenantId`, `matchResolutionClientEventId`);

ALTER TABLE `PurchaseItem`
  ADD COLUMN `purchaseOrderItemId` VARCHAR(191) NULL,
  ADD COLUMN `unitCostExact` DECIMAL(18, 6) NULL,
  ADD COLUMN `expectedUnitCostExact` DECIMAL(18, 6) NULL,
  ADD COLUMN `taxAmountExact` DECIMAL(18, 4) NULL,
  ADD COLUMN `creditableTaxExact` DECIMAL(18, 4) NULL,
  ADD COLUMN `priceVarianceExact` DECIMAL(18, 4) NULL;

ALTER TABLE `PurchaseOrderItem`
  ADD COLUMN `unitCostExact` DECIMAL(18, 6) NULL;

CREATE INDEX `PurchaseItem_purchaseOrderItemId_idx`
  ON `PurchaseItem`(`purchaseOrderItemId`);

CREATE TABLE `GoodsReceipt` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `receiptNumber` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `supplierDeliveryRef` VARCHAR(191) NULL,
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `receivedBy` VARCHAR(191) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `GoodsReceipt_tenantId_receiptNumber_key`(`tenantId`, `receiptNumber`),
  UNIQUE INDEX `GoodsReceipt_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
  INDEX `GoodsReceipt_tenantId_purchaseOrderId_receivedAt_idx`(`tenantId`, `purchaseOrderId`, `receivedAt`),
  INDEX `GoodsReceipt_tenantId_warehouseId_receivedAt_idx`(`tenantId`, `warehouseId`, `receivedAt`),
  INDEX `GoodsReceipt_receivedBy_idx`(`receivedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GoodsReceiptItem` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `goodsReceiptId` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `quantityExact` DECIMAL(18, 4) NOT NULL,
  `unitSnapshot` VARCHAR(32) NOT NULL,
  `saleModeSnapshot` VARCHAR(32) NULL,
  `unitCostExact` DECIMAL(18, 6) NOT NULL,
  `batchId` VARCHAR(191) NULL,
  `batchNumber` VARCHAR(191) NULL,
  `expiryDate` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `GoodsReceiptItem_tenantId_goodsReceiptId_idx`(`tenantId`, `goodsReceiptId`),
  INDEX `GoodsReceiptItem_tenantId_purchaseOrderItemId_idx`(`tenantId`, `purchaseOrderItemId`),
  INDEX `GoodsReceiptItem_tenantId_productId_idx`(`tenantId`, `productId`),
  INDEX `GoodsReceiptItem_batchId_idx`(`batchId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseMatchAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `purchaseItemId` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `goodsReceiptItemId` VARCHAR(191) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'FORMAL_RECEIPT',
  `quantityExact` DECIMAL(18, 4) NOT NULL,
  `expectedUnitCostExact` DECIMAL(18, 6) NOT NULL,
  `actualUnitCostExact` DECIMAL(18, 6) NOT NULL,
  `priceVarianceExact` DECIMAL(18, 4) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PurchaseMatchAllocation_purchaseItemId_goodsReceiptItemId_key`(`purchaseItemId`, `goodsReceiptItemId`),
  INDEX `PurchaseMatchAllocation_tenantId_purchaseItemId_idx`(`tenantId`, `purchaseItemId`),
  INDEX `PurchaseMatchAllocation_tenantId_purchaseOrderItemId_idx`(`tenantId`, `purchaseOrderItemId`),
  INDEX `PurchaseMatchAllocation_tenantId_goodsReceiptItemId_idx`(`tenantId`, `goodsReceiptItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseMatchException` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `purchaseId` VARCHAR(191) NOT NULL,
  `purchaseItemId` VARCHAR(191) NULL,
  `type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  `expectedValueExact` DECIMAL(18, 6) NULL,
  `actualValueExact` DECIMAL(18, 6) NULL,
  `varianceExact` DECIMAL(18, 6) NULL,
  `toleranceExact` DECIMAL(18, 6) NULL,
  `resolutionNote` TEXT NULL,
  `resolvedBy` VARCHAR(191) NULL,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PurchaseMatchException_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
  INDEX `PurchaseMatchException_tenantId_purchaseId_status_idx`(`tenantId`, `purchaseId`, `status`),
  INDEX `PurchaseMatchException_purchaseItemId_idx`(`purchaseItemId`),
  INDEX `PurchaseMatchException_resolvedBy_idx`(`resolvedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProcurementPolicy` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `priceTolerancePct` DECIMAL(9, 4) NOT NULL DEFAULT 0,
  `autoHold` BOOLEAN NOT NULL DEFAULT true,
  `updatedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProcurementPolicy_tenantId_key`(`tenantId`),
  INDEX `ProcurementPolicy_updatedBy_idx`(`updatedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Los documentos históricos y sus autores usan RESTRICT. Solo las tablas que
-- son hijas internas del documento usan CASCADE al desaparecer su padre.
ALTER TABLE `Purchase`
  ADD CONSTRAINT `Purchase_matchResolvedBy_fkey`
    FOREIGN KEY (`matchResolvedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseItem`
  ADD CONSTRAINT `PurchaseItem_purchaseOrderItemId_fkey`
    FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `GoodsReceipt`
  ADD CONSTRAINT `GoodsReceipt_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceipt_purchaseOrderId_fkey`
    FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceipt_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceipt_receivedBy_fkey`
    FOREIGN KEY (`receivedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `GoodsReceiptItem`
  ADD CONSTRAINT `GoodsReceiptItem_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceiptItem_goodsReceiptId_fkey`
    FOREIGN KEY (`goodsReceiptId`) REFERENCES `GoodsReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceiptItem_purchaseOrderItemId_fkey`
    FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceiptItem_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `GoodsReceiptItem_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseMatchAllocation`
  ADD CONSTRAINT `PurchaseMatchAllocation_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchAllocation_purchaseItemId_fkey`
    FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchAllocation_purchaseOrderItemId_fkey`
    FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchAllocation_goodsReceiptItemId_fkey`
    FOREIGN KEY (`goodsReceiptItemId`) REFERENCES `GoodsReceiptItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseMatchException`
  ADD CONSTRAINT `PurchaseMatchException_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchException_purchaseId_fkey`
    FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchException_purchaseItemId_fkey`
    FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseMatchException_resolvedBy_fkey`
    FOREIGN KEY (`resolvedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProcurementPolicy`
  ADD CONSTRAINT `ProcurementPolicy_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProcurementPolicy_updatedBy_fkey`
    FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
