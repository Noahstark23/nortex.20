-- Fintech real: `Tenant.creditScore` pasa a NULLABLE para representar
-- "sin datos suficientes" (un tenant nuevo no tiene score hasta que el motor
-- lo calcula desde historial real). Cambio ADITIVO/widening (NOT NULL → NULL):
-- `db push` lo aplica sin tocar datos; las filas existentes conservan su valor.
ALTER TABLE `Tenant` MODIFY `creditScore` INT NULL;
