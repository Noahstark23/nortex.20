# Plan — Comercios híbridos: carnes, pollo y agropecuaria

> Objetivo: que una misma empresa pueda facturar cuadernos, carne por libra,
> pollo por peso, concentrado por libra o saco, insumos agrícolas y productos
> veterinarios sin crear un POS distinto para cada giro.
>
> Decisión central: **no crear otra facturación**. Nortex ya tiene un motor de
> venta, inventario, mayoreo, empaque, lotes e IVA por producto. El trabajo es
> hacer que las **cantidades, unidades y presentaciones sean consistentes de
> punta a punta**, y que el registro acepte negocios híbridos.
>
> Diseño específico de hardware y códigos:
> [`PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md`](./PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md).

---

## 1. Problema que se debe resolver

Hay tres casos distintos que deben convivir en el mismo diseño:

1. **Miscelánea híbrida:** vende productos contables por unidad y también carne,
   pollo u otros perecederos por libra/kilogramo.
2. **Tienda agropecuaria:** vende alimento animal e insumos por unidad, libra,
   kilogramo, litro, quintal o saco; algunos artículos usan lote, vencimiento,
   mayoreo o empaque completo.
3. **Carnicería/pollería con balanza digital:** pesa, imprime etiqueta o entrega
   un código que el cajero debe pasar directo al POS sin reescribir el peso a mano.

Ejemplo de la misma factura:

| Producto | Forma de venta | Línea esperada |
|---|---|---|
| Cuaderno | unidad | `2 und × C$ 35.00` |
| Pollo entero | peso | `1.25 lb × C$ 48.00/lb` |
| Concentrado | peso | `3.50 lb × C$ 18.00/lb` |
| Concentrado | saco | `1 saco (100 lb) × C$ 1,650.00` |

El sistema debe descontar siempre la **unidad base** correcta y dejar una
factura entendible para el cliente.

---

## 2. Diagnóstico confirmado en el código actual

### Lo que ya se puede reutilizar

| Capacidad | Estado actual |
|---|---|
| Stock fraccionario | `Product.stock`, Kardex, lotes y stock por bodega ya usan `Float`. |
| Venta fraccionaria | `SaleItem.quantity` usa `Float`; `executeSale` acepta cualquier cantidad positiva. |
| POS | El carrito acepta entrada decimal y botones de ±0.5. |
| Mayoreo y empaque | Ya existen `wholesalePrice`, `wholesaleMinQty`, `packUnit`, `packSize` y `packPrice`. |
| Fiscalidad | `ivaExento` vive en el producto y `SaleItem` guarda la foto fiscal de la venta. |
| Lotes/vencimientos | Ya existen `ProductBatch`, compras con lote y alertas de vencimiento. |
| Auditoría | Los movimientos pasan por stock atómico + Kardex. |

### Lo que hoy rompe el caso real

| Hueco | Evidencia / impacto |
|---|---|
| Cantidades inconsistentes | Compras, devoluciones, ajustes y alta de lotes todavía validan enteros en `backend/validation/schemas.ts`. |
| Fracciones truncadas | Inventario, POS rápido, Quick Add y Compras todavía contienen `parseInt` para stock/cantidad. |
| Unidad forzada | El alta rápida crea productos como `unidad`; el selector completo no incluye libra, quintal, saco, ml, galón, etc. |
| POS genérico | Al tocar un producto siempre agrega 1; para carne debería pedir primero el peso. |
| Escáner solo “teclado” | El POS actual escucha teclas rápidas + Enter y busca `sku`; sirve para lector wedge, pero no interpreta todavía códigos de balanza con peso/precio embebido ni decide si debe abrir una línea medida. |
| Factura ambigua | Ticket, A4, WhatsApp y ESC/POS imprimen cantidad, pero no unidad ni precio por unidad. |
| Compra por saco mal modelada | El negocio puede definir un empaque, pero Compras no deja capturar “2 sacos de 100 lb” y convertirlos a 200 lb de stock. |
| FEFO dividido | El camino principal de venta baja el stock total, pero no consume los lotes; el sync offline tiene otra lógica. |
| Contratos de venta duplicados | `/api/sales`, `salesService.ts` y `routes/sync.ts` no comparten hoy un único contrato de cantidad/unidad/snapshot; si la venta medida se corrige en un canal y no en otro, el comportamiento divergirá. |
| Giro único | Registro, onboarding y catálogo semilla dependen de un solo `Tenant.type`; no representan “miscelánea + carnes”. |
| Historial incompleto | `SaleItem` no guarda nombre ni unidad como snapshot, por lo que una reimpresión histórica puede perder el significado original. |
| Precisión pendiente | Precio/costo y varias cantidades siguen en `Float`; el riesgo crece al multiplicar precios por pesos fraccionarios. |
| App móvil sin puente nativo aún | La app Android actual envuelve la web remota por `server.url`; hoy no hay plugin/permiso de Bluetooth, serial o USB para hablar directo con balanzas desde el shell móvil. |

