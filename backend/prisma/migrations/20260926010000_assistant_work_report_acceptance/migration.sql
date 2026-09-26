-- Espejo aditivo para la aceptación exacta de un informe W01.
-- El arranque vigente sincroniza Prisma con db push; este archivo documenta el DDL.
ALTER TABLE `AssistantWorkItem`
  ADD COLUMN `acceptedAt` DATETIME(3) NULL,
  ADD COLUMN `acceptedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `acceptedReportHash` CHAR(64) NULL,
  ADD COLUMN `acceptedReportVersion` INTEGER NULL,
  ADD COLUMN `acceptedEventId` VARCHAR(36) NULL;
