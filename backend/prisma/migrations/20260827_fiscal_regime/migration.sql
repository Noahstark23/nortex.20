-- Régimen fiscal por tenant y fotos históricas en ventas/compras/cotizaciones.
--
-- Migración estrictamente aditiva para MySQL 8: solo agrega columnas e índices,
-- sin DML ni reinterpretación masiva de documentos existentes. Los defaults
-- GENERAL/1 conservan el comportamiento fiscal previo; los montos NULL indican
-- que una fila histórica no persistió ese cálculo por separado.

ALTER TABLE `Tenant`
  ADD COLUMN `fiscalRegime` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN `fiscalRegimeVersion` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `Sale`
  ADD COLUMN `fiscalRegimeAtSale` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN `fiscalRegimeVersionAtSale` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `vatAmountAtSale` DECIMAL(18, 4) NULL;

CREATE INDEX `Sale_tenantId_fiscalRegimeAtSale_createdAt_idx`
  ON `Sale`(`tenantId`, `fiscalRegimeAtSale`, `createdAt`);

ALTER TABLE `Purchase`
  ADD COLUMN `fiscalRegimeAtPurchase` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN `creditableTax` DECIMAL(18, 4) NULL;

CREATE INDEX `Purchase_tenantId_fiscalRegimeAtPurchase_date_idx`
  ON `Purchase`(`tenantId`, `fiscalRegimeAtPurchase`, `date`);

ALTER TABLE `Quotation`
  ADD COLUMN `fiscalRegimeAtQuote` VARCHAR(32) NOT NULL DEFAULT 'GENERAL';
