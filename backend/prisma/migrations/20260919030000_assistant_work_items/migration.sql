-- Expansión aditiva. El arranque sincroniza el schema con db push; este SQL es su espejo.
-- Sin referencias a documentos contables ni cambios a tablas existentes.
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
  UNIQUE INDEX `AssistantWorkItem_tenantId_userId_runId_key` (`tenantId`, `userId`, `runId`),
  INDEX `AssistantWorkItem_tenantId_userId_roleAtCreation_createdAt_i_idx` (`tenantId`, `userId`, `roleAtCreation`, `createdAt`, `id`),
  INDEX `AssistantWorkItem_expiresAt_id_idx` (`expiresAt`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  UNIQUE INDEX `AssistantWorkEvent_workItemId_eventId_key` (`workItemId`, `eventId`),
  INDEX `AssistantWorkEvent_workItemId_version_id_idx` (`workItemId`, `version`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AssistantWorkEvent_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `AssistantWorkItem` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
