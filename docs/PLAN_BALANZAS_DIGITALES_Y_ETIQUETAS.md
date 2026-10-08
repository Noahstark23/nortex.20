# Plan técnico — Balanzas digitales y etiquetas de peso/precio

> Subplan de
> [`PLAN_COMERCIOS_HIBRIDOS_CARNES_AGROPECUARIA.md`](./PLAN_COMERCIOS_HIBRIDOS_CARNES_AGROPECUARIA.md).
>
> Objetivo: que Nortex pueda facturar carne, pollo, queso, concentrado y otros
> productos medidos leyendo la etiqueta que imprime una balanza o capturando un
> peso estable desde hardware compatible, sin confiar en el navegador para
> decidir producto, precio, impuesto o inventario.

---

## 1. Decisión ejecutiva

Se implementarán dos carriles independientes:

1. **Etiqueta primero.** Nortex leerá con el escáner actual los códigos que ya
   imprime la balanza, extraerá PLU + peso o precio mediante un perfil
   configurable y creará una línea medida. Es el MVP porque no exige controlar
   el hardware ni instalar drivers.
2. **Peso en vivo después.** Nortex se conectará directamente solo a
   combinaciones certificadas de `marca + modelo + transporte + plataforma`.
   Cada protocolo se encapsulará en un adaptador; no se prometerá compatibilidad
   genérica con “cualquier balanza”.

La balanza aporta una **medición**. Nortex mantiene autoridad sobre producto,
unidad base, precio, descuentos, impuestos, stock, lotes y factura.

### Resultado esperado en caja

```text
Escanear etiqueta 2012345012509
             │
             ├── perfil publicado: Carnicería EAN-13 v3
             ├── PLU 12345 → Pollo entero
             ├── valor 01250 → 1.250 lb
             └── precio Nortex C$ 48.00/lb

Línea: 1.250 lb × C$ 48.00/lb = C$ 60.00
```

El ejemplo es ilustrativo. Los offsets, prefijos y decimales no se deben
hardcodear: dependen del perfil publicado para esa tienda y esa balanza.

---

## 2. Alcance y límites

### Incluido

- etiquetas lineales EAN-13 de medida variable mediante lector tipo teclado;
- perfiles versionados para layouts locales o de fabricante;
- mapeo PLU → producto por tenant y por versión de perfil;
- etiquetas que codifican peso, precio total o cantidad;
- precio recalculado o validado contra el maestro de Nortex;
- venta online y offline con la misma semántica;
- captura estable desde una balanza en vivo mediante adaptadores aprobados;
- trazabilidad de origen en la línea vendida;
- tickets y facturas con cantidad, unidad y precio por unidad;
- base futura para GS1 DataMatrix/QR con peso, lote y vencimiento.

### Fuera del MVP

- calibrar, ajustar o certificar la balanza;
- enviar comandos de tara, cambio de precio o configuración al equipo;
- garantizar compatibilidad con un modelo no probado;
- inferir automáticamente qué formato usa una tienda y activarlo sin revisión;
- aceptar silenciosamente un precio impreso que no coincide con Nortex;
- controlar producción, despiece o rendimiento de carne;
- sincronizar catálogos/precios hacia cada marca de balanza.

La primera integración con hardware será **solo lectura**. Cualquier escritura a
una balanza se tratará como un proyecto posterior, específico del fabricante y
con revisión metrológica.

---

## 3. Base actual verificada

| Área | Estado actual | Consecuencia |
|---|---|---|
| Escáner POS | `components/POS.tsx` acumula teclas rápidas, espera `Enter` y busca coincidencia exacta con `sku`. | Un lector de etiqueta tipo keyboard wedge ya puede entrar al POS, pero hoy termina como `+1 unidad`. |
| Carrito | Las líneas se fusionan por producto y `addToCart` suma uno. | Dos paquetes pesados del mismo producto necesitan identidad de línea propia; no deben fusionarse solo por `productId`. |
| Offline | `lib/db.ts` guarda nombre, cantidad, precio, costo y descuento. | Falta origen de medición, perfil/version, unidad, código y evento idempotente. |
| Sync | `backend/routes/sync.ts` implementa un camino de venta distinto a `salesService.ts`. | El servidor debe reutilizar un contrato/parser común o el online y offline validarán distinto. |
| Android | Capacitor carga la web remota y el manifiesto solo declara `INTERNET`. | No existe aún permiso ni plugin USB/Bluetooth/serial. |
| Impresión | El repositorio ya usa Web Serial para impresoras térmicas. | Sirve como patrón de UX en escritorio, no como garantía de compatibilidad con balanzas. |