**Conclusión:** agregar únicamente las categorías “Carnes” o “Agroinsumos”
haría que el producto aparezca en pantalla, pero no resolvería compras, lotes,
devoluciones, Kardex ni factura.

---

## 3. Decisiones de diseño

### D1. Un solo motor de venta

Carnicería, miscelánea y agropecuaria usan `executeSale`, `applyStockDelta`,
Kardex, caja y correlativo fiscal existentes. No se duplica el POS ni la factura.

### D2. El comportamiento vive en el producto

La categoría visual no debe decidir si un producto admite fracciones, lleva IVA
o requiere lote. Cada SKU tendrá configuración explícita:

- `saleMode`: `COUNTED` o `MEASURED`.
- `unit`: unidad base (`unidad`, `lb`, `kg`, `litro`, `ml`, `metro`, etc.).
- `quantityStep`: menor cantidad permitida (`1`, `0.5`, `0.01`, `0.001`).
- `productFamily`: clasificación comercial para presets y reportes
  (`GENERAL`, `MEAT`, `POULTRY`, `ANIMAL_FEED`, `AGRO_INPUT`, `VETERINARY`).
- `ivaExento`, `requiresBatchTracking`, mayoreo y empaque: se reutilizan.

No se necesita un booleano adicional `allowFractions`: se deriva de
`saleMode` + `quantityStep`.

### D3. La unidad base es el invariante de inventario

Todo stock, costo y Kardex se expresan en la unidad base del producto.

Ejemplo para concentrado:

- unidad base: `lb`;
- `packUnit`: `saco`;
- `packSize`: `100`;
- compra de 2 sacos: entra `200 lb`;
- venta de 3.5 lb: salen `3.5 lb`;
- venta de 1 saco: salen `100 lb`.

El servidor, usando el `packSize` guardado en el producto, hace la conversión.
Nunca debe confiar en un factor enviado por el navegador.

`SaleItem.quantity` representa la cantidad que salió del stock en unidad base.
Para que la factura pueda decir `1 saco` en vez de `100 lb`, la línea también
guarda la foto de la presentación elegida (`BASE` o `PACK`), su cantidad visible
y su unidad. Si se venden 1 saco y 3.5 lb del mismo SKU, son dos líneas de precio
distintas que descuentan en total 103.5 lb; no se aplica el precio del saco a las
3.5 lb sueltas por alcanzar un umbral.

### D4. Giro principal + capacidades combinables

Se conserva `Tenant.type` por compatibilidad y segmentación, pero las variaciones
reales se modelan como capacidades:

- `CARNES_AVES`
- `ALIMENTO_ANIMAL`
- `AGROINSUMOS`
- `PERECEDEROS`
- `MAYOREO`

El registro puede ofrecer `AGROPECUARIA` y `CARNICERIA_POLLERIA` como giros
principales, pero **ninguna función operativa se habilita por ese enum**. Una
`MISCELANEA` puede activar `CARNES_AVES` y operar exactamente igual.

### D5. La familia comercial no decide impuestos

Nortex no debe marcar automáticamente carne, alimento animal o insumos como
gravados/exentos por el nombre o la categoría. En el MVP se conserva
`ivaExento`, elegido por el dueño/contador. Cualquier tabla automática futura
requiere una matriz fiscal validada y versionada.

### D6. Compatibilidad aditiva

Todos los campos nuevos nacen nullable o con defaults que preserven negocios
actuales. Los productos históricos conservan el comportamiento fraccionario
actual hasta que el dueño los clasifique; no se impondrá paso `1` por sorpresa.

### D7. Requisitos no funcionales

- **Integridad:** venta, stock, lote, Kardex y auditoría se confirman en una sola
  transacción. El asiento contable se guarda en esa transacción o deja un
  marcador durable para reconciliación; nunca puede fallar en silencio.
- **Precisión:** cantidades con hasta 4 decimales y dinero con `Decimal.js` /
  `Decimal(18,4)` en los campos nuevos.
