-- Estado parcial válido: las columnas existen, pero faltan los objetos que
-- Prisma considera sensibles. Dos entrypoints concurrentes deben converger.
ALTER TABLE `Warehouse` DROP INDEX `Warehouse_tenantId_sellerId_key`;
ALTER TABLE `ProductReturn` DROP INDEX `ProductReturn_tenantId_clientEventId_key`;

ALTER TABLE `StockCount` DROP FOREIGN KEY `StockCount_warehouseId_fkey`;
ALTER TABLE `StockCount` DROP INDEX `StockCount_openWarehouseKey_key`;
ALTER TABLE `StockCount` DROP INDEX `StockCount_warehouseId_idx`;
ALTER TABLE `StockCount` DROP INDEX `StockCount_tenantId_warehouseId_status_idx`;