### Restricción de plataforma decisiva

- Chrome de escritorio ofrece Web Serial con permiso explícito del usuario.
- Chrome para Android incorporó Web Serial, pero Chromium mantiene Web Serial
  desactivado dentro de Android WebView.
- La app Nortex actual corre dentro de Capacitor WebView; por tanto, el camino
  Android confiable será un **plugin nativo Capacitor** o, como alternativa de
  despliegue, abrir la PWA en Chrome completo para modelos validados.

Esto debe probarse con detección de capacidades; nunca se asumirá soporte por
la versión del sistema operativo.

---

## 4. Arquitectura objetivo

```text
                    CONFIGURACIÓN PUBLICADA
         perfil versión + PLU mappings + política de precio
                              │
                              ▼
┌────────────────┐   ┌──────────────────┐   ┌───────────────────┐
│ Lector/cámara  │──►│ ScaleInputRouter │──►│ ScaleLabelParser  │
└────────────────┘   └──────────────────┘   └─────────┬─────────┘
                                                     │
┌────────────────┐   ┌──────────────────┐             │
│ Balanza física │──►│ ScaleAdapter     │─────────────┤
└────────────────┘   │ lectura estable  │             │
                     └──────────────────┘             ▼
                                            borrador de línea medida
                                                     │
                                                     ▼
                                       contrato único online/offline
                                                     │
                                                     ▼
                                      servidor revalida / vuelve a parsear
                                                     │
                             ┌───────────────────────┼────────────────────┐
                             ▼                       ▼                    ▼
                      producto/tenant         precio/impuestos     stock/lote/Kardex
                             └───────────────────────┼────────────────────┘
                                                     ▼
                                            SaleItem + medición
                                                     ▼
                                         ticket / factura / reimpresión
```

### Componentes nuevos

1. `ScaleInputRouter`: decide si una entrada es SKU normal, etiqueta de balanza
   o un formato 2D reconocido.
2. `ScaleLabelParser`: biblioteca pura y determinística, compartida por cliente
   y servidor, sin acceso a red ni base de datos.
3. `ScaleAdapter`: contrato común para lecturas en vivo.
4. `ScaleProfileService`: publicación/versionado de configuración y mapeos.
5. `SaleMeasurementService`: normaliza, audita e incorpora la medición a la
   transacción de venta.

---

## 5. Carril A — Etiquetas impresas

### 5.1 Formatos que se soportarán

| Prioridad | Formato | Uso |
|---|---|---|
| P0 | EAN-13 de circulación restringida/configurable | Etiquetas actuales de carnicerías y pollerías, leídas como teclado. |
| P1 | UPC-A u otro layout lineal solicitado por el piloto | Solo con muestras y perfil publicado. |
| P2 | GS1 DataMatrix / GS1 QR / GS1 DataBar | Peso, precio, lote, vencimiento o serial mediante Application Identifiers. |
| P3 | Código propietario no estándar | Adaptador de parser solo si existe documentación y volumen comercial. |

GS1 reserva estructuras para artículos de medida variable, pero las reglas de
los números de circulación restringida dependen del mercado/organización. Por
eso Nortex necesita perfiles configurables y versionados; no basta con asumir
que todo código que empieza en `20` usa el mismo layout.

### 5.2 Perfil declarativo

Cada versión publicada debe definir como mínimo:

| Campo | Ejemplo | Regla |
|---|---|---|
| `symbology` | `EAN_13` | Lista cerrada. |
| `totalLength` | `13` | Límite exacto y acotado. |
| `prefixes` | `["20", "21"]` | Prefijos explícitos; no regex libre. |
| `itemStart`, `itemLength` | `2`, `5` | Offset y longitud del PLU. |
| `valueStart`, `valueLength` | `7`, `5` | Offset y longitud del valor variable. |
| `valueKind` | `WEIGHT` | `WEIGHT`, `TOTAL_PRICE` o `COUNT`. |
| `impliedDecimals` | `3` | `01250` → `1.250`. |
| `sourceUnit` | `lb` | Unidad que representa la balanza. |
| `checksumMode` | `EAN13` | Obligatorio cuando la simbología lo define. |
| `pricePolicy` | `RECALCULATE` | Política descrita en 5.6. |
| `roundingTolerance` | `0.01` | Dinero exacto, nunca porcentaje implícito. |
| `minValue`, `maxValue` | `0.001`, `100` | Límites razonables para el perfil. |

