-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `businessName` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'FERRETERIA',
    `taxId` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NULL,
    `walletBalance` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `creditLimit` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `creditScore` INTEGER NULL,
    `subscriptionStatus` VARCHAR(191) NOT NULL DEFAULT 'TRIAL',
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `subscriptionEndsAt` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `theftAlertThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 500,
    `agentCashMin` DECIMAL(18, 4) NULL,
    `agentCashMax` DECIMAL(18, 4) NULL,
    `deliveryFee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `allowNegativeStock` BOOLEAN NOT NULL DEFAULT false,
    `requireCashierPin` BOOLEAN NOT NULL DEFAULT false,
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `dgiAuthCode` VARCHAR(191) NULL,
    `dgiAuthDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fiscalRegime` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    `fiscalRegimeVersion` INTEGER NOT NULL DEFAULT 1,
    `batchWarehouseLedgerMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
    `batchWarehouseLedgerActivatedAt` DATETIME(3) NULL,
    `pharmacyInventoryMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
    `pharmacyInventoryActivatedAt` DATETIME(3) NULL,
    `returnWindowDays` INTEGER NOT NULL DEFAULT 30,

    UNIQUE INDEX `Tenant_taxId_key`(`taxId`),
    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'EMPLOYEE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `lastLogin` DATETIME(3) NULL,
    `invitedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `whatsappNumber` VARCHAR(20) NULL,
    `assistantBudgetOwner` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_whatsappNumber_key`(`whatsappNumber`),
    INDEX `User_tenantId_idx`(`tenantId`),
    INDEX `User_lastLogin_idx`(`lastLogin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantTenantConfig` (
    `tenantId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `extractionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `executionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `operationsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `actionsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `promotionsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `privateWhatsappEnabled` BOOLEAN NOT NULL DEFAULT false,
    `monthlyBudgetUsd` DECIMAL(18, 6) NOT NULL DEFAULT 10,
    `approvedMonthlyBudgetUsd` DECIMAL(18, 6) NOT NULL DEFAULT 2,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantBudgetRequest` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `requestedUsd` DECIMAL(18, 6) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `decidedBy` VARCHAR(191) NULL,
    `decisionReason` VARCHAR(500) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantBudgetRequest_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `AssistantBudgetRequest_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AssistantBudgetRequest_status_createdAt_id_idx`(`status`, `createdAt`, `id`),
    UNIQUE INDEX `AssistantBudgetRequest_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantConversation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `metadata` JSON NULL,
    `stateVersion` INTEGER NOT NULL DEFAULT 0,
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
    `intakeContext` JSON NULL,
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
    `source` JSON NULL,
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
    `runId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssistantUsage_tenantId_month_createdAt_idx`(`tenantId`, `month`, `createdAt`),
    INDEX `AssistantUsage_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AssistantUsage_runId_idx`(`runId`),
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
    INDEX `PurchaseCommand_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `PurchaseCommand_tenantId_requestKey_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `knowledgeChannel` VARCHAR(24) NULL,

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
    `knowledgeReferences` JSON NULL,

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

-- CreateTable
CREATE TABLE `AssistantKnowledgeControl` (
    `id` VARCHAR(64) NOT NULL,
    `activeReleaseId` VARCHAR(128) NULL,
    `generation` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantKnowledgeRelease` (
    `id` VARCHAR(128) NOT NULL,
    `formatVersion` INTEGER NOT NULL DEFAULT 1,
    `manifest` JSON NOT NULL,
    `manifestHash` CHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `createdById` VARCHAR(191) NOT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `retiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssistantKnowledgeRelease_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AssistantKnowledgeRelease_status_createdAt_id_idx`(`status`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantKnowledgeReviewNote` (
    `id` VARCHAR(64) NOT NULL,
    `releaseId` VARCHAR(128) NOT NULL,
    `manifestHash` CHAR(64) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantKnowledgeReviewNote_releaseId_createdAt_id_idx`(`releaseId`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantKnowledgeVersion` (
    `documentId` VARCHAR(128) NOT NULL,
    `version` VARCHAR(64) NOT NULL,
    `sectionId` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `retiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssistantKnowledgeVersion_status_documentId_idx`(`status`, `documentId`),
    PRIMARY KEY (`documentId`, `version`, `sectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invitation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `invitedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invitation_token_key`(`token`),
    INDEX `Invitation_tenantId_idx`(`tenantId`),
    INDEX `Invitation_token_idx`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordReset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordReset_token_key`(`token`),
    INDEX `PasswordReset_token_idx`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `creditLimit` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `currentDebt` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `isBlocked` BOOLEAN NOT NULL DEFAULT false,
    `isWholesale` BOOLEAN NOT NULL DEFAULT false,
    `sellerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `storeCreditBalance` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    INDEX `Customer_tenantId_idx`(`tenantId`),
    INDEX `Customer_tenantId_sellerId_idx`(`tenantId`, `sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `ruc` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `creditLimit` DECIMAL(18, 4) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NIO',
    `deletedAt` DATETIME(3) NULL,
    `fiscalCategory` VARCHAR(64) NULL,
    `leadTimeDays` INTEGER NULL,
    `legalType` VARCHAR(32) NULL,
    `minimumOrderAmount` DECIMAL(18, 4) NULL,
    `notes` TEXT NULL,
    `paymentTermsDays` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Supplier_tenantId_idx`(`tenantId`),
    INDEX `Supplier_tenantId_deletedAt_name_idx`(`tenantId`, `deletedAt`, `name`),
    INDEX `Supplier_tenantId_status_name_idx`(`tenantId`, `status`, `name`),
    INDEX `Supplier_tenantId_ruc_idx`(`tenantId`, `ruc`),
    INDEX `Supplier_tenantId_name_idx`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE `Purchase` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `tax` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `paymentMethod` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `purchaseOrderId` VARCHAR(191) NULL,
    `creditableTax` DECIMAL(18, 4) NULL,
    `fiscalRegimeAtPurchase` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    `matchResolutionClientEventId` VARCHAR(128) NULL,
    `matchResolutionPayloadHash` VARCHAR(64) NULL,
    `settledAt` DATETIME(3) NULL,
    `balanceDue` DECIMAL(18, 4) NULL,
    `documentStatus` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
    `matchResolutionNote` TEXT NULL,
    `matchResolvedAt` DATETIME(3) NULL,
    `matchResolvedBy` VARCHAR(191) NULL,
    `matchStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
    `paidAt` DATETIME(3) NULL,
    `paymentHold` BOOLEAN NOT NULL DEFAULT false,
    `postingDate` DATETIME(3) NULL,
    `exemptSubtotal` DECIMAL(18, 4) NULL,
    `noTaxReason` VARCHAR(32) NULL,
    `taxTreatment` VARCHAR(32) NOT NULL DEFAULT 'IVA_TRASLADADO',
    `taxableSubtotal` DECIMAL(18, 4) NULL,

    INDEX `Purchase_tenantId_idx`(`tenantId`),
    INDEX `Purchase_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `Purchase_supplierId_idx`(`supplierId`),
    INDEX `Purchase_status_idx`(`status`),
    INDEX `Purchase_tenantId_date_idx`(`tenantId`, `date`),
    INDEX `Purchase_tenantId_fiscalRegimeAtPurchase_date_idx`(`tenantId`, `fiscalRegimeAtPurchase`, `date`),
    INDEX `Purchase_tenantId_supplierId_date_idx`(`tenantId`, `supplierId`, `date`),
    INDEX `Purchase_tenantId_documentStatus_postingDate_idx`(`tenantId`, `documentStatus`, `postingDate`),
    INDEX `Purchase_tenantId_matchStatus_paymentHold_date_idx`(`tenantId`, `matchStatus`, `paymentHold`, `date`),
    INDEX `Purchase_matchResolvedBy_idx`(`matchResolvedBy`),
    UNIQUE INDEX `Purchase_tenantId_supplierId_invoiceNumber_key`(`tenantId`, `supplierId`, `invoiceNumber`),
    UNIQUE INDEX `Purchase_tenantId_matchResolutionClientEventId_key`(`tenantId`, `matchResolutionClientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SupplierPayment_tenantId_supplierId_paidAt_idx`(`tenantId`, `supplierId`, `paidAt`),
    INDEX `SupplierPayment_tenantId_purchaseId_paidAt_idx`(`tenantId`, `purchaseId`, `paidAt`),
    INDEX `SupplierPayment_createdBy_idx`(`createdBy`),
    UNIQUE INDEX `SupplierPayment_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SupplierReturn_tenantId_supplierId_returnedAt_idx`(`tenantId`, `supplierId`, `returnedAt`),
    INDEX `SupplierReturn_returnedBy_idx`(`returnedBy`),
    UNIQUE INDEX `SupplierReturn_tenantId_returnNumber_key`(`tenantId`, `returnNumber`),
    UNIQUE INDEX `SupplierReturn_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SupplierReturnItem_tenantId_supplierReturnId_idx`(`tenantId`, `supplierReturnId`),
    INDEX `SupplierReturnItem_tenantId_productId_warehouseId_idx`(`tenantId`, `productId`, `warehouseId`),
    INDEX `SupplierReturnItem_tenantId_purchaseItemId_idx`(`tenantId`, `purchaseItemId`),
    INDEX `SupplierReturnItem_tenantId_goodsReceiptItemId_idx`(`tenantId`, `goodsReceiptItemId`),
    INDEX `SupplierReturnItem_tenantId_purchaseMatchAllocationId_idx`(`tenantId`, `purchaseMatchAllocationId`),
    INDEX `SupplierReturnItem_tenantId_batchId_idx`(`tenantId`, `batchId`),
    UNIQUE INDEX `SupplierReturnItem_supplierReturnId_sourceHash_key`(`supplierReturnId`, `sourceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SupplierCreditNote_tenantId_supplierId_creditNoteDate_idx`(`tenantId`, `supplierId`, `creditNoteDate`),
    INDEX `SupplierCreditNote_tenantId_postingDate_idx`(`tenantId`, `postingDate`),
    INDEX `SupplierCreditNote_createdBy_idx`(`createdBy`),
    UNIQUE INDEX `SupplierCreditNote_tenantId_supplierId_creditNoteNumber_key`(`tenantId`, `supplierId`, `creditNoteNumber`),
    UNIQUE INDEX `SupplierCreditNote_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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
    INDEX `SupplierCreditNoteLine_tenantId_creditNoteId_idx`(`tenantId`, `creditNoteId`),
    INDEX `SupplierCreditNoteLine_tenantId_sourcePurchaseItemId_idx`(`tenantId`, `sourcePurchaseItemId`),
    INDEX `SupplierCreditNoteLine_tenantId_purchaseMatchAllocationId_idx`(`tenantId`, `purchaseMatchAllocationId`),
    UNIQUE INDEX `SupplierCreditNoteLine_creditNoteId_supplierReturnItemId_key`(`creditNoteId`, `supplierReturnItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SupplierCreditApplication_tenantId_supplierId_appliedAt_idx`(`tenantId`, `supplierId`, `appliedAt`),
    INDEX `SupplierCreditApplication_tenantId_purchaseId_appliedAt_idx`(`tenantId`, `purchaseId`, `appliedAt`),
    INDEX `SupplierCreditApplication_createdBy_idx`(`createdBy`),
    UNIQUE INDEX `SupplierCreditApplication_creditNoteId_purchaseId_key`(`creditNoteId`, `purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseItem` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `quantityExact` DECIMAL(18, 4) NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `totalCost` DECIMAL(10, 2) NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `expiryDate` DATETIME(3) NULL,
    `inventoryWarehouseId` VARCHAR(191) NULL,
    `inventoryBatchId` VARCHAR(191) NULL,
    `inventoryUnitCostExact` DECIMAL(18, 6) NULL,
    `creditableTaxExact` DECIMAL(18, 4) NULL,
    `expectedUnitCostExact` DECIMAL(18, 6) NULL,
    `priceVarianceExact` DECIMAL(18, 4) NULL,
    `purchaseOrderItemId` VARCHAR(191) NULL,
    `taxAmountExact` DECIMAL(18, 4) NULL,
    `unitCostExact` DECIMAL(18, 6) NULL,
    `taxableAtPurchase` BOOLEAN NULL,

    INDEX `PurchaseItem_purchaseId_idx`(`purchaseId`),
    INDEX `PurchaseItem_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
    INDEX `PurchaseItem_inventoryWarehouseId_idx`(`inventoryWarehouseId`),
    INDEX `PurchaseItem_inventoryBatchId_idx`(`inventoryBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `expectedDate` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PurchaseOrder_tenantId_idx`(`tenantId`),
    INDEX `PurchaseOrder_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
    INDEX `PurchaseOrder_status_idx`(`status`),
    UNIQUE INDEX `PurchaseOrder_tenantId_orderNumber_key`(`tenantId`, `orderNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `quantityOrdered` DOUBLE NOT NULL,
    `quantityReceived` DOUBLE NOT NULL DEFAULT 0,
    `quantityOrderedExact` DECIMAL(18, 4) NULL,
    `quantityReceivedExact` DECIMAL(18, 4) NULL,
    `unitAtOrder` VARCHAR(191) NULL,
    `saleModeAtOrder` VARCHAR(191) NULL,
    `quantityStepAtOrder` DECIMAL(18, 4) NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `quantityRejectedExact` DECIMAL(18, 4) NULL,
    `quantityClosedShortExact` DECIMAL(18, 4) NULL,
    `unitCostExact` DECIMAL(18, 6) NULL,

    INDEX `PurchaseOrderItem_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `PurchaseOrderItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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
    `payloadVersion` INTEGER NOT NULL DEFAULT 1,
    `inspectionOutcome` VARCHAR(32) NOT NULL DEFAULT 'FULL_ACCEPT',
    `inspectedLineCount` INTEGER NOT NULL DEFAULT 0,
    `rejectedLineCount` INTEGER NOT NULL DEFAULT 0,
    `hasSupplierFault` BOOLEAN NOT NULL DEFAULT false,
    `receivedBy` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GoodsReceipt_tenantId_purchaseOrderId_receivedAt_idx`(`tenantId`, `purchaseOrderId`, `receivedAt`),
    INDEX `GoodsReceipt_tenantId_warehouseId_receivedAt_idx`(`tenantId`, `warehouseId`, `receivedAt`),
    INDEX `GoodsReceipt_receivedBy_idx`(`receivedBy`),
    UNIQUE INDEX `GoodsReceipt_tenantId_receiptNumber_key`(`tenantId`, `receiptNumber`),
    UNIQUE INDEX `GoodsReceipt_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoodsReceiptItem` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `goodsReceiptId` VARCHAR(191) NOT NULL,
    `purchaseOrderItemId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantityExact` DECIMAL(18, 4) NOT NULL,
    `deliveredQuantityExact` DECIMAL(18, 4) NULL,
    `rejectedQuantityExact` DECIMAL(18, 4) NULL,
    `rejectionReasonCode` VARCHAR(32) NULL,
    `rejectionNotes` TEXT NULL,
    `supplierFault` BOOLEAN NULL,
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

-- CreateTable
CREATE TABLE `PurchaseOrderCloseShort` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'POSTED',
    `clientEventId` VARCHAR(128) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `closedBy` VARCHAR(191) NOT NULL,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lineCount` INTEGER NOT NULL DEFAULT 0,
    `closedLineCount` INTEGER NOT NULL DEFAULT 0,
    `hasSupplierFault` BOOLEAN NOT NULL DEFAULT false,
    `reasonSummaryCode` VARCHAR(32) NULL,
    `note` TEXT NULL,

    INDEX `PurchaseOrderCloseShort_tenantId_purchaseOrderId_closedAt_idx`(`tenantId`, `purchaseOrderId`, `closedAt`),
    INDEX `PurchaseOrderCloseShort_closedBy_idx`(`closedBy`),
    UNIQUE INDEX `PurchaseOrderCloseShort_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderCloseShortItem` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `closeShortId` VARCHAR(191) NOT NULL,
    `purchaseOrderItemId` VARCHAR(191) NOT NULL,
    `quantityExact` DECIMAL(18, 4) NOT NULL,
    `reasonCode` VARCHAR(32) NOT NULL,
    `supplierFault` BOOLEAN NULL,
    `note` TEXT NULL,
    `orderedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
    `acceptedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
    `rejectedQuantitySnapshotExact` DECIMAL(18, 4) NOT NULL,
    `remainingBeforeExact` DECIMAL(18, 4) NOT NULL,
    `remainingAfterExact` DECIMAL(18, 4) NOT NULL,
    `unitSnapshot` VARCHAR(32) NOT NULL,
    `saleModeSnapshot` VARCHAR(32) NULL,
    `quantityStepSnapshot` DECIMAL(18, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrderCloseShortItem_tenantId_closeShortId_idx`(`tenantId`, `closeShortId`),
    INDEX `PurchaseOrderCloseShortItem_tenantId_purchaseOrderItemId_idx`(`tenantId`, `purchaseOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `PurchaseMatchAllocation_tenantId_purchaseItemId_idx`(`tenantId`, `purchaseItemId`),
    INDEX `PurchaseMatchAllocation_tenantId_purchaseOrderItemId_idx`(`tenantId`, `purchaseOrderItemId`),
    INDEX `PurchaseMatchAllocation_tenantId_goodsReceiptItemId_idx`(`tenantId`, `goodsReceiptItemId`),
    UNIQUE INDEX `PurchaseMatchAllocation_purchaseItemId_goodsReceiptItemId_key`(`purchaseItemId`, `goodsReceiptItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE `Employee` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `pin` VARCHAR(191) NOT NULL DEFAULT '0000',
    `cedula` VARCHAR(191) NULL,
    `inss` VARCHAR(191) NULL,
    `baseSalary` DECIMAL(10, 2) NOT NULL,
    `commissionRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `phone` VARCHAR(191) NULL,
    `vacationDays` DOUBLE NOT NULL DEFAULT 0,
    `accumulatedThirteenth` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `hireDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bankAccount` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `jornada` VARCHAR(191) NOT NULL DEFAULT 'DIURNA',

    UNIQUE INDEX `Employee_userId_key`(`userId`),
    INDEX `Employee_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JudicialDeduction` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NULL,
    `percentage` DOUBLE NULL,
    `beneficiary` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JudicialDeduction_tenantId_idx`(`tenantId`),
    INDEX `JudicialDeduction_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Holiday` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `national` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Holiday_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Holiday_tenantId_date_key`(`tenantId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmploymentContract` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `probationEnd` DATETIME(3) NULL,
    `salary` DECIMAL(10, 2) NOT NULL,
    `position` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmploymentContract_tenantId_idx`(`tenantId`),
    INDEX `EmploymentContract_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Aguinaldo` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `diasLaborados` INTEGER NOT NULL,
    `baseSalary` DECIMAL(10, 2) NOT NULL,
    `monto` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PAGADO',
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Aguinaldo_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Aguinaldo_employeeId_year_key`(`employeeId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payroll` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `grossSalary` DECIMAL(10, 2) NOT NULL,
    `commissions` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalIncome` DECIMAL(10, 2) NOT NULL,
    `inssLaboral` DECIMAL(10, 2) NOT NULL,
    `irLaboral` DECIMAL(10, 2) NOT NULL,
    `totalDeductions` DECIMAL(10, 2) NOT NULL,
    `netSalary` DECIMAL(10, 2) NOT NULL,
    `inssPatronal` DECIMAL(10, 2) NOT NULL,
    `inatec` DECIMAL(10, 2) NOT NULL,
    `overtimePay` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `horasExtra` DOUBLE NOT NULL DEFAULT 0,
    `advanceDeduction` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `holidayPay` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `diasFeriados` DOUBLE NOT NULL DEFAULT 0,
    `absenceDeduction` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `diasAusencia` DOUBLE NOT NULL DEFAULT 0,
    `judicialDeduction` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Payroll_tenantId_idx`(`tenantId`),
    INDEX `Payroll_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `Payroll_employeeId_month_year_key`(`employeeId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxReport` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `totalSales` DECIMAL(12, 2) NOT NULL,
    `totalIVACollected` DECIMAL(12, 2) NOT NULL,
    `totalIVAPaid` DECIMAL(12, 2) NOT NULL,
    `ivaNeto` DECIMAL(12, 2) NOT NULL,
    `anticipoIR` DECIMAL(12, 2) NOT NULL,
    `imiAlcaldia` DECIMAL(12, 2) NOT NULL,
    `totalToPay` DECIMAL(12, 2) NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TaxReport_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `TaxReport_tenantId_month_year_key`(`tenantId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sale` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `total` DECIMAL(18, 4) NOT NULL,
    `exemptTotal` DECIMAL(18, 4) NULL,
    `status` VARCHAR(191) NOT NULL,
    `paymentMethod` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `employeeId` VARCHAR(191) NULL,
    `balance` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `dueDate` DATETIME(3) NULL,
    `shiftId` VARCHAR(191) NULL,
    `soldById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `globalDiscount` DOUBLE NOT NULL DEFAULT 0,
    `invoiceNumber` INTEGER NULL,
    `invoiceSeries` VARCHAR(191) NULL,
    `offlineId` VARCHAR(191) NULL,
    `offlinePayloadHash` VARCHAR(64) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `fiscalRegimeAtSale` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    `fiscalRegimeVersionAtSale` INTEGER NOT NULL DEFAULT 1,
    `vatAmountAtSale` DECIMAL(18, 4) NULL,
    `storeCreditApplied` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    UNIQUE INDEX `Sale_offlineId_key`(`offlineId`),
    INDEX `Sale_tenantId_idx`(`tenantId`),
    INDEX `Sale_customerId_idx`(`customerId`),
    INDEX `Sale_employeeId_idx`(`employeeId`),
    INDEX `Sale_shiftId_idx`(`shiftId`),
    INDEX `Sale_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `Sale_tenantId_soldById_createdAt_idx`(`tenantId`, `soldById`, `createdAt`),
    INDEX `Sale_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `Sale_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `Sale_tenantId_shiftId_status_idx`(`tenantId`, `shiftId`, `status`),
    INDEX `Sale_tenantId_fiscalRegimeAtSale_createdAt_idx`(`tenantId`, `fiscalRegimeAtSale`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleItem` (
    `id` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `priceAtSale` DECIMAL(10, 2) NOT NULL,
    `unitPriceExactAtSale` DECIMAL(18, 4) NULL,
    `costAtSale` DECIMAL(10, 2) NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `productNameAtSale` VARCHAR(191) NULL,
    `unitAtSale` VARCHAR(191) NULL,
    `saleModeAtSale` VARCHAR(191) NULL,
    `quantityStepAtSale` DECIMAL(18, 4) NULL,
    `presentationAtSale` VARCHAR(191) NULL,
    `presentationQuantityAtSale` DECIMAL(18, 4) NULL,
    `ivaExento` BOOLEAN NOT NULL DEFAULT false,
    `promotionSnapshot` JSON NULL,

    INDEX `SaleItem_saleId_idx`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantCapability` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TenantCapability_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `TenantCapability_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleLabelProfile` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScaleLabelProfile_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `ScaleLabelProfile_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleLabelProfileVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `symbology` VARCHAR(191) NOT NULL,
    `totalLength` INTEGER NOT NULL,
    `prefixes` JSON NOT NULL,
    `itemStart` INTEGER NOT NULL,
    `itemLength` INTEGER NOT NULL,
    `valueStart` INTEGER NOT NULL,
    `valueLength` INTEGER NOT NULL,
    `valueKind` VARCHAR(191) NOT NULL,
    `impliedDecimals` INTEGER NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `checksumMode` VARCHAR(191) NOT NULL,
    `pricePolicy` VARCHAR(191) NOT NULL,
    `roundingTolerance` DECIMAL(18, 4) NOT NULL,
    `minValue` DECIMAL(18, 4) NOT NULL,
    `maxValue` DECIMAL(18, 4) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScaleLabelProfileVersion_profileId_idx`(`profileId`),
    INDEX `ScaleLabelProfileVersion_createdBy_idx`(`createdBy`),
    INDEX `ScaleLabelProfileVersion_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `ScaleLabelProfileVersion_tenantId_profileId_version_key`(`tenantId`, `profileId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleProductMapping` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `profileVersionId` VARCHAR(191) NOT NULL,
    `plu` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScaleProductMapping_profileVersionId_idx`(`profileVersionId`),
    INDEX `ScaleProductMapping_tenantId_productId_idx`(`tenantId`, `productId`),
    UNIQUE INDEX `ScaleProductMapping_tenantId_profileVersionId_plu_key`(`tenantId`, `profileVersionId`, `plu`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `manufacturer` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `transport` VARCHAR(191) NOT NULL,
    `protocolKey` VARCHAR(191) NOT NULL,
    `adapterVersion` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `config` JSON NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScaleDevice_createdBy_idx`(`createdBy`),
    INDEX `ScaleDevice_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `ScaleDevice_tenantId_transport_idx`(`tenantId`, `transport`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleMeasurement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `profileVersionId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `sourceValue` DECIMAL(18, 4) NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `baseQuantity` DECIMAL(18, 4) NOT NULL,
    `encodedPrice` DECIMAL(18, 4) NULL,
    `pricingPolicy` VARCHAR(191) NOT NULL,
    `stable` BOOLEAN NULL,
    `clientEventId` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(191) NULL,
    `capturedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `SaleMeasurement_saleItemId_key`(`saleItemId`),
    INDEX `SaleMeasurement_profileVersionId_idx`(`profileVersionId`),
    INDEX `SaleMeasurement_deviceId_idx`(`deviceId`),
    INDEX `SaleMeasurement_userId_idx`(`userId`),
    INDEX `SaleMeasurement_tenantId_capturedAt_idx`(`tenantId`, `capturedAt`),
    INDEX `SaleMeasurement_tenantId_source_capturedAt_idx`(`tenantId`, `source`, `capturedAt`),
    UNIQUE INDEX `SaleMeasurement_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleItemBatchAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `warehouseId` VARCHAR(191) NULL,

    INDEX `SaleItemBatchAllocation_tenantId_saleItemId_idx`(`tenantId`, `saleItemId`),
    INDEX `SaleItemBatchAllocation_tenantId_batchId_idx`(`tenantId`, `batchId`),
    INDEX `SaleItemBatchAllocation_tenantId_warehouseId_idx`(`tenantId`, `warehouseId`),
    UNIQUE INDEX `SaleItemBatchAllocation_saleItemId_batchId_key`(`saleItemId`, `batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `collectedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clientEventId` VARCHAR(128) NULL,
    `payloadHash` VARCHAR(64) NULL,

    INDEX `Payment_saleId_idx`(`saleId`),
    INDEX `Payment_createdAt_idx`(`createdAt`),
    INDEX `Payment_collectedBy_createdAt_idx`(`collectedBy`, `createdAt`),
    UNIQUE INDEX `Payment_saleId_clientEventId_key`(`saleId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shift` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `initialCash` DECIMAL(10, 2) NOT NULL,
    `finalCashDeclared` DECIMAL(10, 2) NULL,
    `systemExpectedCash` DECIMAL(10, 2) NULL,
    `difference` DECIMAL(10, 2) NULL,
    `initialCashUsd` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `finalCashDeclaredUsd` DECIMAL(18, 4) NULL,
    `systemExpectedUsd` DECIMAL(18, 4) NULL,
    `differenceUsd` DECIMAL(18, 4) NULL,
    `regularHours` DOUBLE NOT NULL DEFAULT 0,
    `overtimeHours` DOUBLE NOT NULL DEFAULT 0,
    `nightHours` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endTime` DATETIME(3) NULL,
    `closeEventId` VARCHAR(128) NULL,
    `closePayloadHash` VARCHAR(64) NULL,

    INDEX `Shift_tenantId_idx`(`tenantId`),
    INDEX `Shift_tenantId_status_startTime_idx`(`tenantId`, `status`, `startTime`),
    INDEX `Shift_tenantId_status_endTime_idx`(`tenantId`, `status`, `endTime`),
    INDEX `Shift_userId_idx`(`userId`),
    INDEX `Shift_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `Shift_tenantId_closeEventId_key`(`tenantId`, `closeEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftCloseReport` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `folio` VARCHAR(191) NOT NULL,
    `businessDate` VARCHAR(10) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `report` JSON NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftCloseReport_shiftId_key`(`shiftId`),
    INDEX `ShiftCloseReport_tenantId_businessDate_idx`(`tenantId`, `businessDate`),
    INDEX `ShiftCloseReport_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `ShiftCloseReport_tenantId_folio_key`(`tenantId`, `folio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `description` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Expense_tenantId_idx`(`tenantId`),
    INDEX `Expense_category_idx`(`category`),
    INDEX `Expense_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashMovement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NIO',
    `category` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `expenseId` VARCHAR(191) NULL,
    `isVoided` BOOLEAN NOT NULL DEFAULT false,
    `voidReason` TEXT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `seq` INTEGER NULL,
    `prevHash` VARCHAR(191) NULL,
    `signature` VARCHAR(191) NULL,

    UNIQUE INDEX `CashMovement_expenseId_key`(`expenseId`),
    INDEX `CashMovement_tenantId_idx`(`tenantId`),
    INDEX `CashMovement_shiftId_idx`(`shiftId`),
    INDEX `CashMovement_createdAt_idx`(`createdAt`),
    INDEX `CashMovement_tenantId_shiftId_isVoided_idx`(`tenantId`, `shiftId`, `isVoided`),
    INDEX `CashMovement_tenantId_shiftId_createdAt_id_idx`(`tenantId`, `shiftId`, `createdAt`, `id`),
    UNIQUE INDEX `CashMovement_tenantId_seq_key`(`tenantId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerHead` (
    `tenantId` VARCHAR(191) NOT NULL,
    `lastSeq` INTEGER NOT NULL DEFAULT 0,
    `lastHash` VARCHAR(191) NOT NULL DEFAULT 'GENESIS',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentAgreement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'BANCO',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `commissionConfig` JSON NULL,
    `limitsConfig` JSON NULL,
    `settlementBalance` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `commissionAccrued` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentAgreement_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `agreementId` VARCHAR(191) NOT NULL,
    `cashMovementId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NIO',
    `exchangeRate` DECIMAL(12, 6) NULL,
    `amountNio` DECIMAL(18, 4) NULL,
    `commission` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `externalRef` VARCHAR(191) NULL,
    `customerRef` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `reversedAt` DATETIME(3) NULL,
    `reversedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AgentTransaction_cashMovementId_key`(`cashMovementId`),
    INDEX `AgentTransaction_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AgentTransaction_agreementId_createdAt_idx`(`agreementId`, `createdAt`),
    INDEX `AgentTransaction_shiftId_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppChannel` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `phoneNumberId` VARCHAR(191) NOT NULL,
    `wabaId` VARCHAR(191) NULL,
    `displayPhone` VARCHAR(191) NULL,
    `accessTokenEnc` TEXT NOT NULL,
    `botScope` VARCHAR(191) NOT NULL DEFAULT 'B2C',
    `defaultMode` VARCHAR(191) NOT NULL DEFAULT 'BOT',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppChannel_phoneNumberId_key`(`phoneNumberId`),
    INDEX `WhatsAppChannel_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppConversation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'BOT',
    `lastInboundAt` DATETIME(3) NULL,
    `lastOutboundAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppConversation_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `WhatsAppConversation_tenantId_waId_key`(`tenantId`, `waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `waMessageId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'text',
    `body` TEXT NOT NULL,
    `status` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppMessage_waMessageId_key`(`waMessageId`),
    INDEX `WhatsAppMessage_tenantId_idx`(`tenantId`),
    INDEX `WhatsAppMessage_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `B2BOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `total` DECIMAL(18, 4) NOT NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `B2BOrder_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_tenantId_idx`(`tenantId`),
    INDEX `AuditLog_userId_idx`(`userId`),
    INDEX `AuditLog_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AuditLog_tenantId_action_createdAt_idx`(`tenantId`, `action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `price` DOUBLE NOT NULL,
    `cost` DOUBLE NOT NULL,
    `wholesalePrice` DOUBLE NULL,
    `wholesaleMinQty` DOUBLE NULL,
    `packUnit` VARCHAR(191) NULL,
    `packSize` DOUBLE NULL,
    `packPrice` DOUBLE NULL,
    `saleMode` VARCHAR(191) NULL,
    `quantityStep` DECIMAL(18, 4) NULL,
    `productFamily` VARCHAR(191) NULL,
    `stock` DOUBLE NOT NULL DEFAULT 0,
    `minStock` DOUBLE NOT NULL DEFAULT 0,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'unidad',
    `reorderPoint` DOUBLE NOT NULL DEFAULT 0,
    `maxStock` DOUBLE NOT NULL DEFAULT 0,
    `defaultSupplierId` VARCHAR(191) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `ivaExento` BOOLEAN NOT NULL DEFAULT false,
    `imageUrl` VARCHAR(191) NULL,
    `requiresBatchTracking` BOOLEAN NOT NULL DEFAULT false,
    `requiresSerialTracking` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `promotionPriceVersion` INTEGER NOT NULL DEFAULT 1,
    `brand` VARCHAR(100) NULL,

    INDEX `Product_defaultSupplierId_idx`(`defaultSupplierId`),
    INDEX `Product_tenantId_idx`(`tenantId`),
    INDEX `Product_tenantId_isPublished_name_idx`(`tenantId`, `isPublished`, `name`),
    INDEX `Product_tenantId_isPublished_category_name_idx`(`tenantId`, `isPublished`, `category`, `name`),
    INDEX `Product_category_idx`(`category`),
    INDEX `Product_tenantId_brand_idx`(`tenantId`, `brand`),
    INDEX `Product_tenantId_name_idx`(`tenantId`, `name`),
    UNIQUE INDEX `Product_tenantId_sku_key`(`tenantId`, `sku`),
    FULLTEXT INDEX `Product_name_category_idx`(`name`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KardexMovement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `stockBefore` DOUBLE NOT NULL,
    `stockAfter` DOUBLE NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `referenceType` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NULL,
    `warehouseId` VARCHAR(191) NULL,

    INDEX `KardexMovement_productId_idx`(`productId`),
    INDEX `KardexMovement_tenantId_idx`(`tenantId`),
    INDEX `KardexMovement_date_idx`(`date`),
    INDEX `KardexMovement_type_idx`(`type`),
    INDEX `KardexMovement_batchId_idx`(`batchId`),
    INDEX `KardexMovement_warehouseId_idx`(`warehouseId`),
    INDEX `KardexMovement_tenantId_type_date_idx`(`tenantId`, `type`, `date`),
    INDEX `KardexMovement_tenantId_productId_date_idx`(`tenantId`, `productId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SellerProduct` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SellerProduct_tenantId_productId_idx`(`tenantId`, `productId`),
    UNIQUE INDEX `SellerProduct_tenantId_sellerId_productId_key`(`tenantId`, `sellerId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warehouse` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sellerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Warehouse_tenantId_idx`(`tenantId`),
    INDEX `Warehouse_tenantId_isActive_name_idx`(`tenantId`, `isActive`, `name`),
    UNIQUE INDEX `Warehouse_tenantId_name_key`(`tenantId`, `name`),
    UNIQUE INDEX `Warehouse_tenantId_sellerId_key`(`tenantId`, `sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductStock` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `stock` DOUBLE NOT NULL DEFAULT 0,

    INDEX `ProductStock_tenantId_idx`(`tenantId`),
    INDEX `ProductStock_warehouseId_idx`(`warehouseId`),
    INDEX `ProductStock_productId_idx`(`productId`),
    UNIQUE INDEX `ProductStock_productId_warehouseId_key`(`productId`, `warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `fromWarehouseId` VARCHAR(191) NOT NULL,
    `toWarehouseId` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `items` JSON NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clientEventId` VARCHAR(128) NULL,
    `payloadHash` VARCHAR(64) NULL,
    `payloadVersion` INTEGER NOT NULL DEFAULT 1,
    `batchLedgerMode` VARCHAR(16) NOT NULL DEFAULT 'OFF',
    `batchTransferStatus` VARCHAR(32) NOT NULL DEFAULT 'OFF',
    `batchSnapshot` JSON NULL,

    INDEX `StockTransfer_tenantId_idx`(`tenantId`),
    INDEX `StockTransfer_fromWarehouseId_idx`(`fromWarehouseId`),
    INDEX `StockTransfer_toWarehouseId_idx`(`toWarehouseId`),
    INDEX `StockTransfer_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `StockTransfer_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductBatch` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `batchNumber` VARCHAR(191) NOT NULL,
    `expiryDate` DATETIME(3) NOT NULL,
    `stock` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductBatch_tenantId_idx`(`tenantId`),
    INDEX `ProductBatch_productId_idx`(`productId`),
    INDEX `ProductBatch_expiryDate_idx`(`expiryDate`),
    INDEX `ProductBatch_tenantId_expiryDate_idx`(`tenantId`, `expiryDate`),
    UNIQUE INDEX `ProductBatch_productId_batchNumber_key`(`productId`, `batchNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductBatchWarehouseStock` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `stock` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `heldStock` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    INDEX `ProductBatchWarehouseStock_tenantId_batchId_idx`(`tenantId`, `batchId`),
    INDEX `ProductBatchWarehouseStock_tenantId_productId_warehouseId_idx`(`tenantId`, `productId`, `warehouseId`),
    INDEX `ProductBatchWarehouseStock_tenantId_warehouseId_productId_idx`(`tenantId`, `warehouseId`, `productId`),
    UNIQUE INDEX `ProductBatchWarehouseStock_tenantId_batchId_warehouseId_key`(`tenantId`, `batchId`, `warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductBatchHold` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `quantityDelta` DECIMAL(18, 4) NOT NULL,
    `heldBefore` DECIMAL(18, 4) NOT NULL,
    `heldAfter` DECIMAL(18, 4) NOT NULL,
    `physicalStockSnapshot` DECIMAL(18, 4) NOT NULL,
    `sellableBefore` DECIMAL(18, 4) NOT NULL,
    `sellableAfter` DECIMAL(18, 4) NOT NULL,
    `holdReasonCode` VARCHAR(32) NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `referenceType` VARCHAR(64) NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `notes` TEXT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductBatchHold_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `ProductBatchHold_tenantId_batchId_warehouseId_createdAt_idx`(`tenantId`, `batchId`, `warehouseId`, `createdAt`),
    INDEX `ProductBatchHold_tenantId_productId_warehouseId_createdAt_idx`(`tenantId`, `productId`, `warehouseId`, `createdAt`),
    INDEX `ProductBatchHold_tenantId_referenceType_referenceId_idx`(`tenantId`, `referenceType`, `referenceId`),
    INDEX `ProductBatchHold_userId_idx`(`userId`),
    UNIQUE INDEX `ProductBatchHold_tenantId_sourceKey_key`(`tenantId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductBatchLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `quantityDelta` DECIMAL(18, 4) NOT NULL,
    `stockBefore` DECIMAL(18, 4) NOT NULL,
    `stockAfter` DECIMAL(18, 4) NOT NULL,
    `movementType` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'APPLIED',
    `referenceId` VARCHAR(191) NULL,
    `referenceType` VARCHAR(64) NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `reason` TEXT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductBatchLedgerEntry_tenantId_batchId_createdAt_idx`(`tenantId`, `batchId`, `createdAt`),
    INDEX `ProductBatchLedgerEntry_tenantId_warehouseId_createdAt_idx`(`tenantId`, `warehouseId`, `createdAt`),
    INDEX `ProductBatchLedgerEntry_tenantId_productId_warehouseId_creat_idx`(`tenantId`, `productId`, `warehouseId`, `createdAt`),
    INDEX `ProductBatchLedgerEntry_tenantId_referenceType_referenceId_idx`(`tenantId`, `referenceType`, `referenceId`),
    INDEX `ProductBatchLedgerEntry_userId_idx`(`userId`),
    UNIQUE INDEX `ProductBatchLedgerEntry_tenantId_sourceKey_key`(`tenantId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SerialNumber_tenantId_idx`(`tenantId`),
    INDEX `SerialNumber_productId_idx`(`productId`),
    INDEX `SerialNumber_status_idx`(`status`),
    INDEX `SerialNumber_serial_idx`(`serial`),
    UNIQUE INDEX `SerialNumber_productId_serial_key`(`productId`, `serial`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockCount` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NULL,
    `openWarehouseKey` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `scope` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `category` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,

    UNIQUE INDEX `StockCount_openWarehouseKey_key`(`openWarehouseKey`),
    INDEX `StockCount_tenantId_idx`(`tenantId`),
    INDEX `StockCount_status_idx`(`status`),
    INDEX `StockCount_warehouseId_idx`(`warehouseId`),
    INDEX `StockCount_tenantId_warehouseId_status_idx`(`tenantId`, `warehouseId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockCountItem` (
    `id` VARCHAR(191) NOT NULL,
    `countId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `expected` DOUBLE NOT NULL,
    `counted` DOUBLE NULL,
    `diff` DOUBLE NOT NULL DEFAULT 0,
    `countedAt` DATETIME(3) NULL,
    `bookStockAtCapture` DECIMAL(18, 4) NULL,

    INDEX `StockCountItem_countId_idx`(`countId`),
    INDEX `StockCountItem_productId_idx`(`productId`),
    UNIQUE INDEX `StockCountItem_countId_productId_key`(`countId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManualPayment` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `bank` VARCHAR(191) NOT NULL,
    `referenceNumber` VARCHAR(191) NOT NULL,
    `proofUrl` TEXT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `rejectionReason` TEXT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ManualPayment_tenantId_idx`(`tenantId`),
    INDEX `ManualPayment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quotation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerRuc` VARCHAR(191) NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `tax` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SENT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `fiscalRegimeAtQuote` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',

    INDEX `Quotation_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuotationItem` (
    `id` VARCHAR(191) NOT NULL,
    `quotationId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `quantityExact` DECIMAL(18, 4) NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `unitPriceExact` DECIMAL(18, 4) NULL,
    `unitAtQuote` VARCHAR(191) NULL,
    `saleModeAtQuote` VARCHAR(191) NULL,
    `quantityStepAtQuote` DECIMAL(18, 4) NULL,
    `presentationAtQuote` VARCHAR(191) NULL,
    `presentationQuantityAtQuote` DECIMAL(18, 4) NULL,
    `ivaExentoAtQuote` BOOLEAN NULL,
    `name` VARCHAR(191) NOT NULL,

    INDEX `QuotationItem_quotationId_idx`(`quotationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductReturn` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `items` JSON NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `clientEventId` VARCHAR(128) NULL,
    `payloadHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedShiftId` VARCHAR(191) NULL,
    `correctionRequestId` VARCHAR(191) NULL,
    `returnNumber` INTEGER NULL,
    `refundStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
    `resolution` VARCHAR(32) NOT NULL DEFAULT 'REFUND',

    UNIQUE INDEX `ProductReturn_correctionRequestId_key`(`correctionRequestId`),
    INDEX `ProductReturn_tenantId_idx`(`tenantId`),
    INDEX `ProductReturn_saleId_idx`(`saleId`),
    INDEX `ProductReturn_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `ProductReturn_tenantId_processedShiftId_createdAt_idx`(`tenantId`, `processedShiftId`, `createdAt`),
    UNIQUE INDEX `ProductReturn_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    UNIQUE INDEX `ProductReturn_tenantId_returnNumber_key`(`tenantId`, `returnNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `SaleCorrectionRequest_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `SaleCorrectionRequest_tenantId_saleId_createdAt_idx`(`tenantId`, `saleId`, `createdAt`),
    INDEX `SaleCorrectionRequest_approvedBy_idx`(`approvedBy`),
    INDEX `SaleCorrectionRequest_requestedBy_idx`(`requestedBy`),
    UNIQUE INDEX `SaleCorrectionRequest_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleCorrectionLine` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `disposition` VARCHAR(16) NOT NULL DEFAULT 'RESTOCK',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SaleCorrectionLine_tenantId_requestId_idx`(`tenantId`, `requestId`),
    INDEX `SaleCorrectionLine_tenantId_saleItemId_idx`(`tenantId`, `saleItemId`),
    UNIQUE INDEX `SaleCorrectionLine_requestId_saleItemId_key`(`requestId`, `saleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `productReturnId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `refundUnitPrice` DECIMAL(18, 4) NOT NULL,
    `lineTotal` DECIMAL(18, 4) NOT NULL,
    `costTotal` DECIMAL(18, 4) NOT NULL,
    `disposition` VARCHAR(16) NOT NULL,
    `productNameAtReturn` VARCHAR(191) NULL,
    `unitAtReturn` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductReturnItem_tenantId_productReturnId_idx`(`tenantId`, `productReturnId`),
    INDEX `ProductReturnItem_tenantId_productId_idx`(`tenantId`, `productId`),
    UNIQUE INDEX `ProductReturnItem_productReturnId_saleItemId_key`(`productReturnId`, `saleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalGrant` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `purpose` VARCHAR(32) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApprovalGrant_tokenHash_key`(`tokenHash`),
    INDEX `ApprovalGrant_tenantId_userId_expiresAt_idx`(`tenantId`, `userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnRefund` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `productReturnId` VARCHAR(191) NULL,
    `correctionRequestId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `externalReference` VARCHAR(191) NULL,
    `evidenceNote` TEXT NULL,
    `completedBy` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReturnRefund_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `ReturnRefund_tenantId_saleId_idx`(`tenantId`, `saleId`),
    INDEX `ReturnRefund_productReturnId_idx`(`productReturnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnInspection` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `correctionLineId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `batchEvidence` JSON NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolutionReason` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReturnInspection_correctionLineId_key`(`correctionLineId`),
    INDEX `ReturnInspection_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `ReturnInspection_tenantId_productId_idx`(`tenantId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerCreditEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `productReturnId` VARCHAR(191) NULL,
    `saleId` VARCHAR(191) NULL,
    `type` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `balanceAfter` DECIMAL(18, 4) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerCreditEntry_tenantId_customerId_createdAt_idx`(`tenantId`, `customerId`, `createdAt`),
    INDEX `CustomerCreditEntry_productReturnId_idx`(`productReturnId`),
    INDEX `CustomerCreditEntry_saleId_idx`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `subtype` VARCHAR(191) NULL,
    `balance` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `isSystem` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Account_tenantId_idx`(`tenantId`),
    INDEX `Account_type_idx`(`type`),
    UNIQUE INDEX `Account_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` TEXT NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `referenceType` VARCHAR(191) NULL,
    `isAutomatic` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `economicDate` DATETIME(3) NULL,
    `postedAt` DATETIME(3) NULL,
    `entryKind` VARCHAR(32) NOT NULL DEFAULT 'ORIGINAL',
    `postingKey` VARCHAR(191) NULL,
    `payloadHash` VARCHAR(64) NULL,
    `reversalOfId` VARCHAR(191) NULL,

    UNIQUE INDEX `JournalEntry_reversalOfId_key`(`reversalOfId`),
    INDEX `JournalEntry_tenantId_idx`(`tenantId`),
    INDEX `JournalEntry_referenceId_idx`(`referenceId`),
    INDEX `JournalEntry_date_idx`(`date`),
    UNIQUE INDEX `JournalEntry_tenantId_postingKey_key`(`tenantId`, `postingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `debit` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `credit` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    INDEX `JournalLine_journalEntryId_idx`(`journalEntryId`),
    INDEX `JournalLine_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiscalRetention` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `baseAmount` DECIMAL(10, 2) NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `purchaseId` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FiscalRetention_tenantId_idx`(`tenantId`),
    INDEX `FiscalRetention_period_idx`(`period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceSeries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `series` VARCHAR(191) NOT NULL DEFAULT 'A',
    `lastNumber` INTEGER NOT NULL DEFAULT 0,
    `rangeStart` INTEGER NOT NULL DEFAULT 1,
    `rangeEnd` INTEGER NOT NULL DEFAULT 999999,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `InvoiceSeries_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `InvoiceSeries_tenantId_series_key`(`tenantId`, `series`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaveRequest_tenantId_idx`(`tenantId`),
    INDEX `LeaveRequest_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollRun` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',

    INDEX `PayrollRun_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollLine` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `payrollRunId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `basePay` DECIMAL(10, 2) NOT NULL,
    `overtimePay` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `commissions` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `bonuses` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `inssDeduction` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `irDeduction` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `advanceDeductions` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `netPay` DECIMAL(10, 2) NOT NULL,

    INDEX `PayrollLine_tenantId_idx`(`tenantId`),
    INDEX `PayrollLine_payrollRunId_idx`(`payrollRunId`),
    INDEX `PayrollLine_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalaryAdvance` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `fee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `repaymentPayrollId` VARCHAR(191) NULL,
    `payrollId` VARCHAR(191) NULL,

    INDEX `SalaryAdvance_tenantId_idx`(`tenantId`),
    INDEX `SalaryAdvance_employeeId_idx`(`employeeId`),
    INDEX `SalaryAdvance_repaymentPayrollId_idx`(`repaymentPayrollId`),
    INDEX `SalaryAdvance_payrollId_idx`(`payrollId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TerminationSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `terminationDate` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `aguinaldoAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `vacationAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `severanceAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,

    UNIQUE INDEX `TerminationSettlement_employeeId_key`(`employeeId`),
    INDEX `TerminationSettlement_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PublicOrder_tenantId_idx`(`tenantId`),
    INDEX `PublicOrder_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CapitalLoan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `interestRate` DECIMAL(5, 4) NOT NULL,
    `totalDue` DECIMAL(12, 2) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `linkedPurchaseId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signature` VARCHAR(191) NULL,

    UNIQUE INDEX `CapitalLoan_linkedPurchaseId_key`(`linkedPurchaseId`),
    INDEX `CapitalLoan_tenantId_idx`(`tenantId`),
    INDEX `CapitalLoan_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Motorizado` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `tipoFlota` VARCHAR(191) NOT NULL DEFAULT 'PROPIA',
    `nombre` VARCHAR(100) NOT NULL,
    `telefono` VARCHAR(20) NOT NULL,
    `zonaCobertura` VARCHAR(100) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `walletId` VARCHAR(191) NULL,
    `calificacionPromedio` DOUBLE NOT NULL DEFAULT 5.0,
    `vehiculoPlaca` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cedula` VARCHAR(25) NULL,
    `pinHash` VARCHAR(191) NULL,
    `kycStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    `kycNota` TEXT NULL,
    `fotoCedulaUrl` VARCHAR(191) NULL,
    `fotoVehiculoUrl` VARCHAR(191) NULL,
    `walletBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,

    UNIQUE INDEX `Motorizado_walletId_key`(`walletId`),
    INDEX `Motorizado_tenantId_idx`(`tenantId`),
    INDEX `Motorizado_telefono_idx`(`telefono`),
    INDEX `Motorizado_kycStatus_idx`(`kycStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiscalPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CLOSED',
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `reopenedBy` VARCHAR(191) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenReason` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FiscalPeriod_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `FiscalPeriod_tenantId_year_month_key`(`tenantId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxConfig` (
    `tenantId` VARCHAR(191) NOT NULL,
    `inssPatronalRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.225,
    `anticipoIrRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.0100,
    `imiRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.0100,
    `salarioMinimo` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExchangeRate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `fecha` DATE NOT NULL,
    `rate` DECIMAL(10, 4) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExchangeRate_tenantId_fecha_idx`(`tenantId`, `fecha`),
    UNIQUE INDEX `ExchangeRate_tenantId_fecha_key`(`tenantId`, `fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RetencionSufrida` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `fecha` DATETIME(3) NOT NULL,
    `clienteRetenedor` VARCHAR(160) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `baseAmount` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `numeroConstancia` VARCHAR(60) NULL,
    `saleId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clientEventId` VARCHAR(128) NULL,
    `payloadHash` VARCHAR(64) NULL,

    INDEX `RetencionSufrida_tenantId_fecha_idx`(`tenantId`, `fecha`),
    UNIQUE INDEX `RetencionSufrida_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FixedAsset` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(160) NOT NULL,
    `categoria` VARCHAR(191) NOT NULL,
    `costo` DECIMAL(14, 2) NOT NULL,
    `fechaAdquisicion` DATE NOT NULL,
    `vidaUtilMeses` INTEGER NOT NULL,
    `depreciacionAcumulada` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `mesesDepreciados` INTEGER NOT NULL DEFAULT 0,
    `ultimoPeriodoDep` VARCHAR(191) NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'ACTIVO',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FixedAsset_tenantId_idx`(`tenantId`),
    INDEX `FixedAsset_estado_idx`(`estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DepreciationEntry` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DepreciationEntry_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `DepreciationEntry_assetId_year_month_key`(`assetId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ObligationStatus` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `declarado` BOOLEAN NOT NULL DEFAULT false,
    `markedBy` VARCHAR(191) NULL,
    `markedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ObligationStatus_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `ObligationStatus_tenantId_year_month_key_key`(`tenantId`, `year`, `month`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverLedgerHead` (
    `motorizadoId` VARCHAR(191) NOT NULL,
    `lastSeq` INTEGER NOT NULL DEFAULT 0,
    `lastHash` VARCHAR(191) NOT NULL DEFAULT 'GENESIS',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`motorizadoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverWalletMovement` (
    `id` VARCHAR(191) NOT NULL,
    `motorizadoId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `pedidoId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `descripcion` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `seq` INTEGER NULL,
    `prevHash` VARCHAR(191) NULL,
    `signature` VARCHAR(191) NULL,

    UNIQUE INDEX `DriverWalletMovement_pedidoId_key`(`pedidoId`),
    INDEX `DriverWalletMovement_motorizadoId_idx`(`motorizadoId`),
    INDEX `DriverWalletMovement_type_idx`(`type`),
    UNIQUE INDEX `DriverWalletMovement_motorizadoId_seq_key`(`motorizadoId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pedido` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clienteNombre` VARCHAR(100) NOT NULL,
    `clienteTelefono` VARCHAR(20) NOT NULL,
    `direccionEntrega` TEXT NOT NULL,
    `referenciaDireccion` TEXT NULL,
    `motorizadoId` VARCHAR(191) NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `total` DECIMAL(10, 2) NOT NULL,
    `costoEntrega` DECIMAL(10, 2) NOT NULL,
    `facturaId` VARCHAR(191) NULL,
    `notas` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `entregadoAt` DATETIME(3) NULL,
    `distanciaEstimada` DOUBLE NULL,
    `tiempoEntregaReal` INTEGER NULL,

    INDEX `Pedido_tenantId_idx`(`tenantId`),
    INDEX `Pedido_motorizadoId_idx`(`motorizadoId`),
    INDEX `Pedido_facturaId_idx`(`facturaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidoItem` (
    `id` VARCHAR(191) NOT NULL,
    `pedidoId` VARCHAR(191) NOT NULL,
    `productoId` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `cantidadExact` DECIMAL(18, 4) NULL,
    `presentationAtSale` VARCHAR(191) NULL,
    `presentationQuantityAtSale` DECIMAL(18, 4) NULL,
    `productNameAtOrder` VARCHAR(191) NULL,
    `unitAtOrder` VARCHAR(191) NULL,
    `saleModeAtOrder` VARCHAR(191) NULL,
    `quantityStepAtOrder` DECIMAL(18, 4) NULL,
    `unitPriceExactAtOrder` DECIMAL(18, 4) NULL,
    `ivaExentoAtOrder` BOOLEAN NULL,
    `precioUnitario` DECIMAL(10, 2) NOT NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,

    INDEX `PedidoItem_pedidoId_idx`(`pedidoId`),
    INDEX `PedidoItem_productoId_idx`(`productoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrackingEvento` (
    `id` VARCHAR(191) NOT NULL,
    `pedidoId` VARCHAR(191) NOT NULL,
    `estado` VARCHAR(191) NOT NULL,
    `nota` TEXT NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrackingEvento_pedidoId_idx`(`pedidoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Loan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `lenderId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `clientName` VARCHAR(191) NOT NULL,
    `clientPhone` VARCHAR(191) NULL,
    `clientAddress` VARCHAR(191) NULL,
    `type` ENUM('INFORMAL_FLAT', 'FORMAL_AMORTIZED') NOT NULL DEFAULT 'INFORMAL_FLAT',
    `frequency` ENUM('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY') NOT NULL DEFAULT 'DAILY',
    `principalAmount` DECIMAL(12, 2) NOT NULL,
    `interestRate` DECIMAL(5, 2) NOT NULL,
    `totalToRepay` DECIMAL(12, 2) NOT NULL,
    `balanceRemaining` DECIMAL(12, 2) NOT NULL,
    `installments` INTEGER NOT NULL,
    `installmentAmount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'DEFAULTED', 'PAID_OFF') NOT NULL DEFAULT 'ACTIVE',
    `disbursedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Loan_lenderId_createdAt_idx`(`lenderId`, `createdAt`),
    INDEX `Loan_lenderId_status_idx`(`lenderId`, `status`),
    INDEX `Loan_assignedToId_idx`(`assignedToId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanInstallment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `amountDue` DECIMAL(10, 2) NOT NULL,
    `amountPaid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoanInstallment_loanId_idx`(`loanId`),
    INDEX `LoanInstallment_dueDate_idx`(`dueDate`),
    UNIQUE INDEX `LoanInstallment_loanId_number_key`(`loanId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Repayment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `amountPaid` DECIMAL(10, 2) NOT NULL,
    `paymentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `collectedBy` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Repayment_loanId_paymentDate_idx`(`loanId`, `paymentDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RouteExpense` (
    `id` VARCHAR(191) NOT NULL,
    `lenderId` VARCHAR(191) NOT NULL,
    `collectedBy` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectorDeposit` (
    `id` VARCHAR(191) NOT NULL,
    `lenderId` VARCHAR(191) NOT NULL,
    `collectorId` VARCHAR(191) NULL,
    `collectorName` VARCHAR(191) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollectorDeposit_lenderId_idx`(`lenderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsappSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `threadId` VARCHAR(191) NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'CHAT',
    `pendingData` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsappSession_userId_key`(`userId`),
    INDEX `WhatsappSession_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsappInboundMessage` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PROCESSING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsappInboundMessage_messageId_key`(`messageId`),
    INDEX `WhatsappInboundMessage_tenantId_idx`(`tenantId`),
    INDEX `WhatsappInboundMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductEnrollment` (
    `tenantId` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductEnrollment_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    PRIMARY KEY (`tenantId`, `operationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWorkItem` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL DEFAULT 'W01_CASH_REVIEW',
    `runId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `evidenceId` VARCHAR(191) NOT NULL,
    `sourceHash` CHAR(64) NOT NULL,
    `sourceSummary` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'IN_REVIEW',
    `version` INTEGER NOT NULL DEFAULT 0,
    `eventCount` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedByUserId` VARCHAR(191) NULL,
    `acceptedEventId` VARCHAR(36) NULL,
    `acceptedReportHash` CHAR(64) NULL,
    `acceptedReportVersion` INTEGER NULL,

    INDEX `AssistantWorkItem_tenantId_userId_roleAtCreation_createdAt_i_idx`(`tenantId`, `userId`, `roleAtCreation`, `createdAt`, `id`),
    INDEX `AssistantWorkItem_expiresAt_id_idx`(`expiresAt`, `id`),
    UNIQUE INDEX `AssistantWorkItem_tenantId_userId_runId_key`(`tenantId`, `userId`, `runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantWorkEvent` (
    `id` VARCHAR(191) NOT NULL,
    `workItemId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleAtCreation` VARCHAR(32) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `note` VARCHAR(2000) NULL,
    `fromStatus` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantWorkEvent_workItemId_version_id_idx`(`workItemId`, `version`, `id`),
    UNIQUE INDEX `AssistantWorkEvent_workItemId_eventId_key`(`workItemId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantTenantConfig` ADD CONSTRAINT `AssistantTenantConfig_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantBudgetRequest` ADD CONSTRAINT `AssistantBudgetRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `AssistantKnowledgeReviewNote` ADD CONSTRAINT `AssistantKnowledgeReviewNote_releaseId_fkey` FOREIGN KEY (`releaseId`) REFERENCES `AssistantKnowledgeRelease`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordReset` ADD CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerInteraction` ADD CONSTRAINT `CustomerInteraction_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerInteraction` ADD CONSTRAINT `CustomerInteraction_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerInteraction` ADD CONSTRAINT `CustomerInteraction_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierContact` ADD CONSTRAINT `SupplierContact_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierContact` ADD CONSTRAINT `SupplierContact_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierContact` ADD CONSTRAINT `SupplierContact_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierDocument` ADD CONSTRAINT `SupplierDocument_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierDocument` ADD CONSTRAINT `SupplierDocument_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierDocument` ADD CONSTRAINT `SupplierDocument_uploadedBy_fkey` FOREIGN KEY (`uploadedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_matchResolvedBy_fkey` FOREIGN KEY (`matchResolvedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturn` ADD CONSTRAINT `SupplierReturn_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturn` ADD CONSTRAINT `SupplierReturn_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturn` ADD CONSTRAINT `SupplierReturn_returnedBy_fkey` FOREIGN KEY (`returnedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_supplierReturnId_fkey` FOREIGN KEY (`supplierReturnId`) REFERENCES `SupplierReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_purchaseItemId_fkey` FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_goodsReceiptItemId_fkey` FOREIGN KEY (`goodsReceiptItemId`) REFERENCES `GoodsReceiptItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_purchaseMatchAllocationId_fkey` FOREIGN KEY (`purchaseMatchAllocationId`) REFERENCES `PurchaseMatchAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNote` ADD CONSTRAINT `SupplierCreditNote_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNote` ADD CONSTRAINT `SupplierCreditNote_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNote` ADD CONSTRAINT `SupplierCreditNote_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNoteLine` ADD CONSTRAINT `SupplierCreditNoteLine_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNoteLine` ADD CONSTRAINT `SupplierCreditNoteLine_creditNoteId_fkey` FOREIGN KEY (`creditNoteId`) REFERENCES `SupplierCreditNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNoteLine` ADD CONSTRAINT `SupplierCreditNoteLine_supplierReturnItemId_fkey` FOREIGN KEY (`supplierReturnItemId`) REFERENCES `SupplierReturnItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNoteLine` ADD CONSTRAINT `SupplierCreditNoteLine_sourcePurchaseItemId_fkey` FOREIGN KEY (`sourcePurchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditNoteLine` ADD CONSTRAINT `SupplierCreditNoteLine_purchaseMatchAllocationId_fkey` FOREIGN KEY (`purchaseMatchAllocationId`) REFERENCES `PurchaseMatchAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_creditNoteId_fkey` FOREIGN KEY (`creditNoteId`) REFERENCES `SupplierCreditNote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseItem` ADD CONSTRAINT `PurchaseItem_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseItem` ADD CONSTRAINT `PurchaseItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseItem` ADD CONSTRAINT `PurchaseItem_inventoryWarehouseId_fkey` FOREIGN KEY (`inventoryWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseItem` ADD CONSTRAINT `PurchaseItem_inventoryBatchId_fkey` FOREIGN KEY (`inventoryBatchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_receivedBy_fkey` FOREIGN KEY (`receivedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptItem` ADD CONSTRAINT `GoodsReceiptItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptItem` ADD CONSTRAINT `GoodsReceiptItem_goodsReceiptId_fkey` FOREIGN KEY (`goodsReceiptId`) REFERENCES `GoodsReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptItem` ADD CONSTRAINT `GoodsReceiptItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptItem` ADD CONSTRAINT `GoodsReceiptItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptItem` ADD CONSTRAINT `GoodsReceiptItem_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShort` ADD CONSTRAINT `PurchaseOrderCloseShort_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShort` ADD CONSTRAINT `PurchaseOrderCloseShort_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShort` ADD CONSTRAINT `PurchaseOrderCloseShort_closedBy_fkey` FOREIGN KEY (`closedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShortItem` ADD CONSTRAINT `PurchaseOrderCloseShortItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShortItem` ADD CONSTRAINT `PurchaseOrderCloseShortItem_closeShortId_fkey` FOREIGN KEY (`closeShortId`) REFERENCES `PurchaseOrderCloseShort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderCloseShortItem` ADD CONSTRAINT `PurchaseOrderCloseShortItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchAllocation` ADD CONSTRAINT `PurchaseMatchAllocation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchAllocation` ADD CONSTRAINT `PurchaseMatchAllocation_purchaseItemId_fkey` FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchAllocation` ADD CONSTRAINT `PurchaseMatchAllocation_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchAllocation` ADD CONSTRAINT `PurchaseMatchAllocation_goodsReceiptItemId_fkey` FOREIGN KEY (`goodsReceiptItemId`) REFERENCES `GoodsReceiptItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchException` ADD CONSTRAINT `PurchaseMatchException_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchException` ADD CONSTRAINT `PurchaseMatchException_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchException` ADD CONSTRAINT `PurchaseMatchException_purchaseItemId_fkey` FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseMatchException` ADD CONSTRAINT `PurchaseMatchException_resolvedBy_fkey` FOREIGN KEY (`resolvedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProcurementPolicy` ADD CONSTRAINT `ProcurementPolicy_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProcurementPolicy` ADD CONSTRAINT `ProcurementPolicy_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JudicialDeduction` ADD CONSTRAINT `JudicialDeduction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmploymentContract` ADD CONSTRAINT `EmploymentContract_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Aguinaldo` ADD CONSTRAINT `Aguinaldo_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payroll` ADD CONSTRAINT `Payroll_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_soldById_fkey` FOREIGN KEY (`soldById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItem` ADD CONSTRAINT `SaleItem_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantCapability` ADD CONSTRAINT `TenantCapability_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleLabelProfile` ADD CONSTRAINT `ScaleLabelProfile_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleLabelProfileVersion` ADD CONSTRAINT `ScaleLabelProfileVersion_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleLabelProfileVersion` ADD CONSTRAINT `ScaleLabelProfileVersion_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ScaleLabelProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleLabelProfileVersion` ADD CONSTRAINT `ScaleLabelProfileVersion_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleProductMapping` ADD CONSTRAINT `ScaleProductMapping_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleProductMapping` ADD CONSTRAINT `ScaleProductMapping_profileVersionId_fkey` FOREIGN KEY (`profileVersionId`) REFERENCES `ScaleLabelProfileVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleProductMapping` ADD CONSTRAINT `ScaleProductMapping_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleDevice` ADD CONSTRAINT `ScaleDevice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleDevice` ADD CONSTRAINT `ScaleDevice_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleMeasurement` ADD CONSTRAINT `SaleMeasurement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleMeasurement` ADD CONSTRAINT `SaleMeasurement_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleMeasurement` ADD CONSTRAINT `SaleMeasurement_profileVersionId_fkey` FOREIGN KEY (`profileVersionId`) REFERENCES `ScaleLabelProfileVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleMeasurement` ADD CONSTRAINT `SaleMeasurement_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `ScaleDevice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleMeasurement` ADD CONSTRAINT `SaleMeasurement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItemBatchAllocation` ADD CONSTRAINT `SaleItemBatchAllocation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItemBatchAllocation` ADD CONSTRAINT `SaleItemBatchAllocation_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItemBatchAllocation` ADD CONSTRAINT `SaleItemBatchAllocation_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItemBatchAllocation` ADD CONSTRAINT `SaleItemBatchAllocation_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_collectedBy_fkey` FOREIGN KEY (`collectedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shift` ADD CONSTRAINT `Shift_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shift` ADD CONSTRAINT `Shift_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shift` ADD CONSTRAINT `Shift_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftCloseReport` ADD CONSTRAINT `ShiftCloseReport_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftCloseReport` ADD CONSTRAINT `ShiftCloseReport_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentTransaction` ADD CONSTRAINT `AgentTransaction_agreementId_fkey` FOREIGN KEY (`agreementId`) REFERENCES `AgentAgreement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMessage` ADD CONSTRAINT `WhatsAppMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `WhatsAppConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `B2BOrder` ADD CONSTRAINT `B2BOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_defaultSupplierId_fkey` FOREIGN KEY (`defaultSupplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KardexMovement` ADD CONSTRAINT `KardexMovement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductStock` ADD CONSTRAINT `ProductStock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_fromWarehouseId_fkey` FOREIGN KEY (`fromWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_toWarehouseId_fkey` FOREIGN KEY (`toWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatch` ADD CONSTRAINT `ProductBatch_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatch` ADD CONSTRAINT `ProductBatch_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchWarehouseStock` ADD CONSTRAINT `ProductBatchWarehouseStock_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchWarehouseStock` ADD CONSTRAINT `ProductBatchWarehouseStock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchWarehouseStock` ADD CONSTRAINT `ProductBatchWarehouseStock_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchWarehouseStock` ADD CONSTRAINT `ProductBatchWarehouseStock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchHold` ADD CONSTRAINT `ProductBatchHold_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchHold` ADD CONSTRAINT `ProductBatchHold_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchHold` ADD CONSTRAINT `ProductBatchHold_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchHold` ADD CONSTRAINT `ProductBatchHold_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchHold` ADD CONSTRAINT `ProductBatchHold_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchLedgerEntry` ADD CONSTRAINT `ProductBatchLedgerEntry_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchLedgerEntry` ADD CONSTRAINT `ProductBatchLedgerEntry_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchLedgerEntry` ADD CONSTRAINT `ProductBatchLedgerEntry_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchLedgerEntry` ADD CONSTRAINT `ProductBatchLedgerEntry_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatchLedgerEntry` ADD CONSTRAINT `ProductBatchLedgerEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCountItem` ADD CONSTRAINT `StockCountItem_countId_fkey` FOREIGN KEY (`countId`) REFERENCES `StockCount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCountItem` ADD CONSTRAINT `StockCountItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManualPayment` ADD CONSTRAINT `ManualPayment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quotation` ADD CONSTRAINT `Quotation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuotationItem` ADD CONSTRAINT `QuotationItem_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturn` ADD CONSTRAINT `ProductReturn_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturn` ADD CONSTRAINT `ProductReturn_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturn` ADD CONSTRAINT `ProductReturn_processedShiftId_fkey` FOREIGN KEY (`processedShiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturn` ADD CONSTRAINT `ProductReturn_correctionRequestId_fkey` FOREIGN KEY (`correctionRequestId`) REFERENCES `SaleCorrectionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleCorrectionRequest` ADD CONSTRAINT `SaleCorrectionRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleCorrectionRequest` ADD CONSTRAINT `SaleCorrectionRequest_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleCorrectionLine` ADD CONSTRAINT `SaleCorrectionLine_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleCorrectionLine` ADD CONSTRAINT `SaleCorrectionLine_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `SaleCorrectionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleCorrectionLine` ADD CONSTRAINT `SaleCorrectionLine_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturnItem` ADD CONSTRAINT `ProductReturnItem_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturnItem` ADD CONSTRAINT `ProductReturnItem_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturnItem` ADD CONSTRAINT `ProductReturnItem_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReturnItem` ADD CONSTRAINT `ProductReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalGrant` ADD CONSTRAINT `ApprovalGrant_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRefund` ADD CONSTRAINT `ReturnRefund_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRefund` ADD CONSTRAINT `ReturnRefund_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRefund` ADD CONSTRAINT `ReturnRefund_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRefund` ADD CONSTRAINT `ReturnRefund_correctionRequestId_fkey` FOREIGN KEY (`correctionRequestId`) REFERENCES `SaleCorrectionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnInspection` ADD CONSTRAINT `ReturnInspection_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnInspection` ADD CONSTRAINT `ReturnInspection_correctionLineId_fkey` FOREIGN KEY (`correctionLineId`) REFERENCES `SaleCorrectionLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnInspection` ADD CONSTRAINT `ReturnInspection_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCreditEntry` ADD CONSTRAINT `CustomerCreditEntry_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCreditEntry` ADD CONSTRAINT `CustomerCreditEntry_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCreditEntry` ADD CONSTRAINT `CustomerCreditEntry_productReturnId_fkey` FOREIGN KEY (`productReturnId`) REFERENCES `ProductReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCreditEntry` ADD CONSTRAINT `CustomerCreditEntry_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FiscalRetention` ADD CONSTRAINT `FiscalRetention_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceSeries` ADD CONSTRAINT `InvoiceSeries_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollLine` ADD CONSTRAINT `PayrollLine_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollLine` ADD CONSTRAINT `PayrollLine_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollLine` ADD CONSTRAINT `PayrollLine_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalaryAdvance` ADD CONSTRAINT `SalaryAdvance_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalaryAdvance` ADD CONSTRAINT `SalaryAdvance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalaryAdvance` ADD CONSTRAINT `SalaryAdvance_repaymentPayrollId_fkey` FOREIGN KEY (`repaymentPayrollId`) REFERENCES `PayrollLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalaryAdvance` ADD CONSTRAINT `SalaryAdvance_payrollId_fkey` FOREIGN KEY (`payrollId`) REFERENCES `Payroll`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminationSettlement` ADD CONSTRAINT `TerminationSettlement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminationSettlement` ADD CONSTRAINT `TerminationSettlement_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicOrder` ADD CONSTRAINT `PublicOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CapitalLoan` ADD CONSTRAINT `CapitalLoan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CapitalLoan` ADD CONSTRAINT `CapitalLoan_linkedPurchaseId_fkey` FOREIGN KEY (`linkedPurchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Motorizado` ADD CONSTRAINT `Motorizado_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepreciationEntry` ADD CONSTRAINT `DepreciationEntry_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `FixedAsset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverWalletMovement` ADD CONSTRAINT `DriverWalletMovement_motorizadoId_fkey` FOREIGN KEY (`motorizadoId`) REFERENCES `Motorizado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pedido` ADD CONSTRAINT `Pedido_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pedido` ADD CONSTRAINT `Pedido_motorizadoId_fkey` FOREIGN KEY (`motorizadoId`) REFERENCES `Motorizado`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pedido` ADD CONSTRAINT `Pedido_facturaId_fkey` FOREIGN KEY (`facturaId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoItem` ADD CONSTRAINT `PedidoItem_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `Pedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoItem` ADD CONSTRAINT `PedidoItem_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrackingEvento` ADD CONSTRAINT `TrackingEvento_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `Pedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanInstallment` ADD CONSTRAINT `LoanInstallment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Repayment` ADD CONSTRAINT `Repayment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RouteExpense` ADD CONSTRAINT `RouteExpense_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsappSession` ADD CONSTRAINT `WhatsappSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsappSession` ADD CONSTRAINT `WhatsappSession_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsappInboundMessage` ADD CONSTRAINT `WhatsappInboundMessage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantWorkEvent` ADD CONSTRAINT `AssistantWorkEvent_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `AssistantWorkItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

