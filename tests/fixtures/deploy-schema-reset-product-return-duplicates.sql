-- Recuperación explícita del fixture adversarial para que las demás pruebas
-- partan otra vez de la fila histórica original. Este SQL nunca corre en prod.
DELETE FROM `ProductReturn`
WHERE `id` = 'product-return-deploy-duplicate';

UPDATE `ProductReturn`
SET `clientEventId` = NULL, `payloadHash` = NULL
WHERE `id` = 'product-return-deploy-legacy';
