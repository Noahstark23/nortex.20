-- Índice aditivo para listar evidencia actual de un turno con límite y orden estable.
-- El arranque sincroniza el schema mediante db push; este SQL documenta la expansión.
CREATE INDEX `CashMovement_tenantId_shiftId_createdAt_id_idx`
    ON `CashMovement` (`tenantId`, `shiftId`, `createdAt`, `id`);
