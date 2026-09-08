# Release — Nortex Capital fuera de la interfaz del cliente — 2026-09-05

> **Registro histórico — no ejecutar como receta de release.** Los SHAs, PRs,
> resultados y estado de producción de este documento son una fotografía del
> momento en que se escribió; no declaran el estado actual. La secuencia de
> promoción que sigue fue reemplazada porque mezclaba un push a `main` con una
> ruta automática a producción. Para cualquier candidato nuevo usá el
> [runbook canónico de promoción](../runbooks/release-promotion.md).

Estado histórico al 2026-09-05: **CANDIDATO PREPARADO · NO MERGEADO · PRODUCCIÓN NO AUTORIZADA**

Candidato histórico: `b71942b194aaf3755ec470e681fb746e2c45022d` (PR `#203`, draft)
Base histórica: `2834497f6090c2d55bcc48d5edb86887f6993ae3` (no usar para inferir
`origin/main` ni la versión actual de producción)

---

## 1. Qué faltaba desplegar en la fotografía histórica

El trabajo de Codex (PR `#196`–`#201`: blindaje de Entregas, identidad de
motorizados, unificación Apple del shell público, default de bodega en compras)
quedó registrado como promovido el 2026-09-02. El job `deploy-production` del run
`33688959590` cerró en verde en esa fecha y su verificador exigió salud y SHA
exacto entonces (ver `docs/releases/2026-09-02-public-apple-unification.md`). No
usar ese resultado como prueba del estado actual de producción.

En esa fotografía, había dos cosas que no estaban desplegadas:

| # | PR | Contenido | Riesgo |
|---|---|---|---|
| 1 | `#203` (draft) | Nortex Capital fuera de la UI del cliente + score en panel admin + **abono en efectivo a proveedor sale de la caja** | Runtime: medio (ver §3) |
| 2 | `#202` (draft) | Solo `docs/releases/…`: registra la promoción del 2026-09-02 | Nulo |

---

## 2. Compuerta técnica del candidato

