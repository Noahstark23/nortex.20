-- CreateTable
CREATE TABLE `AssistantTenantConfig` (
    `tenantId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `extractionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `executionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `monthlyBudgetUsd` DECIMAL(18, 6) NOT NULL DEFAULT 10,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantConversation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AssistantConversation_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantConversation_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantMessage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantMessage_tenantId_userId_conversationId_createdAt_idx`(`tenantId`, `userId`, `conversationId`, `createdAt`),
    UNIQUE INDEX `AssistantMessage_conversationId_requestId_role_key`(`conversationId`, `requestId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `mediaType` VARCHAR(64) NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `pages` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(24) NOT NULL DEFAULT 'UPLOADED',
    `purchaseId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    INDEX `AssistantAttachment_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantAttachment_tenantId_purchaseId_idx`(`tenantId`, `purchaseId`),
    INDEX `AssistantAttachment_expiresAt_status_idx`(`expiresAt`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `attachmentIds` JSON NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `leaseToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `proposalId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssistantJob_status_availableAt_leaseUntil_idx`(`status`, `availableAt`, `leaseUntil`),
    INDEX `AssistantJob_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantJob_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantProposal` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `attachmentIds` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    `draft` JSON NOT NULL,
    `issues` JSON NOT NULL,
    `preview` JSON NULL,
    `payloadHash` CHAR(64) NULL,
    `operationId` VARCHAR(64) NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AssistantProposal_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantProposal_tenantId_userId_operationId_idx`(`tenantId`, `userId`, `operationId`),
    INDEX `AssistantProposal_expiresAt_status_idx`(`expiresAt`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantBudget` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(160) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `limitUsd` DECIMAL(18, 6) NOT NULL,
    `reservedUsd` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `blocked` BOOLEAN NOT NULL DEFAULT false,
    `spentUsd` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AssistantBudget_scope_month_key`(`scope`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantUsage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `reservedUsd` DECIMAL(18, 6) NOT NULL,
    `actualUsd` DECIMAL(18, 6) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
    `providerRequestId` VARCHAR(191) NULL,
    `usage` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssistantUsage_tenantId_month_createdAt_idx`(`tenantId`, `month`, `createdAt`),
    INDEX `AssistantUsage_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseCommand` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `purchaseId` VARCHAR(191) NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseCommand_tenantId_purchaseId_idx`(`tenantId`, `purchaseId`),
    UNIQUE INDEX `PurchaseCommand_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Supplier_tenantId_name_idx` ON `Supplier`(`tenantId`, `name`);

-- CreateIndex
CREATE INDEX `Product_tenantId_name_idx` ON `Product`(`tenantId`, `name`);

-- CreateIndex
CREATE INDEX `Warehouse_tenantId_isActive_name_idx` ON `Warehouse`(`tenantId`, `isActive`, `name`);

-- CreateIndex
CREATE INDEX `ProductBatch_tenantId_expiryDate_idx` ON `ProductBatch`(`tenantId`, `expiryDate`);

-- CreateIndex
CREATE INDEX `ProductReturn_tenantId_createdAt_idx` ON `ProductReturn`(`tenantId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `AssistantTenantConfig` ADD CONSTRAINT `AssistantTenantConfig_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantConversation` ADD CONSTRAINT `AssistantConversation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantMessage` ADD CONSTRAINT `AssistantMessage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantMessage` ADD CONSTRAINT `AssistantMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AssistantConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantAttachment` ADD CONSTRAINT `AssistantAttachment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantJob` ADD CONSTRAINT `AssistantJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantProposal` ADD CONSTRAINT `AssistantProposal_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantUsage` ADD CONSTRAINT `AssistantUsage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseCommand` ADD CONSTRAINT `PurchaseCommand_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
