CREATE INDEX `AssistantKnowledgeRelease_status_createdAt_id_idx`
  ON `AssistantKnowledgeRelease` (`status`, `createdAt`, `id`);

CREATE TABLE `AssistantKnowledgeReviewNote` (
  `id` VARCHAR(64) NOT NULL,
  `releaseId` VARCHAR(128) NOT NULL,
  `manifestHash` CHAR(64) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AssistantKnowledgeReviewNote_releaseId_createdAt_id_idx` (`releaseId`, `createdAt`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AssistantKnowledgeReviewNote_releaseId_fkey` FOREIGN KEY (`releaseId`)
    REFERENCES `AssistantKnowledgeRelease` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
