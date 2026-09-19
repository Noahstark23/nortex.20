-- Preserva conteos anteriores sin inventar el saldo de su captura.
ALTER TABLE `StockCountItem` ADD COLUMN `bookStockAtCapture` DECIMAL(18,4) NULL;
