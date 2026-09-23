-- Revisión de cierres: rango por fecha de cierre y estado, dentro del negocio.
CREATE INDEX `Shift_tenantId_status_endTime_idx` ON `Shift` (`tenantId`, `status`, `endTime`);
