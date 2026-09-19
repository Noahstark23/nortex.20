-- PR-01: cierre legado y contabilizacion idempotentes.
--
-- Los campos de idempotencia son nullable para no reinterpretar historicos.
-- MySQL permite multiples NULL en los indices UNIQUE compuestos, por lo que los
-- turnos y asientos existentes permanecen validos.

ALTER TABLE `Shift`
  ADD COLUMN `closeEventId` VARCHAR(128) NULL,
  ADD COLUMN `closePayloadHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Shift_tenantId_closeEventId_key`
  ON `Shift`(`tenantId`, `closeEventId`);

ALTER TABLE `JournalEntry`
  ADD COLUMN `economicDate` DATETIME(3) NULL,
  ADD COLUMN `postedAt` DATETIME(3) NULL,
  ADD COLUMN `entryKind` VARCHAR(32) NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN `postingKey` VARCHAR(191) NULL,
  ADD COLUMN `payloadHash` VARCHAR(64) NULL,
  ADD COLUMN `reversalOfId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `JournalEntry_tenantId_postingKey_key`
  ON `JournalEntry`(`tenantId`, `postingKey`);

CREATE UNIQUE INDEX `JournalEntry_reversalOfId_key`
  ON `JournalEntry`(`reversalOfId`);

ALTER TABLE `JournalEntry`
  ADD CONSTRAINT `JournalEntry_reversalOfId_fkey`
    FOREIGN KEY (`reversalOfId`) REFERENCES `JournalEntry`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Widening exacto: conserva todos los valores DECIMAL(14,2) y habilita cuatro
-- decimales. scripts/deploy-schema-preflight.ts valida el contrato anterior o
-- final y rechaza cualquier forma inesperada antes de que db push lo aplique.
ALTER TABLE `Account`
  MODIFY COLUMN `balance` DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE `JournalLine`
  MODIFY COLUMN `debit` DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY COLUMN `credit` DECIMAL(18,4) NOT NULL DEFAULT 0;
