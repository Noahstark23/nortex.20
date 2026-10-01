-- CreateTable
CREATE TABLE `PlatformAccountEvidence` (
    `tenantId` VARCHAR(191) NOT NULL,
    `businessKind` VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    `founder` BOOLEAN NULL,
    `benefitStartedAt` DATETIME(3) NULL,
    `benefitEndsAt` DATETIME(3) NULL,
    `planLabel` VARCHAR(100) NULL,
    `evidenceReference` VARCHAR(191) NOT NULL,
    `verifiedAt` DATETIME(3) NOT NULL,

    INDEX `PlatformAccountEvidence_businessKind_verifiedAt_idx`(`businessKind`, `verifiedAt`),
    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformPaymentEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `reconciledAt` DATETIME(3) NOT NULL,
    `evidenceReference` VARCHAR(191) NOT NULL,

    INDEX `PlatformPaymentEvidence_tenantId_paidAt_reconciledAt_idx`(`tenantId`, `paidAt`, `reconciledAt`),
    UNIQUE INDEX `PlatformPaymentEvidence_tenantId_evidenceReference_key`(`tenantId`, `evidenceReference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Tenant_createdAt_id_idx` ON `Tenant`(`createdAt`, `id`);

-- CreateIndex
CREATE INDEX `User_tenantId_lastLogin_idx` ON `User`(`tenantId`, `lastLogin`);

-- CreateIndex
CREATE INDEX `Product_tenantId_stock_idx` ON `Product`(`tenantId`, `stock`);

-- AddForeignKey
ALTER TABLE `PlatformAccountEvidence` ADD CONSTRAINT `PlatformAccountEvidence_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformPaymentEvidence` ADD CONSTRAINT `PlatformPaymentEvidence_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
