-- Estado adversarial: el índice se retira en esta BD desechable y dos bodegas
-- reciben el mismo vendedor. El preflight debe abortar sin alterar las filas.
ALTER TABLE `Warehouse` DROP INDEX `Warehouse_tenantId_sellerId_key`;

UPDATE `Warehouse`
SET `sellerId` = 'user-deploy-smoke'
WHERE `id` IN ('warehouse-deploy-1', 'warehouse-deploy-2');
