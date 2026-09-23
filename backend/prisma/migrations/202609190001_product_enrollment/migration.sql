CREATE TABLE IF NOT EXISTS `ProductEnrollment` (
  `tenantId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `operationId`),
  INDEX `ProductEnrollment_tenantId_userId_createdAt_idx` (`tenantId`, `userId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
