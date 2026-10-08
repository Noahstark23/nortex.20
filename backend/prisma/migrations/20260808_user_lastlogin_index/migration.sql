-- Retención (P0-B): índice para escanear usuarios activos por recencia de login
-- (métricas de retención del admin + detección de dormancia). Aditivo (solo
-- CREATE INDEX) → seguro con `db push`, con backticks MySQL.

CREATE INDEX `User_lastLogin_idx` ON `User`(`lastLogin`);
