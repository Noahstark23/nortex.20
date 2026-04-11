-- AlterTable: add ruc and address to Supplier
ALTER TABLE `Supplier` ADD COLUMN `ruc` VARCHAR(191) NULL;
ALTER TABLE `Supplier` ADD COLUMN `address` TEXT NULL;
