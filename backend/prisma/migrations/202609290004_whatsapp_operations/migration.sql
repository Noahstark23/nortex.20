-- Metadatos auxiliares aditivos; no activa canal ni cambia dinero/stock.
ALTER TABLE `WaCommerceActivationRequest` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1 AFTER `status`, ADD COLUMN `assignedTo` VARCHAR(191) NULL AFTER `version`;
CREATE TABLE `WaCommerceWorkerHeartbeat` (
 `id` VARCHAR(191) NOT NULL,
 `startedAt` DATETIME(3) NOT NULL,
 `lastSeenAt` DATETIME(3) NOT NULL,
 `lastProgressAt` DATETIME(3) NULL,
 `processingEnabled` BOOLEAN NOT NULL,
 `sendingEnabled` BOOLEAN NOT NULL,
 `status` VARCHAR(191) NOT NULL,
 `errorCode` VARCHAR(64) NULL,
 INDEX `WaCommerceWorkerHeartbeat_status_lastSeenAt_idx` (`status`,`lastSeenAt`),
 INDEX `WaCommerceWorkerHeartbeat_lastSeenAt_idx` (`lastSeenAt`),
 PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX `WaCommerceInbox_tenantId_status_createdAt_idx` ON `WaCommerceInbox` (`tenantId`,`status`,`createdAt`);
CREATE INDEX `WaCommerceInbox_tenantId_status_leaseUntil_idx` ON `WaCommerceInbox` (`tenantId`,`status`,`leaseUntil`);
CREATE INDEX `WaCommerceOutbox_tenantId_status_createdAt_idx` ON `WaCommerceOutbox` (`tenantId`,`status`,`createdAt`);
CREATE INDEX `WaCommerceOutbox_tenantId_status_leaseUntil_idx` ON `WaCommerceOutbox` (`tenantId`,`status`,`leaseUntil`);

CREATE TABLE `WaCommerceOutboxAttempt` (
 `id` VARCHAR(191) NOT NULL,
 `tenantId` VARCHAR(191) NOT NULL,
 `outboxId` VARCHAR(191) NOT NULL,
 `channelId` VARCHAR(191) NOT NULL,
 `claimedAt` DATETIME(3) NOT NULL,
 `invokedAt` DATETIME(3) NULL,
 `settledAt` DATETIME(3) NULL,
 `status` VARCHAR(191) NOT NULL,
 `providerMessageId` VARCHAR(191) NULL,
 `errorCode` VARCHAR(64) NULL,
 INDEX `WaCommerceOutboxAttempt_tenantId_outboxId_claimedAt_idx` (`tenantId`,`outboxId`,`claimedAt`),
 INDEX `WaCommerceOutboxAttempt_status_claimedAt_idx` (`status`,`claimedAt`),
 PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `WaCommerceActivationRequest_createdAt_id_idx` ON `WaCommerceActivationRequest` (`createdAt`,`id`);
CREATE INDEX `WaCommerceActivationRequest_status_createdAt_id_idx` ON `WaCommerceActivationRequest` (`status`,`createdAt`,`id`);
