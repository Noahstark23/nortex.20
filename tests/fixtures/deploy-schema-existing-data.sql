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

-- Filas legadas representativas de las superficies que reciben columnas
-- nullable en la expansión de productos medidos. El upgrade debe conservar
-- sus valores originales y dejar toda metadata nueva en NULL.
INSERT INTO `Supplier` (`id`, `tenantId`, `name`, `createdAt`)
VALUES ('supplier-deploy-legacy', 'tenant-deploy-smoke', 'Proveedor histórico smoke', CURRENT_TIMESTAMP(3));

INSERT INTO `Product` (
    `id`, `tenantId`, `name`, `sku`, `price`, `cost`, `stock`, `minStock`, `unit`,
    `reorderPoint`, `maxStock`, `isPublished`, `ivaExento`,
    `requiresBatchTracking`, `requiresSerialTracking`,
    `createdAt`, `updatedAt`, `createdBy`
)
VALUES (
    'product-deploy-legacy', 'tenant-deploy-smoke', 'Producto histórico smoke',
    'DEPLOY-LEGACY-1', 5.00, 2.00, 7, 1, 'unidad', 1, 10, FALSE, FALSE,
    FALSE, FALSE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), 'user-deploy-smoke'
);

INSERT INTO `Purchase` (
    `id`, `tenantId`, `supplierId`, `invoiceNumber`, `date`, `subtotal`, `tax`,
    `total`, `status`, `paymentMethod`, `createdBy`, `createdAt`
)
VALUES (
    'purchase-deploy-legacy', 'tenant-deploy-smoke', 'supplier-deploy-legacy',
    'FAC-DEPLOY-1', CURRENT_TIMESTAMP(3), 6.00, 0.00, 6.00, 'COMPLETED',
    'CASH', 'user-deploy-smoke', CURRENT_TIMESTAMP(3)
);

INSERT INTO `PurchaseItem` (
    `id`, `purchaseId`, `productId`, `productName`, `quantity`, `unitCost`, `totalCost`
)
VALUES (
    'purchase-item-deploy-legacy', 'purchase-deploy-legacy', 'product-deploy-legacy',
    'Producto histórico smoke', 3, 2.00, 6.00
);

INSERT INTO `PurchaseOrder` (
    `id`, `tenantId`, `supplierId`, `orderNumber`, `status`, `createdBy`, `createdAt`, `updatedAt`
)
VALUES (
    'purchase-order-deploy-legacy', 'tenant-deploy-smoke', 'supplier-deploy-legacy',
    'OC-DEPLOY-1', 'DRAFT', 'user-deploy-smoke', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
);

INSERT INTO `PurchaseOrderItem` (
    `id`, `purchaseOrderId`, `productId`, `productName`, `quantityOrdered`,
    `quantityReceived`, `unitCost`
)
VALUES (
    'purchase-order-item-deploy-legacy', 'purchase-order-deploy-legacy',
    'product-deploy-legacy', 'Producto histórico smoke', 4, 1, 2.00
);

INSERT INTO `Sale` (
    `id`, `tenantId`, `total`, `status`, `paymentMethod`, `createdAt`, `globalDiscount`
)
VALUES (
    'sale-deploy-legacy', 'tenant-deploy-smoke', 10.0000, 'COMPLETED', 'CASH',
    CURRENT_TIMESTAMP(3), 0
);

INSERT INTO `SaleItem` (
    `id`, `saleId`, `productId`, `quantity`, `priceAtSale`, `costAtSale`, `discount`, `ivaExento`
)
VALUES (
    'sale-item-deploy-legacy', 'sale-deploy-legacy', 'product-deploy-legacy',
    2, 5.00, 2.00, 0, FALSE
);

INSERT INTO `ProductReturn` (
    `id`, `tenantId`, `saleId`, `total`, `reason`, `items`, `createdBy`, `createdAt`
)
VALUES (
    'product-return-deploy-legacy', 'tenant-deploy-smoke', 'sale-deploy-legacy',
    5.00, 'Devolución histórica smoke',
    JSON_ARRAY(JSON_OBJECT('productId', 'product-deploy-legacy', 'quantity', 1, 'price', 5)),
    'user-deploy-smoke', CURRENT_TIMESTAMP(3)
);

INSERT INTO `Quotation` (
    `id`, `tenantId`, `customerName`, `subtotal`, `tax`, `total`, `status`, `createdAt`, `expiresAt`
)
VALUES (
    'quotation-deploy-legacy', 'tenant-deploy-smoke', 'Cliente histórico smoke',
    10.00, 0.00, 10.00, 'SENT', CURRENT_TIMESTAMP(3), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
);

INSERT INTO `QuotationItem` (`id`, `quotationId`, `productId`, `quantity`, `price`, `name`)
VALUES (
    'quotation-item-deploy-legacy', 'quotation-deploy-legacy', 'product-deploy-legacy',
    2, 5.00, 'Producto histórico smoke'
);

INSERT INTO `Pedido` (
    `id`, `tenantId`, `clienteNombre`, `clienteTelefono`, `direccionEntrega`,
    `estado`, `total`, `costoEntrega`, `createdAt`
)
VALUES (
    'pedido-deploy-legacy', 'tenant-deploy-smoke', 'Cliente pedido smoke', '555-0101',
    'Dirección histórica smoke', 'pendiente', 10.00, 0.00, CURRENT_TIMESTAMP(3)
);

INSERT INTO `PedidoItem` (`id`, `pedidoId`, `productoId`, `cantidad`, `precioUnitario`, `subtotal`)
VALUES (
    'pedido-item-deploy-legacy', 'pedido-deploy-legacy', 'product-deploy-legacy', 2, 5.00, 10.00
);
