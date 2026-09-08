-- AlterTable
ALTER TABLE `AssistantConversation` ADD COLUMN `metadata` JSON NULL,
    ADD COLUMN `stateVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `AssistantJob` ADD COLUMN `intakeContext` JSON NULL;

-- AlterTable
ALTER TABLE `AssistantProposal` ADD COLUMN `source` JSON NULL;
