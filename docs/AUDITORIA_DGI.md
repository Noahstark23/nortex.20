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
| DGI-4 | Respaldo de la información | ⚠️ Resuelto en código; falta configurar prod |
| DGI-5 | Anulación de comprobantes con rastro | ✅ Resuelto en código |
| DGI-6 | Manual Técnico y de Usuario en español | ⚠️ Redactado; faltan los datos legales |
| DGI-7 | Reportes contables formateados | ✅ Cumple (alcance limitado) |

Ninguno de los siete sigue sin resolver en el código. Lo que queda es **de
configuración y de trámite**, no de programación: poner las variables del respaldo
en producción (DGI-4) y completar los datos legales del manual antes de presentarlo
a la VET (DGI-6). Hasta que eso pase, **DGI-4 y DGI-6 siguen incumplidos de hecho**
por más que el código esté listo.

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

## DGI-4 · Respaldo de la información — ⚠️ Resuelto en código; falta configurar prod

> **Actualización.** El hallazgo original (abajo) se corrigió: el respaldo dejó de
> depender de que alguien instale un cron a mano. Lo que falta ya no es código, son
> **tres variables de entorno en Coolify**.

**El diagnóstico original se quedaba corto.** No era solo que nadie hubiera agendado
el script: es que el cron del host **no podía funcionar**. El servicio `db` del
`docker-compose.yml` no publica puertos (a propósito, fue una brecha cerrada) y el
nombre `db` solo resuelve dentro de la red de compose. Un `mysqldump` lanzado desde
el crontab del Droplet nunca habría alcanzado la base. Por eso el respaldo se movió
adentro del despliegue:

| Pieza | Qué hace |
|---|---|
| `docker-compose.yml` → servicio `backup` | Se despliega con la app en cada release. Sin paso manual por SSH, y con acceso real a `db` por la red interna |
| `Dockerfile.backup` | Imagen mínima con el `mysqldump` de MySQL 8 (el cliente de MariaDB produce dumps que MySQL 8 puede rechazar al restaurar) + `aws` v2 |
| `scripts/backup-scheduler.sh` | Corre el backup diario a las 03:15 (America/Managua). Loop propio y no `cron`: dentro de un contenedor, `cron` **no hereda las variables de entorno** y las credenciales llegarían vacías. Si la config está incompleta, el servicio **muere ruidosamente** en vez de fingir que respalda |
| `scripts/verify-dump-file.sh` | Rechaza un dump truncado, vacío o sin las tablas fiscales **antes** de subirlo. Un `mysqldump` que muere a mitad deja un archivo que existe y descomprime: subirlo borraba la única señal del problema |
| `scripts/verify-backup-restore.sh` | Restaura el dump en una base desechable y exige que tablas y conteos coincidan con el origen. *Un backup no probado no existe* |
| Latido `last-backup.json` | Evidencia del último respaldo bueno (fecha, tamaño, sha256, destino, tablas). Es lo que se le muestra a la DGI y lo que responde "¿corrió el backup de anoche?" |
| CI `backup-restore-smoke` | Cada PR genera un dump real contra MySQL 8, lo restaura, compara conteos y acentos, y **verifica que un dump truncado sea rechazado** (sin ese caso negativo, la verificación podría estar pasando por vacía) |

**Lo que falta para declarar cumplido:** definir en Coolify `BACKUP_S3_BUCKET`,
`AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` (y `BACKUP_S3_ENDPOINT` si es Spaces),
desplegar, y confirmar el primer latido. Sin esas variables el servicio `backup` se
cae y queda visible en Coolify — la app sigue vendiendo, porque un respaldo mal
configurado no puede tumbar el punto de venta del cliente. **Mientras esas variables
no estén puestas, DGI-4 sigue INCUMPLIDO en producción.**

### Hallazgo original (2026-07)

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

## DGI-5 · Anulación de comprobantes — ✅ Resuelto en código

La distinción que el sistema no sabía hacer:

- **Devolución** = el cliente trae mercadería de vuelta. La venta ocurrió y sigue
  siendo válida; se emite un movimiento nuevo en sentido contrario.
