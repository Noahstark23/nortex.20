-- Agente Bancario Fase C — límites y alertas de gaveta. Estrictamente aditivo.
-- Ver docs/PLAN_AGENTE_BANCARIO.md.

-- AlterTable: límites por operación del convenio (contrato con el banco/red)
ALTER TABLE `AgentAgreement` ADD COLUMN `limitsConfig` JSON NULL;

-- AlterTable: umbrales de alerta de gaveta por tenant (nullable = sin alerta)
ALTER TABLE `Tenant` ADD COLUMN `agentCashMin` DECIMAL(18, 4) NULL;
ALTER TABLE `Tenant` ADD COLUMN `agentCashMax` DECIMAL(18, 4) NULL;
