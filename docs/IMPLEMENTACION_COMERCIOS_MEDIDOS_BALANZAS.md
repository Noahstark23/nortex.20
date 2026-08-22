# Implementación — comercios híbridos, productos medidos y balanzas

> Estado del alcance al 22 de agosto de 2026.
>
> Esta guía describe lo que Nortex implementa realmente, cómo operarlo y qué
> límites deben respetarse al desplegarlo. El diseño de referencia está en
> [el plan de comercios híbridos](./PLAN_COMERCIOS_HIBRIDOS_CARNES_AGROPECUARIA.md)
> y [el plan de balanzas](./PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md). La política
> server-side de roles se mantiene en la
> [matriz de autorización de operaciones medidas](./MATRIZ_AUTORIZACION_OPERACIONES_MEDIDAS.md).

## 1. Resultado operativo

Nortex conserva un solo motor de venta e inventario para misceláneas,
carnicerías, pollerías y agropecuarias. Un mismo tenant puede combinar artículos
por unidad, productos por peso y presentaciones completas sin crear otro POS ni
otra factura.

El flujo implementado es:

```text
producto + unidad base + modo/paso
              │
      captura manual o etiqueta
              │
              ▼
 servidor revalida producto, cantidad y precio
              │
              ▼
 venta + stock + FEFO + Kardex + contabilidad + auditoría
              │
              ▼
 ticket/factura con cantidad, unidad y precio unitario
```

La balanza aporta una medición. El servidor de Nortex sigue siendo la autoridad
sobre tenant, producto, unidad, conversión, precio, mayoreo/empaque, descuento,
IVA, stock, lote y total de la venta.

## 2. Modelo de negocio y producto

### 2.1 Giro principal y capacidades combinables

`Tenant.type` se conserva por compatibilidad. Las variaciones operativas se
guardan como filas únicas `TenantCapability` y pueden combinarse:

- `CARNES_AVES`
- `ALIMENTO_ANIMAL`
- `AGROINSUMOS`
- `PERECEDEROS`
- `MAYOREO`

El registro ofrece `CARNICERIA_POLLERIA` y `AGROPECUARIA` y sugiere capacidades,
pero el dueño puede combinarlas. El catálogo inicial se compone con el giro y
las capacidades activas; solo se puede sembrar cuando el inventario está vacío.
El cambio de capacidades queda en auditoría y no altera impuestos por sí solo.

Al elegir una familia en el alta de producto, la UI aplica una sugerencia
editable de unidad, modo, paso, lote y, para alimento animal, saco de 100 lb.
Es un atajo de captura: nunca sugiere IVA, precio ni costo. Esos campos siguen
bajo confirmación explícita del dueño.

### 2.2 Configuración autoritativa del producto

| Campo | Uso |
|---|---|
| `saleMode` | `COUNTED`, `MEASURED` o `null` para legado. |
| `quantityStep` | Mínimo incremento exacto, hasta 4 decimales. |
| `unit` | Unidad base de stock, costo y Kardex. |
| `productFamily` | `GENERAL`, `MEAT`, `POULTRY`, `ANIMAL_FEED`, `AGRO_INPUT` o `VETERINARY`. |
| `packUnit`, `packSize`, `packPrice` | Presentación completa y su equivalencia/precio. |
| `requiresBatchTracking` | Activa lotes, vencimiento y consumo FEFO. |
| `ivaExento` | Foto fiscal explícita; nunca se infiere por familia o categoría. |

Reglas de cantidad:

- `COUNTED` explícito exige cantidades y pasos enteros;
- `MEASURED` acepta cantidades positivas de hasta 4 decimales y exige que sean
  múltiplos exactos de `quantityStep`;
- `saleMode = null` mantiene el comportamiento fraccionario histórico, con paso
  efectivo `0.0001`; no se convierte silenciosamente en contado;
- `NaN`, infinito, cero, negativos, exceso de escala y pasos incompatibles se
  rechazan;
- las conversiones automáticas se limitan a pares exactos aprobados: `g ↔ kg`
  y `oz ↔ lb`. No se cruzan sistemas ni se infieren densidades.

El alta, edición, importación masiva, ajuste, lotes, compras y devoluciones usan
las mismas reglas contextuales. El stock inicial se mueve mediante la operación
atómica de stock y genera Kardex; no se escribe como un valor suelto.

### 2.3 Unidad base y presentaciones

`SaleItem.quantity` representa lo descontado en unidad base. Si una línea se
vende como empaque, el servidor comprueba la presentación contra `packUnit` y
`packSize`, conserva `presentationAtSale` y `presentationQuantityAtSale`, y no
confía en un factor arbitrario enviado por el navegador.

Ejemplo: un saco de 100 lb se descuenta como 100 lb, pero se imprime como
`1 saco × C$ …/saco`. Una venta separada de 3.5 lb conserva su propia línea y
precio.

Las compras permiten elegir `BASE` o `PACK`. En `PACK`, la cantidad visible es
el número de empaques y el costo visible es por empaque. El navegador muestra la
equivalencia, pero el servidor vuelve a leer `packSize` del producto: mueve
`cantidad × packSize` en stock/lote/Kardex, guarda esa cantidad en
`quantityExact` y obtiene el costo promedio por unidad base. Ningún factor de
conversión enviado por el cliente forma parte del contrato.

