# Plan de ejecución — Bodeguero Fase B (+ loop para terminar el Bodeguero)

Continuación del arco «Bodeguero Experto» (roadmap: `PLAN_BODEGUERO_EXPERTO.md`).
La Fase A («sin fricción», RF A1–A5) quedó en los PRs #44 (A1) y #45 (A2).
Esta es la **Fase B — cuadrar el inventario real** y el **loop** para cerrar
también la **Fase C — reposición inteligente**.

## Loop de trabajo (Loop Engineering)

Por cada RF: **implementar → verificar (`tsc --noEmit` = 0 + `vite build` OK +
`prisma validate` si hay esquema) → commit**. Al terminar B y C, una **pasada
de QA** sobre todo el arco del Bodeguero (igual que el loop de RRHH) y arreglar
lo que aparezca, iterando hasta converger.

## Fase B — «Cuadrar el inventario real»

### B1 · Toma física / conteo cíclico  *(la estrella)*
- **Esquema (aditivo):** `StockCount { tenantId, status OPEN|CLOSED|CANCELLED,
  scope ALL|CATEGORY, category?, notes?, createdBy, createdAt, closedAt?, closedBy? }`
  y `StockCountItem { countId, productId, expected, counted?, diff, countedAt? }`.
- **Flujo:** crear conteo (todo o por categoría) → **snapshot** del stock esperado
  por producto → capturar el conteo físico (con escáner) → al **cerrar**:
  - por cada ítem contado con `diff = counted − expected ≠ 0`, aplica el ajuste
    con `applyStockDelta` (sobre el stock **actual**, así respeta ventas/compras
    ocurridas entre captura y cierre) y deja el **Kardex** (`ADJUST_LOSS/GAIN`,
    `referenceType='STOCK_COUNT'`).
  - **asiento contable** de la merma/sobrante valuado al costo promedio:
    - merma (Σ pérdidas·costo): **Debe 5.1.2 Pérdida por Merma / Haber 1.1.4 Inventario**.
    - sobrante (Σ sobrantes·costo): **Debe 1.1.4 Inventario / Haber 4.1.3 Sobrantes**.
    - se netea 1.1.4 en una sola línea; Σdebe=Σhaber (lo valida `createJournalEntry`).
  - los ítems **no contados** se **omiten** (no se asume stock 0).
- **Cuentas nuevas** (5.1.2, 4.1.3) se agregan al catálogo auto-sanable y se
  siembran (`seedChartOfAccounts`) antes del cierre.
- **Endpoints:** `POST /api/stock-counts` (crea+snapshot), `GET /api/stock-counts`
  (historial), `GET /api/stock-counts/:id` (ítems para captura), `PATCH
  /api/stock-counts/:id/count` (registra un conteo por `productId` — apto escáner),
  `POST /api/stock-counts/:id/close` (postea ajustes+asiento), `POST
  /api/stock-counts/:id/cancel`.
- **UI:** componente `StockCount.tsx` + ruta `inventory-count` + nav. Captura rápida
  con escáner, resumen de diferencias y valor de la merma antes de cerrar.

### B2 · Punto de reorden + stock de seguridad
- **Esquema (aditivo):** Product `+ reorderPoint Float @default(0)`,
  `+ maxStock Float @default(0)`.
- Editable en el alta/edición de producto y en la edición masiva (A2).
- **Endpoint** `GET /api/inventory/reorder` que combina el reorden estático
  (`stock ≤ reorderPoint`) con el oráculo VPD existente → una sola vista
  «¿qué reponer?» con la cantidad sugerida (`maxStock − stock`).

### B3 · Cumplimiento de vencimiento
- **Avisar/bloquear** venta de lotes vencidos: en la venta con lotes, preferir
  FEFO y **excluir lotes vencidos** del consumo automático; alerta visible.
- Panel de próximos a vencer (reusa `/api/inventory/expiring-soon`) con acción
  rápida de **merma** (reusa el patrón de ajuste) para dar de baja lo vencido.

## Fase C — «Reposición inteligente»

- **C1 · Oráculo → orden de compra:** conectar `InventoryOracle` a la ruta
  `smart-purchases` (hoy cascarón) y generar una **orden de compra borrador
  agrupada por proveedor**, editable, que al confirmar crea la(s) `Purchase`
  (reusa el flujo ACID de `POST /api/purchases`).
- **C2 · Proveedor por producto:** Product `+ defaultSupplierId`; completar el
  CRUD de proveedores (PUT/DELETE) que falta. Lo usa C1 para agrupar/prellenar.
- **C3 · Etiquetas imprimibles** *(nice-to-have)*: etiquetas de precio/código.

## Lo que NO se hace
- Multi-bodega / ubicaciones / traslados (confirmado: una sola ubicación).

## Verificación por RF
- `prisma validate` (B1, B2, C2), `tsc --noEmit` → **0 errores**, `vite build` OK.
- B1: contar físico genera el ajuste correcto y el asiento de merma cuadra
  (Σdebe=Σhaber); los no contados no se tocan.
- B2: la vista de reorden lista lo que está en/bajo el punto de reorden.
- B3: un lote vencido no se consume en venta automática y se puede dar de baja.
- C1: del oráculo sale una orden por proveedor que al confirmar crea la Purchase.