| Compuerta | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npm test` | 3899 pasan · 68 saltados · 0 fallan |
| `npm run check:design` | íntegro (0 hex fuera de tokens, 0 moneda hardcodeada, 83 archivos) |
| `npm run test:mutation` (Stryker, umbral `break: 100`) | verde en CI |
| `npm run build:seo` | verde — **71 rutas prerenderizadas + sitemap de 72 URLs** |
| CI del SHA candidato | `verify` ✅ · `deploy-schema-smoke` ✅ · `backup-restore-smoke` ✅ |
| `mergeable_state` | `clean` (main no avanzó desde `2834497`) |

### Diff de schema: **vacío**

```
$ git diff --stat origin/main...b71942b -- backend/prisma/
(sin cambios)
```

Consecuencia operativa: el `prisma db push` del arranque es un **no-op**. No hay
DDL, no hay backfill, y por lo tanto:

- **no aplica la compuerta de respaldo** que `nortex-deploy` exige *antes de
  desplegar cambios de schema* (`nortex-backup-recovery`);
- **el rollback es limpio**: redesplegar `2834497` en Coolify revierte todo el
  cambio sin migración inversa ni pérdida de datos.

---

## 3. El cambio que un cliente SÍ va a notar

Todo lo demás de este release quita cosas de la pantalla. Esto agrega una
condición nueva y es lo único con riesgo operativo real:

> **Abonar una factura de proveedor en EFECTIVO ahora exige una caja abierta.**

Antes ese abono debitaba `Tenant.walletBalance` —la billetera de Nortex Capital,
que ninguna ferretería tiene fondeada—, así que **fallaba siempre** con "No hay
suficiente efectivo disponible" aunque la gaveta estuviera llena. No se está
quitando un flujo que funcionaba: se está reemplazando un camino 100 % roto por
uno que funciona y pide caja abierta.

Los mensajes nuevos que puede ver un cajero:

| Situación | Mensaje |
|---|---|
| Sin turno abierto | `No hay caja abierta. Abrí una caja para registrar el pago al proveedor.` (409) |
| Gaveta insuficiente | `Efectivo insuficiente en caja: disponible C$ X, requerido C$ Y. Registrá una entrada de caja o pagá desde otra caja.` (400) |
| El turno se cerró durante la operación | `La caja se cerró antes de aplicar el pago. Abrí una caja y volvé a intentar.` (409) |

TRANSFER / CARD / QR **no cambian**: siguen liquidando contra Bancos (1.1.2) sin
tocar caja ni billetera.

### Chequeo previo obligatorio: ¿hay billeteras con saldo?

`POST /api/admin/loans/approve` acredita `Tenant.walletBalance`. Si algún tenant
tiene saldo, después de este release ese saldo **deja de gastarse en pagos a
proveedor** (queda inmovilizado hasta que se decida qué hacer con Capital).
Correr contra la BD de producción, en solo lectura, ANTES de promover:

```sql
SELECT id, businessName, walletBalance, creditLimit, creditScore
FROM Tenant
WHERE walletBalance > 0 OR creditLimit > 0;
```

- **0 filas** → no hay nada inmovilizado; promover sin más.
- **≥1 fila** → decidir antes de promover: son cuentas a las que se les prometió
  un saldo que la UI va a dejar de mostrar.

---

## 4. Secuencia de promoción histórica — sustituida

La secuencia que aparecía aquí permitía que el mismo workflow de CI, activado por
un push a `main`, construyera una ruta a producción. Esa propiedad hizo posible
una promoción no solicitada de un cambio docs-only y queda retirada. No se deben
seguir los pasos históricos de merge, espera y aprobación de environment.

La ruta vigente separa CI/staging de producción: después de CI y staging sanos para
un SHA completo, se requiere autorización explícita de producto y el workflow
manual `release-production.yml` con `PROMOTE <SHA>`. El workflow revalida `main` y
staging tras la aprobación técnica. El procedimiento, la evidencia y la
configuración externa requerida están en el [runbook canónico de
promoción](../runbooks/release-promotion.md).

---

## 5. Smoke tests

### Automático (lo corre el propio job, no hay que hacerlo a mano)

`scripts/verify-deployed-release.mjs` solo pasa con `ok`, `db: up` y el commit
exacto en `/api/health`. Un webhook roto o un rollout que no avanzó nunca
habilita producción.

### Manual — genérico del release

```bash
curl -s https://somosnortex.com/ | grep -c "Tu negocio ya vende"      # landing viva
curl -s https://somosnortex.com/ferreterias | grep -o '<title>[^<]*'  # prerender por-ruta
curl -s https://somosnortex.com/sitemap.xml | grep -c "<loc>"         # 72 URLs
```

### Manual — específico de ESTE cambio (tenant sintético, nunca un cliente real)

1. **Abono en efectivo, con caja abierta** → el pago entra; la gaveta baja por el
   monto; aparece un `CashMovement` OUT categoría `PAGO_PROVEEDOR` firmado; el
   asiento es Debe CxP (2.1.1) / Haber Caja (1.1.1) — **una sola vez**.
2. **Abono en efectivo, sin caja abierta** → 409 con el mensaje de "Abrí una
   caja", y la factura queda **sin tocar** (ni pagada, ni con saldo movido).
3. **Abono por transferencia** → liquida contra Bancos, no pide caja, no toca la
   gaveta.
4. **Doble clic en el botón de abono** → un solo pago (idempotencia por
   `clientEventId`), no dos salidas de caja.
5. **Dashboard del dueño** → no aparecen billetera, Nortex Score, línea de
   crédito ni "Préstamos activos"; sí aparecen ventas del día, "Cuánto podrías
   retirar", stock bajo y el flujo de caja a ancho completo.
6. **Panel SUPER_ADMIN** → el botón "Recalcular" de una empresa devuelve score y
   línea, y deja un `AuditLog` con acción `ADMIN_SCORE_RECALCULATED` y su
   before/after.
7. `GET /api/admin/ledger/verify/<tenantId>` → `{ ok: true }` (la cadena firmada
   del libro de caja sigue íntegra después del movimiento del punto 1).

---

## 6. Rollback

Sin cambios de schema, el rollback es un redeploy del SHA anterior:

- Redesplegar `2834497f6090c2d55bcc48d5edb86887f6993ae3` desde Coolify.
- No hay migración inversa que correr ni datos que reconciliar.
- Lo único que persiste de este release son los `CashMovement`/`Expense` de los
  abonos que sí se hayan hecho — y son correctos: representan plata que
  efectivamente salió de la gaveta.

---

## 7. Lo que este documento NO declara

- **No se declara `PRODUCCIÓN VERIFICADA`.** El runbook
  (`docs/runbooks/frontend-preprod-audit.md`) exige, además de la salud por SHA,
  el smoke autenticado con tenant sintético y 30 minutos de observación. Ninguno
  de los dos se ejecutó.
- **No se verificó producción desde este entorno.** La política de red de la
  sesión bloquea `somosnortex.com` (`CONNECT tunnel failed, 403`), así que el
  estado de producción de §1 sale del registro de CI del run `33688959590`, no
  de un `curl` propio.
- **No se ejecutó `npm ci` limpio.** La misma política bloquea
  `cdn.sheetjs.com`, de donde `package.json` toma `xlsx`. Las compuertas de §2
  se corrieron con `node_modules` completado a partir del tarball local ya
  presente; **las de CI, que sí corren `npm ci`, están todas en verde sobre el
  SHA candidato** y son la evidencia que vale.

## 8. Bloqueos abiertos, ajenos a este release

- **`JWT_SECRET` y `DATABASE_URL` de producción siguen extraíbles del historial
  de git** (`.env.backup`, commit `ca222c2`). La purga nunca corrió. Rotar el
  keyring `JWT_SECRETS` (formato `"nuevo,viejo"`: rota sin desloguear a nadie) y
  purgar el historial es tarea del responsable, y no se resuelve desplegando.
  Este release no empeora la exposición, pero tampoco la cierra.
