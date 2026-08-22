-- Productos medidos, capacidades comerciales y fundación de balanzas.
-- Migración estrictamente aditiva para MySQL 8: el histórico queda nullable
-- y los perfiles/versiones referenciados por ventas no se borran en cascada.

ALTER TABLE `Product`
    ADD COLUMN `saleMode` VARCHAR(191) NULL,
    ADD COLUMN `quantityStep` DECIMAL(18, 4) NULL,
    ADD COLUMN `productFamily` VARCHAR(191) NULL;

ALTER TABLE `PurchaseItem`
    ADD COLUMN `quantityExact` DECIMAL(18, 4) NULL;

ALTER TABLE `PurchaseOrderItem`
    ADD COLUMN `quantityOrderedExact` DECIMAL(18, 4) NULL,
    ADD COLUMN `quantityReceivedExact` DECIMAL(18, 4) NULL,
    ADD COLUMN `unitAtOrder` VARCHAR(191) NULL,
    ADD COLUMN `saleModeAtOrder` VARCHAR(191) NULL,
    ADD COLUMN `quantityStepAtOrder` DECIMAL(18, 4) NULL;

ALTER TABLE `QuotationItem`
    ADD COLUMN `quantityExact` DECIMAL(18, 4) NULL,
    ADD COLUMN `unitPriceExact` DECIMAL(18, 4) NULL,
    ADD COLUMN `unitAtQuote` VARCHAR(191) NULL,
    ADD COLUMN `saleModeAtQuote` VARCHAR(191) NULL,
    ADD COLUMN `quantityStepAtQuote` DECIMAL(18, 4) NULL,
    ADD COLUMN `presentationAtQuote` VARCHAR(191) NULL,
    ADD COLUMN `presentationQuantityAtQuote` DECIMAL(18, 4) NULL,
    ADD COLUMN `ivaExentoAtQuote` BOOLEAN NULL;

ALTER TABLE `PedidoItem`
    ADD COLUMN `cantidadExact` DECIMAL(18, 4) NULL,
    ADD COLUMN `presentationAtSale` VARCHAR(191) NULL,
    ADD COLUMN `presentationQuantityAtSale` DECIMAL(18, 4) NULL,
    ADD COLUMN `productNameAtOrder` VARCHAR(191) NULL,
    ADD COLUMN `unitAtOrder` VARCHAR(191) NULL,
    ADD COLUMN `saleModeAtOrder` VARCHAR(191) NULL,
    ADD COLUMN `quantityStepAtOrder` DECIMAL(18, 4) NULL,
    ADD COLUMN `unitPriceExactAtOrder` DECIMAL(18, 4) NULL,
    ADD COLUMN `ivaExentoAtOrder` BOOLEAN NULL;

ALTER TABLE `SaleItem`
    ADD COLUMN `productNameAtSale` VARCHAR(191) NULL,
    ADD COLUMN `unitAtSale` VARCHAR(191) NULL,
    ADD COLUMN `saleModeAtSale` VARCHAR(191) NULL,
    ADD COLUMN `quantityStepAtSale` DECIMAL(18, 4) NULL,
    ADD COLUMN `unitPriceExactAtSale` DECIMAL(18, 4) NULL,
    ADD COLUMN `presentationAtSale` VARCHAR(191) NULL,
    ADD COLUMN `presentationQuantityAtSale` DECIMAL(18, 4) NULL;

ALTER TABLE `Sale`
    ADD COLUMN `offlinePayloadHash` VARCHAR(64) NULL;

