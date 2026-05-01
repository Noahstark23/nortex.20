-- Migration: add offlineId to Sale for PWA offline sync idempotency
ALTER TABLE `Sale` ADD COLUMN `offlineId` VARCHAR(191) NULL;
ALTER TABLE `Sale` ADD UNIQUE INDEX `Sale_offlineId_key`(`offlineId`);