Los ajustes, lotes, tomas físicas y transferencias entre bodegas vuelven a leer
el modo/paso del producto dentro de la operación. La transferencia conserva el
decimal textual hasta esa validación y solo lo convierte a la columna `Float`
legacy en el último borde de persistencia.

## 3. Venta, stock, lotes y precisión

### 3.1 Un contrato online/offline

`POST /api/sales` y `POST /api/sales/sync` convergen en el mismo servicio. Antes
de escribir, el servidor:

1. verifica el JWT y vuelve a consultar en base de datos el usuario, su estado,
   tenant y rol actuales;
2. vuelve a cargar cada producto dentro del tenant;
3. valida modo, paso, unidad y presentación;
4. calcula precio de detalle, mayoreo o empaque desde el maestro;
5. ignora el precio unitario enviado por clientes antiguos;
6. calcula descuentos y totales con `Decimal.js`;
7. confirma venta, existencias, lotes, Kardex, contabilidad y auditoría en la
   misma transacción.

El JWT identifica la sesión, pero sus claims de rol y tenant no deciden la
autorización. Cada request autenticado exige que el usuario persistido siga en
estado `ACTIVE`, que pertenezca al mismo tenant del token y que tenga un rol
válido; después reemplaza el principal del request con esos valores actuales.
Una baja, degradación de rol o cambio de tenant surte efecto de inmediato aunque
el token todavía no haya expirado. Si la consulta de estado no está disponible,
la autenticación falla cerrada. `SUPER_ADMIN` solo obtiene su bypass cuando ese
es también su rol activo en base de datos; un token de motorizado no se acepta
como sesión de usuario.

Las vistas fiscales HTML autenticadas no interpolan directamente datos
persistidos. La constancia de retención codifica negocio, proveedor y número de
factura como texto, añade CSP con nonce tanto en el header como dentro del
documento `blob:` y responde `no-store`. Así un valor capturado por un rol de
compras no puede convertirse en script cuando `OWNER`, `ADMIN` o `ACCOUNTANT`
abre la vista previa.

Una venta POS no puede fingir otro canal para saltarse el turno: la ruta fija
`source = POS` del lado servidor. El sync valida que el `tenantId` de cada fila
coincida con el JWT.

Cada línea nueva guarda la foto de nombre, unidad, modo y presentación. Las
reimpresiones no dependen de que el producto conserve después el mismo nombre o
unidad.

Las cotizaciones y pedidos públicos guardan cantidad, precio unitario, unidad,
modo, paso, presentación e IVA como snapshots. Al convertirlos o entregarlos,
el navegador conserva la identidad de la línea y el servidor rechaza cambios
de cantidad, presentación, precio o descuento. Una cotización vencida,
procesada o de otro tenant no puede convertirse en venta.

Pedidos públicos legacy con un snapshot incompleto fallan cerrado con
`RECONCILIATION_REQUIRED`; no se inventa IVA ni se redondea un precio exacto
faltante. Si una presentación `PACK` desaparece del catálogo, el carrito público
descarta esa línea y obliga al cliente a elegir nuevamente en vez de convertirla
silenciosamente a `BASE`.

### 3.2 FEFO e inventario offline

Los productos con lotes se consumen por fecha de vencimiento y luego por fecha
de creación. Cada descuento queda en `SaleItemBatchAllocation`. La venta online
exige asignación suficiente cuando no se permite stock negativo.

Una venta offline usa el mismo orden FEFO, referido a la fecha capturada de la
venta. Si al sincronizar falta lote asignable, Nortex conserva el faltante para
conciliación y crea un evento de auditoría; no inventa un lote ni reordena la
historia silenciosamente.

`offlineId` ya no basta por sí solo para declarar un replay. El servidor guarda
en `Sale.offlinePayloadHash` un SHA-256 del intento canónico, ligado a tenant,
usuario, turno, canal, forma de pago, cliente, descuento, líneas, presentación e
identidad de cada medición. El material canónico contiene únicamente la huella
del código de balanza, nunca el barcode crudo. Un reintento con el mismo
`offlineId` y la misma huella devuelve la venta existente; si cambia el payload,
responde `OFFLINE_PAYLOAD_MISMATCH` y el sync lo conserva como
`reconciliation_required` sin volver a cobrar ni mover stock. Una venta
histórica con `offlineId` pero sin huella también exige conciliación, porque no
se puede demostrar que sea el mismo intento.

### 3.3 Compatibilidad de precisión

Los campos nuevos de evidencia, snapshots y cantidades exactas son
`Decimal(18,4)`. Para mantener compatibilidad, varias columnas históricas
continúan como `Float` o `Int`. En compras, `PurchaseItem.quantityExact` es la
autoridad nueva y `PurchaseItem.quantity` queda como sombra entera compatible.
Las órdenes de compra conservan `quantityOrderedExact` y
`quantityReceivedExact`, además de unidad/modo/paso al ordenar. Cotizaciones y
pedidos tienen cantidad exacta, precio exacto y snapshots operativos/fiscales;
sus `Int`/`Decimal(10,2)` anteriores son solo sombras para clientes legacy.

