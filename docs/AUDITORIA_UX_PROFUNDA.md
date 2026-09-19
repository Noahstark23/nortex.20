# Auditoría UX profunda — seis lentes (2026-08-10)

> **Revalidación 2026-09-04:** el cuerpo conserva el análisis histórico de su fecha.
> La evidencia actual está en [AUDITORIA_GENERAL_2026-09-04.md](AUDITORIA_GENERAL_2026-09-04.md)
> y la prioridad en [PLAN_TRANSFORMACION_TOTAL_2026.md](PLAN_TRANSFORMACION_TOTAL_2026.md).
> No ejecutar una receta antigua sin contrastarla con código, pruebas y reglas de integridad.
> Estado local, staging y producción se registran por separado.

> Cambios locales ya presentes: trial 30 días/precio $20, contacto/lifecycle,
> lista de dormidos/export, navegación integrada y PWA con inicio /app/pos.
> La suite local de esta auditoría pasó con omisiones documentadas; no se revalidó
> cada hallazgo UX ni el funcionamiento en dispositivos/producción. Conservar
> los casos de regresión, no volver a implementar por defecto todos los pendientes de agosto.

Seis auditorías independientes sobre el código real de la rama
`claude/nortex-blog-seo-scale-vyt6ug` (HEAD `2f84a28`, R2 mergeado). Cada lente
leyó el código sin ver los hallazgos de los demás, y cada hallazgo cita
`archivo:línea`.

**Lentes:** activación (registro → primera venta) · POS de mostrador · móvil,
red mala y offline · lenguaje y navegación · carga de catálogo · conversión
trial → pago.

**Verificado a mano** (releído directamente sobre el código, no solo reportado):
A1, A2, A3, A5, B1, B2, B5, C1, D1, D2, D3, E2. El resto queda como hallazgo de
agente con su evidencia citada; el detalle de cuál es cuál está marcado en cada
ficha.

---

## Resumen ejecutivo

Nortex tiene el motor bien construido —total autoritativo server-side en
Decimal, stock atómico con Kardex y AuditLog en la misma transacción,
idempotencia por `offlineId`, libro firmado de caja, aislamiento por tenant— y
falla en el último metro: **en los cuatro puntos donde el producto toca dinero
real, el dinero se escapa.**

Los tres titulares:

1. **Hoy es imposible pagarle a Nortex desde el producto.** La pantalla de
   depósito muestra cuentas `XXXX-XXXX-XXXX-4521` y un WhatsApp
   `+505 XXXX-XXXX`; los dos únicos botones de pago del producto llaman a un
   endpoint que no existe.
2. **El POS cobra un 15% de IVA que el sistema no registra.** El cliente paga
   C$115, la base de datos guarda C$100. La caja descuadra a favor todos los
   días y cada fiado se anota 15% por debajo de lo cobrado.
3. **Toda venta hecha sin internet se pierde en silencio.** La cola offline
   nunca devuelve nada por un desajuste de tipo en el índice de IndexedDB: el
   POS dice "Venta registrada con éxito", imprime el ticket, y la venta no
   existe.

Debajo de eso hay un patrón que se repite en los seis lentes: **el trabajo bueno
está escrito y desconectado.** El menú simple existe y el Layout no lo importa.
La pantalla de inicio del pulpero existe y no tiene un solo enlace. La
idempotencia existe y el POS online no la manda. La regla de mayoreo existe,
está testeada, y el POS descarta los campos que la alimentan. El helper de
sesión vencida existe y lo usan 2 de 30 componentes.

---

## Bloque A — Plata que se pierde en el mostrador

### A1 · El POS cobra 15% de IVA que el sistema no registra `CRÍTICO` *(verificado)*

`components/POS.tsx:1249-1250` suma el IVA **encima** del total:

```ts
const taxD = discountedTotalD.mul('0.15');
const grandTotalD = discountedTotalD.plus(taxD);
```

Ese `grandTotal` es lo que muestra el modal de cobro (`POS.tsx:3126`), contra lo
que se calcula el vuelto (`:3196`) y lo que se imprime. Pero
`backend/services/salesService.ts:158-166` calcula el total autoritativo
**sin IVA** (`finalTotal = itemsSubtotal * globalFactor`) y descarta el `total`
que manda el cliente. Y `backend/services/nicaTax.ts:66` trata `Sale.total` como
**IVA incluido** (`netoGravado = gravado / IVA_FACTOR`).

**Qué pasa:** venta de C$100 → el cliente paga C$115, la gaveta tiene C$115, la
BD guarda 100. `expectedCash` (`backend/server.ts:2205,2212`) suma los 100 → el
arqueo arroja **sobrante del 15% en todos los turnos, todos los días**, y el
cuadre deja de servir para detectar robo porque el ruido tapa la señal. En
fiado es peor: `salesService.ts:367` incrementa la deuda por `finalTotal` (100)
mientras el ticket dice 115 → **se regala el 15% de cada crédito, para siempre.**
Además el POS nunca lee `ivaExento`, así que a la pulpería que vende canasta
básica exonerada le cobra un IVA que no corresponde.

**Arreglo:** en Nicaragua el precio de mostrador es IVA incluido. Eliminar
`taxD`/`grandTotalD` del POS, cobrar `discountedTotal` y mostrar el IVA solo
como desglose (`total/1.15`), igual que hace `desglosarVentaConExoneracion`.

### A2 · Toda venta offline se pierde: el índice `synced` nunca matchea `CRÍTICO` *(verificado)*

`lib/db.ts:47` guarda `synced: false` (booleano) y `lib/db.ts:51` consulta
`.where('synced').equals(0)`. En IndexedDB **un booleano no es una clave
válida**: los registros quedan fuera del índice, y aunque estuvieran,
`false ≠ 0`. `getPendingSales()` devuelve **siempre `[]`**.

