-- Recuperar los duplicados y dejar una FK existente pero semánticamente ajena.
UPDATE `Warehouse` SET `sellerId` = NULL;

INSERT INTO `Tenant` (`id`, `businessName`, `taxId`, `createdAt`)
VALUES ('tenant-deploy-cross', 'Deploy Cross Tenant', 'DEPLOY-SMOKE-002', CURRENT_TIMESTAMP(3));

INSERT INTO `User` (`id`, `tenantId`, `password`, `name`, `createdAt`)
VALUES ('user-deploy-cross-tenant', 'tenant-deploy-cross', 'not-a-real-password', 'Otro Tenant', CURRENT_TIMESTAMP(3));

UPDATE `Warehouse`
SET `sellerId` = 'user-deploy-cross-tenant'
WHERE `id` = 'warehouse-deploy-1';