Los cálculos tocados trabajan con decimal serializado y solo convierten a
`Number` en el borde de una columna legacy. Esto reduce el riesgo, pero no
equivale todavía a una migración completa de todas las existencias históricas a
decimal.

### 3.4 Devolución por línea vendida

Las devoluciones identifican `SaleItem`, no solo el producto. Esto permite
devolver correctamente dos paquetes del mismo SKU vendidos en líneas separadas,
con cantidades, precios o presentaciones diferentes.

Los clientes actuales deben enviar un `clientEventId` estable por intención de
devolución. Nortex calcula una huella canónica de venta, líneas/cantidades,
motivo y método de reembolso, y la persiste en `ProductReturn.payloadHash`. La
clave única es `tenantId + clientEventId`: el mismo evento con el mismo payload
recupera la devolución existente con `idempotentReplay = true`; reutilizar la
clave con otro contenido devuelve `409 RETURN_IDEMPOTENCY_CONFLICT`. El POS
mantiene la misma UUID durante errores/reintentos y la rota al cambiar
materialmente la solicitud o después de una confirmación. Las columnas son
nullable únicamente para convivir con filas históricas; la API nueva exige la
clave.

La búsqueda de la venta devuelve por línea: cantidad vendida, ya devuelta y
disponible, unidad/presentación, paso y precio de reintegro. Al confirmar, el
servidor:

- comprueba que `saleItemId` pertenezca a la venta y al tenant;
- admite `productId` legacy únicamente si ese producto aparece en una sola
  línea no ambigua;
- suma devoluciones anteriores por `saleItemId` y evita sobredevolver;
- usa los snapshots de precio, descuentos y cantidad, no el precio del cliente;
- serializa devoluciones concurrentes bloqueando la venta antes de recalcular;
- restaura en la bodega y lotes originales, con Kardex desglosado;
- separa la reversión de cuentas por cobrar del importe ya liquidado; solo un
  reembolso `CASH` crea movimiento de caja y exige turno/fondo disponible;
- registra contabilidad fiscal, deuda, stock y auditoría en la misma transacción.

### 3.5 Catálogo público, pedidos y delivery

El catálogo público envía solo producto, cantidad y `BASE`/`PACK`; el servidor
deriva tenant por slug, vuelve a cargar productos publicados y recalcula precio,
flete y snapshots. Preparar un pedido reserva stock/lotes; tanto el dashboard
como el driver usan el mismo fulfillment transaccional para entregar y facturar.

Cancelar después de reservar crea liberaciones compensatorias por
producto/bodega/lote. Un replay solo se declara idempotente cuando reserva y
liberación cuadran exactamente; cualquier diferencia queda visible para
conciliación, no se oculta detrás de un estado `cancelado`.

Reserva, cancelación y entrega bloquean primero la fila `Pedido` con
`SELECT … FOR UPDATE` y solo entonces leen sus snapshots o tocan inventario. El
orden global es `Pedido → Product/stock de bodega → ProductBatch → Kardex`; las
líneas se ordenan de forma determinista. Así dos transiciones concurrentes no
pueden decidir sobre snapshots simultáneos del mismo pedido ni invertir el orden
de locks de inventario. Dashboard y motorizado pasan por este mismo servicio.

El seguimiento público no se autoriza con el UUID del pedido. Al crear el
pedido, el backend emite una capacidad JWT ligada a `pedidoId + tenantId`, con
vigencia de 7 días, y entrega una ruta cuyo token viaja en el fragmento
`#token=…`. El navegador lo extrae y lo envía exclusivamente en el header
`X-Pedido-Tracking-Token`; el fragmento no forma parte de la petición HTML ni
del `Referer`. El endpoint verifica firma, expiración y pedido antes de consultar
y responde con un DTO mínimo: estado y fecha del pedido, estados/fechas de los
eventos y nombre del motorizado. No expone cliente, teléfono, dirección, GPS,
notas internas ni teléfono del conductor; tokens ausentes, vencidos, alterados
o ligados a otro pedido fallan de forma indistinguible con `404` y `no-store`.

## 4. Etiquetas de balanza

### 4.1 Perfil y publicación

El parser es declarativo: no acepta JavaScript, callbacks ni regex provistas por
el usuario. Una versión define EAN-13, longitud, prefijos, offsets de PLU/valor,
semántica, decimales implícitos, unidad, checksum, tolerancia y límites.

El ciclo de vida es `DRAFT → PUBLISHED → REVOKED`:

- un borrador se puede editar, probar y borrar;
- publicar valida estructura, mapeos, tenant, unidades y ambigüedad con otros
  perfiles activos;
- el mapeo es `profileVersionId + PLU → productId + sourceUnit` y solo admite un
  producto del mismo tenant configurado explícitamente como `MEASURED`;
- publicar una nueva versión revoca la publicada anterior del mismo perfil;
- una versión publicada es inmutable;
- una venta offline que referencia una versión revocada pasa a conciliación y
  nunca se reinterpreta con la versión vigente.

El contexto publicado se descarga por tenant con `cacheVersion`, `ETag` y
`If-None-Match`. El POS puede previsualizar localmente para responder rápido,
pero al cobrar o sincronizar el servidor vuelve a parsear el código y deriva el
producto y cantidad. Una etiqueta reconocible pero inválida no degrada a
`1 unidad` ni a un SKU común.

