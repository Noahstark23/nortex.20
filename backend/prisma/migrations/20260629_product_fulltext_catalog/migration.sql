-- Migration: índice FULLTEXT para la búsqueda de catálogo del agente de WhatsApp (RAG).
-- Habilita `MATCH(name, category) AGAINST(... IN BOOLEAN MODE)` con ranking por
-- relevancia, indexado (antes era un scan con LIKE '%term%' + re-rank en JS).
-- InnoDB/MySQL 8 soporta FULLTEXT nativamente. Cambio no destructivo.
-- El nombre del índice coincide con el que genera Prisma para @@fulltext([name, category]).
ALTER TABLE `Product` ADD FULLTEXT INDEX `Product_name_category_idx` (`name`, `category`);
