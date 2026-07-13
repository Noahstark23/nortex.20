-- Scaling A3 (issue #79): índices compuestos en tablas calientes. Los reportes,
-- dashboards y listados filtran por tenant y ordenan por fecha — sin el composite,
-- MySQL escanea el índice simple de tenant y ordena en memoria. Aditivo; db push.
CREATE INDEX `Sale_tenantId_createdAt_idx` ON `Sale`(`tenantId`, `createdAt`);
CREATE INDEX `KardexMovement_tenantId_date_idx` ON `KardexMovement`(`tenantId`, `date`);
CREATE INDEX `AuditLog_tenantId_createdAt_idx` ON `AuditLog`(`tenantId`, `createdAt`);
CREATE INDEX `Expense_tenantId_createdAt_idx` ON `Expense`(`tenantId`, `createdAt`);
CREATE INDEX `Purchase_tenantId_createdAt_idx` ON `Purchase`(`tenantId`, `createdAt`);