- **Aislamiento:** todo lookup y mutación usa `tenantId` derivado del JWT.
- **Compatibilidad:** productos y ventas antiguas siguen legibles; ningún deploy
  requiere `--accept-data-loss`.
- **Mostrador:** agregar/pesar un producto no agrega viajes de red antes del
  cobro; la validación autoritativa ocurre al confirmar.
- **Offline:** misma idempotencia y reglas de cantidad/precio que online.
- **Escalabilidad:** listados paginados e índices compuestos con cada query nueva; sin
  sembrar catálogos durante un `GET`.

### D8. Etiqueta primero, hardware después

El plan debe separar dos integraciones que parecen iguales pero no lo son:

- **Ruta 1: etiqueta/código de balanza.** Es la primera prioridad porque se acopla
  mejor al POS actual: el lector ya entra como teclado y el cajero ya escanea.
- **Ruta 2: conexión directa a balanza.** Queda para una fase posterior porque
  depende de marca, protocolo, permisos y plataforma (USB, serial, Bluetooth,
  BLE o red local).

La regla operativa es:

- si la balanza imprime una etiqueta estándar o configurable, Nortex debe poder
  leerla, resolver el SKU base, extraer peso/precio si aplica y crear la línea
  medida sin redigitar;
- si el negocio exige lectura en vivo desde la balanza, esa integración se hace
  solo después de validar el hardware dominante del piloto.

### D9. Parser configurable y trazabilidad de origen

Nortex no debe asumir un solo layout de etiqueta. El parser de balanza debe ser
configurable por perfil y guardar evidencia suficiente para soporte/auditoría.

Cada regla de parser debe definir, como mínimo:

- prefijo o familia de prefijos admitidos;
- longitud del código;
- posición y tamaño del identificador del producto;
- posición y tamaño del valor variable;
- semántica del valor variable: `WEIGHT`, `TOTAL_PRICE`, `COUNT`;
- decimales implícitos;
- checksum o validación equivalente si el formato lo permite.

Cada línea medida debe conservar:

- origen: `MANUAL`, `SCALE_LABEL`, `LIVE_SCALE`;
- versión de perfil/dispositivo y valor/unidad capturados;
- identificador único cuando el formato lo incluya o hash acotado del payload;
- decisión de precio: recalculado, validado o aceptado desde origen.

El código completo se usa para que el servidor vuelva a parsearlo, pero no se
conserva indefinidamente por defecto. El subplan de balanzas define retención,
modelo versionado y conciliación offline.

### D10. La balanza mide; Nortex decide cómo se cobra

La cantidad capturada desde etiqueta o balanza puede ser confiable como
medición, pero el precio unitario, impuestos, descuentos, mayoreo y presentación
siguen siendo autoritativos en Nortex.

Políticas permitidas:

- `RECALCULATE`: Nortex ignora el total impreso y recalcula desde el maestro;
  es la política predeterminada.
- `REQUIRE_MATCH`: Nortex exige que el total impreso cuadre con el precio
  vigente dentro de una tolerancia explícita.
- `ACCEPT_LABEL_TOTAL`: excepción con perfil/equipo aprobado, permiso de
  gerente y auditoría reforzada; no es el default del MVP.

Un mismo evento offline o frame reintentado no puede duplicar la línea. Sin
embargo, dos paquetes físicos pueden compartir exactamente el mismo EAN-13 si
tienen igual PLU y peso: sin serial único no se bloquea la huella para siempre.
Nortex usa `clientEventId` para reintentos y pide confirmación ante un reescaneo
idéntico dentro de una ventana corta.

---

## 4. Diseño de alto nivel

```text
Giro principal + capacidades
           │
           ├──► catálogo semilla componible
           │
           ▼
Producto: modo + unidad base + paso + familia
           │
    ┌──────┴───────────────┐
    ▼                      ▼
Compra base/empaque     POS unidad/peso/etiqueta
    │                      │
    ▼                      ▼
conversión server      validación y precio server
    │                      │
    └──────► stock + Kardex + lotes/FEFO
                           │
                           ▼
               SaleItem con snapshot de nombre/unidad
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Ticket 80mm   Factura A4   WhatsApp/ESC-POS
```

### Campos aditivos propuestos

