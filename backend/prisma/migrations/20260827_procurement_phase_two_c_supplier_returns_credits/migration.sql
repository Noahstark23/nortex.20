-- Procurement Fase 2C: devoluciones físicas a proveedor, notas de crédito y
-- aplicaciones contra CxP. Migración expand-only para MySQL 8.
-- No reinterpreta compras históricas, no hace backfill y no activa modos.

ALTER TABLE `Purchase`
  ADD COLUMN `settledAt` DATETIME(3) NULL;

ALTER TABLE `PurchaseItem`
  ADD COLUMN `inventoryWarehouseId` VARCHAR(191) NULL,
  ADD COLUMN `inventoryBatchId` VARCHAR(191) NULL,
  ADD COLUMN `inventoryUnitCostExact` DECIMAL(18, 6) NULL;

CREATE INDEX `PurchaseItem_inventoryWarehouseId_idx`
  ON `PurchaseItem`(`inventoryWarehouseId`);

CREATE INDEX `PurchaseItem_inventoryBatchId_idx`
  ON `PurchaseItem`(`inventoryBatchId`);

CREATE TABLE `SupplierReturn` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `returnNumber` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `reasonCode` VARCHAR(32) NOT NULL,
  `reason` TEXT NULL,
  `supplierReference` VARCHAR(191) NULL,
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  `payloadHash` VARCHAR(64) NOT NULL,
  `batchLedgerMode` VARCHAR(16) NOT NULL,
  `returnedBy` VARCHAR(191) NOT NULL,
  `returnedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierReturn_tenantId_returnNumber_key`(`tenantId`, `returnNumber`),
  UNIQUE INDEX `SupplierReturn_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
  INDEX `SupplierReturn_tenantId_supplierId_returnedAt_idx`(`tenantId`, `supplierId`, `returnedAt`),
  INDEX `SupplierReturn_returnedBy_idx`(`returnedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierReturnItem` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierReturnId` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(32) NOT NULL,
  `purchaseItemId` VARCHAR(191) NULL,
  `goodsReceiptItemId` VARCHAR(191) NULL,
  `purchaseMatchAllocationId` VARCHAR(191) NULL,
  `productId` VARCHAR(191) NOT NULL,
  `productNameAtReturn` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NULL,
  `quantityExact` DECIMAL(18, 4) NOT NULL,
  `bookUnitCostExact` DECIMAL(18, 6) NOT NULL,
  `bookValueExact` DECIMAL(18, 4) NOT NULL,
  `unitAtReturn` VARCHAR(32) NOT NULL,
  `saleModeAtReturn` VARCHAR(32) NULL,
  `quantityStepAtReturn` DECIMAL(18, 4) NULL,
  `batchNumberAtReturn` VARCHAR(191) NULL,
  `expiryDateAtReturn` DATETIME(3) NULL,
  `sourceHash` VARCHAR(64) NOT NULL,
  `batchLedgerStatus` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierReturnItem_supplierReturnId_sourceHash_key`(`supplierReturnId`, `sourceHash`),
  INDEX `SupplierReturnItem_tenantId_supplierReturnId_idx`(`tenantId`, `supplierReturnId`),
  INDEX `SupplierReturnItem_tenantId_productId_warehouseId_idx`(`tenantId`, `productId`, `warehouseId`),
  INDEX `SupplierReturnItem_tenantId_purchaseItemId_idx`(`tenantId`, `purchaseItemId`),
  INDEX `SupplierReturnItem_tenantId_goodsReceiptItemId_idx`(`tenantId`, `goodsReceiptItemId`),
  INDEX `SupplierReturnItem_tenantId_purchaseMatchAllocationId_idx`(`tenantId`, `purchaseMatchAllocationId`),
  INDEX `SupplierReturnItem_tenantId_batchId_idx`(`tenantId`, `batchId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierCreditNote` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `creditNoteNumber` VARCHAR(191) NOT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'RETURN',
  `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  `invoiceDate` DATETIME(3) NOT NULL,
  `creditNoteDate` DATETIME(3) NOT NULL,
  `devolutionDate` DATETIME(3) NOT NULL,
  `postingDate` DATETIME(3) NOT NULL,
  `fiscalRegimeAtCredit` VARCHAR(32) NOT NULL,
  `currencyAtIssue` VARCHAR(3) NOT NULL,
  `subtotal` DECIMAL(18, 4) NOT NULL,
  `tax` DECIMAL(18, 4) NOT NULL,
  `creditableTax` DECIMAL(18, 4) NOT NULL,
  `total` DECIMAL(18, 4) NOT NULL,
  `inventoryReversalExact` DECIMAL(18, 4) NOT NULL,
  `priceVarianceReversalExact` DECIMAL(18, 4) NOT NULL,
  `remainingCredit` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `reason` TEXT NULL,
  `supplierReference` VARCHAR(191) NULL,
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierCreditNote_tenantId_supplierId_creditNoteNumber_key`(`tenantId`, `supplierId`, `creditNoteNumber`),
  UNIQUE INDEX `SupplierCreditNote_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
  INDEX `SupplierCreditNote_tenantId_supplierId_creditNoteDate_idx`(`tenantId`, `supplierId`, `creditNoteDate`),
  INDEX `SupplierCreditNote_tenantId_postingDate_idx`(`tenantId`, `postingDate`),
  INDEX `SupplierCreditNote_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierCreditNoteLine` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `creditNoteId` VARCHAR(191) NOT NULL,
  `supplierReturnItemId` VARCHAR(191) NOT NULL,
  `sourcePurchaseItemId` VARCHAR(191) NULL,
  `purchaseMatchAllocationId` VARCHAR(191) NULL,
  `sourceHash` VARCHAR(64) NOT NULL,
  `quantityExact` DECIMAL(18, 4) NOT NULL,
  `bookUnitCostExact` DECIMAL(18, 6) NOT NULL,
  `bookValueExact` DECIMAL(18, 4) NOT NULL,
  `subtotal` DECIMAL(18, 4) NOT NULL,
  `tax` DECIMAL(18, 4) NOT NULL,
  `creditableTax` DECIMAL(18, 4) NOT NULL,
  `total` DECIMAL(18, 4) NOT NULL,
  `inventoryReversalExact` DECIMAL(18, 4) NOT NULL,
  `priceVarianceReversalExact` DECIMAL(18, 4) NOT NULL,
  `descriptionAtCredit` VARCHAR(191) NOT NULL,
  `unitAtCredit` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierCreditNoteLine_supplierReturnItemId_key`(`supplierReturnItemId`),
  UNIQUE INDEX `SupplierCreditNoteLine_creditNoteId_supplierReturnItemId_key`(`creditNoteId`, `supplierReturnItemId`),
  INDEX `SupplierCreditNoteLine_tenantId_creditNoteId_idx`(`tenantId`, `creditNoteId`),
  INDEX `SupplierCreditNoteLine_tenantId_sourcePurchaseItemId_idx`(`tenantId`, `sourcePurchaseItemId`),
  INDEX `SupplierCreditNoteLine_tenantId_purchaseMatchAllocationId_idx`(`tenantId`, `purchaseMatchAllocationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierCreditApplication` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `creditNoteId` VARCHAR(191) NOT NULL,
  `purchaseId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(18, 4) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `appliedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierCreditApplication_creditNoteId_purchaseId_key`(`creditNoteId`, `purchaseId`),
  INDEX `SupplierCreditApplication_tenantId_supplierId_appliedAt_idx`(`tenantId`, `supplierId`, `appliedAt`),
  INDEX `SupplierCreditApplication_tenantId_purchaseId_appliedAt_idx`(`tenantId`, `purchaseId`, `appliedAt`),
  INDEX `SupplierCreditApplication_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PurchaseItem`
  ADD CONSTRAINT `PurchaseItem_inventoryWarehouseId_fkey`
    FOREIGN KEY (`inventoryWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PurchaseItem_inventoryBatchId_fkey`
    FOREIGN KEY (`inventoryBatchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierReturn`
  ADD CONSTRAINT `SupplierReturn_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturn_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturn_returnedBy_fkey`
    FOREIGN KEY (`returnedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierReturnItem`
  ADD CONSTRAINT `SupplierReturnItem_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_supplierReturnId_fkey`
    FOREIGN KEY (`supplierReturnId`) REFERENCES `SupplierReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_purchaseItemId_fkey`
    FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_goodsReceiptItemId_fkey`
    FOREIGN KEY (`goodsReceiptItemId`) REFERENCES `GoodsReceiptItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_purchaseMatchAllocationId_fkey`
    FOREIGN KEY (`purchaseMatchAllocationId`) REFERENCES `PurchaseMatchAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierReturnItem_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierCreditNote`
  ADD CONSTRAINT `SupplierCreditNote_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNote_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNote_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierCreditNoteLine`
  ADD CONSTRAINT `SupplierCreditNoteLine_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNoteLine_creditNoteId_fkey`
    FOREIGN KEY (`creditNoteId`) REFERENCES `SupplierCreditNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNoteLine_supplierReturnItemId_fkey`
    FOREIGN KEY (`supplierReturnItemId`) REFERENCES `SupplierReturnItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNoteLine_sourcePurchaseItemId_fkey`
    FOREIGN KEY (`sourcePurchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditNoteLine_purchaseMatchAllocationId_fkey`
    FOREIGN KEY (`purchaseMatchAllocationId`) REFERENCES `PurchaseMatchAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierCreditApplication`
  ADD CONSTRAINT `SupplierCreditApplication_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditApplication_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditApplication_creditNoteId_fkey`
    FOREIGN KEY (`creditNoteId`) REFERENCES `SupplierCreditNote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditApplication_purchaseId_fkey`
    FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierCreditApplication_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