### 4.2 Matriz real de compatibilidad

| Entrada/política | Estado | Comportamiento actual |
|---|---|---|
| EAN-13 `WEIGHT` + `RECALCULATE` | **Soportado** | Convierte la masa dentro de la misma familia, valida el paso y cobra con el precio Nortex. |
| EAN-13 `COUNT` + `RECALCULATE` | **Soportado** | Exige valor entero y paso compatible; el producto mapeado debe estar explícitamente en `MEASURED`. |
| EAN-13 `TOTAL_PRICE` | **Solo diagnóstico/manual** | Se puede previsualizar en borrador, pero no deriva peso, no se publica y no se factura. Se exige reimpresión con peso/cantidad o captura manual. |
| `REQUIRE_MATCH` | **Reservado** | No es publicable con layouts actuales de un solo valor: requiere un formato futuro que contenga cantidad **y** total como campos independientes. |
| `ACCEPT_LABEL_TOTAL` | **Reservado** | Tampoco es publicable hoy. El contrato futuro exige confirmación explícita, sesión de gerente y auditoría reforzada. |
| Web Serial de texto | **Base experimental, solo lectura** | Detecta frames y estabilidad en navegador compatible; no certifica marca/modelo y el servidor no admite aún `LIVE_SCALE` en una venta. |
| Simulador | **Diagnóstico, solo lectura** | Sirve para probar estados y UX; no demuestra compatibilidad física. |
| UPC-A, GS1 DataMatrix/QR/DataBar o formatos propietarios | **No soportado** | Requieren parser/perfil o adaptador futuro validado con muestras reales. |

Aunque el borrador conserva `TOTAL_PRICE`, `REQUIRE_MATCH` y
`ACCEPT_LABEL_TOTAL` para diagnosticar etiquetas y evolucionar el contrato, el
gate de publicación bloquea esas combinaciones. No deben anunciarse como
capacidad de producción.

### 4.3 Trazabilidad, retención e idempotencia

Una línea manual o de etiqueta puede guardar `SaleMeasurement` con cantidad y
unidad de origen, cantidad base, versión, política, fecha, usuario y
`clientEventId`. Para etiquetas se persiste el SHA-256 del código normalizado;
el código completo no queda guardado en la venta ni en logs de aplicación. Los
rechazos de preview generan telemetría con código de error, versión y esa huella,
nunca con el barcode crudo ni la cantidad codificada.

El código crudo solo permanece en IndexedDB mientras una venta offline está
pendiente, porque el servidor necesita volver a parsearlo. Se elimina al
sincronizarla correctamente. `offlineId` y `clientEventId`, ambos acotados por
tenant, identifican reintentos; el servidor exige además que sus huellas
canónicas coincidan antes de declarar un replay idempotente.

Dos paquetes reales pueden producir el mismo EAN-13. Nortex no bloquea esa
huella para siempre: dentro de una ventana corta pregunta si se quiere agregar
otro paquete igual y, al confirmar, genera un evento nuevo.

## 5. POS, modo offline e impresión

En el POS:

- un producto legado conserva el gesto histórico: tocar o escanear suma 1 y
  agrupa la línea, aunque después permita ajuste fraccionario;
- un producto `COUNTED` solo admite enteros;
- un producto `MEASURED` explícito abre la captura de cantidad y cada paquete
  medido conserva identidad propia;
- el lector tipo teclado puede resolver SKU común o etiqueta publicada;
- el caché offline de perfiles está separado por tenant;
- las ventas offline se filtran por tenant **y usuario** antes de sincronizar;
- una venta pendiente conserva la versión exacta del perfil y su evento de
  medición;
- fallos y conciliaciones quedan durablemente en IndexedDB; solo resultados
  `created`/`skipped` eliminan el payload crudo de la cola;
- `OFFLINE_PAYLOAD_MISMATCH`, incluido el caso histórico sin hash verificable,
  queda como `reconciliation_required` para revisión explícita.

Ticket React, factura A4/HTML, WhatsApp y ESC/POS imprimen cantidad visible,
unidad, precio por unidad y total de línea. Para empaques usan la presentación
visible; para la contabilidad e inventario se mantiene la cantidad base.

La pantalla `/app/scales` permite administrar perfiles/mapeos y probar el
simulador o Web Serial genérico. La integración directa es deliberadamente de
solo lectura: no expone tara, calibración, cambio de precio ni configuración de
la balanza. Android WebView/Capacitor tiene soporte limitado para Web Serial;
no debe asumirse equivalente a Chrome de escritorio.

## 6. Endpoints incorporados o ampliados

Salvo registro, checkout público y tracking por capacidad firmada, los endpoints
operativos usan `authenticate`. El tenant y rol efectivos salen de la
revalidación en base de datos descrita arriba; luego cada guard aplica mínimo
privilegio. La tabla siguiente resume el contrato funcional. La lista exhaustiva
de roles para venta offline, pedidos, cotizaciones, devoluciones y documentos
fiscales está en la
[matriz de autorización](./MATRIZ_AUTORIZACION_OPERACIONES_MEDIDAS.md).

