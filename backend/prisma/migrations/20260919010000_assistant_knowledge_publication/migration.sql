-- Ayuda oficial global; ningún documento privado del negocio se almacena aquí.
CREATE TABLE `AssistantKnowledgeControl` (
  `id` VARCHAR(64) NOT NULL,
  `activeReleaseId` VARCHAR(128) NULL,
  `generation` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  INDEX `AssistantKnowledgeRelease_status_createdAt_idx` (`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  INDEX `AssistantKnowledgeVersion_status_documentId_idx` (`status`, `documentId`),
  PRIMARY KEY (`documentId`, `version`, `sectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- null = procedencia antigua desconocida; [] = respuesta nueva sin ayuda documental.
ALTER TABLE `AssistantWaOutbox` ADD COLUMN `knowledgeReferences` JSON NULL;

-- Persistir el origen evita inferirlo desde un vínculo de WhatsApp que puede renovarse.
ALTER TABLE `AssistantRun` ADD COLUMN `knowledgeChannel` VARCHAR(24) NULL;