| Modelo | Campo | Propósito |
|---|---|---|
| `TenantCapability` | `tenantId`, `code` | Permitir combinaciones de giro sin silos. `@@unique([tenantId, code])`. |
| `Product` | `saleMode` | `COUNTED` / `MEASURED`; nullable para legado. |
| `Product` | `quantityStep Decimal(18,4)?` | Paso permitido, validado en servidor. |
| `Product` | `productFamily` | Presets, filtros y reportes; nunca tratamiento fiscal implícito. |
| `SaleItem` | `productNameAtSale?` | Nombre histórico estable. |
| `SaleItem` | `unitAtSale?` | Unidad histórica impresa. |
| `SaleItem` | `saleModeAtSale?` | Semántica histórica de la línea. |
| `SaleItem` | `presentationAtSale?` | `BASE` / `PACK`; conserva cómo se ofreció. |
| `SaleItem` | `presentationQuantityAtSale Decimal(18,4)?` | Permite imprimir `1 saco` aunque stock baje `100 lb`. |
| `SaleItemBatchAllocation` | `tenantId`, `saleItemId`, `batchId`, `quantity Decimal(18,4)` | Trazabilidad FEFO cuando una línea consume uno o varios lotes. |
| `ScaleLabelProfileVersion` | `tenantId`, `profileId`, `version`, layout declarativo, política, estado | Parser inmutable y reproducible para online/offline. |
| `ScaleProductMapping` | `tenantId`, `profileVersionId`, `plu`, `productId`, `sourceUnit` | El PLU depende del perfil; no se fuerza un único código en `Product`. |
| `ScaleDevice` | `tenantId`, marca/modelo, transporte, protocolo/adaptador, estado | Inventario de hardware en vivo explícitamente soportado. |
| `SaleMeasurement` | `tenantId`, `saleItemId`, origen, perfil/dispositivo, valor/unidad, cantidad base, política, `clientEventId`, hash | Evidencia auditable sin sobrecargar `SaleItem` ni guardar el código crudo indefinidamente. |

Para modelos que hoy exigen enteros (`PurchaseItem`, `QuotationItem`,
`PedidoItem`), la migración seguirá el patrón aditivo:

1. agregar un campo exacto nullable `Decimal(18,4)`;
2. desplegar lectores con fallback al campo legado;
3. backfill perezoso y luego dual-write;
4. retirar el campo anterior solo en una migración futura y controlada.

Los `Float` de stock/costo/precio se migrarán con el mismo patrón de columnas
sombra; el barrido de precisión no debe mezclarse con un cambio destructivo de
tipo ejecutado por `db push`.

### Contrato único de cantidad

Toda entrada de cantidad —venta, compra, devolución, ajuste, lote, conteo,
transferencia, proforma y pedido— debe cumplir:

- acepta string o number por compatibilidad y se normaliza con `Decimal.js`;
- valor finito y mayor que cero (distinto de cero para ajustes firmados);
- máximo 4 decimales;
- múltiplo de `quantityStep` del producto;
- límites de tamaño e ítems por request;
- jamás `parseInt` ni multiplicación monetaria con `Number`;
- precio, empaque, fiscalidad y costo se consultan server-side.

Una utilidad pura compartida (`utils/quantity.ts`) concentrará parsing,
validación, cuantización y formato para que POS, backend e impresión usen la
misma regla.

### Contrato de captura desde balanza o etiqueta

Toda entrada desde hardware debe cumplir además:

- `inputMode` explícito: `MANUAL`, `SCALE_LABEL` o `LIVE_SCALE`;
- producto resuelto mediante `ScaleProductMapping` de la versión publicada,
  nunca por texto libre de la etiqueta ni por un PLU global en `Product`;
- validación por `ScaleLabelProfileVersion`: prefijo, longitud, checksum,
  offsets, decimales, unidad y tipo de valor;
- límites de peso y monto por producto/perfil para rechazar lecturas absurdas;
- parser determinístico: un código inválido se rechaza con mensaje claro, no
  con fallback silencioso a “1 unidad”;
- validación server-side del precio final aunque el parseo ocurra localmente;
- tolerancia explícita de redondeo cuando el formato traiga peso + total.

---

## 5. Plan por fases

### Fase A — MVP: facturar por peso sin romper lo existente

**Resultado:** una miscelánea puede vender carne/pollo por peso y una
agropecuaria puede vender alimento por libra o saco; el ticket lo explica.

