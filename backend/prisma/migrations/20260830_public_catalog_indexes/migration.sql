-- Catálogo público: filtra siempre por tenant/publicado y ordena por nombre;
-- la categoría es opcional. Ambos índices mantienen esas consultas acotadas
-- cuando un comercio acumula miles de productos e imágenes.
CREATE INDEX `Product_tenantId_isPublished_name_idx`
    ON `Product`(`tenantId`, `isPublished`, `name`);

CREATE INDEX `Product_tenantId_isPublished_category_name_idx`
    ON `Product`(`tenantId`, `isPublished`, `category`, `name`);