| Método y ruta | Uso / autorización |
|---|---|
| `POST /api/auth/register` | Acepta giro y capacidades combinables durante el registro. |
| `GET /api/tenant/capabilities` | Lista capacidades del tenant autenticado. |
| `PUT /api/tenant/capabilities` | Reemplaza capacidades conocidas; `OWNER`/`ADMIN`, con auditoría. |
| `POST /api/onboarding/seed-catalog` | Compone catálogo inicial por giro/capacidades; `OWNER`/`ADMIN`/`SUPER_ADMIN`, solo inventario vacío. |
| `POST /api/products` | Alta con modo, paso, familia, unidad y presentación; `OWNER`/`ADMIN`. |
| `PUT /api/products/:id` | Edición contextual; `OWNER`/`ADMIN`. |
| `POST /api/products/bulk` | Importación con aliases de campos medidos; `OWNER`/`ADMIN`. |
| `POST /api/inventory/adjust` | Ajuste decimal contextual y atómico; `OWNER`/`ADMIN`. |
| `POST /api/inventory/batches` | Alta de lote con cantidad contextual; `OWNER`/`ADMIN`. |
| `POST /api/purchases` | Compra `BASE`/`PACK`, conversión server-side y cantidad exacta; `OWNER`/`ADMIN`/`MANAGER`. |
| `POST /api/purchase-orders` | Orden con cantidad exacta y snapshots de unidad/modo/paso. |
| `POST /api/purchase-orders/:id/receive` | Recepción parcial exacta y sin sobrerrecepción; mueve stock/lote/Kardex. |
| `POST /api/stock-transfers` | Transferencia decimal contextual entre bodegas, atómica y tenant-scoped. |
| `GET /api/sales/search` | Busca una venta y calcula disponibilidad por `saleItemId`; `OWNER`/`ADMIN`/`SUPER_ADMIN`. |
| `POST /api/returns` | Devolución por línea con `clientEventId` y huella canónica; `OWNER`/`ADMIN`/`SUPER_ADMIN`. |
| `POST /api/sales` | Venta POS online; canal fijado en servidor y turno abierto requerido. |
| `POST /api/sales/sync` | Lote offline para roles POS; compara `offlineId + offlinePayloadHash` y devuelve `created`, `skipped`, `failed` o `reconciliation_required`. |
| `POST /api/v1/pedidos` | Checkout público tenant-by-slug; crea snapshots y enlace de tracking firmado por 7 días. |
| `GET /api/v1/pedidos/:id/tracking` | Tracking público solo con capacidad en `X-Pedido-Tracking-Token`; DTO mínimo y `no-store`. |
| `GET /api/v1/pedidos` y `GET /api/v1/pedidos/:id` | Lectura tenant-scoped; incluye `VIEWER`, nunca mutación. |
| `PATCH /api/v1/pedidos/:id/estado` | Roles operativos; lock de pedido, reserva, entrega/facturación o cancelación compensatoria. |
| `PATCH /api/v1/pedidos/:id/motorizado` | Roles operativos; asignación tenant-scoped o flota Nortex activa con KYC aprobado. |
| `PATCH /api/driver/me/orders/:orderId/deliver` | Entrega por driver autenticado usando el mismo fulfillment. |
| `GET /api/quotations` | Lectura de cotizaciones; incluye `VIEWER`, nunca creación. |
| `POST /api/quotations` | Roles de venta; cotización con cantidad/precio/presentación/fiscalidad exactas. |
| `GET /api/public-orders` | Lectura tenant-scoped de pedidos web; incluye `VIEWER`. |
| `PATCH /api/public-orders/:id/convert` | Roles de venta; conversión fail-closed de pedido web a cotización. |
| `GET /api/scale-labels/active-context` | Contexto publicado para POS/offline, con ETag. |
| `POST /api/scale-labels/preview` | Clasifica/resuelve sin crear venta ni persistir el barcode. |
| `GET/POST /api/scale-labels/profiles` | Lista (`OWNER`/`ADMIN`/`MANAGER`) o crea (`OWNER`/`ADMIN`) perfiles. |
| `PATCH /api/scale-labels/profiles/:profileId` | Renombra o activa/inactiva; `OWNER`/`ADMIN`. |
| `GET/POST /api/scale-labels/profiles/:profileId/versions` | Lista o crea versiones con los roles anteriores. |
| `PATCH/DELETE /api/scale-labels/versions/:versionId` | Modifica o borra únicamente borradores; `OWNER`/`ADMIN`. |
| `GET/PUT /api/scale-labels/versions/:versionId/mappings` | Lista o reemplaza mapeos; lectura incluye `MANAGER`, escritura no. |
| `POST /api/scale-labels/versions/:versionId/publish` | Publica una versión validada; `OWNER`/`ADMIN`. |
| `POST /api/scale-labels/versions/:versionId/revoke` | Revoca una versión; `OWNER`/`ADMIN`. Revisar antes colas offline. |
| `GET/POST /api/scale-devices` | Lista dispositivos o registra metadatos allowlisted. |
| `GET/PATCH /api/scale-devices/:deviceId` | Consulta o actualiza metadatos; escritura `OWNER`/`ADMIN`. |
| `POST /api/scale-devices/:deviceId/test-reading` | Valida una lectura de prueba; `OWNER`/`ADMIN`/`MANAGER`. No crea venta. |

