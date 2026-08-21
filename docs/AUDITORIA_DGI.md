# Auditoría de cumplimiento DGI — Sistema de Facturación Computarizada

**Alcance:** requisitos de la **Disposición Técnica No. 09-2007** (DGI Nicaragua) para
que un Sistema de Facturación Computarizada (SFC) pueda registrarse en la Ventanilla
Electrónica Tributaria (VET) y sus comprobantes tengan validez fiscal.

**Método:** lectura del código real. Cada veredicto cita `archivo:línea`. Lo que no
se pudo verificar leyendo código se declara como tal en vez de asumirse cumplido.

**Por qué importa:** sin el registro del SFC, los tickets que emite Nortex **no son
comprobantes fiscales**. El cliente de la ferretería no puede deducir el gasto ni el
IVA, y el propio negocio queda expuesto a multa. Es un bloqueo comercial, no un
detalle técnico.

---

## Resumen

| ID | Requisito | Veredicto |
|---|---|---|
| DGI-1 | Numeración correlativa ininterrumpida y series | ✅ Cumple |
| DGI-2 | Un comprobante emitido no se edita ni se borra | ⚠️ Cumple de hecho, sin guard |
| DGI-3 | Control de acceso con usuarios y claves cifradas | ✅ Cumple |
| DGI-4 | Respaldo de la información | ❌ **No cumple** |
| DGI-5 | Anulación de comprobantes con rastro | ❌ **No existe** |
| DGI-6 | Manual Técnico y de Usuario en español | ❌ No existe |
| DGI-7 | Reportes contables formateados | ✅ Cumple (alcance limitado) |

Dos hallazgos bloquean el registro (**DGI-4** y **DGI-6**) y uno bloquea la operación
legal del día a día (**DGI-5**).

---

## DGI-1 · Numeración correlativa — ✅ Cumple

`backend/services/salesService.ts:236`

```ts
const counter = await tx.invoiceSeries.upsert({
    where:  { tenantId_series: { tenantId, series: 'A' } },
    update: { lastNumber: { increment: 1 } },
    create: { tenantId, series: 'A', lastNumber: 1 },
});
if (counter.lastNumber > counter.rangeEnd) {
    throw new SaleError('INVOICE_RANGE_EXHAUSTED', 422, 'Rango de facturación DGI agotado…');
}
```

El correlativo se toma con un **upsert atómico dentro de la transacción de la venta**:
el `increment` ocurre en la misma sentencia que lo lee, así que dos ventas simultáneas
no pueden recibir el mismo número. El rango autorizado se controla y la venta se
rechaza al agotarse, en vez de seguir emitiendo fuera de rango.

El schema soporta **series por sucursal** (`Sale.invoiceSeries`, `InvoiceSeries`,
`schema.prisma:534-535,1311`), aunque hoy `executeSale` escribe `'A'` fijo. Eso es
correcto para un solo punto de emisión y hay que parametrizarlo antes de vender
multi-sucursal con series distintas.

## DGI-2 · Inmutabilidad del comprobante — ⚠️ Cumple de hecho, sin guard

Los únicos tres puntos que escriben sobre una venta emitida son:

| Sitio | Qué modifica |
|---|---|
| `backend/server.ts:2102` | `balance`, `status` (abono a crédito) |
| `backend/server.ts:7073` | `balance`, `status` (abono, con guard de saldo exacto) |
| `backend/server.ts:7165` | `balance`, `status: 'UNCOLLECTIBLE'` (incobrable) |

**Ninguno toca `total`, `invoiceNumber`, `invoiceSeries` ni los items**, y no existe
un solo `sale.delete` ni `saleItem.update/delete` en el backend. El documento fiscal
es inmutable en la práctica: lo que cambia es el **estado de cobranza**, que es otra
cosa y sí debe poder cambiar.

**Lo que falta:** nada lo impide estructuralmente. Un endpoint nuevo escrito con
prisa podría actualizar `total` sin que ningún test ni revisión lo detenga. La
recomendación es un guard explícito — un test que falle si aparece una escritura
sobre los campos fiscales, al estilo del `check-mutation-scope.cjs` que ya protege
la red de mutación.

## DGI-3 · Control de acceso — ✅ Cumple