| ID | Trabajo | Componentes principales | Criterio de salida |
|---|---|---|---|
| A1 | Contrato puro de cantidades | `utils/quantity.ts`, Zod, pruebas de mutación | Se aceptan hasta 4 decimales, se rechazan NaN/Infinity/pasos inválidos. |
| A2 | Modelo aditivo y adaptadores legacy | Prisma, servicios de productos/ventas | Negocios existentes funcionan sin reclasificar; snapshots nuevos se guardan. |
| A3 | Alta de producto medida | Inventario, Quick Add, POS rápido, importador | Sin `parseInt`; selector ampliado de unidad; modo y paso explícitos. |
| A4 | Captura por peso en POS | `POS.tsx`, carrito persistente/offline | Tocar un `MEASURED` abre keypad; muestra cantidad, unidad y precio/unidad. |
| A4b | Fundamento de etiqueta de balanza | scanner wedge, parser puro, POS | El primer formato aprobado crea una línea medida; el servidor vuelve a derivar PLU/cantidad y recalcula el precio. |
| A5 | Venta autoritativa | `salesService.ts`, regla de precios compartida | Servidor valida paso, producto/tenant, presentación, precio/tier, descuento y stock en una tx. Base y empaque pueden coexistir como líneas separadas. |
| A6 | Factura con unidad | Receipt, Ticket/A4, WhatsApp, ESC/POS | Línea: `1.25 lb × C$ 48.00/lb = C$ 60.00` en los cuatro formatos. |
| A7 | Perfiles iniciales | Registro, Configuración + `TenantCapability` | Se puede registrar agropecuaria o activar carnes/alimento animal en una miscelánea existente. |
| A8 | Offline medido | IndexedDB, sync, idempotencia | Cantidad, unidad, paso, origen manual/etiqueta y presentación sobreviven cola/reintento sin duplicar la venta. |

**Gate de piloto:** A1–A8 completos y venta mixta online/offline verificada. No
se presenta todavía como “inventario agro completo” hasta terminar la Fase B.

### Fase B — Consistencia operativa de punta a punta

**Resultado:** lo que se compra, cuenta, ajusta, devuelve y vende usa la misma
cantidad exacta.

| ID | Trabajo | Detalle |
|---|---|---|
| B1 | Compras fraccionarias | Cantidad/costo por unidad base; `37.5 lb` o `12.75 kg` sin truncar. |
| B2 | Compra por empaque | Selector Base/Empaque; `2 sacos × 100 lb` entra como `200 lb`; costo promedio queda por lb. |
| B3 | Ajustes, lotes y conteos | Cantidad decimal en merma, hallazgo, alta/baja de lote, toma física y transferencias. |
| B4 | Devoluciones y proformas | Devolver `0.50 lb`; identificar por `saleItemId` para distinguir el mismo SKU suelto/empaque; cantidades exactas en nota de crédito y cotización. |
| B5 | Canales restantes | Catálogo público, WhatsApp, pedidos/delivery y sync offline respetan modo/unidad/paso y persisten la misma foto histórica de nombre/unidad/fiscalidad. |
| B6 | FEFO único | Extraer asignación de lotes a un servicio transaccional usado por venta online y offline; registrar asignaciones por línea. |
| B7 | Importar/exportar | Columnas `unidad`, `modo_venta`, `paso`, `familia`, `empaque`, `lote`, `iva_exento`; validación por fila. |
| B8 | Reportes | Cantidad y unidad en Kardex, compras, ventas, mermas y exportaciones; nunca sumar unidades incompatibles. |
| B9 | Perfiles y mapeos versionados | CRUD/publicación de `ScaleLabelProfileVersion` + `ScaleProductMapping`, pruebas con muestras, tolerancias y códigos de error. |

**Gate de lanzamiento general:** una venta fraccionaria debe cuadrar
`compra → stock → lote → venta → devolución → Kardex → contabilidad` y no
debe cambiar el comportamiento de productos contables.

### Fase C — Onboarding y catálogo por módulos

**Resultado:** el negocio nuevo llega a un catálogo útil sin cargar todo a mano.

| ID | Trabajo | Detalle |
|---|---|---|
| C1 | Composer de semillas | Catálogo base + módulos `CARNES_AVES`, `ALIMENTO_ANIMAL`, `AGROINSUMOS`, en vez de un catálogo monolítico por tipo. |
| C2 | Presets de producto | Sugerir unidad, modo, paso, familia, lote y empaque; el dueño confirma fiscalidad. |
| C3 | Onboarding adaptado | “Configurá tu primer producto por peso”, “registrá un empaque” o “registrá un lote” según capacidades. |
| C4 | Filtros y navegación | Familias y unidades visibles en Inventario/POS sin crear módulos separados. |
| C5 | Métricas de adopción | Alta de producto medido, primera venta medida, correcciones de unidad y errores por paso. |

### Fase D — Etiquetas y balanzas validadas

**Resultado:** el negocio puede facturar desde una etiqueta impresa o desde una
balanza conectada sin abrir huecos de fraude, redondeo o duplicación.