**Qué pasa:** se corta la luz o el internet, el dependiente sigue vendiendo, el
POS muestra "Venta Registrada con Éxito" (`POS.tsx:1326-1338`) y sale el ticket
— pero la venta queda enterrada. Nunca se sincroniza, el badge de pendientes es
siempre 0, el botón "Sync" nunca aparece, el stock nunca baja, la plata nunca
entra. **Una tarde sin internet = una tarde de ventas inexistentes, sin ninguna
señal de alarma.**

**Arreglo:** persistir el flag como número (`synced: 0` / `markSalesSynced` →
`{ synced: 1 }`), mostrar el contador de pendientes siempre (no solo con
`!isOnline`), bloquear el cierre de caja si hay pendientes, y un test de humo
que guarde una venta y verifique `getPendingSales().length === 1`.

### A3 · Ningún `fetch` tiene timeout: en lie-fi se congela y se pierde la venta `CRÍTICO` *(verificado)*

`grep -rn "AbortController|AbortSignal|signal:" components/ utils/ lib/` → **0
resultados** en todo el frontend. El desvío a la cola offline depende solo de
`if (!navigator.onLine)` (`POS.tsx:1296`), y el fallo cae en
`catch { alert(error.message) }` (`:1379-1380`) **sin** llamar a
`saveSaleOffline`.

**Qué pasa:** el wifi del local dice "conectado" pero no pasa nada.
`navigator.onLine` es `true`, así que el POS manda el POST y espera. La promesa
nunca resuelve ni rechaza: el botón queda con el spinner **para siempre**, sin
mensaje, sin cancelar, sin reintentar. El dueño mata la app y —como el carrito
vive solo en `useState` (`POS.tsx:178`)— **pierde la venta y re-tipea todo con
el cliente enfrente**. Si en cambio el fetch falla, ve
`alert("Failed to fetch")` en inglés y la venta tampoco cae a la cola.

**Arreglo:** `AbortSignal.timeout(8000)` en el POST de `/api/sales` y tratar el
`AbortError` (y cualquier fallo de red) como el camino offline:
`saveSaleOffline` + recibo local + badge de pendiente, con el mensaje "Guardamos
la venta y se sincroniza sola".

### A4 · Doble cobro por dos vías: F9 sin guarda y venta online sin idempotencia `CRÍTICO`

`POS.tsx:1017-1020` — el atajo que la propia UI documenta como "F9 Cobrar"
(`:2613`) no chequea `processing`, ni `e.repeat`, ni si el modal de venta
completada está abierto. Y `handleCheckout` no limpia el carrito al terminar (el
`setCart([])` vive solo en `handleNewSale`, `:1447`). El botón EFECTIVO sí está
protegido (`disabled={processing}`, `:2830`); el atajo no.

En paralelo, el POST de venta **no manda `offlineId`** (`POS.tsx:1342-1354`)
aunque el backend ya deduplica por esa clave (`salesService.ts:102,136-141`).

**Qué pasa:** tres escenarios de mostrador. Dedo apoyado medio segundo en F9 →
el auto-repeat dispara N ventas y N descuentos de stock. El server tarda 3 s, no
hay señal visible, vuelve a apretar → doble venta. Termina la venta, aparece el
modal, aprieta F9 por costumbre con el carrito aún cargado → **la venta entera
se duplica.** Y con lie-fi, la venta llega al server pero la respuesta se pierde:
el cajero ve un error, asume que no pasó, cobra de nuevo → **dos ventas, dos
descuentos de stock, un solo cliente.**

**Arreglo:** `if (e.repeat || processing || completedSale || showCashPreModal) return;`
en el `case 'F9'` (y mejor: que F9 abra el modal de efectivo en vez de cobrar a
ciegas, que hoy saltea el cálculo de vuelto); limpiar el carrito apenas responde
OK; y generar `generateOfflineId()` para **toda** venta, online incluida.

### A5 · El mayoreo y el precio por empaque están muertos `ALTO` *(verificado)*

`components/POS.tsx:314-323` mapea el catálogo a 8 campos y descarta
`wholesalePrice`, `wholesaleMinQty`, `packSize`, `packPrice`, `packUnit` — que
`GET /api/products` sí devuelve y que el schema define. Después `addToCart`
llama a `effectiveUnitPrice({ wholesalePrice: undefined, packSize: undefined })`
→ `utils/pricing.ts:30,36` nunca entra a MAYOREO ni EMPAQUE.

**Qué pasa:** la distribuidora configura "docena a C$90" en Inventario y en el
mostrador el POS le cobra 12 × precio de detalle. El badge MAYOREO nunca
aparece, el botón "+1 CAJA (12)" nunca se dibuja, y el toggle
`Customer.isWholesale` no hace nada. **La regla pura está bien escrita y
testeada; simplemente nunca recibe los datos.** Una feature entera, muerta por
cinco campos en un `map`.

**Arreglo:** agregar los cinco campos al `map` de `fetchProducts` y a
`handleQuickCreate`/`handleCreateProduct` (`POS.tsx:1094-1102`, `:1223-1231`),
que también los pierden.

### A6 · No hay botón de TARJETA ni TRANSFERENCIA `ALTO`

`POS.tsx:2827-2846` — el grid de cobro tiene exactamente dos botones: EFECTIVO y
CRÉDITO. `handleCheckout` acepta `'CARD' | 'QR'` y el backend hasta `TRANSFER`,
pero **ninguna UI los dispara.**

**Qué pasa:** la ferretería que pasa tarjeta o recibe transferencia BAC la
registra como efectivo. `expectedCash` la cuenta como billetes en la gaveta pero
la plata está en el banco → **faltante en cada cierre**, que se confunde con
robo. El reporte de arqueo por método queda siempre en cero.

**Arreglo:** dos botones más llamando a `handleCheckout('CARD')` y `'TRANSFER'`
— el backend y el arqueo ya los soportan.