No se permitirá JavaScript, expresiones evaluables ni regex arbitrarias en la
configuración. Los offsets deben quedar dentro de la longitud total y no pueden
solaparse con el dígito verificador de forma inválida.

### 5.3 Publicación y versionado

- un perfil empieza como `DRAFT`;
- el administrador carga o escanea al menos tres muestras conocidas;
- Nortex muestra el desglose de cada posición y el resultado esperado;
- todas las muestras deben pasar longitud, prefijo, checksum, PLU y valor;
- al publicar se crea una versión inmutable;
- editar offsets, decimales, unidad, política o mapeos crea otra versión;
- ventas y colas offline conservan el `profileVersionId` usado al capturar.

Una versión insegura puede marcarse `REVOKED`. Una venta offline pendiente que
la use pasa a conciliación; no se reinterpreta silenciosamente con la versión
nueva.

### 5.4 Mapeo de productos

El PLU no debe guardarse como un único `Product.pluCode`, porque dos balanzas
pueden usar PLU distintos para el mismo producto. El mapeo correcto es:

```text
profileVersionId + plu → productId + sourceUnit
```

Restricciones:

- `@@unique([tenantId, profileVersionId, plu])`;
- el producto debe pertenecer al mismo tenant;
- el producto debe admitir `MEASURED` o `COUNTED` según el `valueKind`;
- la unidad origen debe poder convertirse exactamente a la unidad base;
- publicar una versión copia una foto inmutable de los mapeos aprobados.

### 5.5 Pipeline de escaneo

Orden del router:

1. normalizar únicamente terminador y caracteres de control del lector;
2. limitar tamaño y rechazar caracteres incompatibles con la simbología;
3. buscar perfiles publicados del tenant que coincidan en longitud + prefijo;
4. si hay uno, validar checksum y parsear;
5. si hay más de uno, rechazar como configuración ambigua;
6. si ningún perfil coincide, buscar SKU/código común exacto;
7. nunca degradar una etiqueta reconocible pero inválida a `1 unidad`.

El cliente puede parsear localmente para mantener rápido el mostrador. Al
confirmar o sincronizar, el servidor recibe el código y la versión, vuelve a
parsear y deriva producto/cantidad. No confía en `productId`, peso o precio
calculados por el cliente.

### 5.6 Autoridad de precio

| Política | Comportamiento | Uso recomendado |
|---|---|---|
| `RECALCULATE` | Usa peso/cantidad de la etiqueta y precio vigente de Nortex. Ignora el total impreso salvo para auditoría. | **Default.** |
| `REQUIRE_MATCH` | Recalcula y exige que el total impreso coincida dentro de tolerancia; si no, pide acción autorizada. | Cuando balanza y Nortex sincronizan precios. |
| `ACCEPT_LABEL_TOTAL` | Acepta el total impreso, conserva precio unitario efectivo y exige perfil/equipo aprobado + permiso de gerente. | Excepción controlada, no MVP general. |

Impuestos, descuentos y redondeo final siempre se calculan en el servidor.

Si una etiqueta contiene **solo precio total**, no siempre se puede recuperar
un peso fiable cuando el precio maestro cambió. Ese layout se habilita solo si
la política define cómo resolver la diferencia; de lo contrario se exige
reimpresión o captura manual del peso.

### 5.7 Doble escaneo

Un EAN-13 variable puede repetirse legítimamente: dos paquetes pueden tener el
mismo PLU y exactamente el mismo peso. Por eso no se bloqueará para siempre una
huella idéntica.

- si el formato incluye serial único, se usa como idempotencia estricta;
- si no incluye serial, un reescaneo idéntico dentro de una ventana corta
  muestra `¿Agregar otro paquete igual?`;
- el `clientEventId` evita que un mismo evento offline se sincronice dos veces;
- el cajero puede confirmar dos paquetes físicamente distintos;
- la auditoría distingue “confirmado como duplicado físico” de un reintento.

---

## 6. Carril B — Peso en vivo

### 6.1 Contrato del adaptador

```ts
interface ScaleAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): ScaleCapabilities;
  subscribe(listener: (measurement: ScaleMeasurement) => void): Unsubscribe;
}

type ScaleMeasurement = {
  value: string;          // Decimal serializado, nunca float binario
  unit: "g" | "kg" | "oz" | "lb";
  stable: boolean;
  negative: boolean;
  overload: boolean;
  capturedAt: string;
  deviceId: string;
  adapterVersion: string;
};
```

El adaptador interpreta frames del fabricante y emite un contrato común. El
núcleo del POS no conoce bytes, baud rate ni comandos propietarios.