| ID | Trabajo | Detalle |
|---|---|---|
| D1 | Discovery de hardware real | Relevar marca/modelo, transporte, navegador/SO y muestras de etiquetas antes de escribir drivers. |
| D2 | Parser por perfiles | Perfil inmutable con prefijos, longitudes, checksum, peso/precio/PLU, decimales, mappings y vectores de prueba. |
| D3 | Piloto de etiqueta en POS | El formato elegido se prueba primero en shadow mode y luego crea líneas sin `+1 unidad`, online y offline. |
| D4 | Política de precio y duplicados | Recalcular por defecto, validar total cuando aplique; idempotencia por evento/serial y confirmación de paquetes idénticos sin serial. |
| D5 | Balanza en vivo | Captura de peso estable por serial/Bluetooth/USB o red local solo para hardware permitido por perfil; timeout, desconexión y fallback manual obligatorios. |
| D6 | Auditoría y soporte | Registro de códigos rechazados, payload/hash, métricas de error y muestras oro para regresión. |
| D7 | Piloto controlado | Validar una combinación concreta `modelo + navegador + SO + tienda` antes de vender compatibilidad general. |

**Gate de hardware:** una línea creada por etiqueta o balanza en vivo debe
producir exactamente el mismo efecto fiscal, inventario y trazabilidad que la
captura manual.

### Fase E — Ergonomía avanzada (después del uso real)

- Vender por monto: “dame C$ 50 de pollo” y calcular peso según precio.
- Múltiples presentaciones por producto si una sola pareja
  `packUnit/packSize` queda corta.
- Transformación y rendimiento: pollo entero → pechuga/pierna/merma; esta es
  producción/inventario compuesto, no debe fingirse como una simple venta.
- Listas de precio B2B y condiciones por tipo de cliente, si el piloto agro las
  demuestra necesarias.

---

## 6. UX mínima aprobada

### Alta de producto

1. Nombre y familia.
2. “¿Cómo lo vendés?”: por unidad o por medida.
3. Unidad base y paso.
4. Precio y costo **por unidad base**.
5. Opcional: empaque, mayoreo, lote/vencimiento y configuración fiscal.

Ejemplos de presets:

| Producto | Modo | Unidad base | Paso | Empaque |
|---|---|---:|---:|---|
| Pollo entero | MEASURED | lb | 0.01 | — |
| Carne de res | MEASURED | lb | 0.01 | — |
| Concentrado abierto | MEASURED | lb | 0.01 | saco / 100 |
| Fertilizante líquido | MEASURED | litro | 0.01 | galón / factor configurado |
| Vacuna veterinaria | COUNTED | frasco | 1 | caja / N |
| Saco cerrado | COUNTED | saco | 1 | — |

### POS

- Producto `COUNTED`: conserva toque = +1.
- Producto `MEASURED`: toque = diálogo de peso/cantidad con teclado decimal,
  unidad visible y total calculado en vivo.
- Etiqueta de balanza reconocida: el escaneo no debe sumar `+1`; debe crear o
  completar una línea medida con SKU, peso, unidad, precio por unidad y total
  trazables.
- Atajos configurables por unidad: 0.25, 0.5, 1 lb; 0.1, 0.5, 1 kg, etc.
- El cajero puede editar la cantidad antes de cobrar.
- La línea siempre muestra `precio / unidad` y `cantidad + unidad`.
- Un carrito puede mezclar productos medidos y contables.

### Balanzas y etiquetas

- Nortex debe manejar tres entradas distintas:
  `manual`, `escáner de código común`, `escáner de etiqueta de balanza`.
- La etiqueta no reemplaza el producto maestro: siempre debe resolver contra un
  SKU/PLU existente del tenant.
- Si la etiqueta trae peso y total, Nortex debe recalcular y validar contra el
  precio vigente o marcar la línea como “precio origen balanza” según la política
  comercial que defina el piloto.
- Si la etiqueta trae solo peso, Nortex toma el precio vigente del producto y
  calcula el total en el servidor.
- Cada línea medida debe conservar el origen: `MANUAL`, `SCALE_LABEL` o, en una
  fase futura, `LIVE_SCALE`.
- Si la balanza está conectada en vivo, el POS debe mostrar estado
  `lista / inestable / desconectada`, permitir capturar una lectura estable y
  ofrecer fallback manual si el hardware falla.
- Una vez capturada la lectura, la línea queda congelada; si el peso cambia en
  la balanza después, Nortex no debe mutar silenciosamente la línea ya creada.

