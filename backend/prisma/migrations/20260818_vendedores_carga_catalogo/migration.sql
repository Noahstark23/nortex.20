-- Vendedores Fase B — carga de ruta + catálogo asignado. DDL expand-only.
-- Prisma 6.4 clasifica la creación de un UNIQUE sobre una tabla poblada como
-- posible data loss. Producción crea columna+índice mediante el preflight
-- idempotente `scripts/deploy-schema-preflight.ts` y después corre `db push`
-- normal, sin habilitar --accept-data-loss.
--
-- Warehouse.sellerId: la bodega-CARGA de un vendedor ("camioneta de Juan").
-- Con carga asignada, sus ventas descuentan de esa bodega. El índice único
-- [tenantId, sellerId] permite múltiples NULL (bodegas comunes) y garantiza
-- a lo sumo UNA carga por vendedor.
ALTER TABLE `Warehouse` ADD COLUMN `sellerId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Warehouse_tenantId_sellerId_key` ON `Warehouse`(`tenantId`, `sellerId`);
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- SellerProduct: catálogo asignado (opt-in: sin filas = catálogo completo).
CREATE TABLE `SellerProduct` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SellerProduct_tenantId_sellerId_productId_key`(`tenantId`, `sellerId`, `productId`),
    INDEX `SellerProduct_tenantId_productId_idx`(`tenantId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SellerProduct` ADD CONSTRAINT `SellerProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
