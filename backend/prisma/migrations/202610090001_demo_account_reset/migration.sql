ALTER TABLE `Tenant`
  ADD COLUMN `demoResetArchivedAt` DATETIME(3) NULL,
  ADD COLUMN `demoResetRootId` VARCHAR(191) NULL,
  ADD INDEX `Tenant_demoResetArchivedAt_createdAt_idx` (`demoResetArchivedAt`, `createdAt`),
  ADD INDEX `Tenant_demoResetRootId_idx` (`demoResetRootId`);
CREATE INDEX `ManualPayment_tenantId_status_idx` ON `ManualPayment` (`tenantId`, `status`);
CREATE INDEX `Loan_tenantId_idx` ON `Loan` (`tenantId`);

CREATE TABLE `DemoAccountReset` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `requestKey` VARCHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PREVIEWED',
  `fingerprint` VARCHAR(64) NOT NULL,
  `counts` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `nextTenantId` VARCHAR(191) NULL,
  `nextUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DemoAccountReset_tenantId_requestKey_key` (`tenantId`, `requestKey`),
  INDEX `DemoAccountReset_tenantId_userId_createdAt_idx` (`tenantId`, `userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