### Cambio de unidad de un producto existente

La unidad base no se edita libremente cuando ya hay stock o movimientos. Se
permite solo si:

- el producto no tiene historial y stock = 0; o
- se usa un asistente de conversión con factor explícito, vista previa,
  transacción, Kardex y AuditLog before/after.

Cambiar `saco` a `lb` sin convertir stock/costo corrompería todo el histórico.

---

## 7. Matriz mínima de aceptación

| Escenario | Resultado obligatorio |
|---|---|
| Miscelánea mixta | Una factura contiene 2 cuadernos + 1.25 lb de pollo y cuadra al centavo. |
| Venta medida | 1.25 lb descuenta exactamente 1.25 del stock y Kardex. |
| Etiqueta de balanza | Escanear una etiqueta válida crea la línea medida correcta sin convertirla en `1 unidad`. |
| Etiqueta con precio embebido | Si el formato trae peso + total, Nortex guarda el origen y aplica la política definida sin perder trazabilidad. |
| Etiqueta repetida | Un reintento del mismo evento no duplica; dos paquetes físicos idénticos pueden agregarse con confirmación si el código no trae serial. |
| Etiqueta inválida | Prefijo, checksum o longitud erróneos producen rechazo explícito; no hay fallback silencioso a SKU normal. |
| Compra medida | Entran 37.50 lb sin truncarse; costo promedio usa 37.50. |
| Compra por saco | 2 sacos de 100 lb incrementan 200 lb; costo se expresa por lb. |
| Venta por saco | 1 saco descuenta 100 lb y usa el precio de empaque autorizado. |
| Presentación mixta | 1 saco + 3.5 lb del mismo SKU descuenta 103.5 lb y cobra cada línea con su precio correcto. |
| Devolución | Se devuelven 0.50 lb, sin superar lo vendido, con stock y dinero correctos. |
| Lote | 12.75 kg pueden entrar y salir del lote; FEFO online/offline produce el mismo resultado. |
| Balanza en vivo | Capturar un peso estable crea la misma línea que la captura manual; una desconexión no corrompe el carrito. |
| Ticket | Los cuatro formatos muestran cantidad, unidad, precio por unidad y total. |
| Offline | 0.75 kg se encola, sincroniza una sola vez y conserva cantidad/unidad. |
| Fiscal | Venta mixta conserva la foto fiscal de cada línea; reclasificar después no cambia el pasado. |
| Aislamiento | Ninguna capacidad, producto, lote o venta se puede leer/escribir desde otro tenant. |
| Regresión | Unidad, caja, mayoreo, crédito, stock negativo y ventas existentes siguen funcionando. |

Pruebas nuevas mínimas:

- unitarias y de mutación para parsing, paso, conversión empaque/base y totales;
- integración de `executeSale` con producto medido y concurrencia;
- integración compra/venta/devolución/lote;
- tickets HTML y ESC/POS con decimales/unidad;
- parser de etiquetas con checksums, prefijos inválidos y conflicto peso/precio;
- idempotencia de doble escaneo y doble frame;
- timeout, reconexión y lectura inestable de balanza viva;
- persistencia de carrito y sync offline;
- registro de tenant híbrido y composición de semillas;
- casos cross-tenant para productos, capacidades y lotes.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Ruido de punto flotante | `Decimal.js` en cálculo/validación; máximo 4 decimales; migración aditiva a `Decimal(18,4)`. |
| Romper productos viejos | Campos nullable + adaptador legacy; sin backfill automático por categoría. |
| Cada balanza habla distinto | Empezar por parser de etiquetas versionado por formato; no abrir integración viva sin inventario real de marcas/modelos del piloto. |
| El lector mete un código ambiguo | Resolver por prefijo/longitud/checksum y fallback a confirmación del cajero; nunca facturar silencio. |
| Etiqueta adulterada o repetida | Checksum, límites y reparseo server-side; idempotencia por evento/serial y confirmación para códigos idénticos sin serial. |
| Factor de saco manipulado | El servidor consulta `packSize`; el cliente solo elige BASE o PACK. |
| Precio manipulado desde POS | Precio/tier y descuentos se validan server-side con producto, cliente y rol. |
| Precio de etiqueta no coincide con Nortex | Política explícita por perfil/producto y override auditable; nunca ajuste silencioso. |
| Un canal sí y otro no | Un único contrato compartido para online/offline/impresión; misma utilidad de cantidad y mismos snapshots en `SaleItem`. |
| IVA mal asignado por rubro | `productFamily` nunca cambia fiscalidad; configuración explícita y validada. |
| Stock total y lotes divergen | Un solo servicio FEFO dentro de la misma transacción que venta/Kardex. |
| Online y offline dan resultados distintos | Compartir validadores, pricing, conversión y asignación de lotes; mismos casos oro. |
| UI demasiado técnica | Presets + divulgación progresiva; el camino rápido pide solo modo, unidad, paso y precio. |
| Unidad histórica cambia | Snapshot en `SaleItem` y reglas estrictas para convertir unidad base. |
| Mezclar magnitudes en reportes | Reportar por producto/unidad; no sumar “3 lb + 2 sacos” como una sola cantidad. |
| Navegador o shell móvil no alcanzan para el hardware | Mantener fallback por etiqueta/manual y evaluar plugin nativo/bridge local solo con evidencia del piloto. |
| Confundir integración con certificación de la balanza | Nortex opera en solo lectura; el piloto verifica por separado el control metrológico aplicable y nunca muestra una certificación sin evidencia. |

