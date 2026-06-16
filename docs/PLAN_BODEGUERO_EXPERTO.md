# Nortex — Plan «Bodeguero Experto»

> Objetivo: que gestionar productos en Nortex sea **fácil y rápido**, y que el negocio
> tenga **control real de sus existencias** — del mostrador a la bodega.
> Auditoría realizada sobre `main` (Inventory.tsx, POS.tsx, stockService.ts, ProductImporter.tsx,
> InventoryOracle.tsx y ~15 endpoints de productos/inventario/kardex/compras).
> Alcance confirmado: **una sola ubicación** (sin multi-bodega).

---

## 1 · Lo que Nortex YA hace bien (no tocar, capitalizar)

| Capacidad | Evidencia |
|---|---|
| **Productos** con SKU, precio, costo, stock, mínimo, unidad, imagen, publicación al catálogo | `Product` + CRUD |
| **Escáner de código de barras** (buffer por velocidad de tecleo) en Inventario y POS | `Inventory.tsx`, `POS.tsx` |
| **Kardex inmutable** (auditoría de cada movimiento) + **ajustes con justificación obligatoria** | `GET /api/kardex/:id`, `POST /api/inventory/adjust` (Kardex + AuditLog) |
| **Costo promedio ponderado** recalculado en cada compra | `server.ts` (compra) |
| **Lotes y vencimientos** (FEFO best-effort) + alerta de próximos a vencer | `ProductBatch`, `sync.ts`, `/api/inventory/expiring-soon` |
| **Valuación de inventario** (existencias × costo) | `GET /api/reports/inventory` |
| **Importación masiva** CSV/Excel (hasta 500 SKU, upsert por SKU) | `POST /api/products/bulk`, `ProductImporter.tsx` |
| **Oráculo de bajo stock** (venta diaria promedio 30 días → días restantes → sugerido) + financiamiento Nortex Capital | `GET /api/inventory/oracle`, `/api/capital/finance-purchase` |
| **Decremento de stock atómico** (row-lock, inmune a carreras) | `stockService.ts → applyStockDelta` |

## 2 · Las debilidades (lo que el bodeguero sufre el día 1)

**El veredicto:** el motor está; la **experiencia** y el **control** no. Tres frentes:

| # | Hueco | Por qué duele |
|---|---|---|
| F1 | **Lista sin paginación, orden ni filtros** | Con cientos/miles de SKU la pantalla se arrastra; no se puede "mostrame solo lo que está bajo" ni ordenar por stock/precio. Hay que buscar a ciegas. |
| F2 | **Sin exportar a Excel** | Se puede importar pero no exportar el inventario actual (para cuadrar, compartir, respaldar). |
| F3 | **Edición masiva mínima** | Solo "publicar/despublicar" en lote; no cambiar precio/costo/categoría ni ajustar stock de varios a la vez. |
| F4 | **Lotes/vencimientos solo lectura** | No hay forma de **registrar** un lote con su vencimiento desde la UI (solo al comprar); el bodeguero que recibe mercadería no puede capturarlo. |
| F5 | **Kardex sin paginar ni filtrar por fecha** (tope 50) | No se puede revisar el historial de un producto por período. |
| C1 | **No hay toma física / conteo cíclico** | El trabajo central del bodeguero —contar y cuadrar el físico contra el sistema— se hace ajuste por ajuste, a mano. |
| C2 | **Sin punto de reorden ni stock de seguridad** | Solo existe el mínimo y el oráculo dinámico; falta el umbral estático de reposición. |
| C3 | **Vencimiento no se hace cumplir** | FEFO es sugerencia; nada bloquea/avisa vender un lote vencido. |
| R1 | **Compras inteligentes es un cascarón** | `/app/smart-purchases` dice "en construcción"; el oráculo existe pero "Orden Manual" no hace nada → no se puede generar la orden de compra. |
| R2 | **Proveedor no ligado al producto** | No hay proveedor por defecto por SKU; reponer obliga a elegir proveedor a mano. (Y faltan PUT/DELETE de proveedores.) |

