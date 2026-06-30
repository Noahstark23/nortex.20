-- Inventario Fase 0: política de stock negativo (0a) + Órdenes de Compra (0b).
-- Cambios aditivos y no destructivos. El deploy usa `prisma db push` (lee el schema);
-- este archivo documenta el delta y sirve para `migrate deploy`.

-- 0a · Política de stock negativo (por tenant).
ALTER TABLE `Tenant` ADD COLUMN `allowNegativeStock` BOOLEAN NOT NULL DEFAULT false;

-- 0b · Órdenes de Compra (procurement: pedido → aprobación → recepción).
CREATE TABLE `PurchaseOrder` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `orderNumber` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `notes` TEXT NULL,
  `expectedDate` DATETIME(3) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `approvedBy` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PurchaseOrder_tenantId_orderNumber_key`(`tenantId`, `orderNumber`),
  INDEX `PurchaseOrder_tenantId_idx`(`tenantId`),
  INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
  INDEX `PurchaseOrder_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderItem` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `quantityOrdered` DOUBLE NOT NULL,
  `quantityReceived` DOUBLE NOT NULL DEFAULT 0,
  `unitCost` DECIMAL(10, 2) NOT NULL,
  INDEX `PurchaseOrderItem_purchaseOrderId_idx`(`purchaseOrderId`),
  INDEX `PurchaseOrderItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Enlace recepción → OC (una OC puede tener varias recepciones parciales).
ALTER TABLE `Purchase` ADD COLUMN `purchaseOrderId` VARCHAR(191) NULL;
CREATE INDEX `Purchase_purchaseOrderId_idx` ON `Purchase`(`purchaseOrderId`);

-- Claves foráneas.
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
