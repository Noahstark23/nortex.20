# Plan WhatsApp + catálogo + cotizaciones de Nortex

**Fecha:** 2026-09-28  
**Estado:** PROPUESTO  
**Decisión de producto:** el **catálogo web de Nortex es la fuente canónica**. WhatsApp es la interfaz conversacional que lleva al cliente desde intención → productos → cotización → revisión web → venta.

## 1. Lo que ya existe

El repositorio ya tiene piezas suficientes para evitar construir un segundo e-commerce:

- `components/PublicCatalog.tsx` soporta `DELIVERY | QUOTE`.
- En modo `QUOTE`, el catálogo público crea un `PublicOrder` que puede terminar en cotización mayorista.
- Nortex ya tiene módulo de cotizaciones y puente de cotización hacia POS.
- `QuotationManager.tsx` ya tiene acción de compartir por WhatsApp.
- El canal comercial WhatsApp ya implementa:
  - webhook;
  - validación de firma;
  - sender Cloud API;
  - búsqueda FULLTEXT de catálogo por tenant;
  - agente/orquestador;
  - persistencia parcial.
- `docs/WHATSAPP_INFRA.md` declara brechas: inbox/outbox durable, identidad/handoff y producción real siguen requiriendo validación.

**Conclusión:** no crear otro catálogo dentro del bot.

## 2. Experiencia objetivo

### Entrada A — desde el catálogo
Cliente abre:

`somosnortex.com/c/<comercio>`

Selecciona productos → elige **Pedir cotización** → deja nombre/teléfono → Nortex genera la solicitud y ofrece:

**“Continuar por WhatsApp”**

El mensaje prellenado contiene sólo un identificador opaco o URL firmada, nunca precios confiados al navegador.

### Entrada B — desde WhatsApp
Cliente escribe:

> Necesito 20 láminas de zinc y 10 bolsas de cemento.

Nortex:
1. detecta intención de cotización;
2. busca productos publicados del tenant;
3. pregunta presentación/cantidad cuando sea ambiguo;
4. obtiene precios actuales del servidor;
5. genera **preview**, no venta;
6. responde con resumen;
7. envía enlace de revisión web;
8. cliente confirma en la superficie web;
9. el backend revalida y crea la cotización/pedido público;
10. el comercio recibe el lead y puede convertir a venta con su flujo existente.

## 3. Regla central: WhatsApp no es autoridad de dinero

El LLM puede interpretar texto. No puede:

- inventar precio;
- cambiar descuento;
- certificar stock;
- registrar pago;
- descontar inventario;
- convertir una cotización en venta;
- declarar entrega;
- aprobar crédito.

Todos los valores económicos vienen de servicios deterministas.

## 4. Arquitectura recomendada

### 4.1 Tool nueva: `preparar_cotizacion`

Primera versión **sin escritura de dominio**.

Input conceptual:
```json
{
  "items": [
    {"query":"cemento canal","quantity":"10","presentation":null}
  ]
}
```

Output:
- productos resueltos;
- ambigüedades;
- cantidad exacta;
- presentación;
- precio canónico;
- impuestos aplicables;
- subtotal/total informativo;
- hash/version de precio;
- expiración;
- token para abrir revisión web.

No crea `Sale`, `Quotation` ni `PublicOrder`.

### 4.2 Enlace de revisión

Ruta propuesta:

`/c/:slug/cotizar?t=<opaque-token>`

El token referencia un draft server-side corto o un payload firmado. No debe permitir manipular:
- tenant;
- productId;
- price;
- tax;
- discount.

Al abrir, el servidor vuelve a resolver el estado vigente.

### 4.3 Confirmación

La confirmación ocurre en web con botón explícito:

**Solicitar cotización**

El servidor:
1. revalida token;
2. revalida productos/publicación;
3. recalcula precio e impuestos;
4. detecta cambios;
5. pide aceptación si el total cambió;
6. persiste usando el flujo de `PublicOrder/Quotation` existente.

El cliente recibe número de referencia y el negocio recibe el lead.

## 5. No duplicar Meta Catalog en la primera fase

Nortex ya ofrece catálogo web y controla:
- productos;
- presentación;
- precios;
- stock/publicación;
- IVA;
- tenant;
- cotización.

Duplicar todo en un Meta Catalog crea:
- sincronización;
- productos obsoletos;
- divergencia de precios;
- mapeo extra;
- políticas adicionales.

**Decisión P0:** WhatsApp enlaza al catálogo Nortex.

**Gate para reconsiderar Meta Catalog:** evidencia de que las tarjetas/product messages nativas aumentan conversión lo suficiente para justificar sincronización y soporte.

## 6. Política Meta que afecta el diseño

Referencia:
https://business.whatsapp.com/policy