Los endpoints de perfiles devuelven errores de dominio estables como
`INVALID_PROFILE`, `INVALID_MAPPING`, `AMBIGUOUS_PROFILES`,
`TOTAL_PRICE_REQUIRES_WEIGHT` e `INVALID_STATE`. El sync reserva
`RECONCILIATION_REQUIRED` para casos que no pueden autoaceptarse.

## 7. Migración de base de datos

La migración
`backend/prisma/migrations/20260822_measured_products_scales/migration.sql` es
aditiva para MySQL 8:

- agrega 36 columnas nullable a productos, líneas de venta, compras,
  cotizaciones, pedidos y devoluciones;
- crea 7 tablas: capacidades, perfiles, versiones, mapeos, dispositivos,
  mediciones y asignaciones FEFO;
- agrega índices compuestos por tenant e idempotencia, incluida la unicidad
  `ProductReturn(tenantId, clientEventId)`;
- usa `ON DELETE RESTRICT` para evidencia histórica de balanzas/ventas y
  `CASCADE` solo para capacidades pertenecientes al tenant.

Entre esas 36 columnas están `Sale.offlinePayloadHash` y
`ProductReturn.clientEventId`/`payloadHash`. Son nullable para no fabricar
evidencia en registros antiguos; las rutas nuevas sí las escriben y validan.

No requiere `--accept-data-loss`. Las filas históricas permanecen legibles con
campos nuevos en `null`.

La ronda final aplicó el SQL completo sobre una copia descartable de MySQL 8 con
103 productos, 12 líneas de venta y 154 líneas de compra históricas. Se
conservaron tanto los conteos como las sumas de stock (`4454`), cantidad vendida
(`12`) y cantidad comprada (`1463`); las 36 columnas nuevas quedaron `null` en
el histórico. También se comprobaron las 7 tablas —incluida
`ScaleProductMapping`—, 18 claves foráneas (17 `RESTRICT`, 1 `CASCADE`) y el
índice único `ProductReturn(tenantId, clientEventId)`. La base temporal se
eliminó y se verificó después que ya no existiera.

### 7.1 Checklist previo

1. Confirmar MySQL 8 y una ventana con monitoreo de errores/sync.
2. Crear un backup verificable con `scripts/backup-db.sh` y probar que se puede
   restaurar en una base aislada.
3. Aplicar primero sobre un clon reciente de producción.
4. Instalar exactamente el lockfile y generar Prisma:

   ```bash
   npm ci
   DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma validate --schema=backend/prisma/schema.prisma
   DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma generate --schema=backend/prisma/schema.prisma
   ```

5. En el clon, ejecutar el mismo mecanismo del despliegue y comprobar que
   Prisma no anuncia pérdida de datos:

   ```bash
   npx prisma db push --schema=backend/prisma/schema.prisma --skip-generate
   ```

No mezclar `db push` y `migrate deploy` en una instalación que no tenga el
historial de migraciones inicializado. El contenedor actual usa `db push`; el
SQL versionado sirve también para una plataforma gestionada que ya aplique
migraciones explícitas.

### 7.2 Despliegue y smoke test

1. Aplicar el schema sin `--accept-data-loss` y desplegar backend/frontend de la
   misma revisión.
2. Verificar login, inventario y una venta de producto legado antes de publicar
   perfiles.
3. Crear productos `COUNTED` y `MEASURED`, probar un paso válido y uno inválido.
4. Comprar un producto por empaque y comprobar equivalencia, costo base, stock,
   lote, Kardex y `quantityExact`.
5. Vender dos líneas del mismo producto y devolver parcialmente una por
   `saleItemId`; confirmar que no afecta la otra ni permite sobredevolver.
   Reenviar simultáneamente el mismo `clientEventId`: el payload idéntico debe
   restaurar una sola vez y uno divergente debe producir
   `RETURN_IDEMPOTENCY_CONFLICT` sin efectos parciales.
6. Configurar un perfil de prueba con al menos tres etiquetas conocidas, mapear
   PLU, previsualizar y publicar.
7. Vender una etiqueta online y otra desde cola offline; verificar una sola
   venta por reintento. Reutilizar su `offlineId` con otro payload y confirmar
   que queda en conciliación sin una segunda venta.
8. Comparar `SaleItem`, `SaleMeasurement`, stock agregado, stock de bodega,
   `SaleItemBatchAllocation`, Kardex, auditoría y asiento contable.
9. Reimprimir ticket, A4/HTML, WhatsApp y ESC/POS.
10. Confirmar que `TOTAL_PRICE` y políticas distintas de `RECALCULATE` fallan al
   publicar.
11. Probar checksum incorrecto, prefijos ambiguos, PLU ajeno y versión revocada.
12. Crear un pedido público, abrir el enlace con su capacidad, y confirmar que
    un token ausente, alterado, vencido o de otro pedido recibe `404`; inspeccionar
    que el DTO no contenga PII, GPS ni notas internas.

### 7.3 Rollback seguro

El rollback recomendado es de aplicación, no un `down` destructivo:

1. Inactivar los perfiles para detener nuevas capturas; no revocarlos como
   atajo si existen ventas offline pendientes.
2. Mantener la versión nueva el tiempo necesario para vaciar o conciliar las
   colas de ventas medidas. Un cliente antiguo puede no entender su payload.