Claves con **bcrypt** (`backend/server.ts:292,378`, salt 10; nunca en texto plano),
JWT por **keyring rotable** (`backend/services/secrets.ts`), y todos los endpoints
sensibles detrás de `authenticate` + `checkRole`. El tenant sale **siempre** del JWT
(`req.tenantId`), nunca del body — 445 usos de `tenantId` en `server.ts`.

## DGI-4 · Respaldo de la información — ❌ No cumple

`scripts/backup-db.sh` **existe y está bien escrito**: hace `mysqldump`, comprime y
sube a almacenamiento S3-compatible (DigitalOcean Spaces), separado del Droplet.

**Pero no lo ejecuta nadie.** No hay cron, no aparece en `Dockerfile` ni en
`docker-compose`, y `scripts/docker-entrypoint.sh` no lo invoca. Un backup que no
está agendado no es un backup: es un script.

Esto es exactamente el caso que el `CLAUDE.md` manda escalar (Capa 6 del Security &
Integrity Loop: *"si no está desplegado, alertar al CEO"*). **Queda formalmente
alertado acá.**

Además del requisito fiscal, el riesgo operativo es el peor del sistema: hoy una
falla del volumen de MySQL se lleva el inventario y la cartera de todos los clientes,
sin vuelta atrás.

## DGI-5 · Anulación de comprobantes — ❌ No existe

`Sale.status` no contempla `CANCELLED` ni `VOID` (`schema.prisma:537`). Existe
`POST /api/returns` (`server.ts:2100`), pero **una devolución no es una anulación**:

- **Devolución** = el cliente trae mercadería de vuelta. La venta ocurrió y sigue
  siendo válida; se emite un movimiento nuevo en sentido contrario.
- **Anulación** = la factura no debió emitirse (error de digitación, cobro duplicado,
  cliente equivocado). El comprobante debe quedar **anulado y visible**, no borrado,
  y su número **no se reutiliza**.

Hoy, ante una factura mal emitida, el operario no tiene camino legal. Los caminos que
le quedan son peores: dejarla como venta real (declara de más) o improvisar una
devolución que descuadra el inventario con mercadería que nunca se movió.

## DGI-6 · Manual Técnico y de Usuario — ❌ No existe

La DT 09-2007 exige presentar en la VET un **Manual Técnico y de Usuario en español**,
junto con el lenguaje de programación y los datos del proveedor. No hay tal documento
en el repositorio.

Es la siguiente entrega, y se puede generar del código real (correlativos, series,
controles de acceso, respaldos, reportes) en vez de escribirlo a mano.

## DGI-7 · Reportes contables — ✅ Cumple, con alcance limitado

Existen y están montados: `balance-general`, `estado-resultados`, `libro-diario`,
`libro-mayor`, `chart` (catálogo), `periods` (cierres) — `server.ts:7788-8044` — sobre
un motor de partida doble (`backend/services/accounting.ts`).

**Límite de esta auditoría:** verifiqué que los endpoints existen y que el motor es de
partida doble. **No verifiqué** que la presentación cumpla el formato NIIF para PyMES
línea por línea; eso requiere el criterio de un contador, no una lectura de código. No
lo declaro cumplido más allá de eso.

---

## Qué hacer, en orden

1. **Agendar el backup** (DGI-4). Es el de mayor riesgo y el más barato: un cron en el
   host o un contenedor sidecar que corra `scripts/backup-db.sh`, más una verificación
   de que el archivo llega al bucket. Sin esto no hay expediente ni tranquilidad.
2. **Anulación de comprobantes** (DGI-5). Estado `CANCELLED` en `Sale`, motivo
   obligatorio, `AuditLog` con `before`/`after` en la misma transacción, reversión del
   stock por `applyStockDelta`, el número **no se reutiliza**, y el comprobante anulado
   sigue apareciendo en los libros marcado como tal.
3. **Manual Técnico para la VET** (DGI-6), generado del código.
4. **Guard de inmutabilidad fiscal** (DGI-2), como test que falle en CI.

---

*Auditoría hecha leyendo el código, no la documentación. Si una línea citada cambió de
lugar, el veredicto hay que rehacerlo — no heredarlo.*
