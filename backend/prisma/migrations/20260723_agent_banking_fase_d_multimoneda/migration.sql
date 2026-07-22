-- Agente Bancario Fase D — gaveta multi-moneda (USD con tipo de cambio real).
-- Estrictamente aditivo. Ver docs/PLAN_AGENTE_BANCARIO.md.

-- AlterTable: conteo físico de dólares por turno, separado del de córdobas
ALTER TABLE `Shift` ADD COLUMN `initialCashUsd` DECIMAL(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE `Shift` ADD COLUMN `finalCashDeclaredUsd` DECIMAL(18, 4) NULL;
ALTER TABLE `Shift` ADD COLUMN `systemExpectedUsd` DECIMAL(18, 4) NULL;
ALTER TABLE `Shift` ADD COLUMN `differenceUsd` DECIMAL(18, 4) NULL;

-- AlterTable: tipo de cambio y valor contable en C$ de la operación de agente
ALTER TABLE `AgentTransaction` ADD COLUMN `exchangeRate` DECIMAL(12, 6) NULL;
ALTER TABLE `AgentTransaction` ADD COLUMN `amountNio` DECIMAL(18, 4) NULL;
