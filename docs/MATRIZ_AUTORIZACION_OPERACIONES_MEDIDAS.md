# Matriz de autorización: ventas medidas, pedidos y cotizaciones

> Contrato verificado contra las rutas server-side al 22 de agosto de 2026.

Esta matriz documenta los guards de mínimo privilegio. La interfaz no es una
frontera de seguridad: aunque un botón siga visible por datos locales antiguos,
la API vuelve a consultar el usuario y usa su rol y estado persistidos en cada
request. Las listas autoritativas viven en
`backend/middleware/accessPolicies.ts`; `checkRole` conserva el bypass global de
`OWNER`, `ADMIN` y `SUPER_ADMIN`, por lo que la tabla los muestra de forma
explícita.

| Ruta | OWNER | ADMIN | SUPER_ADMIN | MANAGER | CASHIER | EMPLOYEE | VENDEDOR | VIEWER | ACCOUNTANT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `POST /api/sales/sync` | sí | sí | sí | sí | sí | sí | sí | no | no |
| `GET /api/v1/pedidos` y `GET /api/v1/pedidos/:id` | sí | sí | sí | sí | sí | no | no | sí | no |
| `PATCH /api/v1/pedidos/:id/estado` | sí | sí | sí | sí | sí | no | no | no | no |
| `PATCH /api/v1/pedidos/:id/motorizado` | sí | sí | sí | sí | sí | no | no | no | no |
| `GET /api/sales/search` | sí | sí | sí | no | no | no | no | no | no |
| `POST /api/returns` | sí | sí | sí | no | no | no | no | no | no |
| `GET /api/quotations` | sí | sí | sí | sí | sí | no | no | sí | no |
| `POST /api/quotations` | sí | sí | sí | sí | sí | no | no | no | no |
| `GET /api/public-orders` | sí | sí | sí | sí | sí | no | no | sí | no |
| `PATCH /api/public-orders/:id/convert` | sí | sí | sí | sí | sí | no | no | no | no |
| `POST /api/tax-report/generate` y exportaciones DGI protegidas¹ | sí | sí | sí | no | no | no | no | no | sí |

¹ Las exportaciones de esta fila son exactamente
`GET /api/fiscal/constancia-retencion/:purchaseId`,
`GET /api/fiscal/libro-ventas/:month/:year`,
`GET /api/fiscal/libro-compras/:month/:year` y
`GET /api/fiscal/vet-export/:month/:year`. La fila no afirma que todas las rutas
fiscales históricas del monolito compartan ese guard.

Los endpoints siguientes conservan un contrato público sin JWT de usuario:

- `POST /api/v1/pedidos`
- `POST /api/public/orders`
- `GET /api/v1/pedidos/:id/tracking`, que exige una capacidad firmada distinta
  de una sesión de usuario.

La capacidad de tracking queda ligada a pedido y tenant, expira en 7 días y se
entrega en el fragmento `#token=…`. `TrackPedido` la envía en
`X-Pedido-Tracking-Token`; el endpoint usa `Cache-Control: private, no-store` y
solo devuelve estado/fecha, estados/fechas de eventos y nombre del motorizado.
No expone nombre o teléfono del cliente, dirección, GPS, notas internas ni
teléfono del conductor. Ausencia, alteración, expiración o uso con otro pedido
responden igual con `404`.

## Autoridad de sesión

`authenticate` verifica la firma y expiración del JWT, pero no autoriza con sus
claims de rol/tenant. En cada request vuelve a consultar `User` por `userId` y:

1. exige `status = ACTIVE`;
2. exige que el `tenantId` persistido coincida con el del token;
3. reemplaza `req.role`, `req.tenantId` y `req.email` con valores actuales de BD;
4. aplica el bypass de `SUPER_ADMIN` solo si ese es el rol `ACTIVE` actual;
5. falla cerrado con `AUTH_STATE_UNAVAILABLE` si no puede consultar la BD.

Por eso un token de 30 días deja de conceder privilegios inmediatamente al
deshabilitar al usuario, degradar su rol o moverlo de tenant. Los tokens de
motorizado mantienen su canal separado y `verifyAuthToken` los rechaza antes de
consultar un usuario.

## Reglas de integridad asociadas

- `POST /api/sales/sync` solo marca `skipped` cuando el `offlineId` y el
  `offlinePayloadHash` canónico coinciden; divergencia o histórico sin hash queda
  como `reconciliation_required`.
- `POST /api/returns` exige `clientEventId`. La unicidad
  `tenantId + clientEventId` y el hash canónico hacen que un retry idéntico
  recupere el mismo resultado; un payload distinto recibe
  `409 RETURN_IDEMPOTENCY_CONFLICT`.
- Reserva, cancelación y entrega toman primero un lock de `Pedido` antes de leer
  snapshots o tocar producto, stock, lotes y Kardex.
