-- Vínculo aditivo entre el consumo de IA y la ejecución que lo originó.
-- Se escribe al crear la reserva, antes de llamar al proveedor, para que también
-- queden vinculados los fallos, los reinicios y los costos inciertos.
-- Columna nullable e índice nuevo: expansión pura, sin backfill ni pérdida de datos.
ALTER TABLE `AssistantUsage` ADD COLUMN `runId` VARCHAR(191) NULL;
CREATE INDEX `AssistantUsage_runId_idx` ON `AssistantUsage`(`runId`);