- **Anulación** = la factura no debió emitirse (error de digitación, cobro duplicado,
  cliente equivocado). El comprobante queda **anulado y visible**, no borrado, y su
  número **no se reutiliza**.

Antes, ante una factura mal emitida, el operario no tenía camino legal: o la dejaba
como venta real (declarando de más) o improvisaba una devolución que descuadraba el
inventario con mercadería que nunca se movió.

**Qué se construyó**

- `backend/services/saleCancellation.ts` — reglas puras: cuándo se puede anular
  (no dos veces, no sobre una venta con devoluciones o abonos, no en período
  cerrado) y qué hay que revertir, usando los importes **congelados** de la venta
  (`costAtSale`) y no los de hoy.
- `POST /api/sales/:id/cancel` — reversión completa (stock, COGS, deuda, caja,
  asiento contable espejo) en una sola transacción, con guarda atómica: un
  `updateMany` condicionado a que la venta no esté ya anulada, así dos clics
  simultáneos no revierten el inventario dos veces.
- Interfaz para el cajero dentro del modal de devoluciones, donde ya buscó la
  factura, con motivo obligatorio (mínimo real, no un campo de trámite).

**El estado es `'VOIDED'`, no `'CANCELLED'`.** Es deliberado y contradice lo que
recomendaba la versión anterior de este documento: el repo **ya filtraba**
`status: { not: 'VOIDED' }` en ocho lugares —entre ellos la declaración mensual de
IVA y el Libro de Ventas— mientras **nada escribía nunca ese valor**. Introducir un
nombre nuevo habría dejado esas ocho exclusiones sin efecto y las ventas anuladas
contando como ingreso ante la DGI: el peor resultado posible.

**Hallazgo del otro lado.** `POST /api/returns` no tenía guarda contra facturas
anuladas. Como al anular la mercadería ya vuelve al inventario, una nota de crédito
encima la sumaba por segunda vez. El hueco no era alcanzable antes de que existiera
la anulación; esta misma función lo habría abierto. La guarda quedó dentro de la
transacción y después del `FOR UPDATE` sobre `Sale`.

## DGI-6 · Manual Técnico y de Usuario — ⚠️ Redactado; faltan los datos legales

La DT 09-2007 exige presentar en la VET un **Manual Técnico y de Usuario en español**,
junto con el lenguaje de programación y los datos del proveedor.

El documento existe: `docs/MANUAL_TECNICO_DGI.md`, generado del código real
(correlativos, series, controles de acceso, respaldos, reportes) en vez de escrito a
mano. **No se puede presentar todavía**: lleva marcadores `[[...]]` para los datos
legales del contribuyente, que no están en el repositorio y los tiene que completar
el dueño. Presentarlo con los marcadores puestos sería peor que no presentarlo.

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

Lo que queda **no es programación**. El código de los siete requisitos está escrito;
lo pendiente es configuración y trámite, y no lo puede cerrar un agente:

1. **Poner las variables del respaldo en producción** (DGI-4). El agendador, la
   verificación del volcado y la prueba de restauración ya están en el repo y corren
   en CI, pero sin `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`
   configuradas en Coolify **no se respalda nada**. Es el de mayor riesgo: mientras
   no esté, un disco perdido se lleva el negocio entero.
2. **Completar los datos legales del manual** (DGI-6). `docs/MANUAL_TECNICO_DGI.md`
   tiene marcadores `[[...]]` con los datos del contribuyente y del proveedor, que no
   viven en el código. Sin eso no se presenta a la VET.
3. **Guard de inmutabilidad fiscal** (DGI-2), como test que falle en CI. Es lo único
   que sigue siendo trabajo de programación, y es un endurecimiento: hoy se cumple de
   hecho —ningún endpoint edita una venta emitida— pero nada impide que un cambio
   futuro abra esa puerta sin que nadie se entere.

> Nota sobre la versión anterior de esta lista: recomendaba el estado `CANCELLED`
> para la anulación. Se implementó con `'VOIDED'` a propósito, y el porqué está en la
> sección DGI-5. Seguir aquella recomendación habría dejado las ventas anuladas
> contando en la declaración de IVA.

---

*Auditoría hecha leyendo el código, no la documentación. Si una línea citada cambió de
lugar, el veredicto hay que rehacerlo — no heredarlo.*
