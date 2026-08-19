-- Fixture del schema anterior a #158: dos bodegas existentes con sellerId ausente.
INSERT INTO `Tenant` (`id`, `businessName`, `taxId`, `createdAt`)
VALUES ('tenant-deploy-smoke', 'Deploy Smoke', 'DEPLOY-SMOKE-001', CURRENT_TIMESTAMP(3));

INSERT INTO `User` (`id`, `tenantId`, `password`, `name`, `createdAt`)
VALUES ('user-deploy-smoke', 'tenant-deploy-smoke', 'not-a-real-password', 'Vendedor Smoke', CURRENT_TIMESTAMP(3));

INSERT INTO `Warehouse` (`id`, `tenantId`, `name`, `isDefault`, `isActive`, `createdAt`)
VALUES
    ('warehouse-deploy-1', 'tenant-deploy-smoke', 'Principal Smoke', TRUE, TRUE, CURRENT_TIMESTAMP(3)),
    ('warehouse-deploy-2', 'tenant-deploy-smoke', 'Carga Smoke', FALSE, TRUE, CURRENT_TIMESTAMP(3));