- Dentro de las 24 horas desde el último mensaje del usuario, el negocio puede responder sin plantilla.
- Para iniciar/reabrir fuera de esa ventana se usan plantillas aprobadas.
- Debe existir una vía clara de escalamiento humano.
- El negocio debe contar con permisos/consentimientos adecuados.
- No pedir números completos de tarjetas, cuentas bancarias o identificadores sensibles por WhatsApp.

### 6.1 Gates por vertical

Nortex soporta verticales que pueden entrar en categorías restringidas.

**Prestamistas:** no habilitar por defecto ventas, cobranza ni ofertas de préstamos por WhatsApp. La política de WhatsApp restringe categorías financieras como payday loans, P2P lending y debt collection.

**Farmacias/salud:** no asumir que el catálogo conversacional puede vender cualquier producto. WhatsApp restringe productos médicos/de salud en funciones comerciales.

Crear:
`WhatsappCommercePolicyGate(tenant, product)`

Estados:
- `ALLOWED`
- `SUPPORT_ONLY`
- `BLOCKED_CATEGORY`
- `HUMAN_REVIEW`

No “resolver” restricciones cambiando el nombre del producto.

## 7. Estados de cotización conversacional

```
COLLECTING
NEEDS_CLARIFICATION
PREVIEW_READY
LINK_SENT
CUSTOMER_REVIEWING
SUBMITTED
PRICE_CHANGED
EXPIRED
HANDED_OFF
CANCELLED
```

El estado del chat no reemplaza el estado autoritativo de la cotización persistida.

## 8. Conversación ejemplo

Cliente:
> Tenés cemento Canal?

Bot:
> Sí. Encontré Cemento Canal 42.5 kg. ¿Cuántas bolsas necesitás?

Cliente:
> 15

Bot:
> Puedo prepararte la cotización con el precio actual del comercio. La cotización final se revisa antes de enviarla. ¿La preparo?

Cliente:
> Sí

Bot:
> 15 × Cemento Canal 42.5 kg  
> Total estimado según precio actual: C$…  
> Revisá disponibilidad, datos y total aquí: [enlace Nortex]  
> El comercio confirma precio/disponibilidad al procesarla.

No decir “pedido confirmado” hasta que el backend lo acredite.

## 9. Handoff humano

Comandos/intenciones:
- “hablar con alguien”
- “quiero descuento”
- “precio mayorista”
- “necesito entrega hoy”
- “no es ese producto”
- reclamo/devolución

El bot debe crear/identificar el handoff y detener automatización conflictiva.

## 10. Métricas

Por tenant:
- conversaciones con intención de compra;
- búsquedas de catálogo;
- drafts preparados;
- enlaces abiertos;
- cotizaciones sometidas;
- cotizaciones convertidas;
- tiempo hasta respuesta humana;
- errores de producto ambiguo;
- cambios de precio antes de submit;
- costo IA por cotización;
- opt-outs/bloqueos.

KPI principal:
**cotizaciones WhatsApp convertidas / cotizaciones WhatsApp sometidas**

No optimizar cantidad de mensajes.

## 11. Fases

### W0 — diseño y pruebas
- [ ] definir contratos;
- [ ] tests de política por vertical;
- [ ] preview determinista;
- [ ] signed token;
- [ ] no domain writes.

### W1 — catálogo→WhatsApp
- [ ] botón Continuar por WhatsApp;
- [ ] referencia opaca;
- [ ] recuperar carrito/draft en servidor;
- [ ] QA de manipulación de precio.

### W2 — WhatsApp→catálogo
- [ ] intención cotización;
- [ ] `preparar_cotizacion`;
- [ ] preguntas de desambiguación;
- [ ] enlace prellenado;
- [ ] submit web.

### W3 — piloto
Un comercio real, categorías permitidas:
- máximo de gasto IA definido;
- handoff humano;
- logs sin secretos;
- 20 conversaciones como muestra operativa inicial, sin afirmar significancia estadística;
- revisión de fallos.

### W4 — producción acotada
Sólo después de:
- outbox durable;
- dedupe/lease;
- política de consentimiento;
- template policy;
- protección multi-tenant;
- QA real de Meta;
- autorización de producción.

## 12. Tests mínimos

1. El cliente no puede modificar price en URL/payload.
2. Producto de otro tenant no se resuelve.
3. Producto oculto no se cotiza.
4. Precio cambiado obliga a revalidación.
5. Cantidad medida conserva Decimal.
6. Pack/base conserva snapshot.
7. Mensaje repetido no duplica quote.
8. Retry de Meta no crea segunda solicitud.
9. Categoría restringida queda bloqueada.
10. “hablar con humano” corta automatización.
11. Fuera de 24h no se envía texto libre iniciado por empresa.
12. El bot jamás crea una venta.
13. Submit público usa contrato existente y no confía en totals del cliente.

## 13. Definición de hecho

“Cotización WhatsApp preparada” = mensaje interpretado + productos canónicos + preview server-side + enlace revisable.

“Cotización creada” = submit confirmado por backend.

“Venta” = flujo de venta existente la confirma después; nunca se infiere de un chat.
