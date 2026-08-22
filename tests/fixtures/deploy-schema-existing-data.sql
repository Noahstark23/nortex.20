-- Fixture del schema anterior a #158: dos bodegas existentes con sellerId ausente.
INSERT INTO `Tenant` (`id`, `businessName`, `taxId`, `createdAt`)
VALUES ('tenant-deploy-smoke', 'Deploy Smoke', 'DEPLOY-SMOKE-001', CURRENT_TIMESTAMP(3));

INSERT INTO `User` (`id`, `tenantId`, `password`, `name`, `createdAt`)
VALUES ('user-deploy-smoke', 'tenant-deploy-smoke', 'not-a-real-password', 'Vendedor Smoke', CURRENT_TIMESTAMP(3));

INSERT INTO `Warehouse` (`id`, `tenantId`, `name`, `isDefault`, `isActive`, `createdAt`)
VALUES
    ('warehouse-deploy-1', 'tenant-deploy-smoke', 'Principal Smoke', TRUE, TRUE, CURRENT_TIMESTAMP(3)),
    ('warehouse-deploy-2', 'tenant-deploy-smoke', 'Carga Smoke', FALSE, TRUE, CURRENT_TIMESTAMP(3));

-- Conteos anteriores al alcance por bodega. El upgrade debe conservarlos sin
-- inventar ubicación; esto es especialmente obligatorio para el OPEN legado.
INSERT INTO `StockCount` (`id`, `tenantId`, `status`, `scope`, `createdBy`, `createdAt`, `closedAt`, `closedBy`)
VALUES
    (
        'stock-count-deploy-closed',
        'tenant-deploy-smoke',
        'CLOSED',
        'ALL',
        'user-deploy-smoke',
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3),
        'user-deploy-smoke'
    ),
    (
        'stock-count-deploy-open',
        'tenant-deploy-smoke',
        'OPEN',
        'ALL',
        'user-deploy-smoke',
        CURRENT_TIMESTAMP(3),
        NULL,
        NULL
    );
