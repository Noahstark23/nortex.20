-- B1 (docs/SCALING_AUDIT.md): índices compuestos para las tablas de negocio
-- más grandes y calientes. Cambio ESTRICTAMENTE ADITIVO (solo CREATE INDEX):
-- `db push` lo aplica como DDL en el arranque sin tocar datos.
-- Nombres según la convención de Prisma: `Tabla_campoA_campoB_idx`.

-- Sale: reportes/libros DGI (tenant+fecha) y cobranza (tenant+método+saldo).
CREATE INDEX `Sale_tenantId_createdAt_idx` ON `Sale`(`tenantId`, `createdAt`);
CREATE INDEX `Sale_tenantId_paymentMethod_balance_idx` ON `Sale`(`tenantId`, `paymentMethod`, `balance`);

-- AuditLog: la tabla que más rápido crece; bitácora por tenant+fecha y por acción.
CREATE INDEX `AuditLog_tenantId_createdAt_idx` ON `AuditLog`(`tenantId`, `createdAt`);
CREATE INDEX `AuditLog_tenantId_action_createdAt_idx` ON `AuditLog`(`tenantId`, `action`, `createdAt`);

-- KardexMovement: mermas/reportes (tenant+tipo+fecha) e historial por producto.
CREATE INDEX `KardexMovement_tenantId_type_date_idx` ON `KardexMovement`(`tenantId`, `type`, `date`);
CREATE INDEX `KardexMovement_tenantId_productId_date_idx` ON `KardexMovement`(`tenantId`, `productId`, `date`);

-- Expense: reportes de gastos por período.
CREATE INDEX `Expense_tenantId_createdAt_idx` ON `Expense`(`tenantId`, `createdAt`);

-- Purchase: libros de compras DGI por tenant+fecha de factura.
CREATE INDEX `Purchase_tenantId_date_idx` ON `Purchase`(`tenantId`, `date`);

-- Payment: agregado de cobros del día (el tenant viene por el join a Sale).
CREATE INDEX `Payment_createdAt_idx` ON `Payment`(`createdAt`);

-- StockTransfer: el listado ordena por tenant + createdAt desc.
CREATE INDEX `StockTransfer_tenantId_createdAt_idx` ON `StockTransfer`(`tenantId`, `createdAt`);
