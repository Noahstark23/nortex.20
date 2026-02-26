-- AlterTable: Add theft alert threshold to Tenant
ALTER TABLE `Tenant` ADD COLUMN `theftAlertThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 500;

-- CreateTable: CashMovement (entradas/salidas manuales de caja)
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

    UNIQUE INDEX `CashMovement_expenseId_key`(`expenseId`),
    INDEX `CashMovement_tenantId_idx`(`tenantId`),
    INDEX `CashMovement_shiftId_idx`(`shiftId`),
    INDEX `CashMovement_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: CashMovement -> Tenant
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CashMovement -> Shift
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CashMovement -> User
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CashMovement -> Expense
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
