-- Reintentos seguros de retenciones sufridas.
-- Expand-only para MySQL 8: las filas históricas quedan NULL y se conservan.

ALTER TABLE `RetencionSufrida`
  ADD COLUMN `clientEventId` VARCHAR(128) NULL,
  ADD COLUMN `payloadHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `RetencionSufrida_tenantId_clientEventId_key`
  ON `RetencionSufrida`(`tenantId`, `clientEventId`);
