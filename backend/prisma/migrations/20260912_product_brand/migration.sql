ALTER TABLE `Product` ADD COLUMN `brand` VARCHAR(100) NULL;
CREATE INDEX `Product_tenantId_brand_idx` ON `Product` (`tenantId`, `brand`);
