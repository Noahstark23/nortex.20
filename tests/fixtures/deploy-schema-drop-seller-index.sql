-- Estado parcial válido: la columna/FK existen y solo falta recrear el índice.
ALTER TABLE `Warehouse` DROP INDEX `Warehouse_tenantId_sellerId_key`;