### A7 · Otros del mostrador `ALTO`/`MEDIO`

- **Falta de stock tumba la venta entera con un CUID en pantalla.**
  `stockService.ts:289-292` arma `"Stock insuficiente para producto cm3x9f0a1..."`
  y el POS lo tira con `alert` (`:1379`). Carrito de 14 renglones, cliente
  esperando, y el dependiente no tiene forma de saber cuál producto es.
- **No se puede vender solo con teclado.** Enter no agrega el único resultado
  filtrado (`:1474-1484`, solo matchea SKU exacto), el buscador no se limpia ni
  recupera el foco tras agregar (`:2578-2580`), y el modal de efectivo no es un
  `<form>`: **Enter no confirma el cobro** y Escape no lo cierra
  (`:3208-3223`). Son 3-5 segundos y dos cambios de mano por venta.
- **Los botones +/− mueven de a media unidad** (`:2767,2774`,
  `updateQuantity(item.id, ±0.5)`). El cliente pide dos gaseosas, el dependiente
  escanea una y toca "+" → queda en 1.5, se reprecia y se descuenta 1.5 de
  stock. `Product.unit` existe y no se usa para elegir el paso.
- **Controles de 22 px, y el de borrar de 14 px sin padding** (`:2767,2774,2778`),
  contra los 44 px recomendados. Rozar el basurero borra la línea sin
  confirmación.
- **El ticket no cuadra con lo cobrado:** `ReceiptTicket.tsx:102` imprime
  `price × quantity` ignorando el descuento por línea, y no hay renglón de
  descuento. El modal de devolución lista `cm3x9f0a...` en vez de nombres
  (`POS.tsx:2925`).

---

## Bloque B — El camino del dinero de Nortex (trial → pago)

### B1 · La pantalla de pago no tiene cuentas bancarias reales `CRÍTICO` *(verificado)*

`components/Billing.tsx:28-30`:

```ts
{ bank: 'BAC Credomatic', number: 'XXXX-XXXX-XXXX-4521', name: 'NORTEX INC.' },
{ bank: 'Lafise Bancentro', number: 'XXXX-XXXX-XXXX-7890', ... },
{ bank: 'Banpro',          number: 'XXXX-XXXX-XXXX-3456', ... },
```

Y el canal de rescate, `Billing.tsx:461`: "Escríbenos al WhatsApp:
**+505 XXXX-XXXX**". El número real (+505 7664-4030) existe en
`public/landing.html:951` y en `backend/services/email.ts:55` — en todos lados
menos en la pantalla donde se paga.

**Qué pasa:** el 100% de los que quieren pagar por transferencia —el único
método viable en Nicaragua— llegan a una pantalla donde no hay a dónde
transferir ni a quién preguntarle. **Se pierde el cliente que ya decidió
comprar**, que es el más caro de conseguir.

**Arreglo:** cuentas reales por variable de entorno (`BANK_ACCOUNTS_JSON`, no
hardcodeadas en el bundle) y el WhatsApp real.

### B2 · Los dos botones de pago llaman a un endpoint que no existe `CRÍTICO` *(verificado)*

`components/Dashboard.tsx:231` → `fetch('/api/billing/subscribe', {method:'POST'})`.
Las rutas de billing que existen en `backend/server.ts` son `webhook`,
`create-session`, `portal`, `status`, `report-manual` y `manual-status`.
**`subscribe` no existe.** El catch-all solo atiende GET fuera de `/api`
(`:9591`), así que Express responde 404 → `throw` → `alert("Error al procesar la
suscripción.")`.

**Qué pasa:** "ACTIVAR PLAN PRO" (banner de trial, `Dashboard.tsx:359`) y
"Activar plan" (banner de vencido, `:376`) —los dos únicos CTAs de pago dentro
del producto— fallan con un error genérico. El usuario concluye que el pago está
roto. Ningún banner enlaza a `/app/billing`.

**Arreglo:** reemplazar `handleReactivate` por `navigate('/app/billing')`. Una
línea, y es el arreglo de mayor retorno de toda la auditoría.

### B3 · El mes 2 exige caer en mora para poder pagar `CRÍTICO`

`Billing.tsx:316` — el formulario de reporte de pago solo se renderiza
`{!hasPendingManual && !isActive && ...}`. El cron horario tira
`ACTIVE + subscriptionEndsAt < now → PAST_DUE` (`server.ts:9614-9617`). Y
`lifecycleEmails.ts:111-117` solo levanta candidatos `TRIAL` o `PAST_DUE con
trialEndsAt de los últimos 7 días` — un cliente que ya pagó tiene `trialEndsAt`
de hace meses o `null`.

**Qué pasa:** el que pagó por transferencia **no puede renovar mientras está al
día**, no recibe ningún aviso antes del vencimiento, y cada mes repite el mismo
pozo: suspensión → enterarse por un `alert` de 402 → transferir → esperar
aprobación manual. Encima `endsAt` se calcula desde la aprobación
(`server.ts:6352-6354`), así que **pierde días en cada ciclo, acumulativamente.**
Se castiga exactamente al cliente que ya demostró que paga.

**Arreglo:** permitir reportar pago siempre (quitar `!isActive`), sumar 30 días
sobre `max(subscriptionEndsAt, now)`, y un aviso de renovación a los -5 días
para tenants no-trial.

### B4 · El comprobante nunca se sube: se manda el nombre del archivo `ALTO`

`Billing.tsx:107` — `proofUrl: proofFile ? proofFile.name : null`. No hay
`FormData` ni endpoint de upload. `SuperAdmin.tsx:545-546` renderiza
`<a href={p.proofUrl}>Ver Voucher</a>` sobre un string tipo `IMG_20260910.jpg`.

