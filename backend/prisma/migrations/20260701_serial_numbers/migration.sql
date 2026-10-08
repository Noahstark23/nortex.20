-- Inventario Fase 1: control de series (números de serie por unidad).
-- Cambios aditivos y no destructivos. El deploy usa `prisma db push`.

ALTER TABLE `Product` ADD COLUMN `requiresSerialTracking` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `SerialNumber` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `serial` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'IN_STOCK',
  `saleId` VARCHAR(191) NULL,
  `purchaseId` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SerialNumber_productId_serial_key`(`productId`, `serial`),
  INDEX `SerialNumber_tenantId_idx`(`tenantId`),
  INDEX `SerialNumber_productId_idx`(`productId`),
  INDEX `SerialNumber_status_idx`(`status`),
  INDEX `SerialNumber_serial_idx`(`serial`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