---

## 9. Prioridad y definición de terminado

```text
A: facturar correctamente
        ↓
B: sostener inventario y trazabilidad
        ↓
C: facilitar adopción del nuevo giro
        ↓
D: etiquetas y balanzas validadas
        ↓
E: rendimiento y B2B avanzado
```

La funcionalidad está **terminada** cuando un mismo tenant puede comprar,
inventariar, vender, imprimir y devolver productos por unidad y por medida sin
truncar cantidades, perder la unidad, desalinear lotes ni depender de una
categoría hardcodeada.

No se considera terminado con solo agregar opciones al registro o categorías al
catálogo.

---

## 10. Qué se revisará después del piloto

- Precisión realmente usada: 2, 3 o 4 decimales por tipo de balanza.
- Si una presentación por producto alcanza o hace falta `ProductPresentation`.
- Si los clientes agro necesitan listas de precio/condiciones distintas a
  `isWholesale`.
- Si los comercios procesan animales/cortes y necesitan recetas, rendimiento y
  merma de producción.
- Qué perfiles adicionales de etiqueta y qué marcas ameritan soporte oficial
  después del primer piloto exitoso.
- Si la conexión viva debe quedarse en navegador/Capacitor o escalar a bridge
  local/plugin nativo según la evidencia de hardware.
- Qué clasificación fiscal adicional, si alguna, debe reemplazar el booleano
  `ivaExento`, siempre con validación contable previa.

---

## 11. Restricciones técnicas verificadas

- El repositorio ya incluye Capacitor (`package.json` declara
  `@capacitor/core`, `@capacitor/android` y `@capacitor/cli`), así que existe
  una ruta real para un plugin nativo Android cuando la web no alcance.
- El POS actual ya soporta lectores tipo keyboard wedge porque escucha eventos
  globales de teclado y busca por `sku`, pero todavía no parsea etiquetas de
  peso/precio variable ni distingue origen de la captura.
- El ticket y la factura actuales aún modelan ítems como
  `{ name, quantity, price, lineTotal }`, sin snapshot explícito de unidad ni de
  origen de captura.
- `Web Serial`, `WebHID` y `Web Bluetooth` existen en web moderna, pero no son
  una baseline universal y exigen secure context. Chromium mantiene Web Serial
  desactivado en Android WebView, que es donde corre la app Capacitor actual;
  por eso la balanza viva en Android requiere spike y probablemente plugin nativo.
- En estándares GS1 para variable measure/restricted circulation no conviene
  hardcodear un solo prefijo global. Nortex debe tratar la etiqueta como una
  regla configurable por tenant o por perfil de balanza.
- MIFIC inspecciona balanzas usadas para ventas al consumidor bajo metrología
  legal; la integración Nortex no sustituye calibración, verificación ni control
  que corresponda al comercio/equipo.

Referencias externas para la implementación:

- Subplan técnico de balanzas:
  [`PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md`](./PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md)
- Chrome Web Serial: https://developer.chrome.com/docs/capabilities/serial
- Chromium Web Serial/WebView: https://issues.chromium.org/issues/407822062
- Android USB Host: https://developer.android.com/develop/connectivity/usb/host
- Capacitor plugins: https://capacitorjs.com/docs/plugins
- GS1 General Specifications: https://ref.gs1.org/standards/genspecs/
- GS1 2D at Retail POS: https://ref.gs1.org/guidelines/2d-in-retail/
- MIFIC Metrología Legal:
  https://www.mific.gob.ni/Inicio/Comercio/Comercio-Interior/SNC/ML