3. Confirmar backup y desplegar la revisión anterior de la aplicación.
4. Dejar las columnas y tablas aditivas en la base; la aplicación anterior las
   ignora y se conserva la evidencia histórica.
5. No eliminar tablas, columnas, versiones ni mapeos referenciados. Una limpieza
   futura requiere exportación, backup probado y una migración separada.

Si el problema es corrupción de datos, detener escrituras y seguir el runbook
de restauración completo. Borrar solo el schema nuevo no restaura stock, lotes,
Kardex ni contabilidad y por tanto no es un rollback válido.

## 8. QA ejecutable

### 8.1 Automatización

Desde la raíz del repositorio:

```bash
DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma validate --schema=backend/prisma/schema.prisma
DATABASE_URL="mysql://u:p@localhost:3306/db" npx prisma generate --schema=backend/prisma/schema.prisma
npx tsc --noEmit
npx vitest run \
  tests/quantity.test.ts \
  tests/physicalQuantitySchemas.test.ts \
  tests/purchasePackaging.test.ts \
  tests/purchaseOrderQuantities.test.ts \
  tests/purchaseOrderAvailability.test.ts \
  tests/purchaseSchema.test.ts \
  tests/importProductsMeasured.test.ts \
  tests/productFamilyPresets.test.ts \
  tests/tenantCapabilities.test.ts \
  tests/seedCatalog.test.ts \
  tests/scaleLabels.test.ts \
  tests/scaleLabelService.test.ts \
  tests/scaleLabelConcurrencyGuards.test.ts \
  tests/scaleLabelTelemetry.test.ts \
  tests/scaleLabelAcceptance.test.ts \
  tests/scaleAdapters.test.ts \
  tests/scaleOfflineContext.test.ts \
  tests/authRevalidation.test.ts \
  tests/measuredRouteAuthorization.test.ts \
  tests/pedidoTrackingSecurity.test.ts \
  tests/offlineSaleReplay.test.ts \
  tests/saleItemMeasurementService.test.ts \
  tests/saleBatchAllocationService.test.ts \
  tests/returnSchema.test.ts \
  tests/returnService.test.ts \
  tests/returnEndpointGuards.test.ts \
  tests/returnIdempotencyPersistence.test.ts \
  tests/stockTransferQuantity.test.ts \
  tests/publicOrderItems.test.ts \
  tests/quotationItems.test.ts \
  tests/pedidoFulfillmentService.test.ts \
  tests/syncRoute.test.ts \
  tests/cartPersistence.test.ts \
  tests/invoiceTemplate.test.ts \
  tests/receiptTicket.test.tsx \
  tests/thermalPrinter.test.ts \
  tests/salesQuantityReport.test.ts \
  tests/measuredReportExport.test.ts \
  tests/htmlSecurity.test.ts \
  tests/scaleNavigation.test.ts
npm test
npm run check:design
npm run test:mutation
npm run build
git diff --check
```

La revisión integrada final aprobó 81 archivos de pruebas y omitió 4 suites de
integración sin entorno: 1,140 casos pasaron y 14 quedaron omitidos en esa
corrida. Esos 14 casos se ejecutaron aparte contra el backend real y MySQL 8,
con resultado 14/14. También pasaron TypeScript, Prisma 6.4.1
(`validate`/`generate`), el build de producción, el guard del sistema de diseño
y `git diff --check`. El único aviso no bloqueante es el tamaño histórico del
chunk principal de Vite.

El gate oficial de mutación final protege 27 módulos: instrumentó 1,905
mutantes, de los cuales 1,885 son puntuables; 1,873 murieron, 4 terminaron por
hit-limit, 8 sobrevivieron como equivalentes históricos y no hubo ningún
`NoCoverage`. El resultado detectado fue 1,877/1,885
(`99.57559681697613%`) y el umbral monotónico quedó en `99.57`. Los 20
`Ignored` siguen limitados a los literales estáticos documentados de
`IR_TABLE`; no se agregó ninguna exclusión para este alcance.

Las pruebas de integración que requieren base deben ejecutarse contra una base
MySQL 8 descartable, nunca contra producción. Además del resultado verde, se
debe inspeccionar que `db push` solo proponga altas y que no aparezca
`--accept-data-loss`.

Con backend y base descartables ya iniciados:

```bash
NORTEX_QA_BASE_URL="http://127.0.0.1:PUERTO" npx vitest run \
  tests/purchaseFlow.integration.test.ts \
  tests/inventoryAdjust.integration.test.ts \
  tests/stockCountWarehouse.integration.test.ts \
  tests/returnIdempotency.integration.test.ts
```

En la ronda integrada se ejecutaron 4 archivos y 14 casos HTTP normalmente
omitidos (`purchaseFlow`, `inventoryAdjust`, `stockCountWarehouse` y
`returnIdempotency`) contra backend y MySQL 8 descartables. Todos pasaron. Los 2
casos de devolución comprobaron tanto el replay concurrente idéntico —una sola
restauración y la misma devolución— como el payload divergente —un ganador y un
`409 RETURN_IDEMPOTENCY_CONFLICT`, nunca `500`—. El servidor y contenedor
temporales se apagaron, y se verificó que los puertos `3213` y `33309` quedaran
libres.

### 8.2 Casos de aceptación obligatorios

