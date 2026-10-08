-- Toma física por bodega (aditivo y compatible con datos históricos).
--
-- `warehouseId` permanece nullable deliberadamente: los conteos anteriores a
-- multi-bodega no contienen evidencia suficiente para atribuirlos a una
-- ubicación. Solo se completa automáticamente un historial ya finalizado cuando
-- el tenant tiene exactamente una bodega, caso en el que agregado == ubicación.
-- Los OPEN históricos se dejan sin ubicación para que la aplicación los trate
-- como solo lectura y pida cancelar/reiniciar, sin reinterpretar su snapshot.

ALTER TABLE `StockCount`
  ADD COLUMN `warehouseId` VARCHAR(191) NULL,
  ADD COLUMN `openWarehouseKey` VARCHAR(191) NULL;

UPDATE `StockCount` AS `sc`
JOIN (
  SELECT `tenantId`, MIN(`id`) AS `warehouseId`
  FROM `Warehouse`
  GROUP BY `tenantId`
  HAVING COUNT(*) = 1
) AS `singleWarehouse`
  ON `singleWarehouse`.`tenantId` = `sc`.`tenantId`
SET `sc`.`warehouseId` = `singleWarehouse`.`warehouseId`
WHERE `sc`.`status` IN ('CLOSED', 'CANCELLED');

CREATE UNIQUE INDEX `StockCount_openWarehouseKey_key`
  ON `StockCount`(`openWarehouseKey`);
CREATE INDEX `StockCount_warehouseId_idx`
  ON `StockCount`(`warehouseId`);
CREATE INDEX `StockCount_tenantId_warehouseId_status_idx`
  ON `StockCount`(`tenantId`, `warehouseId`, `status`);

ALTER TABLE `StockCount`
  ADD CONSTRAINT `StockCount_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