### 6.2 Estados de UX

```text
DISCONNECTED
     │ conectar (gesto del usuario)
     ▼
CONNECTING ──error──► ERROR
     │
     ▼
READY_UNSTABLE ──peso estable──► READY_STABLE
     ▲                                  │
     └──────── cambia el peso ──────────┤
                                        │ Capturar
                                        ▼
                                     CAPTURED
```

Reglas:

- el cajero selecciona primero el producto y pulsa `Pesar`;
- solo se habilita `Capturar` con lectura estable, positiva y sin overload;
- el peso debe respetar unidad, límites y paso del producto;
- una lectura capturada queda congelada en la línea;
- cambios posteriores en la balanza no mutan el carrito;
- timeout o desconexión dejan fallback manual, marcado en auditoría;
- el MVP no envía tara, calibración ni comandos de configuración.

### 6.3 Transportes y prioridad

| Transporte | Plataforma | Estrategia |
|---|---|---|
| Keyboard wedge | Web/Android/iOS | Parsear una lectura terminada en Enter si el equipo emula teclado y existe protocolo inequívoco. |
| Serial/USB | Chrome escritorio | Web Serial con permiso del usuario y un adaptador por protocolo. |
| Bluetooth Classic RFCOMM | Chrome completo Android | Spike controlado; no aplica automáticamente a Capacitor WebView. |
| USB Host | App Android Capacitor | Plugin nativo con permiso explícito, filtro de dispositivos y API mínima. |
| Bluetooth Classic/BLE | App Android Capacitor | Plugin nativo, permisos runtime y adaptador por modelo. |
| BLE GATT | iOS/Android | Plugin nativo solo para perfiles GATT documentados. |
| MFi/External Accessory | iOS | Solo fabricante/protocolo autorizado y modelo validado. |
| RS-232/COM heredado | Windows | Web Serial si el navegador lo expone; si no, bridge local firmado en fase posterior. |
| Red local | Cualquier plataforma | Adaptador específico; jamás sockets/hosts arbitrarios configurables desde el POS. |

### 6.4 Plugin Android

El plugin Capacitor debe exponer únicamente:

- `listApprovedDevices`;
- `requestConnection`;
- `startReadings` / `stopReadings`;
- `disconnect`;
- eventos de estado y medición normalizada.

No expondrá lectura/escritura USB genérica ni ejecución de comandos. El
manifiesto agregará solo las capacidades necesarias al transporte elegido:
USB Host y/o permisos Bluetooth modernos. El usuario debe aceptar el
dispositivo y Nortex debe restringir vendor/product IDs cuando estén disponibles.

Como la app carga contenido web remoto, el puente nativo debe aceptar llamadas
solo desde el origen Nortex permitido, bloquear navegación ajena y validar
argumentos también en código nativo.

### 6.5 Bridge local opcional

Para balanzas antiguas conectadas a un PC con driver propietario:

```text
Balanza/COM → Agente Nortex firmado → localhost WebSocket → POS
```

Condiciones para abrir esta fase:

- no existe camino Web Serial/nativo viable;
- hay suficientes clientes con el mismo modelo;
- instalación, actualización y firma del agente están resueltas;
- pairing con token rotatorio, allowlist de origen y protocolo de solo lectura;
- logs sin secretos ni payloads ilimitados;
- health check y versión visible para soporte.

---

## 7. Modelo de datos aditivo

### Entidades propuestas

| Modelo | Campos principales | Notas |
|---|---|---|
| `ScaleLabelProfile` | `id`, `tenantId`, `name`, `status` | Identidad lógica del formato dentro del tenant. |
| `ScaleLabelProfileVersion` | `id`, `tenantId`, `profileId`, `version`, campos de parser, `pricePolicy`, `publishedAt` | Inmutable una vez publicada. `@@unique([tenantId, profileId, version])`. |
| `ScaleProductMapping` | `tenantId`, `profileVersionId`, `plu`, `productId`, `sourceUnit` | Foto de mapeos por versión. |
| `ScaleDevice` | `id`, `tenantId`, `name`, `manufacturer`, `model`, `transport`, `protocolKey`, `adapterVersion`, `status` | Sin secretos en JSON abierto; credenciales cifradas/server-side si alguna integración las necesita. |
| `SaleMeasurement` | `tenantId`, `saleItemId`, `source`, `profileVersionId?`, `deviceId?`, `sourceValue`, `sourceUnit`, `baseQuantity`, `encodedPrice?`, `pricingPolicy`, `stable?`, `clientEventId`, `payloadHash?`, `capturedAt`, `userId` | Snapshot auditable de la medición. |