**Qué pasa:** el usuario cree que mandó la foto ("Clic para subir foto del
comprobante"). Quien aprueba no tiene con qué verificar y termina yendo al
estado de cuenta del banco por cada pago — o rechazando pagos legítimos con
`'Comprobante inválido o no verificable'` (`server.ts:6846`).

### B5 · Cada peso de ingreso pasa por un clic manual tuyo, sin alerta `ALTO`

`POST /api/billing/report-manual` (`server.ts:6266-6303`) **no notifica a
nadie**: ni email, ni WhatsApp, ni push. La única superficie es el panel
SUPER_ADMIN con SWR cada 30 s (`SuperAdmin.tsx:180`) — si alguien lo tiene
abierto. El rechazo (`:6833-6856`) tampoco notifica al cliente ni deja
`AuditLog`. La aprobación tampoco manda confirmación.

**Qué pasa:** domingo 8 pm el cliente transfiere, reporta y **no pasa nada**. No
puede re-reportar (el backend rechaza el segundo con 400, `:6285-6288`), no
puede pagar por otro lado, y la app le prometió "menos de 24 horas". Esto no
escala: el ingreso está acoplado a que un humano mire una pantalla.

**Arreglo:** notificar al reportar (a Nortex) y al aprobar/rechazar (al cliente),
con las plantillas que ya existen en `email.ts`; y auto-aprobación provisional
de 72 h al reportar, reversible si se rechaza.

### B6 · El contador de días no existe donde vive el usuario `ALTO`

`MiNegocio.tsx` —la pantalla de inicio de PULPERIA— no tiene una sola línea de
billing. `LenderDashboard` tampoco (0 hits de `subscriptionStatus`). El POS y el
Layout tampoco (0 hits de "prueba"/"trial"). Y la propia pantalla de Facturación
**no muestra los días** porque `daysLeft` solo se pinta cuando `isActive`
(`Billing.tsx:181-185`) y `/api/billing/status` ni siquiera devuelve
`trialEndsAt` (`server.ts:6221-6242`).

**Qué pasa:** el pulpero y el prestamista **nunca ven que su prueba corre**. Su
primera noticia del vencimiento es un alert rojo el día 31. Lo que se pierde no
es el pago: es la relación, porque el corte se siente como una emboscada. El
único aviso —EMAIL_TRIAL_ENDING, día 28— se manda **una sola vez en la vida del
tenant** y solo si `RESEND_API_KEY` está configurada.

### B7 · Contradicciones en el momento exacto de pagar `MEDIO`

- El formulario viene precargado en **$25** (`Billing.tsx:43`) mientras la misma
  pantalla dice **$20** dos veces (`:311,:442`). *(verificado)*
- El email EXPIRED promete devolver "reportes y exportes"
  (`email.ts:158`) que **nunca se bloquearon** (son GET).
- La landing dice "Cancelás desde tu panel" (`landing.html:889`), pero la única
  cancelación es el portal de Stripe, visible solo si `isActive && hasStripe`.
- La landing promete "Tres meses sin pagar" a socios fundadores
  (`landing.html:684`); en código el registro da 30 días fijos.

### Nota sobre el paywall (matiz, no hallazgo)

`backend/middleware/billingExempt.ts:35` exime **todo GET** y el camino operativo
de venta. El agente lo reportó como fuga; el comentario del archivo dice que es
una **decisión explícita del CEO** ("NUNCA bloquear el acto de vender"). Se
respeta. Pero vale registrar la consecuencia real: una pulpería vencida puede
vender, cobrar fiado, cuadrar caja, cargar productos y exportar a Excel
indefinidamente, y su plan simple no incluye una sola pantalla bloqueada — nunca
tiene un motivo económico para pagar. Si se mantiene la política, la palanca
tiene que ser otra (cierre de caja con reporte, multi-usuario, respaldo).
Aparte: los tenants con `trialEndsAt = null` **nunca se bloquean ni entran al
cron** (`auth.ts:66-69`, `server.ts:9620` usa `lt: now`, que no matchea NULL) —
prueba infinita e invisible.

---

## Bloque C — Entrar y volver

### C1 · La sesión vence el día 8 de un trial de 30 `CRÍTICO` *(verificado)*

`backend/services/secrets.ts:30` → `const TOKEN_TTL = '7d'`, contra
`trialEndsAt = +30 días` (`server.ts:306`). Dato que duele: el repartidor tiene
`DRIVER_TOKEN_TTL = '30d'` (`secrets.ts:70`). **El dueño del negocio tiene menos
sesión que su motorizado.**

Peor, nadie traduce el 403: `utils/auth.ts:19` tiene el redirect a
`/login?error=session_expired` y lo usan **2 de ~30 componentes**;
`ProtectedApp` solo comprueba que exista la cadena en localStorage, no su `exp`
(`App.tsx:61-62`).

**Qué pasa:** el dueño que cargó su inventario la primera semana vuelve el lunes
8 y ve *"No pudimos cargar tu panel — Revisá tu conexión"* con un "Reintentar"
que recarga eternamente; si va al POS recibe
`alert("Acceso Denegado: Token inválido o expirado.")`. **Nunca le dicen que
solo tiene que volver a entrar.** Concluye que Nortex se rompió, a mitad del
trial y con su inventario adentro. El aviso "Tu sesión venció" existe en
`Login.tsx:74-78` y no se muestra nunca.

**Arreglo:** `TOKEN_TTL = '30d'` (o refresh token) y enrutar los fetch por
`authFetch`/`handleAuthError`, empezando por POS, Dashboard e Inventario; más
chequeo de `exp` en `ProtectedApp`.

### C2 · El catálogo de ejemplo ensucia el inventario y no se puede deshacer `CRÍTICO`

El CTA primario de "Empezá acá" es `seedStarterCatalog` sin confirmación
(`Dashboard.tsx:405-412`), y siembra productos **con stock**
(`backend/data/seedCatalogs.ts:24-38`: arroz 100, gaseosa 48; ferretería:
cemento 40×C$330, bloque 300×C$16). Borrarlos está prohibido con stock
(`server.ts:3514-3518`), ajustar exige tipo de movimiento y un motivo de ≥3
caracteres (`:3649`), y no existe borrado masivo.

**Qué pasa:** el pulpero toca "probar con un catálogo de ejemplo" para ver cómo
funciona y queda con ~C$12,500 de mercadería fantasma (ferretería: ~C$35,000)
que su panel reporta como "Valor Inventario" y que alimenta el score. Para
limpiarlo tiene que registrar **14 mermas falsas en su Kardex** y después 14
borrados: ~28 operaciones para deshacer un clic. En la práctica no lo hace: su
primer "aha" y todos sus reportes quedan sobre inventario que no existe.

**Arreglo:** sembrar con `stock: 0`, o marcar los productos semilla (`isDemo` /
el prefijo `EJ-` que ya se genera) y exponer "Quitar productos de ejemplo" que
salte el guard de stock.

### C3 · `/register` es marketing sin formulario hasta que bajan 2.24 MB `CRÍTICO`

El HTML prerenderizado que se sirve primero (`scripts/prerender.ts:111-118`) es
un `h1` "Crea tu cuenta gratis en Nortex" y un `<p>`, **sin inputs**. React
recién reemplaza `#root` cuando termina de parsear el bundle.

**Qué pasa:** el dueño hace clic en "Empezar gratis" desde el celular y cae en
una página que dice "Crea tu cuenta gratis" donde **no hay dónde escribir**. En
un Android de gama baja con 3G son 10-20 s de pantalla muerta. Es la pérdida más
grande del embudo y ocurre **antes de que exista un usuario**.

### C4 · El giro se elige en 3 segundos, define todo, y no se puede cambiar `ALTO`

`RegisterTenant.tsx:42` → `type: 'FERRETERIA'` como valor inicial del select. Ese
campo decide el catálogo semilla, la rama del onboarding y el modo simple
(`navigation.ts:190-193`, que solo activa el menú simple para `PULPERIA`). **No
existe ningún endpoint para cambiarlo.**

**Qué pasa:** el dueño de una pulpería que no despliega el combo queda
registrado como ferretería para siempre: su catálogo de ejemplo son cemento y
varilla, y nunca califica para el menú simple. Solo se corrige con acceso a la
base de datos.

**Arreglo:** sacar el default (`''` con `<option disabled>` "Elegí tu giro") y
permitir cambiar el `type` desde Configuración.

### C5 · Otros de activación `MEDIO`

- **Cuenta irrecuperable por un typo:** un solo campo de contraseña, sin
  confirmación y sin ojo de "ver" (`RegisterTenant.tsx:257-266`); el email no se
  verifica. Y si el email ya existe, el banner rojo no ofrece ni "Iniciar
  sesión" ni "Recuperar contraseña" en modo modal.
- **"Empezar" del modal de bienvenida no mueve al usuario:** solo abre el panel
  flotante (`OnboardingHub.tsx:154-158,226-231`). Entre "entré" y "cobré mi
  primer córdoba" hay ~25 interacciones y al menos 6 decisiones con vocabulario
  nuevo.

---

## Bloque D — Entender el producto

### D1 · El menú simple está escrito, testeado y desconectado `CRÍTICO` *(verificado)*

`utils/navigation.ts:141` exporta `buildNavigation`. `Layout.tsx` **no importa
`utils/navigation` en absoluto** (verificado por grep): sigue armando a mano 22
ítems en `Layout.tsx:138-200`. Los únicos consumidores del módulo son `App.tsx`
(solo `homePathFor`) y `POS.tsx` (etiquetas).

**De los 22 ítems, 12 no pasan la prueba del pulpero:** "Cajas y Arqueos",
"Toma Física", "Clientes (CRM)", "Compras Inteligentes", "Mercado B2B",
"Facturación" (que no es facturar clientes: es pagarle a Nortex), "Auditoría"
(suena a que lo están investigando), "Mi Espacio", "Recursos Humanos", "Panel
Admin", "Salud Financiera", "Finanzas".

**Y la propuesta de `navigation.ts` se queda corta** — no darla por buena:
renombra el ítem a "Mi Plata" pero la pantalla destino sigue titulándose "Panel
Financiero" con "Nortex Score" y saldos en `$`; el modo simple arranca **solo
para PULPERIA** (ferretería y farmacia, los dos nichos con landing SEO propia,
siguen con 22 ítems); conserva "Facturación" y "Panel Admin"; el grupo "Más
opciones" sigue teniendo ~16 ítems sin buscador; y **no existe ningún control de
UI para cambiar `nortex_ui_mode`** — el toggle "ver menú simple/completo" no está
implementado en ningún componente.

### D2 · "Mi Equipo" está roto para todos: lee una llave que no existe `CRÍTICO` *(verificado)*

`components/TeamManagement.tsx:95` → `localStorage.getItem('token')`. El JWT se
guarda como **`nortex_token`** (83 usos en `components/`); `'token'` a secas
aparece **una sola vez en todo el repo**: acá.

**Qué pasa:** todas las llamadas salen con `Authorization: Bearer null` → 401. El
dueño abre "Mi Equipo", ve la lista vacía, invita a su cajero y recibe "Error
creando invitación". Y `handleDisableUser`, `handleChangeRole` y
`handleCancelInvite` no tienen rama `else`: fallan en silencio, el botón no hace
nada. **La única vía de la app para dar de alta a un empleado está muerta** — o
sea que el POS multi-usuario, los PIN y los turnos por empleado son
inalcanzables para un cliente nuevo.

**Arreglo:** una línea (`nortex_token`) más `else setError(...)` en los tres
handlers mudos.

### D3 · El prestamista: 3 de sus 4 ítems aterrizan en pantallas de ferretería `CRÍTICO` *(verificado)*

`Layout.tsx:143-145` apunta "Cartera de Clientes" → `/app/clients`, "Reportes de
Cobro" → `/app/reports` y "Cobradores" → `/app/team`: componentes con **cero
conciencia de LENDER** (`Clients.tsx:51` pega a `/api/customers`, no a
`/api/loans`). Las rutas correctas existen (`/app/cartera`, `/app/cobros`,
`/app/cobradores`) y **ningún ítem del menú las apunta**.

**Qué pasa:** el prestamista hace clic en "Cartera de Clientes" y cae en el CRM
de retail, vacío, con un botón que crea clientes de tienda. Su cartera real solo
es alcanzable por las pestañas internas del dashboard, y cuando llega ahí ningún
ítem del menú queda resaltado.

**Arreglo:** cambiar tres `path`. Las rutas ya existen y funcionan.

### D4 · "Panel Admin" es una pantalla de desarrollador visible para el cajero `ALTO`

`Layout.tsx:198` — `{ path: '/app/blueprint', label: 'Panel Admin' }` **sin
gating de rol**, a diferencia de sus vecinos. Renderiza `BlueprintViewer`, cuyo
encabezado literal es `CTO_MODE: ARQUITECTURA` y *"Plan maestro de
infraestructura y datos para Jose 2.0"*, con pestañas `schema.prisma` /
`server.ts` y un botón **"COPIAR CÓDIGO"** que vuelca el schema de Prisma.

**Qué pasa:** un cajero toca lo que parece la configuración del negocio y recibe
un volcado de código con el nombre en clave de un proyecto interno. Es la
pantalla que más rápido destruye la confianza en que esto es un producto
terminado.

### D5 · Callejones sin salida y jerarquía invertida `ALTO`

- **`/app/inicio` (MiNegocio) no tiene un solo enlace en la UI.** Es la pantalla
  de aterrizaje de la pulpería (`App.tsx:72-73`) y no está en ningún menú. Su
  propio pie dice, literal: *"¿Buscás algo más? Está en el menú de la izquierda,
  en «Más opciones»"* (`MiNegocio.tsx:167`) — un menú que no existe. **La señora
  toca "Vender" y no puede volver nunca a su casa.**
- **La barra móvil son los 4 primeros del array** (`Layout.tsx:266`,
  `slice(0,4)`): POS, Cajas, Inventario y **Toma Física** — un conteo físico que
  se hace una o dos veces al año, a un tap. **"Cobranza" (el fiado, la operación
  diaria de toda pulpería) está en el ítem 13**, dentro del cajón.
- **"Pedir Reabastecimiento"**, el botón del banner rojo "Alerta de Quiebre de
  Stock" (`Dashboard.tsx:456,464`), lleva a `/app/marketplace` →
  **"Próximamente"**. Le crean la urgencia y le cierran la puerta. El propio
  `B2BMarketplace.tsx:11-12` dice que el ítem "quedó oculto"; `Layout.tsx:175`
  lo sigue mostrando.
- **La Ayuda no existe en el celular:** su único acceso está en el pie del
  sidebar de escritorio, dentro de `hidden lg:flex`.
- **Pantallas que el cajero abre y quedan vacías sin explicar:** RRHH y Mi Equipo
  no están gateados en el menú, el backend devuelve 403 y el frontend **se lo
  traga en silencio** (`HRM.tsx:256-259`). El cajero concluye que el sistema
  perdió los datos. *(Aparte, fuera de UX: `/api/billing/create-session` y
  `/portal` llevan `authenticate` sin `checkRole` — el cajero puede activar el
  plan.)*

### D6 · El producto habla cuatro idiomas a la vez `MEDIO`

Enums crudos de base de datos en pantalla: el badge dice literalmente
`PULPERIA` y `TRIALING`/`PAST_DUE` (`Dashboard.tsx:429,434`). Dos monedas en la
misma pantalla: `C$` para la ganancia del día pero `$` para billetera, línea de
crédito y deuda (`:553,572,624,645`) — el dueño no sabe si le deben 5,000
córdobas o 5,000 dólares. El menú dice una cosa y la pantalla otra: "Reportes" →
"Inteligencia Financiera", "Inventario" → "Inventario Blindado", "Auditoría" →
"Auditoría Forense". Cinco errores del backend en inglés que llegan al alert
("Tenant not found"). Tuteo contra la convención de voseo del repo ("Ingrese un
monto válido", "Selecciona un proveedor"). Y **247 `alert()` nativos** en
`components/`, que en el navegador se anuncian como "localhost dice:".

---

## Bloque E — Cargar el catálogo

### E1 · El importador no entiende el Excel de una PyME real `CRÍTICO`

`ProductImporter.tsx:33-34` solo lee `sku`/`SKU` y `nombre`/`Nombre`/`name`. No
acepta `Código`, `Barra`, `Producto`, `Descripción`, `Artículo`, ni tolera
espacios finales en el encabezado, ni `Categoría` con tilde. (El importador del
POS **sí** acepta variantes: hay dos importadores con mapeos distintos.)

El agente corrió el archivo típico (`Código | Descripción | Precio | Costo |
Existencia`) contra `validateRow` con la librería real: **5 de 5 filas
inválidas**, todas "SKU vacío, Nombre vacío". El dueño ve una tabla 100% roja,
ningún mensaje explica que el problema son los nombres de las columnas, y no hay
forma de mapearlas.

### E2 · Un `return` descarta hasta 49 productos por cada fila mala, en silencio `CRÍTICO` *(verificado)*

`backend/server.ts:3115-3123`, dentro de `$transaction` y de un `for...of` sobre
lotes de 50:

```ts
if (!sku || !name) { errors.push(...); return; }
if (price <= 0)    { errors.push(...); return; }
```

`return` sale del **callback completo**, no de la iteración: la transacción hace
commit de lo procesado y los productos restantes del lote nunca se intentan.

**Qué pasa:** una sola fila sin precio en la posición 3 borra del mapa los 47
siguientes. El dueño recibe "Importación exitosa! Creados: 253" sobre 300 filas
y no tiene forma de saber cuáles faltan; los descubre semanas después cuando el
POS no encuentra el producto en plena venta.

**Arreglo:** `return` → `continue` (dos ocurrencias) más un test que importe un
lote con una fila mala en el medio.

### E3 · Precios con "C$" o coma de miles: corrupción silenciosa `CRÍTICO`

`ProductImporter.tsx:35` usa `parseFloat` y `:48` valida `if (precio <= 0)`.
Como `NaN <= 0` es `false`, **la fila se marca válida con check verde**.
Ejecutado con la lógica literal del archivo:

| Celda del Excel | Preview | Al backend |
|---|---|---|
| `"C$ 385.00"` | `C$ NaN` | `price: null` |
| `"1,250.50"` | `C$ 1.00` | `price: 1` |
| `"18,50"` | `18` | se comen los 50 centavos |

**Qué pasa:** o la importación se vacía sin explicación, o **la ferretería queda
vendiendo cemento a C$ 1.00**. Corrupción de dinero silenciosa, en el minuto uno
del sistema.

### E4 · Sin deshacer, sin ver qué falló, y tope de 500 que solo se descubre al final `ALTO`

- **No hay reversión ni borrado masivo**: importar 500 productos con los precios
  corridos una columna cuesta ~1.500 clics para limpiar (stock a 0 con motivo, y
  recién ahí borrar). En la práctica el dueño abandona el tenant.
- **El detalle de errores se tira**: `ProductImporter.tsx:188` muestra
  "Errores: 47" y descarta el arreglo de mensajes. Y el número de fila del
  backend es inventado (`i + batch.indexOf(item) + 1`, sin compensar el
  encabezado y con `indexOf` que devuelve la primera coincidencia).
- **Tope de 500 sin validación en el cliente** (`server.ts:3089`): la ferretería
  de 800 SKUs ve 800 filas verdes, aprieta "Importar", espera, y recibe
  `alert("Error: Máximo 500 productos por lote.")`. Cero productos cargados.

### E5 · SKU obligatorio y otros roces `ALTO`/`MEDIO`

- **SKU obligatorio en toda alta rápida** (`QuickAddProduct.tsx:240-248`,
  `Inventory.tsx:1896`) — el arroz por libra y los clavos a granel no tienen
  código. El POS **sí** autogenera (`POS.tsx:1080`): otra incoherencia entre dos
  caminos del mismo producto. Son +10-15 s y una decisión mental por ítem × 300.
- **El formulario manual pide 16 campos y 3 toggles**, con `Costo de Compra`
  **obligatorio** (`Inventory.tsx:1954`) — dato que el backend trata como
  opcional (`server.ts:3032`).
- **Re-importar falsea el Kardex:** el diferencial se escribe como
  `IN_PURCHASE` con cantidad negativa (`server.ts:3131`) y pisa el stock con un
  `update` absoluto en vez de pasar por `applyStockDelta`.
- **Subir precios por inflación solo alcanza la página visible** (50 de 800,
  `Inventory.tsx:883-895`), y la selección se borra al cambiar de página.
- **No se puede crear un producto mientras se registra la factura del
  proveedor** (`Purchases.tsx:134-143`), que es como una ferretería realmente
  arma su catálogo.

**Tiempo real hoy para una ferretería de 800 SKUs:** 2-4 horas peleando con
Excel (si alguien la ayuda), o el camino que la mayoría toma —teclear 800
productos a 30-45 s cada uno— **7 a 10 horas netas, 2-3 días reales.** Debería
ser 15-20 minutos.

---

## Bloque F — Peso y red

Medición real (`npm run build`, exit 0):

```
dist/assets/index-CHV1hzDi.js   2,235.74 kB │ gzip: 614.04 kB
dist/assets/index-CopV1xux.css    123.07 kB │ gzip:  17.96 kB
precache 26 entries (2659.61 KiB)
```

Desglose medido (segundo build con `manualChunks`, raw/gzip): código de la app
951/202 · **xlsx 425/142** · recharts+d3 275/77 · react 194/61 · dexie 96/32 ·
lucide 59/12 · browser-image-compression 53/21 · decimal.js 32/13.

- **F1 · Cero lazy loading de rutas** `CRÍTICO`. `App.tsx:10-58` importa ~45
  pantallas estáticas; solo el blog es `lazy`. Para cobrar C$50 el Android baja y
  **parsea** el motor de Excel, los gráficos, el compresor de imágenes, el panel
  SUPER_ADMIN, contabilidad NIIF, nómina y las landings de marketing. El
  `<Suspense>` ya existe (`App.tsx:142`).
- **F2 · Recargar sin internet deja el POS sin catálogo** `CRÍTICO`. Dexie tiene
  **una sola tabla**, `offline_sales` (`lib/db.ts:33`): no hay productos
  persistidos. El service worker precachea 2.6 MB y la app **abre** sin internet
  — pero sin productos que tocar, así que la cola offline de ventas es
  inalcanzable justo en el escenario para el que existe. Solo sirve si el
  internet se cae *mientras* la pestaña ya estaba abierta.
- **F3 · `xlsx` (142 kB gzip, 23% del bundle) importado estáticamente en el POS**
  `ALTO` (`POS.tsx:12`). El cajero que solo cobra en efectivo se baja un parser
  de Excel que nunca usa — en un plan medido de Claro/Tigo eso es dinero.
  Arreglo: `await import('xlsx')` dentro del handler. Cuatro líneas.
- **F4 · Cascada de 4 requests en serie en el Dashboard** `ALTO`
  (`Dashboard.tsx:111→132→135→144`, con `isLoading` global bloqueando todo el
  render). Y `Login.tsx:47` manda **a todos** al Dashboard, ignorando el
  `homePathFor(role)` que `App.tsx:73` ya calcula: el cajero paga la cascada
  completa para recién entonces poder tocar "Punto de venta". *(`Reports.tsx:103`
  sí usa `Promise.all` — el patrón bueno existe en el repo.)*
- **F5 · `/api/products` devuelve todo, con el email del creador por fila**
  `ALTO`. La paginación es opt-in (`server.ts:2940`) y el POS llama sin `page`;
  el modelo tiene ~30 columnas (incluida `description @db.Text`) y el POS usa 8.
  Se re-descarga al montar, **después de cada venta** y después de cada sync.
  Además es un `findMany` sin `take`, que la propia guía de escalabilidad prohíbe.
- **F6 · La grilla del POS renderiza todos los productos sin virtualizar**
  `ALTO` (`POS.tsx:2577`): 2.000 SKUs ≈ 20.000 nodos DOM en un equipo de 2 GB.
  Chrome tiene motivo para matar la pestaña — lo que, combinado con F2, borra el
  carrito.
- **F7 · Polling permanente y re-descarga completa en cada deploy** `MEDIO`.
  `Layout.tsx:84` hace poll cada 30 s contra `/api/public-orders` en **toda** la
  app y para casi todo rol, sin pausar en `visibilitychange` (~120 requests/hora
  aunque el negocio no use pedidos web); `DriverView` cada 10 s sobre el plan
  personal del motorizado. Y con todo en un chunk, cualquier deploy invalida los
  2.2 MB: ~20 MB/mes por dispositivo en datos móviles, blog y landings incluidos.
- **F8 · Fuentes de Google bloqueando el render** `MEDIO` (`index.html:52-54`),
  desde un origen que el SW no cachea: en lie-fi la pantalla queda negra decenas
  de segundos con todo el JS ya en el precache.

**Veredicto de tiempo** *(tamaños medidos; segundos estimados, no medidos en
dispositivo)*: hoy, en un Android de gama baja sobre 3G, de la primera carga a
poder cobrar hay **20-35 segundos**, y la visita repetida sigue en 10-15 porque
el service worker ahorra la bajada pero no el parse, ni la cascada, ni el
catálogo. Con lazy loading, `xlsx` dinámico, catálogo en Dexie y el Dashboard en
paralelo: **4-6 segundos la primera vez, menos de 2 las siguientes.**

---

## Lo que ya está bien (no re-hacer)

Total autoritativo server-side en Decimal · stock atómico con `applyStockDelta` +
Kardex + AuditLog en la misma transacción · idempotencia por `offlineId` en el
motor de ventas · inputs de dinero como texto controlado (nunca `type="number"`)
· beep de éxito/error al escanear · parqueo de hasta 5 carritos · semáforo de
crédito con override por PIN · empty-states que distinguen "no tenés productos"
de "no pudimos cargarlos" · la calculadora de vuelto del modal de efectivo · el
escáner del Inventario que abre el alta rápida con el SKU precargado ·
`QuickAddProduct` con modo continuo, categoría pegajosa y sonido · la toma
física (`StockCount`) · 59 usos de `inputMode` (el teclado numérico no es el
problema) · el menú del contador, el único de los cinco que funciona bien · y de
R0-R2: la puerta de vuelta en la landing, el precio/trial coherentes, el modal
del PIN fuera del camino, el tour que ya no se pisa con el modal de caja, los
emails de bienvenida y trial, el rate-limit de login por email.

---

## Plan sugerido — R2.5 antes de R3

La conclusión más incómoda de la auditoría es que **R3 (peso y offline) no es lo
más urgente**. Partir el bundle hace que la app cargue en segundos; no sirve de
nada si al llegar el usuario no puede pagar, la caja descuadra el 15% todos los
días y las ventas sin internet se evaporan.

**R2.5 — "que no se pierda plata" (la mayoría son cambios de 1-5 líneas):**

1. `A1` IVA: una sola convención (precio IVA incluido, desglose en el ticket).
2. `A2` `synced: 0/1` en `lib/db.ts` + contador de pendientes siempre visible.
3. `A3`+`A4` timeout de 8 s, fallo → cola offline, `offlineId` en toda venta,
   guarda en F9.
4. `B1`+`B2` cuentas bancarias y WhatsApp reales; los banners de pago →
   `/app/billing`; monto precargado en $20.
5. `C1` `TOKEN_TTL = '30d'` y traducir el 403 a "volvé a iniciar sesión".
6. `D2` `nortex_token` en `TeamManagement.tsx:95` (dar de alta empleados vuelve
   a funcionar).
7. `D3` las tres rutas del prestamista.
8. `D4` sacar "Panel Admin" del menú.
9. `E2` `return` → `continue` en la importación.
10. `A5` los cinco campos de mayoreo en el `map` del POS.

**R2.6 — el menú simple** (ya preparado), extendido con lo que la auditoría
agregó: modo simple para ferretería y farmacia (no solo pulpería), `/app/inicio`
enlazado, la barra móvil reordenada por frecuencia real de uso (Vender · Fiado ·
Productos · Mi plata), y alinear los títulos de pantalla con las etiquetas del
menú.

**R2.7 — el importador** (`E1`, `E3`, `E4`): mapeo de columnas con sinónimos
nicas, `parseMoneyNi` que rechace lo ilegible en vez de dejar pasar `NaN`,
troceado en el cliente y tabla de rechazados descargable. Es lo que separa "2-3
días" de "una tarde" para quedar operativo.

**R3 — peso y offline**, como estaba planeado, más `F2` (catálogo en Dexie) que
es lo que finalmente hace cierta la promesa de "funciona sin internet".
