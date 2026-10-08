ALTER TABLE `AssistantTenantConfig` ADD COLUMN `approvedMonthlyBudgetUsd` DECIMAL(18,6) NOT NULL DEFAULT 2;

CREATE TABLE `AssistantBudgetRequest` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestedBy` VARCHAR(191) NOT NULL,
  `requestKey` VARCHAR(191) NOT NULL,
  `requestedUsd` DECIMAL(18,6) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `decidedBy` VARCHAR(191) NULL,
  `decisionReason` VARCHAR(500) NULL,
  `decidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AssistantBudgetRequest_tenantId_requestKey_key` (`tenantId`, `requestKey`),
  INDEX `AssistantBudgetRequest_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  INDEX `AssistantBudgetRequest_tenantId_createdAt_idx` (`tenantId`, `createdAt`),
  INDEX `AssistantBudgetRequest_status_createdAt_id_idx` (`status`, `createdAt`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AssistantBudgetRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
