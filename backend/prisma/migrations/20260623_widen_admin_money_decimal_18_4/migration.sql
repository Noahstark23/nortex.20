-- Migration: widen Command Center money columns to Decimal(18,4)
-- Capa 4 del Security & Integrity Loop (precisión financiera): los montos que alimentan
-- el panel /admin (capital asignado, wallets, ventas) pasan de Decimal(12,2)/(10,2) a (18,4).
-- Es un ensanchamiento no destructivo: los valores existentes se conservan (se rellenan con ceros).
ALTER TABLE `Tenant`   MODIFY COLUMN `walletBalance` DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE `Tenant`   MODIFY COLUMN `creditLimit`   DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE `Sale`     MODIFY COLUMN `total`          DECIMAL(18,4) NOT NULL;
ALTER TABLE `B2BOrder` MODIFY COLUMN `total`          DECIMAL(18,4) NOT NULL;