- legado fraccionario sigue funcionando; solo `COUNTED` rechaza `1.5`;
- el paso medido rechaza múltiplos inexactos y más de 4 decimales;
- una compra `PACK` usa el factor persistido del producto y no uno inyectado por
  el cliente;
- una devolución usa `saleItemId`, descuentos históricos y límite por línea aun
  con solicitudes concurrentes;
- una devolución reintentada con el mismo `clientEventId` no repite efectos y
  una reutilización divergente responde `RETURN_IDEMPOTENCY_CONFLICT`;
- precio/producto/tenant alterados por el cliente no cambian el resultado;
- un usuario deshabilitado, degradado o movido de tenant pierde acceso aunque su
  JWT siga vigente; `VIEWER` no puede mutar pedidos/cotizaciones ni buscar ventas
  para devolución;
- etiqueta inválida reconocida no cae a SKU común;
- dos perfiles con prefijos solapados no se publican;
- `TOTAL_PRICE`, `REQUIRE_MATCH` y `ACCEPT_LABEL_TOTAL` no se publican;
- reintento con el mismo evento no duplica y un segundo paquete confirmado sí;
- versión revocada offline devuelve conciliación sin reinterpretación;
- el mismo `offlineId` solo se omite si coincide `offlinePayloadHash`; payload
  divergente o fila histórica sin hash queda en conciliación;
- FEFO coincide online/offline y conserva faltante offline conciliable;
- fallo de contabilidad revierte venta, stock, lote y Kardex;
- ticket, factura, WhatsApp y ESC/POS muestran cantidad, unidad, precio unitario
  y total;
- lectura cero, negativa, inestable o con sobrecarga nunca queda capturable;
- una venta `LIVE_SCALE` se rechaza hasta aprobar un adaptador físico;
- reserva, cancelación y entrega concurrentes serializan primero sobre `Pedido`;
- tracking exige capacidad firmada vigente y su DTO no expone PII, GPS, notas ni
  teléfono del motorizado.

## 9. Riesgos y límites conocidos

| Riesgo/límite | Mitigación actual / siguiente paso |
|---|---|
| Existencias y varias cantidades históricas siguen en `Float`; compras conservan un `Int` legacy. | `Decimal.js` durante validación/cálculo y sombras `Decimal(18,4)` exactas. Planificar migración integral después de medir compatibilidad. |
| Filas históricas no tienen snapshots ni medición. | Campos nullable y fallback de lectura; no inventar evidencia retroactiva. |
| Venta offline histórica con `offlineId` pero sin `offlinePayloadHash`. | No asumir equivalencia: devolver `OFFLINE_PAYLOAD_MISMATCH` como conciliación requerida. |
| Devolución histórica sin `clientEventId`/`payloadHash`. | Se conserva legible; solo la API actual exige idempotencia verificable. No etiquetar retroactivamente una fila como replay. |
| Pedido público legacy pendiente sin snapshot operativo/fiscal completo. | Conversión bloqueada con `RECONCILIATION_REQUIRED`; revisar y recrear explícitamente, sin asumir IVA/precio. |
| El enlace público de tracking expira a los 7 días y todavía no hay endpoint de reemisión. | Consultar el pedido desde el dashboard autenticado; si se necesita más vigencia, implementar reemisión autenticada sin volver al UUID como credencial. |
| El bundle principal sigue generando aviso de chunk grande. | Mantener rutas pesadas lazy y separar chunks antes de ampliar drivers/protocolos. |
| No se probó una balanza física dominante del piloto. | Recoger marca, modelo, manual, frames y etiquetas reales; certificar la combinación exacta antes de habilitar ventas en vivo. |
| Web Serial depende de contexto seguro, permisos y navegador. Android WebView/Capacitor es limitado. | Usar Chrome de escritorio validado para laboratorio; evaluar puente nativo por modelo para Android. |
| Web Serial y simulador son genéricos. | Solo lectura y diagnóstico; el backend rechaza `LIVE_SCALE` hasta tener adaptador aprobado. |
| Sin tara, calibración, configuración ni escritura a balanza. | Mantener esas acciones fuera de Nortex hasta revisión técnica y metrológica específica. |
| `TOTAL_PRICE` no contiene cantidad independiente. | No publicar ni inferir peso desde precio vigente; reimprimir por peso o capturar manualmente. |
| Versión revocada con cola offline. | Estado durable `reconciliation_required`; nunca cambiar de perfil ni aceptar/borrar automáticamente. La resolución actual es manual con administrador/soporte y debe contrastar ticket, stock y versión antes de retirar la evidencia local. |

## 10. Criterio para certificar una balanza real

Una combinación solo puede pasar de experimental a soportada cuando exista:

1. marca, modelo y firmware identificados;
2. transporte/plataforma definidos;
3. manual o conjunto suficiente de frames y etiquetas reales;
4. pruebas de cero, estabilidad, negativo, overload, desconexión y reconexión;
5. prueba de precisión y unidad sin comandos de escritura;
6. venta online/offline, idempotencia, impresión y conciliación verificadas;
7. matriz explícita de navegador/SO/dispositivo;
8. aprobación del piloto y versión fija del adaptador.

Hasta completar esa lista, Nortex soporta la ruta de **etiqueta EAN-13
configurada** y una fundación read-only para hardware; no “cualquier balanza”.
