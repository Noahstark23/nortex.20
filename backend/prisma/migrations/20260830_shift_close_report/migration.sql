-- Snapshot Z inmutable por cierre de caja. El modelo es estrictamente aditivo:
-- no modifica ni reescribe cierres históricos.
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
    UNIQUE INDEX `ShiftCloseReport_tenantId_folio_key`(`tenantId`, `folio`),
    INDEX `ShiftCloseReport_tenantId_businessDate_idx`(`tenantId`, `businessDate`),
    INDEX `ShiftCloseReport_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ShiftCloseReport_tenantId_fkey`
        FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ShiftCloseReport_shiftId_fkey`
        FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Accesos de reportes por tenant, estado/turno y período.
CREATE INDEX `Shift_tenantId_status_startTime_idx`
    ON `Shift`(`tenantId`, `status`, `startTime`);

CREATE INDEX `CashMovement_tenantId_shiftId_isVoided_idx`
    ON `CashMovement`(`tenantId`, `shiftId`, `isVoided`);

CREATE INDEX `ProductReturn_tenantId_createdAt_idx`
    ON `ProductReturn`(`tenantId`, `createdAt`);

ALTER TABLE `ProductReturn`
    ADD COLUMN `processedShiftId` VARCHAR(191) NULL,
    ADD CONSTRAINT `ProductReturn_processedShiftId_fkey`
        FOREIGN KEY (`processedShiftId`) REFERENCES `Shift`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `ProductReturn_tenantId_processedShiftId_createdAt_idx`
    ON `ProductReturn`(`tenantId`, `processedShiftId`, `createdAt`);

CREATE INDEX `Sale_tenantId_status_createdAt_idx`
    ON `Sale`(`tenantId`, `status`, `createdAt`);

CREATE INDEX `Sale_tenantId_shiftId_status_idx`
    ON `Sale`(`tenantId`, `shiftId`, `status`);