ALTER TABLE `ProductReturn`
    ADD COLUMN `clientEventId` VARCHAR(128) NULL,
    ADD COLUMN `payloadHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `ProductReturn_tenantId_clientEventId_key`
    ON `ProductReturn`(`tenantId`, `clientEventId`);

CREATE TABLE `TenantCapability` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TenantCapability_tenantId_code_key`(`tenantId`, `code`),
    INDEX `TenantCapability_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScaleLabelProfile` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ScaleLabelProfile_tenantId_name_key`(`tenantId`, `name`),
    INDEX `ScaleLabelProfile_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScaleDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `manufacturer` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `transport` VARCHAR(191) NOT NULL,
    `protocolKey` VARCHAR(191) NOT NULL,
    `adapterVersion` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `config` JSON NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScaleDevice_createdBy_idx`(`createdBy`),
    INDEX `ScaleDevice_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `ScaleDevice_tenantId_transport_idx`(`tenantId`, `transport`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScaleLabelProfileVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `symbology` VARCHAR(191) NOT NULL,
    `totalLength` INTEGER NOT NULL,
    `prefixes` JSON NOT NULL,
    `itemStart` INTEGER NOT NULL,
    `itemLength` INTEGER NOT NULL,
    `valueStart` INTEGER NOT NULL,
    `valueLength` INTEGER NOT NULL,
    `valueKind` VARCHAR(191) NOT NULL,
    `impliedDecimals` INTEGER NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `checksumMode` VARCHAR(191) NOT NULL,
    `pricePolicy` VARCHAR(191) NOT NULL,
    `roundingTolerance` DECIMAL(18, 4) NOT NULL,
    `minValue` DECIMAL(18, 4) NOT NULL,
    `maxValue` DECIMAL(18, 4) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ScaleLabelProfileVersion_tenantId_profileId_version_key`(`tenantId`, `profileId`, `version`),
    INDEX `ScaleLabelProfileVersion_profileId_idx`(`profileId`),
    INDEX `ScaleLabelProfileVersion_createdBy_idx`(`createdBy`),
    INDEX `ScaleLabelProfileVersion_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScaleProductMapping` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `profileVersionId` VARCHAR(191) NOT NULL,
    `plu` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ScaleProductMapping_tenantId_profileVersionId_plu_key`(`tenantId`, `profileVersionId`, `plu`),
    INDEX `ScaleProductMapping_profileVersionId_idx`(`profileVersionId`),
    INDEX `ScaleProductMapping_tenantId_productId_idx`(`tenantId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SaleMeasurement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `profileVersionId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `sourceValue` DECIMAL(18, 4) NOT NULL,
    `sourceUnit` VARCHAR(191) NOT NULL,
    `baseQuantity` DECIMAL(18, 4) NOT NULL,
    `encodedPrice` DECIMAL(18, 4) NULL,
    `pricingPolicy` VARCHAR(191) NOT NULL,
    `stable` BOOLEAN NULL,
    `clientEventId` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(191) NULL,
    `capturedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `SaleMeasurement_saleItemId_key`(`saleItemId`),
    UNIQUE INDEX `SaleMeasurement_tenantId_clientEventId_key`(`tenantId`, `clientEventId`),
    INDEX `SaleMeasurement_profileVersionId_idx`(`profileVersionId`),
    INDEX `SaleMeasurement_deviceId_idx`(`deviceId`),
    INDEX `SaleMeasurement_userId_idx`(`userId`),
    INDEX `SaleMeasurement_tenantId_capturedAt_idx`(`tenantId`, `capturedAt`),
    INDEX `SaleMeasurement_tenantId_source_capturedAt_idx`(`tenantId`, `source`, `capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SaleItemBatchAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SaleItemBatchAllocation_saleItemId_batchId_key`(`saleItemId`, `batchId`),
    INDEX `SaleItemBatchAllocation_tenantId_saleItemId_idx`(`tenantId`, `saleItemId`),
    INDEX `SaleItemBatchAllocation_tenantId_batchId_idx`(`tenantId`, `batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TenantCapability`
    ADD CONSTRAINT `TenantCapability_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ScaleLabelProfile`
    ADD CONSTRAINT `ScaleLabelProfile_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ScaleDevice`
    ADD CONSTRAINT `ScaleDevice_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ScaleDevice_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ScaleLabelProfileVersion`
    ADD CONSTRAINT `ScaleLabelProfileVersion_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ScaleLabelProfileVersion_profileId_fkey`
    FOREIGN KEY (`profileId`) REFERENCES `ScaleLabelProfile`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ScaleLabelProfileVersion_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ScaleProductMapping`
    ADD CONSTRAINT `ScaleProductMapping_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ScaleProductMapping_profileVersionId_fkey`
    FOREIGN KEY (`profileVersionId`) REFERENCES `ScaleLabelProfileVersion`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ScaleProductMapping_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SaleMeasurement`
    ADD CONSTRAINT `SaleMeasurement_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleMeasurement_saleItemId_fkey`
    FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleMeasurement_profileVersionId_fkey`
    FOREIGN KEY (`profileVersionId`) REFERENCES `ScaleLabelProfileVersion`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleMeasurement_deviceId_fkey`
    FOREIGN KEY (`deviceId`) REFERENCES `ScaleDevice`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleMeasurement_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SaleItemBatchAllocation`
    ADD CONSTRAINT `SaleItemBatchAllocation_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleItemBatchAllocation_saleItemId_fkey`
    FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SaleItemBatchAllocation_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
