-- AlterTable
ALTER TABLE `WhatsAppChannel` ADD COLUMN `commerceEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `commercePolicy` JSON NULL,
    ADD COLUMN `commercePolicyVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `WaCommerceConversation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'BOT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `assignedUserId` VARCHAR(191) NULL,
    `optedOutAt` DATETIME(3) NULL,
    `optedInAt` DATETIME(3) NULL,
    `lastInboundAt` DATETIME(3) NOT NULL,
    `draftState` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WaCommerceConversation_tenantId_status_updatedAt_idx`(`tenantId`, `status`, `updatedAt`),
    INDEX `WaCommerceConversation_tenantId_channelId_idx`(`tenantId`, `channelId`),
    UNIQUE INDEX `WaCommerceConversation_channelId_waId_key`(`channelId`, `waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommerceInbox` (
    `id` VARCHAR(191) NOT NULL,
    `sequence` BIGINT NOT NULL AUTO_INCREMENT,
    `providerMessageId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `eventAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseToken` VARCHAR(191) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `errorCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaCommerceInbox_sequence_key`(`sequence`),
    UNIQUE INDEX `WaCommerceInbox_providerMessageId_key`(`providerMessageId`),
    INDEX `WaCommerceInbox_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `WaCommerceInbox_conversationId_status_sequence_idx`(`conversationId`, `status`, `sequence`),
    INDEX `WaCommerceInbox_tenantId_channelId_createdAt_idx`(`tenantId`, `channelId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommerceOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `sequence` BIGINT NOT NULL AUTO_INCREMENT,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `providerMessageId` VARCHAR(191) NULL,
    `policyVersion` INTEGER NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `quoteDraftId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `leaseToken` VARCHAR(191) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `errorCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WaCommerceOutbox_sequence_key`(`sequence`),
    UNIQUE INDEX `WaCommerceOutbox_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `WaCommerceOutbox_providerMessageId_key`(`providerMessageId`),
    INDEX `WaCommerceOutbox_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `WaCommerceOutbox_conversationId_status_sequence_idx`(`conversationId`, `status`, `sequence`),
    INDEX `WaCommerceOutbox_tenantId_channelId_createdAt_idx`(`tenantId`, `channelId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommerceReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaCommerceReceipt_fingerprint_key`(`fingerprint`),
    INDEX `WaCommerceReceipt_channelId_providerMessageId_waId_idx`(`channelId`, `providerMessageId`, `waId`),
    INDEX `WaCommerceReceipt_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommerceQuoteDraft` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `items` JSON NOT NULL,
    `snapshot` JSON NULL,
    `reviewHash` VARCHAR(191) NULL,
    `policyVersion` INTEGER NOT NULL,
    `quotationId` VARCHAR(191) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WaCommerceQuoteDraft_requestKey_key`(`requestKey`),
    UNIQUE INDEX `WaCommerceQuoteDraft_quotationId_key`(`quotationId`),
    INDEX `WaCommerceQuoteDraft_tenantId_status_updatedAt_idx`(`tenantId`, `status`, `updatedAt`),
    INDEX `WaCommerceQuoteDraft_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommerceConsentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `noticeVersion` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'RESPONSE_ONLY',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaCommerceConsentEvent_sourceId_key`(`sourceId`),
    INDEX `WaCommerceConsentEvent_tenantId_conversationId_createdAt_idx`(`tenantId`, `conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaCommercePolicyVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `policy` JSON NOT NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WaCommercePolicyVersion_tenantId_channelId_createdAt_idx`(`tenantId`, `channelId`, `createdAt`),
    UNIQUE INDEX `WaCommercePolicyVersion_channelId_version_key`(`channelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