### Decisiones de persistencia

- `SaleItem.quantity` sigue siendo la cantidad descontada en unidad base.
- `SaleMeasurement.baseQuantity` debe coincidir exactamente con esa cantidad.
- el código completo se envía al servidor para reparseo, pero por defecto se
  persisten hash + campos extraídos; guardar el código crudo requiere motivo de
  soporte y retención limitada;
- `clientEventId` es UUID generado al capturar y tiene índice único por tenant;
- los perfiles no se borran si existen ventas o colas que los referencian;
- todos los campos numéricos nuevos usan `Decimal(18,4)` o precisión mayor si el
  estándar lo exige; en tránsito se serializan como string.

La migración es estrictamente aditiva. No se reemplazan campos `Float` ni se
eliminan columnas históricas en el mismo despliegue.

---

## 8. Contratos y endpoints

### Administración

```text
GET    /api/scale-label-profiles
POST   /api/scale-label-profiles
POST   /api/scale-label-profiles/:id/versions
POST   /api/scale-label-profile-versions/:id/test
POST   /api/scale-label-profile-versions/:id/publish
POST   /api/scale-label-profile-versions/:id/revoke
PUT    /api/scale-label-profile-versions/:id/mappings

GET    /api/scale-devices
POST   /api/scale-devices
POST   /api/scale-devices/:id/test-reading
```

- crear/editar/publicar/revocar requiere rol dueño/administrador;
- `test` no crea venta, stock, Kardex ni movimiento contable;
- todos los queries filtran `tenantId` derivado del JWT;
- publicación y revocación generan AuditLog before/after.

### Captura por etiqueta

```json
{
  "source": "SCALE_LABEL",
  "clientEventId": "uuid",
  "profileVersionId": "profile-version-id",
  "rawCode": "2012345012509"
}
```

El servidor deriva `productId`, cantidad base y precio. Si el cliente también
manda valores de vista previa, se ignoran como autoridad y solo sirven para
detectar discrepancia diagnóstica.

### Captura en vivo

```json
{
  "source": "LIVE_SCALE",
  "clientEventId": "uuid",
  "productId": "product-id",
  "deviceId": "scale-device-id",
  "adapterVersion": "cas-pd2:1",
  "value": "1.250",
  "unit": "lb",
  "stable": true,
  "capturedAt": "2026-08-22T18:00:00.000Z"
}
```

El servidor no puede volver a observar el peso físico. Debe validar dispositivo
activo, protocolo, edad de lectura, unidad, rango, paso, tenant y rol; luego
calcula precio/impuesto/stock. Una lectura manual o física seguirá siendo un
hecho auditable, no una prueba criptográfica de la balanza.

### Errores estables para UX

| Código | Mensaje/acción |
|---|---|
| `SCALE_PROFILE_NOT_FOUND` | “Esta etiqueta no tiene un formato configurado.” |
| `SCALE_PROFILE_AMBIGUOUS` | “Dos perfiles coinciden; corregí la configuración.” |
| `BARCODE_CHECKSUM_INVALID` | “La etiqueta está dañada o no corresponde al perfil.” |
| `SCALE_PLU_NOT_MAPPED` | “PLU 12345 no está vinculado a un producto.” |
| `SCALE_VALUE_OUT_OF_RANGE` | “El peso/precio está fuera del rango permitido.” |
| `SCALE_UNIT_MISMATCH` | “La balanza reporta kg y el producto no tiene conversión aprobada.” |
| `LABEL_PRICE_MISMATCH` | Mostrar total etiqueta vs total Nortex y acción autorizada. |
| `SCALE_UNSTABLE` | “Esperá a que el peso se estabilice.” |
| `SCALE_DISCONNECTED` | Reintentar o captura manual. |
| `SCALE_PROFILE_REVOKED` | Enviar a conciliación, no reinterpretar. |

---

## 9. Offline e idempotencia

### Caché local

IndexedDB debe almacenar, siempre separado por tenant:

- versiones publicadas necesarias para el POS;
- mapeos PLU/producto de esas versiones;
- fecha de actualización y hash de configuración;
- política de revocación recibida en la última sincronización.

### Línea offline

La cola conserva:

- `clientEventId`;
- origen de medición;
- `profileVersionId` + código crudo para etiqueta;
- o `deviceId`, adapter version, valor, unidad, estabilidad y fecha para vivo;
- presentación/unidad visible para rehidratar el carrito;
- nunca trata el precio local como autoridad final.

