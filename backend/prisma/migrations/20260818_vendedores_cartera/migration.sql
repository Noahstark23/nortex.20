-- Vendedores (cartera de ruta) — Fase A. 100% ADITIVO: compatible con
-- `prisma db push` sin --accept-data-loss (el deploy falla ante cambios
-- destructivos; este no tiene ninguno).
--
-- Sale.soldById: quién FACTURÓ, del JWT server-side. Nullable: el histórico
-- queda "Sin vendedor" (no se backfillea desde Shift.userId, que es mutable).
-- Customer.sellerId: a qué vendedor pertenece el cliente. Nullable = sin asignar.

ALTER TABLE `Sale` ADD COLUMN `soldById` VARCHAR(191) NULL;
ALTER TABLE `Customer` ADD COLUMN `sellerId` VARCHAR(191) NULL;

-- Índices en el MISMO cambio que las queries que los usan:
-- groupBy de ventas por vendedor, filtro de cartera y groupBy de cobros.
CREATE INDEX `Sale_tenantId_soldById_createdAt_idx` ON `Sale`(`tenantId`, `soldById`, `createdAt`);
CREATE INDEX `Customer_tenantId_sellerId_idx` ON `Customer`(`tenantId`, `sellerId`);
CREATE INDEX `Payment_collectedBy_createdAt_idx` ON `Payment`(`collectedBy`, `createdAt`);

-- FKs opcionales (los User nunca se borran físicamente — solo status DISABLED —
-- pero SET NULL es la red correcta por si eso cambia).
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_soldById_fkey` FOREIGN KEY (`soldById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
