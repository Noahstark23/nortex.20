-- Estado adversarial: dos abonos de la misma venta reclaman el mismo evento
-- no-null. El preflight debe abortar sin corregir montos, metadata ni filas.
ALTER TABLE `Payment`
    DROP INDEX `Payment_saleId_clientEventId_key`;

INSERT INTO `Payment` (
    `id`, `saleId`, `amount`, `method`, `collectedBy`,
    `clientEventId`, `payloadHash`, `createdAt`
)
VALUES (
    'payment-deploy-duplicate', 'sale-deploy-legacy', 1.75, 'CASH',
    'user-deploy-smoke', 'payment-event-deploy-duplicate', NULL,
    CURRENT_TIMESTAMP(3)
);

UPDATE `Payment`
SET `clientEventId` = 'payment-event-deploy-duplicate', `payloadHash` = NULL
WHERE `id` = 'payment-deploy-legacy';
