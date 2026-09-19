# Modularidad de la reparación de bodega

La base es la copia inicial del checkout con los cambios previos del usuario; no es HEAD. Conteo de líneas físicas, incluyendo comentarios. Los módulos extraídos se contabilizan completos; no se subieron presupuestos.

## Extracciones de monolitos

| Origen y destinos | Base | Candidato | Delta |
|---|---:|---:|---:|
| `backend/server.ts` | 14266 | 13518 | -748 |
| `backend/services/productImportService.ts` | 0 | 193 | +193 |
| `backend/services/productDeletionService.ts` | 0 | 26 | +26 |
| `backend/services/inventoryAdjustmentService.ts` | 0 | 173 | +173 |
| `backend/routes/inventoryAdjustments.ts` | 0 | 31 | +31 |
| `backend/services/inventoryReorderService.ts` | 0 | 99 | +99 |
| `backend/routes/inventoryReorder.ts` | 0 | 22 | +22 |
| `backend/services/shiftHandoverService.ts` | 0 | 59 | +59 |
| `backend/services/stockCountClosingSnapshot.ts` | 0 | 39 | +39 |
| `backend/services/warehouseTopologyService.ts` | 0 | 69 | +69 |
| **Subtotal origen y destinos** | **14266** | **14229** | **-37** |
| `components/POS.tsx` | 6892 | 6882 | -10 |

El trinquete del backend baja de 14,266 a 13,518 y el del POS de 6,892 a 6,882. El helper de importación compartido ya existía; su modificación completa está incluida en la tabla siguiente, sin atribuir todo su crecimiento al POS.

## Todos los archivos de producto afectados

Esta suma incluye funcionalidad añadida, recuperación de errores, formularios, reglas, schema y migración. No describe una reducción global: el incremento neto es explícito. Pruebas, documentación y configuración de QA se informan por separado en el manifiesto.

| Archivo | Base | Candidato | Delta |
|---|---:|---:|---:|
| `backend/prisma/migrations/20260912_stock_count_capture_book/migration.sql` | 0 | 2 | +2 |
| `backend/prisma/schema.prisma` | 3637 | 3639 | +2 |
| `backend/routes/inventoryAdjustments.ts` | 0 | 31 | +31 |
| `backend/routes/inventoryReorder.ts` | 0 | 22 | +22 |
| `backend/routes/warehouses.ts` | 255 | 246 | -9 |
| `backend/server.ts` | 14266 | 13518 | -748 |
| `backend/services/inventoryAdjustmentService.ts` | 0 | 173 | +173 |
| `backend/services/inventoryReorderService.ts` | 0 | 99 | +99 |
| `backend/services/productDeletionService.ts` | 0 | 26 | +26 |
| `backend/services/productImportService.ts` | 0 | 193 | +193 |
| `backend/services/publicOrderItemService.ts` | 411 | 411 | +0 |
| `backend/services/purchaseRegistrationPreparation.ts` | 284 | 305 | +21 |
| `backend/services/purchaseRegistrationService.ts` | 475 | 477 | +2 |
| `backend/services/saleItemMeasurementService.ts` | 891 | 894 | +3 |
| `backend/services/shiftHandoverService.ts` | 0 | 59 | +59 |
| `backend/services/stockCountClosingSnapshot.ts` | 0 | 39 | +39 |
| `backend/services/stockService.ts` | 395 | 406 | +11 |
| `backend/services/stockTransferService.ts` | 890 | 891 | +1 |
| `backend/services/warehouseTopologyService.ts` | 0 | 69 | +69 |
| `backend/validation/schemas.ts` | 1104 | 1106 | +2 |
| `components/Inventory.tsx` | 3478 | 3635 | +157 |
| `components/Layout.tsx` | 632 | 632 | +0 |
| `components/POS.tsx` | 6892 | 6882 | -10 |
| `components/ProductImporter.tsx` | 619 | 705 | +86 |
| `components/PublicCatalog.tsx` | 1249 | 1243 | -6 |
| `components/PurchaseOrders.tsx` | 1515 | 1579 | +64 |
| `components/Purchases.tsx` | 2809 | 2873 | +64 |
| `components/QuickAddProduct.tsx` | 521 | 310 | -211 |
| `components/SmartPurchases.tsx` | 377 | 467 | +90 |
| `components/StockCount.tsx` | 1021 | 1116 | +95 |
| `components/Warehouses.tsx` | 901 | 938 | +37 |
| `components/ui/InventoryTabs.tsx` | 54 | 62 | +8 |
| `utils/bodegaReceivingDraft.ts` | 0 | 44 | +44 |
| `utils/bodegaReceivingInput.ts` | 0 | 16 | +16 |
| `utils/importProducts.ts` | 497 | 556 | +59 |
| `utils/inventoryAdjustmentAttempt.ts` | 0 | 95 | +95 |
| `utils/navigation.ts` | 330 | 329 | -1 |
| `utils/posActivation.ts` | 233 | 218 | -15 |
| `utils/productForm.ts` | 122 | 128 | +6 |
| `utils/productQuantityRules.ts` | 0 | 30 | +30 |
| `utils/purchaseOrderQuantities.ts` | 396 | 394 | -2 |
| `utils/purchasePackaging.ts` | 148 | 141 | -7 |
| `utils/stockTransferQuantity.ts` | 21 | 15 | -6 |
| **Total 43 archivos** | **44423** | **45014** | **+591** |
