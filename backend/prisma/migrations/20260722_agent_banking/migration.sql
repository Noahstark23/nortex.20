-- Agente Bancario (corresponsalía no bancaria) — Fase A
-- El negocio (ferretería/pulpería/farmacia) opera como Agente Banpro / Rapibac /
-- ServiRED / Puntoxpress y Nortex registra en paralelo las operaciones para
-- cuadrar la caja. Estrictamente aditivo (el deploy usa `prisma db push`).
-- Ver docs/PLAN_AGENTE_BANCARIO.md.

-- CreateTable: AgentAgreement (convenio del negocio con un banco/red)
CREATE TABLE `AgentAgreement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'BANCO',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `commissionConfig` JSON NULL,
    `settlementBalance` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `commissionAccrued` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentAgreement_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: AgentTransaction (una operación de mostrador del agente)
CREATE TABLE `AgentTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `agreementId` VARCHAR(191) NOT NULL,
    `cashMovementId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NIO',
    `commission` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `externalRef` VARCHAR(191) NULL,
    `customerRef` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `reversedAt` DATETIME(3) NULL,
    `reversedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AgentTransaction_cashMovementId_key`(`cashMovementId`),
    INDEX `AgentTransaction_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AgentTransaction_agreementId_createdAt_idx`(`agreementId`, `createdAt`),
    INDEX `AgentTransaction_shiftId_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: AgentTransaction -> AgentAgreement
ALTER TABLE `AgentTransaction` ADD CONSTRAINT `AgentTransaction_agreementId_fkey` FOREIGN KEY (`agreementId`) REFERENCES `AgentAgreement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
