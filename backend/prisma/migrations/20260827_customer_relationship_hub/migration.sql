-- Hub de relación con clientes y reintentos seguros de abonos.
-- Migración estrictamente aditiva para MySQL 8: no reinterpreta históricos.

ALTER TABLE `Payment`
  ADD COLUMN `clientEventId` VARCHAR(128) NULL,
  ADD COLUMN `payloadHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Payment_saleId_clientEventId_key`
  ON `Payment`(`saleId`, `clientEventId`);

CREATE TABLE `CustomerInteraction` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `note` TEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
  `promisedAmount` DECIMAL(10, 2) NULL,
  `promisedAt` DATETIME(3) NULL,
  `followUpAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `CustomerInteraction_tenantId_customerId_createdAt_idx`(`tenantId`, `customerId`, `createdAt`),
  INDEX `CustomerInteraction_tenantId_status_followUpAt_idx`(`tenantId`, `status`, `followUpAt`),
  INDEX `CustomerInteraction_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerInteraction`
  ADD CONSTRAINT `CustomerInteraction_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerInteraction_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerInteraction_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
