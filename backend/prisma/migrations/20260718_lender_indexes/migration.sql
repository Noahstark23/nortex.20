-- Fase 0 blindaje del módulo Prestamista: índices para evitar table-scan en la
-- cartera y los cobros. Aditivo (solo CREATE INDEX) → seguro con `db push`.

CREATE INDEX `Loan_lenderId_createdAt_idx` ON `Loan`(`lenderId`, `createdAt`);
CREATE INDEX `Loan_lenderId_status_idx`    ON `Loan`(`lenderId`, `status`);
CREATE INDEX `Loan_assignedToId_idx`       ON `Loan`(`assignedToId`);
CREATE INDEX `Repayment_loanId_paymentDate_idx` ON `Repayment`(`loanId`, `paymentDate`);
