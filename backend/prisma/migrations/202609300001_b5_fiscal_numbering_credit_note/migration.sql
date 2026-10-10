-- B5 H3: un número DGI no se repite dentro de su serie. Expand-only, pero Prisma
-- lo trata como posible data loss; el arranque lo aplica mediante
-- scripts/saleInvoiceSchemaPreflight.ts, que primero verifica que NO existan
-- duplicados (tenantId, invoiceSeries, invoiceNumber) y se detiene si los hay.
-- Nunca corrige ni borra filas automáticamente.
CREATE UNIQUE INDEX `Sale_tenantId_invoiceSeries_invoiceNumber_key`
  ON `Sale`(`tenantId`, `invoiceSeries`, `invoiceNumber`);

-- B5 H6: nota de crédito por anulación con número propio (serie NC).
CREATE TABLE `SaleCreditNote` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `saleId` VARCHAR(191) NOT NULL,
  `correctionRequestId` VARCHAR(191) NOT NULL,
  `series` VARCHAR(8) NOT NULL,
  `number` INTEGER NOT NULL,
  `total` DECIMAL(18, 4) NOT NULL,
  `vatAmount` DECIMAL(18, 4) NOT NULL,
  `reason` TEXT NOT NULL,
  `authorizedById` VARCHAR(191) NOT NULL,
  `issuedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SaleCreditNote_saleId_key` (`saleId`),
  UNIQUE INDEX `SaleCreditNote_correctionRequestId_key` (`correctionRequestId`),
  UNIQUE INDEX `SaleCreditNote_tenantId_series_number_key` (`tenantId`, `series`, `number`),
  INDEX `SaleCreditNote_tenantId_createdAt_idx` (`tenantId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SaleCreditNote_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SaleCreditNote_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