Al sincronizar:

1. la venta usa la misma idempotency key actual;
2. el servidor vuelve a parsear etiquetas con la versión capturada;
3. revalida producto, precio, impuesto, stock y tenant;
4. si una política comercial exige confirmar una diferencia, la venta queda en
   `RECONCILIATION_REQUIRED`; no se cambia el total en silencio;
5. el mismo `clientEventId` no crea dos mediciones ni dos líneas.

---

## 10. Metrología, seguridad e integridad

### Metrología comercial

MIFIC indica que las balanzas usadas para venta al consumidor están sujetas a
control/inspección metrológica. Nortex no sustituye esa obligación:

- el comercio conserva responsabilidad sobre balanza, calibración y
  verificaciones aplicables;
- el setup registra marca, modelo, serie opcional, resolución y fecha/estado de
  verificación informada por el negocio;
- Nortex nunca muestra “balanza certificada” sin evidencia vigente;
- el software no altera medición, tara ni parámetros metrológicos en el MVP;
- antes del piloto comercial se valida el requisito con MIFIC/asesoría local.

Esto es un gate operativo, no una conclusión legal automática para cada equipo.

### Controles de aplicación

- tenant siempre desde JWT, nunca desde body;
- perfiles, dispositivos, mappings, productos y ventas filtrados por tenant;
- parser con longitud, offsets y listas cerradas; sin ejecución dinámica;
- checksum, rangos, unidades y pasos antes de crear la línea;
- precio, impuesto, descuento, factor de conversión y stock desde servidor;
- eventos y publicación/revocación auditados;
- configuración nativa allowlisted; sin comandos USB/Bluetooth arbitrarios;
- permiso de hardware solicitado por gesto del usuario;
- logs con payload hash y códigos de error; código crudo redactado por defecto;
- límites de request, rate limit en test/parser y paginación en listados;
- una discrepancia nunca degrada silenciosamente a venta normal.

### Amenazas específicas

| Amenaza | Control |
|---|---|
| Cambiar dígitos para reducir peso/precio | Checksum, límites y reparseo server-side. |
| Usar PLU de otro tenant | Mapping versionado y lookup con tenant JWT. |
| Manipular cantidad/precio en DevTools | Servidor deriva etiqueta y recalcula venta. |
| Reintento offline duplicado | Idempotency key de venta + `clientEventId`. |
| Dos paquetes legítimos con código idéntico | Confirmación de duplicado rápido, no bloqueo global. |
| Perfil cambiado mientras caja estaba offline | Versión inmutable; revocación lleva a conciliación. |
| Página ajena llama al plugin Android | Origen/navegación restringidos + API nativa mínima y validada. |
| Frame serial malformado o infinito | Longitud máxima, timeout y parser por protocolo. |

---

## 11. UX de configuración y caja

### Asistente de etiquetas

1. Elegir “Mi balanza imprime etiqueta”.
2. Escanear tres etiquetas reales con valores distintos.
3. Escribir lo que aparece impreso: PLU, peso/unidad y precio si existe.
4. Nortex propone longitud, prefijo, offsets y decimales.
5. El administrador confirma cada campo y mapea los PLU.
6. Se ejecutan vectores positivos y negativos.
7. Solo entonces se publica la versión.

La propuesta automática nunca publica por sí sola.

### Caja — etiqueta válida

- sonido/estado visual distinto al SKU común;
- muestra producto, valor extraído, unidad, precio/unidad, total y origen;
- si la etiqueta tiene total, muestra si fue ignorado, validado o aceptado;
- agrega una línea independiente por paquete;
- permite corregir solo con permiso según política y deja AuditLog.

### Caja — balanza en vivo

- selector visible de equipo cuando hay más de uno;
- badge `Conectada`, `Inestable`, `Lista` o `Desconectada`;
- valor grande con unidad y resolución del equipo;
- botón `Capturar peso` solo en estable;
- fallback manual con motivo opcional/obligatorio según tenant;
- la factura no depende de que el equipo siga conectado después de capturar.

---

## 12. Estrategia de pruebas

### Parser unitario y de mutación

- EAN-13 válido y checksum inválido;
- cada prefijo publicado y uno desconocido;
- offsets fuera de rango o solapados;
- peso con 0/1/2/3/4 decimales implícitos;
- precio total y cantidad;
- PLU inexistente/cross-tenant;
- mínimo, máximo, cero y overflow;
- conversión kg↔g y lb↔oz solo cuando está aprobada;
- discrepancia de precio dentro/fuera de tolerancia;
- dos perfiles coincidentes;
- inputs enormes, no numéricos y caracteres de control.