## 3 · El plan — 3 fases

### FASE A — «El bodeguero sin fricción» · que sea fácil
*Lo que el usuario pidió literal. Es la base de todo lo demás.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **A1** | **Lista paginada + orden + filtros** | `GET /api/products` con `page/search/category/status(low/out/published)/sort`. UI: paginación server-side, encabezados ordenables, panel de filtros. Reusa los badges de estado existentes. |
| **A2** | **Edición masiva real** | Sobre el toolbar de selección que ya existe: cambiar precio/costo/categoría y **ajustar stock** en lote (con razón → Kardex). `PATCH /api/products/bulk-edit`. |
| **A3** | **Exportar a Excel** | Botón "Descargar Excel" de la vista filtrada (XLSX ya es dependencia). |
| **A4** | **Alta de lotes y vencimientos** | `POST /api/inventory/batches` (crea lote + suma stock vía `applyStockDelta` + Kardex). Botón "Agregar lote" + columnas opcionales en la plantilla de importación. |
| **A5** | **Kardex paginado + filtro por fecha** | Rango de fechas + paginación; export del Kardex. |

### FASE B — «Cuadrar el inventario real» · control de existencias
*El corazón del oficio de bodeguero.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **B1** | **Toma física / conteo cíclico** 🌟 | Modelos `StockCount` + `StockCountItem`. Flujo: crear conteo (todo o por filtro) → snapshot del esperado → capturar el conteo físico (con escáner) → calcular diferencias → al cerrar, postear los ajustes en Kardex y el **asiento contable** de la merma/sobrante (`createJournalEntry`: Debe gasto / Haber Inventario 1.1.4, o a la inversa). |
| **B2** | **Punto de reorden + stock de seguridad** | Aditivo a `Product`: `reorderPoint`, `maxStock`. Vista "¿qué reponer?" que junta el reorden estático con el oráculo VPD. |
| **B3** | **Cumplimiento de vencimiento** | Bloquear/avisar venta de lotes vencidos; panel de próximos a vencer con acción (rebaja/merma). |

### FASE C — «Reposición inteligente» · qué comprar y cuándo
*De controlar a reponer solo.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **C1** | **Oráculo → orden de compra** | Conectar `InventoryOracle` a `/app/smart-purchases` y que "Orden Manual" **genere una orden de compra borrador agrupada por proveedor**, editable, que al confirmar crea la(s) `Purchase` (reusa el flujo ACID de compras). Cierra el ciclo. |
| **C2** | **Proveedor por producto** | Aditivo a `Product`: `defaultSupplierId` + último costo/lead time; lo usa C1. Completar CRUD de proveedores. |
| **C3** | **Etiquetas imprimibles** | (nice-to-have) Etiquetas de precio/código de barras para imprimir. |

## 4 · Priorización
```
A (fácil, base) ──→ B1 (toma física, usa A) ──→ C1 (reposición, usa B2+C2)
```
- **Empezar por la Fase A**: es lo que el usuario pidió ("que sea más fácil") y la base operativa.
- **B1 (toma física)** es la pieza estrella: el trabajo central del bodeguero hoy no existe.
- Todo cambio de esquema es **aditivo** (`prisma db push` en deploy). Los ajustes de la toma física
  pasan por el patrón ya probado de `/api/inventory/adjust` (Kardex + AuditLog) y la merma por
  `createJournalEntry` → hereda el lock de períodos y el libro firmado.

## 5 · Fuera de alcance
- **Multi-bodega / ubicaciones / traslados**: confirmado una sola ubicación. Queda como fase futura.

---

*Plan generado a partir de auditoría del código en `main`. Capitaliza el motor existente
(stock atómico, kardex, costo promedio, lotes, oráculo) y se enfoca en la experiencia y el control.*
