-- Proveedor 360 y subledger de cuentas por pagar.
-- Migración expand-only para MySQL 8: no modifica ni reinterpreta filas históricas.

ALTER TABLE `Supplier`
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `legalType` VARCHAR(32) NULL,
  ADD COLUMN `fiscalCategory` VARCHAR(64) NULL,
  ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'NIO',
  ADD COLUMN `paymentTermsDays` INTEGER NULL,
  ADD COLUMN `creditLimit` DECIMAL(18, 4) NULL,
  ADD COLUMN `leadTimeDays` INTEGER NULL,
  ADD COLUMN `minimumOrderAmount` DECIMAL(18, 4) NULL,
  ADD COLUMN `notes` TEXT NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `Supplier_tenantId_deletedAt_name_idx`
  ON `Supplier`(`tenantId`, `deletedAt`, `name`);

CREATE INDEX `Supplier_tenantId_status_name_idx`
  ON `Supplier`(`tenantId`, `status`, `name`);

CREATE INDEX `Supplier_tenantId_ruc_idx`
  ON `Supplier`(`tenantId`, `ruc`);

ALTER TABLE `Purchase`
  ADD COLUMN `balanceDue` DECIMAL(18, 4) NULL,
  ADD COLUMN `paidAt` DATETIME(3) NULL;

CREATE INDEX `Purchase_tenantId_supplierId_date_idx`
  ON `Purchase`(`tenantId`, `supplierId`, `date`);

-- Sobre instalaciones pobladas, scripts/deploy-schema-preflight.ts valida la
-- definición exacta y duplicados antes de crear este índice, sin borrar datos.
CREATE UNIQUE INDEX `Purchase_tenantId_supplierId_invoiceNumber_key`
  ON `Purchase`(`tenantId`, `supplierId`, `invoiceNumber`);

CREATE TABLE `SupplierContact` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NULL,
  `email` VARCHAR(191) NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `notes` TEXT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `SupplierContact_tenantId_supplierId_idx`(`tenantId`, `supplierId`),
  INDEX `SupplierContact_tenantId_email_idx`(`tenantId`, `email`),
  INDEX `SupplierContact_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierDocument` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(64) NOT NULL,
  `fileName` VARCHAR(255) NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `mimeType` VARCHAR(127) NULL,
  `sizeBytes` INTEGER NULL,
  `sha256` VARCHAR(64) NULL,
  `expiresAt` DATETIME(3) NULL,
  `uploadedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `SupplierDocument_tenantId_supplierId_createdAt_idx`(`tenantId`, `supplierId`, `createdAt`),
  INDEX `SupplierDocument_tenantId_kind_expiresAt_idx`(`tenantId`, `kind`, `expiresAt`),
  INDEX `SupplierDocument_uploadedBy_idx`(`uploadedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupplierPayment` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `purchaseId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `clientEventId` VARCHAR(128) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `amount` DECIMAL(18, 4) NOT NULL,
  `method` VARCHAR(32) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SupplierPayment_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
  INDEX `SupplierPayment_tenantId_supplierId_paidAt_idx`(`tenantId`, `supplierId`, `paidAt`),
  INDEX `SupplierPayment_tenantId_purchaseId_paidAt_idx`(`tenantId`, `purchaseId`, `paidAt`),
  INDEX `SupplierPayment_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SupplierContact`
  ADD CONSTRAINT `SupplierContact_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierContact_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierContact_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierDocument`
  ADD CONSTRAINT `SupplierDocument_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierDocument_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierDocument_uploadedBy_fkey`
    FOREIGN KEY (`uploadedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierPayment`
  ADD CONSTRAINT `SupplierPayment_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierPayment_purchaseId_fkey`
    FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierPayment_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SupplierPayment_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
