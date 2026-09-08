-- Expediente profesional de devoluciones, cambios y anulaciones.
-- MySQL 8, expand-only: no borra ni reescribe datos históricos.

ALTER TABLE `Tenant`
  ADD COLUMN `returnWindowDays` INTEGER NOT NULL DEFAULT 30;

ALTER TABLE `Customer`
  ADD COLUMN `storeCreditBalance` DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE `Sale`
  ADD COLUMN `storeCreditApplied` DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE `ProductReturn`
  ADD COLUMN `correctionRequestId` VARCHAR(191) NULL,
  ADD COLUMN `returnNumber` INTEGER NULL,
  ADD COLUMN `resolution` VARCHAR(32) NOT NULL DEFAULT 'REFUND',
  ADD COLUMN `refundStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED';

CREATE TABLE `SaleCorrectionRequest` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `saleId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
  `reason` TEXT NOT NULL,
  `resolution` VARCHAR(32) NULL,
  `refundMethod` VARCHAR(16) NULL,
  `requestedBy` VARCHAR(191) NOT NULL,
  `approvedBy` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `rejectedBy` VARCHAR(191) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `rejectionReason` TEXT NULL,
  `executedBy` VARCHAR(191) NULL,
  `executedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SaleCorrectionRequest_tenantId_clientEventId_key` (`tenantId`, `clientEventId`),
  INDEX `SaleCorrectionRequest_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  INDEX `SaleCorrectionRequest_tenantId_saleId_createdAt_idx` (`tenantId`, `saleId`, `createdAt`),
  INDEX `SaleCorrectionRequest_approvedBy_idx` (`approvedBy`),
  INDEX `SaleCorrectionRequest_requestedBy_idx` (`requestedBy`),
  CONSTRAINT `SaleCorrectionRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleCorrectionRequest_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SaleCorrectionLine` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(191) NOT NULL,
  `saleItemId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `disposition` VARCHAR(16) NOT NULL DEFAULT 'RESTOCK',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SaleCorrectionLine_requestId_saleItemId_key` (`requestId`, `saleItemId`),
  INDEX `SaleCorrectionLine_tenantId_requestId_idx` (`tenantId`, `requestId`),
  INDEX `SaleCorrectionLine_tenantId_saleItemId_idx` (`tenantId`, `saleItemId`),
  CONSTRAINT `SaleCorrectionLine_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleCorrectionLine_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `SaleCorrectionRequest` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleCorrectionLine_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductReturnItem` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productReturnId` VARCHAR(191) NOT NULL,
  `saleItemId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `refundUnitPrice` DECIMAL(18,4) NOT NULL,
  `lineTotal` DECIMAL(18,4) NOT NULL,
  `costTotal` DECIMAL(18,4) NOT NULL,
  `disposition` VARCHAR(16) NOT NULL,
  `productNameAtReturn` VARCHAR(191) NULL,
  `unitAtReturn` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProductReturnItem_productReturnId_saleItemId_key` (`productReturnId`, `saleItemId`),
  INDEX `ProductReturnItem_tenantId_productReturnId_idx` (`tenantId`, `productReturnId`),
  INDEX `ProductReturnItem_tenantId_productId_idx` (`tenantId`, `productId`),
  CONSTRAINT `ProductReturnItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductReturnItem_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductReturnItem_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApprovalGrant` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `purpose` VARCHAR(32) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ApprovalGrant_tokenHash_key` (`tokenHash`),
  INDEX `ApprovalGrant_tenantId_userId_expiresAt_idx` (`tenantId`, `userId`, `expiresAt`),
  CONSTRAINT `ApprovalGrant_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReturnRefund` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `saleId` VARCHAR(191) NOT NULL,
  `productReturnId` VARCHAR(191) NULL,
  `correctionRequestId` VARCHAR(191) NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `externalReference` VARCHAR(191) NULL,
  `evidenceNote` TEXT NULL,
  `completedBy` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ReturnRefund_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  INDEX `ReturnRefund_tenantId_saleId_idx` (`tenantId`, `saleId`),
  INDEX `ReturnRefund_productReturnId_idx` (`productReturnId`),
  CONSTRAINT `ReturnRefund_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ReturnRefund_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ReturnRefund_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ReturnRefund_correctionRequestId_fkey` FOREIGN KEY (`correctionRequestId`) REFERENCES `SaleCorrectionRequest` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReturnInspection` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `correctionLineId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `batchEvidence` JSON NULL,
  `resolvedBy` VARCHAR(191) NULL,
  `resolutionReason` TEXT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ReturnInspection_correctionLineId_key` (`correctionLineId`),
  INDEX `ReturnInspection_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  INDEX `ReturnInspection_tenantId_productId_idx` (`tenantId`, `productId`),
  CONSTRAINT `ReturnInspection_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ReturnInspection_correctionLineId_fkey` FOREIGN KEY (`correctionLineId`) REFERENCES `SaleCorrectionLine` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ReturnInspection_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerCreditEntry` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `productReturnId` VARCHAR(191) NULL,
  `saleId` VARCHAR(191) NULL,
  `type` VARCHAR(32) NOT NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `balanceAfter` DECIMAL(18,4) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `CustomerCreditEntry_tenantId_customerId_createdAt_idx` (`tenantId`, `customerId`, `createdAt`),
  INDEX `CustomerCreditEntry_productReturnId_idx` (`productReturnId`),
  INDEX `CustomerCreditEntry_saleId_idx` (`saleId`),
  CONSTRAINT `CustomerCreditEntry_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerCreditEntry_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerCreditEntry_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerCreditEntry_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductReturn`
  ADD CONSTRAINT `ProductReturn_correctionRequestId_fkey`
    FOREIGN KEY (`correctionRequestId`) REFERENCES `SaleCorrectionRequest` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD UNIQUE INDEX `ProductReturn_correctionRequestId_key` (`correctionRequestId`),
  ADD UNIQUE INDEX `ProductReturn_tenantId_returnNumber_key` (`tenantId`, `returnNumber`);
