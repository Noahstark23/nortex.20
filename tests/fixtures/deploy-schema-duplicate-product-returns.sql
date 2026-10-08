-- Estado adversarial: dos devoluciones del mismo tenant reclaman el mismo
-- evento no-null. El preflight debe abortar sin corregir ni borrar filas.
ALTER TABLE `ProductReturn`
    DROP INDEX `ProductReturn_tenantId_clientEventId_key`;

INSERT INTO `ProductReturn` (
    `id`, `tenantId`, `saleId`, `total`, `reason`, `items`, `createdBy`,
    `clientEventId`, `payloadHash`, `createdAt`
)
VALUES (
    'product-return-deploy-duplicate', 'tenant-deploy-smoke', 'sale-deploy-legacy',
    5.00, 'Devolución duplicada adversarial',
    JSON_ARRAY(JSON_OBJECT('productId', 'product-deploy-legacy', 'quantity', 1, 'price', 5)),
    'user-deploy-smoke', 'return-event-deploy-duplicate', NULL, CURRENT_TIMESTAMP(3)
);

UPDATE `ProductReturn`
SET `clientEventId` = 'return-event-deploy-duplicate', `payloadHash` = NULL
WHERE `id` = 'product-return-deploy-legacy';
