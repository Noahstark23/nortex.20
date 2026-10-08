-- Recuperación explícita del fixture adversarial. El índice queda ausente para
-- que dos entrypoints concurrentes deban converger desde este estado parcial.
-- Este SQL nunca corre en producción.
DELETE FROM `Payment`
WHERE `id` = 'payment-deploy-duplicate';

UPDATE `Payment`
SET `clientEventId` = NULL, `payloadHash` = NULL
WHERE `id` = 'payment-deploy-legacy';
