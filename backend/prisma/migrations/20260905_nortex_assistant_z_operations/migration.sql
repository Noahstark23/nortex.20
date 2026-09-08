-- AlterTable
ALTER TABLE `AssistantTenantConfig` ADD COLUMN `actionsEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `operationsEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `privateWhatsappEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `promotionsEnabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `SaleItem` ADD COLUMN `promotionSnapshot` JSON NULL;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `promotionPriceVersion` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `AssistantRun` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `inputText` TEXT NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 0,
    `iterations` INTEGER NOT NULL DEFAULT 0,
    `leaseToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `deadlineAt` DATETIME(3) NULL,
    `checkpoint` JSON NULL,
    `result` JSON NULL,
    `errorCode` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AssistantRun_tenantId_userId_conversationId_createdAt_idx`(`tenantId`, `userId`, `conversationId`, `createdAt`),
    INDEX `AssistantRun_status_leaseUntil_idx`(`status`, `leaseUntil`),
    INDEX `AssistantRun_expiresAt_idx`(`expiresAt`),
    INDEX `AssistantRun_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `AssistantRun_conversationId_requestId_key`(`conversationId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantDailyBrief` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `localDay` VARCHAR(10) NOT NULL,
    `items` JSON NOT NULL,
    `dismissedIds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AssistantDailyBrief_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `AssistantDailyBrief_tenantId_userId_localDay_key`(`tenantId`, `userId`, `localDay`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantActionProposal` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `draftJson` JSON NOT NULL,
    `previewJson` JSON NULL,
    `previewHash` CHAR(64) NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `operationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantActionProposal_tenantId_userId_updatedAt_idx`(`tenantId`, `userId`, `updatedAt`),
    INDEX `AssistantActionProposal_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `AssistantActionProposal_tenantId_userId_runId_idx`(`tenantId`, `userId`, `runId`),
    UNIQUE INDEX `AssistantActionProposal_tenantId_userId_requestKey_key`(`tenantId`, `userId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantActionCommand` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `proposalId` VARCHAR(191) NOT NULL,
    `proposalVersion` INTEGER NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `resultJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantActionCommand_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantActionCommand_tenantId_proposalId_idx`(`tenantId`, `proposalId`),
    INDEX `AssistantActionCommand_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `AssistantActionCommand_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderDraftCommand` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `resultJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrderDraftCommand_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    UNIQUE INDEX `PurchaseOrderDraftCommand_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderDraftSequence` (
    `tenantId` VARCHAR(191) NOT NULL,
    `lastNumber` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantCatalogAlias` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(100) NOT NULL,
    `normalizedAlias` VARCHAR(100) NOT NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantCatalogAlias_tenantId_productId_active_idx`(`tenantId`, `productId`, `active`),
    UNIQUE INDEX `AssistantCatalogAlias_tenantId_normalizedAlias_productId_key`(`tenantId`, `normalizedAlias`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Promotion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `percent` DECIMAL(5, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED',
    `version` INTEGER NOT NULL DEFAULT 1,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Promotion_tenantId_status_startsAt_endsAt_idx`(`tenantId`, `status`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionItem` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `promotionId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `configHash` VARCHAR(64) NOT NULL,
    `configSnapshot` JSON NOT NULL,

    INDEX `PromotionItem_tenantId_productId_promotionId_idx`(`tenantId`, `productId`, `promotionId`),
    UNIQUE INDEX `PromotionItem_promotionId_productId_key`(`promotionId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionCommand` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `promotionId` VARCHAR(191) NULL,
    `resultJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PromotionCommand_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionCheckout` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `offlineId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `requestHash` VARCHAR(64) NOT NULL,
    `priceHash` VARCHAR(64) NOT NULL,
    `quoteJson` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `saleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PromotionCheckout_tenantId_userId_offlineId_idx`(`tenantId`, `userId`, `offlineId`),
    INDEX `PromotionCheckout_tenantId_expiresAt_idx`(`tenantId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWaChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssistantWaChallenge_codeHash_key`(`codeHash`),
    INDEX `AssistantWaChallenge_tenantId_userId_expiresAt_idx`(`tenantId`, `userId`, `expiresAt`),
    INDEX `AssistantWaChallenge_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantWaChallenge_expiresAt_createdAt_idx`(`expiresAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWaBinding` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `roleAtBinding` VARCHAR(32) NOT NULL,
    `waId` VARCHAR(32) NOT NULL,
    `phoneNumberId` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `conversationId` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssistantWaBinding_userId_key`(`userId`),
    INDEX `AssistantWaBinding_tenantId_userId_active_idx`(`tenantId`, `userId`, `active`),
    UNIQUE INDEX `AssistantWaBinding_phoneNumberId_waId_key`(`phoneNumberId`, `waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWaInbox` (
    `id` VARCHAR(191) NOT NULL,
    `sequence` BIGINT NOT NULL AUTO_INCREMENT,
    `providerMessageId` VARCHAR(191) NOT NULL,
    `phoneNumberId` VARCHAR(64) NOT NULL,
    `waId` VARCHAR(32) NOT NULL,
    `bindingId` VARCHAR(191) NULL,
    `bindingVersion` INTEGER NULL,
    `tenantId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `roleAtReceipt` VARCHAR(32) NULL,
    `kind` VARCHAR(32) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `leaseToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attachmentId` VARCHAR(191) NULL,
    `extractionJobId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssistantWaInbox_sequence_key`(`sequence`),
    UNIQUE INDEX `AssistantWaInbox_providerMessageId_key`(`providerMessageId`),
    INDEX `AssistantWaInbox_status_availableAt_leaseUntil_idx`(`status`, `availableAt`, `leaseUntil`),
    INDEX `AssistantWaInbox_phoneNumberId_waId_status_sequence_idx`(`phoneNumberId`, `waId`, `status`, `sequence`),
    INDEX `AssistantWaInbox_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantWaInbox_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWaOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `sequence` BIGINT NOT NULL AUTO_INCREMENT,
    `inboxId` VARCHAR(191) NOT NULL,
    `bindingId` VARCHAR(191) NOT NULL,
    `bindingVersion` INTEGER NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `phoneNumberId` VARCHAR(64) NOT NULL,
    `waId` VARCHAR(32) NOT NULL,
    `text` TEXT NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `providerMessageId` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `leaseToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `errorCode` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssistantWaOutbox_sequence_key`(`sequence`),
    UNIQUE INDEX `AssistantWaOutbox_inboxId_key`(`inboxId`),
    UNIQUE INDEX `AssistantWaOutbox_providerMessageId_key`(`providerMessageId`),
    INDEX `AssistantWaOutbox_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AssistantWaOutbox_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `AssistantWaOutbox_expiresAt_idx`(`expiresAt`),
    INDEX `AssistantWaOutbox_phoneNumberId_waId_status_sequence_idx`(`phoneNumberId`, `waId`, `status`, `sequence`),
    INDEX `AssistantWaOutbox_createdAt_status_idx`(`createdAt`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PurchaseCommand_tenantId_createdAt_idx` ON `PurchaseCommand`(`tenantId`, `createdAt`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_tenantId_status_idx` ON `PurchaseOrder`(`tenantId`, `status`);

-- AddForeignKey
ALTER TABLE `AssistantRun` ADD CONSTRAINT `AssistantRun_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantDailyBrief` ADD CONSTRAINT `AssistantDailyBrief_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantActionProposal` ADD CONSTRAINT `AssistantActionProposal_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantActionCommand` ADD CONSTRAINT `AssistantActionCommand_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderDraftCommand` ADD CONSTRAINT `PurchaseOrderDraftCommand_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderDraftSequence` ADD CONSTRAINT `PurchaseOrderDraftSequence_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantCatalogAlias` ADD CONSTRAINT `AssistantCatalogAlias_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Promotion` ADD CONSTRAINT `Promotion_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCommand` ADD CONSTRAINT `PromotionCommand_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCheckout` ADD CONSTRAINT `PromotionCheckout_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantWaChallenge` ADD CONSTRAINT `AssistantWaChallenge_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantWaBinding` ADD CONSTRAINT `AssistantWaBinding_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantWaInbox` ADD CONSTRAINT `AssistantWaInbox_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantWaOutbox` ADD CONSTRAINT `AssistantWaOutbox_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