### Venta e integración

- cliente altera `productId`, peso o precio después del parseo local;
- servidor deriva el valor correcto desde el código;
- línea medida descuenta exactamente stock/lote/Kardex;
- misma etiqueta online/offline produce igual resultado;
- reintento con mismo evento no duplica;
- dos paquetes iguales confirmados crean dos líneas;
- perfil viejo aún interpreta una cola previa;
- perfil revocado envía a conciliación;
- precio/tax snapshot y factura permanecen estables al cambiar producto después.

### Adaptadores en vivo

- frames capturados y anonimizados por modelo como fixtures dorados;
- estable/inestable, negativo, cero, overload y unidad inesperada;
- frame partido, varios frames juntos, basura y timeout;
- conectar, denegar permiso, desconectar y reconectar;
- cambiar peso después de capturar no cambia la línea;
- contrato de hardware con equipo real fuera de CI;
- matriz smoke por modelo + SO + transporte + versión de app.

### Seguridad

- acceso cross-tenant a perfil, mapping y dispositivo;
- rol sin permiso publica/revoca o acepta diferencia;
- plugin rechaza origen/argumento no permitido;
- payload/log no expone secretos ni código completo innecesario;
- fuzzing del parser declarativo y del parser de frames.

---

## 13. Plan de entrega

### BZ0 — Discovery y gate metrológico

- visitar o entrevistar 3–5 negocios piloto;
- inventariar marca, modelo, foto de placa, transporte y plataforma de caja;
- recolectar al menos 10 etiquetas por formato con valores impresos conocidos;
- obtener manual/protocolo o contacto del distribuidor;
- verificar condición metrológica requerida para el piloto;
- elegir **un formato de etiqueta** y **un modelo de balanza viva** objetivo.

**Salida:** matriz real de hardware/formato y muestras anonimizadas aprobadas.

### BZ1 — Fundamento de productos medidos

Depende de A1–A6 del plan principal:

- Decimal y unidad base consistentes;
- producto `MEASURED`;
- líneas independientes y snapshots;
- contrato único de venta;
- factura con `cantidad + unidad + precio/unidad`.

**Salida:** captura manual medida funciona de punta a punta.

### BZ2 — MVP etiqueta EAN-13

- `ScaleLabelParser` puro + vectores;
- modelos versionados y mappings;
- router antes del match de SKU;
- vista previa local y reparseo server-side;
- política `RECALCULATE`;
- medición/snapshot y ticket;
- errores accionables.

**Salida:** el formato elegido se factura sin redigitar y sin aceptar precio del
cliente.

### BZ3 — Administración y offline

- asistente de muestras;
- publicar/revocar/auditar versiones;
- caché tenant-scoped;
- contrato de sync único e idempotente;
- conciliación de perfil revocado o precio discrepante;
- telemetría de códigos rechazados sin guardar payload crudo por defecto.

**Salida:** mismo resultado online/offline y soporte reproducible.

### BZ4 — Piloto de etiquetas

- shadow mode inicial: Nortex compara pero el cajero confirma;
- medir tasa de lectura, PLU no mapeado, diferencias y correcciones manuales;
- validar tickets, cierre de caja, stock, lotes y devoluciones;
- activar flujo normal solo cuando los casos oro pasan.

**Gate:** ≥99.5 % de etiquetas del formato piloto interpretadas correctamente,
cero diferencias silenciosas y cero ventas duplicadas por reintento. La meta se
mide sobre un volumen mínimo acordado antes del piloto.

### BZ5 — Spike y piloto de peso en vivo

- implementar `ScaleAdapter` y simulador;
- escoger transporte adecuado al hardware real;
- primero Chrome escritorio/Web Serial si aplica;
- si el objetivo es Android dentro de la app, crear plugin Capacitor mínimo;
- soportar un único protocolo/modelo;
- estados, timeout, estabilidad, reconexión y fallback;
- contrato y smoke test con equipo físico.

**Gate:** el modelo aparece en una lista de compatibilidad explícita y produce
el mismo efecto de venta que una captura manual equivalente.

### BZ6 — Expansión controlada

- segundo/tercer modelo según demanda;
- GS1 2D y cámara;
- lote/vencimiento desde AIs cuando el motor FEFO esté listo;
- bridge local para hardware heredado solo si el caso comercial lo justifica;
- iOS solo con BLE/MFi/protocolo validado;
- exportación de catálogo/precio hacia balanza por adaptador separado.

---

## 14. Matriz de compatibilidad publicada

Nortex debe mostrar soporte de esta forma:

| Marca/modelo | Método | Plataforma | Función | Estado |
|---|---|---|---|---|
| Etiqueta Perfil A | lector USB teclado | Web/Android/iOS | PLU + peso EAN-13 | Certificado por Nortex |
| Modelo piloto X | RS-232/USB | Chrome escritorio N–M | peso estable | Piloto |
| Modelo piloto X | USB | App Android versión N | peso estable | Planeado |

“Certificado por Nortex” significa que la integración de software pasó la
matriz de pruebas; **no** significa certificación metrológica del instrumento.

---

## 15. Información que se debe pedir al primer cliente

- marca y modelo exactos;
- foto de placa/puertos y resolución mostrada;
- cómo se conecta hoy: USB, RS-232, Bluetooth, Wi-Fi, teclado o solo etiqueta;
- sistema de caja: Windows/macOS/Android/iPad y navegador/app;
- 10 etiquetas legibles con distintos productos/pesos;
- texto visible en cada etiqueta: PLU, peso, unidad, precio/kg o lb, total,
  fecha, lote y vencimiento;
- manual de usuario/protocolo y contacto del proveedor;
- si el catálogo/precio se carga en la balanza y cómo;
- qué ocurre al imprimir dos paquetes de igual peso;
- documentación/estado de verificación metrológica aplicable;
- necesidad real: escanear etiqueta, leer peso vivo o ambas.

Sin esta ficha no se agrega un driver ni se comunica compatibilidad.

---

## 16. Fuentes oficiales verificadas

### Códigos y datos variables

- [GS1 General Specifications — versión vigente](https://ref.gs1.org/standards/genspecs/)
- [GS1: Variable Measure Trade Item](https://support.gs1.org/support/solutions/articles/43000734396-what-is-a-variable-measure-trade-item-)
- [GS1 2D Barcodes at Retail POS](https://ref.gs1.org/guidelines/2d-in-retail/)
- [GS1 Application Identifiers](https://ref.gs1.org/ai/)
- [Manual de especificaciones GS1 Nicaragua](https://gs1ni.org/downloads/ManualdeEspecificacionesGS1Nicaragua.pdf)

### Web, Android y conectividad

- [Chrome — Web Serial](https://developer.chrome.com/docs/capabilities/serial)
- [Chrome 148 — Web Serial en Android](https://developer.chrome.com/release-notes/148)
- [Chromium — Web Serial se mantiene desactivado en WebView](https://issues.chromium.org/issues/407822062)
- [Chrome — WebHID](https://developer.chrome.com/docs/capabilities/hid)
- [Chrome — Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Android — USB Host](https://developer.android.com/develop/connectivity/usb/host)
- [Android — permisos Bluetooth](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
- [Android — seguridad de puentes nativos WebView](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)
- [Capacitor — Plugin APIs](https://capacitorjs.com/docs/plugins)
- [Apple — External Accessory](https://developer.apple.com/documentation/externalaccessory/)

### Metrología en Nicaragua

- [MIFIC — Metrología Legal](https://www.mific.gob.ni/Inicio/Comercio/Comercio-Interior/SNC/ML)
- [MIFIC — inspección de balanzas comerciales](https://www.mific.gob.ni/Inicio/Fomento/DIPRODEC/Inspecci%C3%B3n-de-Normas-T%C3%A9cnicas)
- [MIFIC — Registro para el Control Metrológico](https://www.mific.gob.ni/Inicio/Comercio/Comercio-Interior/SNC/snn/Registrometrologico)

---

## 17. Definición de terminado

La integración de etiquetas está terminada cuando:

- una etiqueta válida del formato publicado crea la línea correcta sin `+1`;
- el servidor vuelve a derivar producto y cantidad;
- la factura muestra cantidad, unidad, precio por unidad y total;
- stock, lote, Kardex, devolución y offline conservan la misma cantidad;
- códigos inválidos o ambiguos fallan de forma visible;
- diferencias de precio requieren la política/rol definidos;
- la configuración y la venta son reproducibles por versión.

La integración de peso en vivo está terminada por **cada modelo soportado**
cuando además:

- conecta con permiso explícito;
- distingue estable/inestable/negativo/overload/desconectado;
- captura una lectura una sola vez y no muta la línea después;
- tiene fallback manual y pruebas con hardware real;
- aparece en la matriz de compatibilidad con plataforma y versión exactas.

No está terminado con una demo que solo lee bytes de una balanza.
