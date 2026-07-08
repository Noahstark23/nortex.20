# Informe de QA — Nortex (loop de 5 pasadas por módulo)

**Fecha:** 2026-07-05  ·  **Método:** auditoría estática adversaria multi-agente  ·  **Módulos:** 15  ·  **Pasadas por módulo:** 5 (4 lentes + verificación adversaria)

> Generado por un workflow de 76 agentes (75 completados; 5.151.008 tokens, 1193 llamadas a herramientas). La pasada de síntesis narrativa se cortó por límite de sesión, así que este resumen ejecutivo se computó a partir de los hallazgos estructurados verificados.

## Resumen ejecutivo

Se auditaron los 15 módulos de Nortex contra el **Security & Integrity Loop de 6 capas** (`CLAUDE.md`) más bugs de correctitud. Cada módulo pasó por 4 lentes en paralelo (aislamiento multi-tenant · precisión financiera/persistencia · inmutabilidad de auditoría · auth+correctitud) y una **pasada adversaria** que descartó falsos positivos.

De **153 hallazgos candidatos**, la verificación adversaria confirmó o dejó como plausibles **152** y descartó **1** como falso positivo. **4 son de severidad crítica** y se concentran en dinero e inventario:

1. `POST /api/returns` acepta precio y cantidad del cliente sin validarlos contra la venta original → fraude de devoluciones e inflado de stock (`backend/server.ts:1519`).
2. `POST /api/purchases` usa un `supplierId` del body sin verificar propiedad → fuga de datos del proveedor cross-tenant (`backend/server.ts:3670`).
3. `POST /api/purchases/:id/pay` no es idempotente → doble débito de billetera por TOCTOU (`backend/server.ts:3815`).
4. Una venta a crédito sincronizada offline se registra como pagada y pierde la cuenta por cobrar (`backend/routes/sync.ts:130`).

Le siguen **46 altos** —destaca la derivación de `SUPER_ADMIN` desde un claim de email del JWT junto con `/api/auth/register` firmando emails arbitrarios—. El resto (medios/bajos) son mayormente los gaps ya anticipados por la línea base (`docs/SECURITY_AUDIT.md`): cobertura incompleta de `AuditLog` (Capa 3), precisión decimal (Capa 4) y ausencia de soft-delete (Capa 2), ahora localizados con `archivo:línea`.

> **Calibración:** la pasada adversaria confirmó casi todo (150/153), señal de que el verificador fue poco agresivo refutando. Verifiqué a mano los 4 críticos contra el código y se sostienen; el resto (sobre todo medios/bajos) conviene triarlo. Nada se reprodujo en runtime (ver limitaciones).

### Hallazgos accionables por severidad

| 🔴 Crítico | 🟠 Alto | 🟡 Medio | ⚪ Bajo | Total accionable | Descartados |
| --- | --- | --- | --- | --- | --- |
| 4 | 46 | 65 | 37 | 152 | 1 |

### Por capa del loop

| Capa | Hallazgos |
| --- | --- |
| 1 | 8 |
| 2 | 1 |
| 3 | 38 |
| 4 | 40 |
| 5 | 36 |
| correctitud | 29 |

### Por módulo

| Módulo | 🔴 | 🟠 | 🟡 | ⚪ | Descartados |
| --- | --- | --- | --- | --- | --- |
| Autenticación y sesiones | 0 | 1 | 1 | 3 | 1 |
| POS / Ventas / Devoluciones | 1 | 4 | 3 | 2 | 0 |
| Inventario / Kardex / Conteos | 0 | 4 | 4 | 4 | 0 |
| Compras / Proveedores / Órdenes de compra | 2 | 5 | 2 | 0 | 0 |
| Facturación y Fiscal (DGI) | 0 | 1 | 8 | 3 | 0 |
| Contabilidad / Ledger / Depreciación | 0 | 3 | 5 | 4 | 0 |
| Nómina / RRHH | 0 | 3 | 10 | 3 | 0 |
| Cobranza / CxC / Créditos | 0 | 2 | 3 | 1 | 0 |
| Caja / Turnos | 0 | 2 | 2 | 2 | 0 |
| Prestamista (Lender / Fintech / Scoring) | 0 | 3 | 5 | 1 | 0 |
| Delivery / Motorizados / Pedidos | 0 | 3 | 5 | 4 | 0 |
| Sync / Offline (PWA) | 1 | 5 | 3 | 1 | 0 |
| Admin / SuperAdmin / Team / Tenant | 0 | 2 | 5 | 2 | 0 |
| Auditoría (AuditLog) — capa transversal 3 | 0 | 6 | 7 | 4 | 0 |
| Integraciones (Stripe / WhatsApp / Email) | 0 | 2 | 2 | 3 | 0 |

## Backlog priorizado (top 12)

| # | Sev | Veredicto | Módulo | Ubicación | Acción |
| --- | --- | --- | --- | --- | --- |
| 1 | 🔴 CRÍTICO | CONFIRMED | POS / Ventas / Devoluciones | `backend/server.ts:1519` | Cargar sale.items con quantity y priceAtSale; por item devuelto: (a) exigir que productId pertenezca a la venta, (b) quantitySolicitada <= quantityVendida - sumaYaDevuelta(productId), (c) usar priceAtSale del servidor (no el price del cliente) para returnTotal y el decremento, todo en decimal.js. Registrar/consultar devoluciones previas por saleId. |
| 2 | 🔴 CRÍTICO | CONFIRMED | Compras / Proveedores / Órdenes de compra | `backend/server.ts:3670` | Dentro de la transacción agregar const supplier = await tx.supplier.findFirst({ where:{ id:supplierId, tenantId:authReq.tenantId } }); if(!supplier) throw 'SUPPLIER_NOT_FOUND'; replicando el patrón de purchaseOrders.ts:167. |
| 3 | 🔴 CRÍTICO | CONFIRMED | Compras / Proveedores / Órdenes de compra | `backend/server.ts:3815` | Reemplazar el update incondicional por prisma.purchase.updateMany({ where:{ id, tenantId, status:'PENDING_PAYMENT' }, data:{ status:'COMPLETED' } }) dentro de la tx y abortar (409) si count===0; recién entonces decrementar wallet y crear el gasto. |
| 4 | 🔴 CRÍTICO | CONFIRMED | Sync / Offline (PWA) | `backend/routes/sync.ts:130` | Reflejar executeSale para CREDIT: validar cliente tenant-scoped, isBlocked y creditLimit; setear Sale.balance=total y dueDate; incrementar customer.currentDebt; NO crear Payment por el total en ventas a crédito. Idealmente delegar en executeSale. |
| 5 | 🟠 ALTO | CONFIRMED | Autenticación y sesiones | `backend/middleware/auth.ts:73` | No derivar SUPER_ADMIN del email del JWT: usar un flag/rol persistido y verificado contra la DB (o allowlist de userId server-side). Bloquear en /api/auth/register y /api/team/invite cualquier email en SUPER_ADMIN_EMAILS, mover la lista a variable de entorno y quitar el email del bundle frontend (Login.tsx:39). |
| 6 | 🟠 ALTO | CONFIRMED | POS / Ventas / Devoluciones | `backend/server.ts:1524` | Dentro del $transaction agregar tx.auditLog.create con action 'RETURN_CREATED' y before/after (capturar el saldo previo del cliente antes del decrement) incluyendo tenantId/userId/saleId/returnId/total/costTotal/items. |
| 7 | 🟠 ALTO | CONFIRMED | POS / Ventas / Devoluciones | `backend/server.ts:1614` | Dentro del $transaction: (1) await recordPayment(tx, tenantId, userId, payment.id, paymentAmount); (2) tx.auditLog.create action 'PAYMENT_RECEIVED' con before/after (balance/status/deuda previos vs nuevos). Y no ocultar el error en el catch. |
| 8 | 🟠 ALTO | CONFIRMED | POS / Ventas / Devoluciones | `backend/server.ts:1618` | Mover la lectura dentro del $transaction con bloqueo (FOR UPDATE / serializable) y actualizar balance de forma relativa: sale.update({ data:{ balance:{ decrement: paymentAmount } } }), recomputando status desde el balance resultante en vez de escribir un absoluto. |
| 9 | 🟠 ALTO | CONFIRMED | POS / Ventas / Devoluciones | `backend/server.ts:1626` | Validar que la venta esté CREDIT_PENDING con balance>0 y new Decimal(amount) <= balance; decrementar currentDebt solo por el saldo efectivamente cubierto y solo para ventas a crédito, en decimal.js. |
| 10 | 🟠 ALTO | CONFIRMED | Inventario / Kardex / Conteos | `backend/server.ts:2541` | Reemplazar parseInt por parseo decimal (Zod z.number().nonnegative() / decimal.js) preservando fracciones en stock (2541) y minStock (2532); escribir Kardex solo si el stock real cambió respecto al valor sin truncar. |
| 11 | 🟠 ALTO | CONFIRMED | Inventario / Kardex / Conteos | `backend/server.ts:2726` | Sustituir el borrado físico por soft-delete (deletedAt); nunca cascada sobre KardexMovement/StockCountItem (cambiar a Restrict o desacoplar la FK como SaleItem). Antes de desactivar, escribir AuditLog PRODUCT_DELETED con before (snapshot) y userId/tenantId dentro de una $transaction. |
| 12 | 🟠 ALTO | CONFIRMED | Inventario / Kardex / Conteos | `backend/server.ts:2442` | Dentro de la misma tx del lote, cuando existing.cost!==cost o existing.price!==price, crear AuditLog (COST_CHANGED/PRICE_CHANGED) con {productId, costBefore, costAfter, priceBefore, priceAfter, userId, tenantId}, igual que el PUT unitario. |

## Detalle por módulo

### Autenticación y sesiones

_5 accionables · 1 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 5] Email SUPER_ADMIN hardcodeado permite god-mode multi-tenant vía /api/auth/register
- **Ubicación:** `backend/middleware/auth.ts:73`
- **Qué pasa:** authenticate() (auth.ts:73) y requireSuperAdmin() (auth.ts:138) conceden bypass total y privilegio SUPER_ADMIN a cualquier token cuyo claim email esté en la lista hardcodeada SUPER_ADMIN_EMAILS ['noelpinedaa96@gmail.com'], y /api/auth/register firma un JWT con el email que el cliente elija (server.ts:282) sin bloquear ese email.
- **Escenario de fallo:** En una instancia donde ese User aún no existe (deploy nuevo, staging, self-hosted, o fila borrada), un anónimo hace POST /api/auth/register con email='noelpinedaa96@gmail.com'. register solo bloquea si existingUser ya existe (server.ts:228-231); si no, crea tenant+user y devuelve un JWT con email=noelpinedaa96@gmail.com. authenticate() salta paywall y trata el token como SUPER_ADMIN -> acceso a datos (dinero/inventario) de TODOS los tenants y a /api/admin.
- **Fix sugerido:** No derivar SUPER_ADMIN del email del JWT: usar un flag/rol persistido y verificado contra la DB (o allowlist de userId server-side). Bloquear en /api/auth/register y /api/team/invite cualquier email en SUPER_ADMIN_EMAILS, mover la lista a variable de entorno y quitar el email del bundle frontend (Login.tsx:39).
- **Nota del verificador:** Confirmado leyendo auth.ts:73 y :138 (check por email) + server.ts:223-289 (register firma email arbitrario en el JWT y solo valida existingUser). Explotabilidad condicionada a que la cuenta del super-admin no exista todavía: en la instancia de producción donde el CEO ya está registrado, register devuelve 400 y este vector queda cerrado. Por eso 'alto' y no 'critico'. La fuga del email en el bundle (Login.tsx:39) es real pero secundaria.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] reset-password guarda el JWT en claves de localStorage equivocadas: el auto-login queda roto
- **Ubicación:** `components/ResetPassword.tsx:71`
- **Qué pasa:** Tras el reset, ResetPassword.tsx guarda token/usuario en las claves 'token'/'user' (líneas 71-72), pero el resto de la app lee 'nortex_token' (utils/auth.ts:21) y el guard de rutas revisa 'nortex_token' (App.tsx:61-62), por lo que el auto-login prometido no surte efecto.
- **Escenario de fallo:** El backend responde 200 con token+user (server.ts:895-898). El componente hace setItem('token', ...)/setItem('user', ...) y navega a '/app' tras 2s. El ProtectedRoute (App.tsx:62) hace Navigate a /login porque 'nortex_token' nunca se seteó; además faltan 'nortex_tenant_id'/'nortex_tenant_data' que otros componentes requieren. El usuario cree quedar logueado pero es expulsado al login.
- **Fix sugerido:** Guardar bajo las mismas claves que Login.tsx/RegisterTenant.tsx: 'nortex_token', 'nortex_user' (con tenant), 'nortex_tenant_id' y 'nortex_tenant_data'. Centralizar el guardado de sesión en una función compartida para evitar divergencias.
- **Nota del verificador:** Confirmado: server.ts:895-898 sí devuelve token+user; ResetPassword.tsx:71-72 usa claves 'token'/'user'; utils/auth.ts:21 y App.tsx:61-62 leen 'nortex_token'. Es bug de correctitud/UX, no de seguridad; 'medio' es adecuado (el usuario puede loguearse manualmente después).

#### ⚪ [BAJO · CONFIRMED · Capa 2] Borrado físico de Invitation al cancelar (sin soft-delete ni AuditLog)
- **Ubicación:** `backend/server.ts:719`
- **Qué pasa:** DELETE /api/team/invite/:invitationId ejecuta prisma.invitation.delete (server.ts:719), borrando físicamente la concesión de acceso sin marcarla CANCELLED y sin asiento en AuditLog, a diferencia del endpoint hermano DELETE /api/team/:userId que hace soft-delete (status DISABLED) + auditLog (server.ts:497-509).
- **Escenario de fallo:** Un OWNER cancela una invitación pendiente; la fila se elimina por completo: no queda rastro de que ese email fue invitado con cierto rol, ni de quién la revocó. La forensia de accesos pierde el evento.
- **Fix sugerido:** Reemplazar por update de estado a 'CANCELLED' (la propiedad ya se verifica con findFirst por tenantId en server.ts:711-713) y registrar AuditLog 'CANCEL_INVITATION' con userId/tenantId, en línea con el endpoint hermano.
- **Nota del verificador:** Confirmado: server.ts:711-713 verifica propiedad por tenant (no hay fuga cross-tenant), pero :719 es delete físico sin audit; el hermano :497-509 sí hace soft-delete+audit. Gap Capa 2/3 real; severidad 'bajo' correcta (es una invitación pendiente, no un histórico financiero).

#### ⚪ [BAJO · CONFIRMED · Capa 3] El registro de tenant acredita walletBalance/creditLimit sin dejar asiento de auditoría
- **Ubicación:** `backend/server.ts:246`
- **Qué pasa:** La $transaction de /api/auth/register (server.ts:237-278) crea el Tenant con walletBalance=10000 y creditLimit=5000 (campos de dinero) y crea User+Employee, pero no incluye ningún tx.auditLog.create que registre el origen de ese saldo de génesis.
- **Escenario de fallo:** Un negocio se auto-registra; el libro del tenant queda con walletBalance=10000 sin asiento inmutable (before=0/after=10000, userId, tenantId). Una revisión forense no puede distinguir el crédito de génesis de una manipulación posterior; además registros repetidos acreditan 10000 c/u sin rastro auditable.
- **Fix sugerido:** Dentro de la misma $transaction, agregar tx.auditLog.create (action p.ej. 'TENANT_GENESIS_CREDIT', tenantId=tenant.id, userId=user.id, before/after documentando 0->10000/5000).
- **Nota del verificador:** Confirmado leyendo server.ts:237-295: no hay auditLog.create dentro (ni fuera) de la transacción del register. Gap Capa 3 real. Severidad 'bajo': es crédito de génesis en creación de cuenta, no un movimiento de dinero entre cuentas existentes.

#### ⚪ [BAJO · CONFIRMED · Capa 5] forgot-password revela si un email existe cuando falla el envío del correo
- **Ubicación:** `backend/server.ts:790`
- **Qué pasa:** Ante fallo de envío del correo el endpoint responde 500 con error específico solo cuando el usuario SÍ existe (server.ts:787-790), mientras que para un email inexistente responde 200 genericMsg (server.ts:755), creando un oráculo de enumeración de cuentas.
- **Escenario de fallo:** Con el servicio de correo caído/mal configurado, un atacante prueba emails: no registrado -> 200 {message genérico}; registrado -> 500 {error:'Error interno: No se pudo enviar el correo...'}. La diferencia de status/cuerpo permite enumerar qué correos tienen cuenta, rompiendo el diseño anti-enumeración del propio endpoint.
- **Fix sugerido:** Ante fallo de envío, loguear server-side y responder igual el genericMsg 200/202. No diferenciar la respuesta según exista o no el usuario.
- **Nota del verificador:** Confirmado: server.ts:753-755 (no existe -> 200 genérico) vs :787-790 (existe + fallo de envío -> 500 específico). El oráculo es real pero condicionado a una caída/misconfig del email (Resend/SMTP); bajo operación normal ambos casos devuelven 200 genérico. Severidad 'bajo' correcta por lo condicional.

<details><summary>Descartados por la pasada adversaria (1)</summary>

- **costPrice sembrado con aritmética de punto flotante nativa (price * 0.7)** (`components/RegisterTenant.tsx:71`) — REFUTED en cuanto al impacto Capa 4: el cálculo float existe (no usa decimal.js), pero salesService.ts:72-74 y :222-231 ignoran el costPrice del cliente y fijan el costo con Decimal desde Product.cost, así que la venta/valorización nunca hereda la imprecisión. El campo costPrice del carrito es efímero/de display. Downgrade de 'medio' a 'bajo' y verdict REFUTED por ausencia del daño alegado.

</details>

### POS / Ventas / Devoluciones

_10 accionables · 0 descartados_

#### 🔴 [CRÍTICO · CONFIRMED · Capa 5] /api/returns confía en precio/cantidad/producto del cliente sin validar contra la venta original
- **Ubicación:** `backend/server.ts:1519`
- **Qué pasa:** El endpoint de devoluciones nunca compara los items devueltos contra los realmente vendidos: usa el price y quantity del cliente para calcular el reembolso, restaurar stock y reducir la deuda del cliente.
- **Escenario de fallo:** La venta se carga con include items:{select:{productId,costAtSale}} (server.ts:1515), sin quantity ni priceAtSale; CreateReturnSchema solo valida forma. POST /api/returns con un saleId CREDIT válido e items:[{productId:<cualquiera>, quantity:9999, price:999999}]: (1) returnTotal=9999*999999 (1519), (2) applyStockDelta delta=+9999 enforceSufficient:false (1542-1547) infla stock fantasma, (3) customer.currentDebt decrement por returnTotal (1571-1576) dejando la deuda en ~-9.99e9, (4) nota de crédito contable falsa. Sin tope acumulado ni verificación de que el producto pertenezca a la venta.
- **Fix sugerido:** Cargar sale.items con quantity y priceAtSale; por item devuelto: (a) exigir que productId pertenezca a la venta, (b) quantitySolicitada <= quantityVendida - sumaYaDevuelta(productId), (c) usar priceAtSale del servidor (no el price del cliente) para returnTotal y el decremento, todo en decimal.js. Registrar/consultar devoluciones previas por saleId.
- **Nota del verificador:** CONFIRMADO — el hallazgo más grave. Detalle adicional descubierto al leer el código: returnTotal se calcula en la línea 1519 sobre TODOS los items ANTES del loop de stock; si un productId no existe, applyStockDelta lanza PRODUCT_NOT_FOUND y el loop hace 'continue' (1549) saltando solo el stock, pero ese item YA infló returnTotal y por tanto el decremento de currentDebt y el total persistido → se puede anular deuda con productos inexistentes. Tampoco hay registro/consulta de devoluciones previas por saleId, así que la misma venta se devuelve ilimitadamente. Severidad critico correcta.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Devolución/nota de crédito no escribe AuditLog (operación que mueve dinero e inventario sin asiento de auditoría inmutable)
- **Ubicación:** `backend/server.ts:1524`
- **Qué pasa:** La transacción de POST /api/returns restaura stock y reduce la deuda del cliente pero nunca crea un AuditLog, dejando la devolución sin rastro de auditoría inmutable con before/after/userId/tenantId (Capa 3).
- **Escenario de fallo:** La tx (server.ts:1524-1589) crea ProductReturn, incrementa stock (applyStockDelta+Kardex), decrementa customer.currentDebt y registra el asiento contable (recordReturn), pero NO ejecuta tx.auditLog.create. A diferencia de la venta (salesService.ts:324 escribe SALE_CREATED), la devolución no deja ninguna entrada en AuditLog.
- **Fix sugerido:** Dentro del $transaction agregar tx.auditLog.create con action 'RETURN_CREATED' y before/after (capturar el saldo previo del cliente antes del decrement) incluyendo tenantId/userId/saleId/returnId/total/costTotal/items.
- **Nota del verificador:** Confirmado leyendo toda la tx: no hay tx.auditLog.create. Viola Capa 3 (mandatoria para operaciones que mueven dinero/inventario). CORRECCIÓN al escenario del candidato: el motor forense de audit.ts NO lee AuditLog (lee KardexMovement, CashMovement y Shift); además el Kardex de la devolución (type 'RETURN', con referenceId) tampoco lo captura detectSuspiciousKardex (filtra type IN ['ADJUSTMENT','OUT'] con referenceId null). O sea la operación queda igualmente sin trazabilidad forense, pero la premisa concreta 'el motor lee AuditLog' es imprecisa. El defecto de control (sin evidencia inmutable de quién autorizó la reversión) es real. Severidad alto se mantiene.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Cobro de pago/abono no escribe AuditLog ni asiento contable (recordPayment nunca se invoca)
- **Ubicación:** `backend/server.ts:1614`
- **Qué pasa:** POST /api/payments cobra dinero, reduce customer.currentDebt y marca la venta como PAID sin crear AuditLog y sin llamar a recordPayment, dejando el cobro sin rastro inmutable ni asiento contable.
- **Escenario de fallo:** La tx (server.ts:1614-1633) crea Payment, actualiza sale.balance/status y decrementa customer.currentDebt, pero NO ejecuta tx.auditLog.create y NUNCA llama recordPayment. Resultado: el cobro solo queda como fila Payment mutable, sin asiento de auditoría inmutable y sin asiento contable (Caja 1.1.1 nunca se debita, CxC 1.1.3 nunca se acredita).
- **Fix sugerido:** Dentro del $transaction: (1) await recordPayment(tx, tenantId, userId, payment.id, paymentAmount); (2) tx.auditLog.create action 'PAYMENT_RECEIVED' con before/after (balance/status/deuda previos vs nuevos). Y no ocultar el error en el catch.
- **Nota del verificador:** CONFIRMADO con evidencia dura: recordPayment está importado (server.ts:19) y definido (accounting.ts:247) pero grep muestra CERO call-sites — nunca se invoca. La tx de payments no tiene tx.auditLog.create. Consecuencia contable real: los abonos a crédito jamás impactan el libro mayor, subvaluando Caja y sobrevaluando CxC en el Balance General. El catch de la línea 1635 además se traga el error con un genérico 'Error'. Severidad alto adecuada.

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] /api/payments: race condition (lost update) al escribir sale.balance desde una lectura previa a la transacción
- **Ubicación:** `backend/server.ts:1618`
- **Qué pasa:** La venta se lee FUERA de la $transaction y el nuevo balance se calcula como valor absoluto a partir de esa lectura obsoleta, por lo que pagos concurrentes se pisan entre sí.
- **Escenario de fallo:** sale (con balance) se lee en server.ts:1608, antes del $transaction. Dentro de la tx, newBalance = sale.balance - paymentAmount se computa desde ese valor obsoleto (1618) y se escribe absoluto (1621-1624). Dos pagos concurrentes sobre balance=100 (60 y 40) leen ambos 100; A escribe 40, B escribe 60 → gana el último commit aunque se cobraron 100. currentDebt usa { decrement } atómico (1629) y baja los 100, dejando sale.balance/estado inconsistentes con Payment y deuda.
- **Fix sugerido:** Mover la lectura dentro del $transaction con bloqueo (FOR UPDATE / serializable) y actualizar balance de forma relativa: sale.update({ data:{ balance:{ decrement: paymentAmount } } }), recomputando status desde el balance resultante en vez de escribir un absoluto.
- **Nota del verificador:** Confirmado: la lectura está fuera de la $transaction (1608) y el update escribe un valor absoluto calculado con datos pre-transacción (aislamiento por defecto ReadCommitted, sin SELECT FOR UPDATE). Lost update real sobre balance/status. Nota: el { decrement } de currentDebt sí es atómico, lo que agrava la inconsistencia entre balance y deuda. Severidad alto adecuada; se combina con los hallazgos 6 y 9 sobre el mismo endpoint.

#### 🟠 [ALTO · CONFIRMED · Capa 5] /api/payments no valida que la venta tenga saldo/crédito ni que amount <= balance → deuda del cliente reducida indebidamente
- **Ubicación:** `backend/server.ts:1626`
- **Qué pasa:** El pago decrementa currentDebt del cliente por cualquier monto sin comprobar que la venta sea a crédito ni que exista saldo pendiente, permitiendo sobrepago y anulación de deuda real.
- **Escenario de fallo:** executeSale guarda customerId incluso en ventas CASH (salesService.ts:210) y /api/payments solo verifica if (sale.customerId) para decrementar currentDebt (1626-1629), sin exigir paymentMethod=='CREDIT' ni amount<=balance. Escenario A: venta CASH con cliente (balance 0) recibe POST /api/payments {amount:5000} → balance -5000, status PAID y currentDebt del cliente -5000, saldando deuda de OTRAS ventas a crédito sin ingreso de efectivo. Escenario B: en crédito con balance 100, amount 1e9 → balance y currentDebt negativos.
- **Fix sugerido:** Validar que la venta esté CREDIT_PENDING con balance>0 y new Decimal(amount) <= balance; decrementar currentDebt solo por el saldo efectivamente cubierto y solo para ventas a crédito, en decimal.js.
- **Nota del verificador:** Confirmado: no hay validación de estado CREDIT_PENDING, de balance>0, ni de amount<=balance antes del decremento (server.ts:1614-1633). El escenario A es posible porque el schema/executeSale permiten customerId en ventas no-CREDIT; el escenario B (sobrepago) es un defecto válido por sí solo. Distinto del hallazgo 8 (race) y del 6 (auditoría): keep separado. Severidad alto adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa 1] customerId (y employeeId) de ventas no-CREDIT se persiste sin validar tenant → fuga del nombre de cliente de otro tenant vía /api/sales/search
- **Ubicación:** `backend/services/salesService.ts:211`
- **Qué pasa:** executeSale solo valida la pertenencia de customerId al tenant en el ramo CREDIT; para CASH/CARD/QR/TRANSFER guarda cualquier customerId/employeeId del body sin verificar, y la relación Sale.customer no filtra por tenant, de modo que /api/sales/search filtra el nombre del Customer de otro tenant.
- **Escenario de fallo:** POST /api/sales con paymentMethod='CASH' y customerId=<cuid de tenant B> persiste ese customerId (salesService.ts:210, sin pasar por el findFirst tenant-scoped de 160-165 que solo corre si paymentMethod==='CREDIT'). Luego GET /api/sales/search?q=<prefijo del id> hace un findFirst tenant-scoped pero con include customer:{select:{id,name}} (server.ts:1498); como Sale.customer @relation(fields:[customerId],references:[id]) (schema.prisma:515) no restringe tenant, devuelve el name del Customer de B → lectura cross-tenant de PII.
- **Fix sugerido:** Mover el prisma.customer.findFirst({where:{id:customerId,tenantId}}) fuera del branch CREDIT: si customerId viene informado y no pertenece al tenant, lanzar CUSTOMER_NOT_FOUND. Igual verificación para employeeId antes de persistirlo.
- **Nota del verificador:** Verificado en el código: la única validación de customerId contra tenantId está dentro del branch CREDIT (salesService.ts:160-165); el /api/sales handler (server.ts:1460) no pre-valida; el include de search no filtra tenant. employeeId sufre lo mismo (línea 211). Defecto REAL. Severidad borderline medio/bajo: explotar la fuga del nombre exige conocer de antemano un cuid ajeno (cuids no enumerables), lo que acota el impacto — pero además queda una brecha de integridad: una venta puede referenciar un Customer de otro tenant.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Devolución calcula el monto de reembolso con aritmética float nativa (Number/+/*) en vez de decimal.js
- **Ubicación:** `backend/server.ts:1519`
- **Qué pasa:** POST /api/returns computa returnTotal con Number(item.price)*Number(item.quantity) sumado con + nativo, violando la regla obligatoria de Capa 4 (cero Number/parseFloat en montos); ese float persiste, ajusta deuda y alimenta la contabilidad.
- **Escenario de fallo:** En server.ts:1519 se revierte el string Decimal-safe del schema a float. El returnTotal float se guarda en ProductReturn.total (1530), decrementa Customer.currentDebt (1574) y se pasa a recordReturn (1585). Contrasta con executeSale, que hace todo el total en Decimal.
- **Fix sugerido:** const returnTotal = items.reduce((acc,it)=>acc.plus(new Decimal(it.price).mul(it.quantity)), new Decimal(0)).toDecimalPlaces(2); usar el Decimal para persistir/decrementar/registrar.
- **Nota del verificador:** El uso de float es REAL y viola la Capa 4 obligatoria del CLAUDE.md. AJUSTO severidad de alto→medio: las columnas son Decimal(10,2) (Customer.currentDebt schema.prisma:165, ProductReturn.total:966), por lo que Postgres redondea a 2 decimales cualquier deriva sub-centavo (47.949999... → 47.95) al persistir y al aplicar { decrement }, acotando el impacto financiero real a valores absurdamente grandes. Además el asiento de recordReturn deriva neto/IVA del mismo total y queda balanceado (Σdebe==Σhaber), así que la afirmación de 'partida doble descuadrada devolución tras devolución' está sobredimensionada. El valor del hallazgo es cumplimiento de estándar y consistencia con executeSale.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] /api/returns sin checkRole: cualquier cajero puede inflar inventario y anular deuda, control que /api/inventory/adjust sí restringe a OWNER/ADMIN
- **Ubicación:** `backend/server.ts:1507`
- **Qué pasa:** /api/returns muta stock (applyStockDelta) y deuda del cliente con solo authenticate, mientras el endpoint equivalente que mueve stock (/api/inventory/adjust) exige checkRole(['OWNER','ADMIN']).
- **Escenario de fallo:** Un CASHIER recibe 403 en /api/inventory/adjust (server.ts:2802 checkRole OWNER/ADMIN) pero puede llamar /api/returns (1507, solo authenticate) para incrementar stock (1542-1547) y reducir currentDebt (1571-1576), evadiendo el control de rol equivalente.
- **Fix sugerido:** Añadir checkRole (p.ej. ['OWNER','ADMIN'] o supervisor) a /api/returns acorde a la política de devoluciones, alineándolo con /api/inventory/adjust; revisar también /api/payments.
- **Nota del verificador:** Confirmado por grep: /api/returns (1507) y /api/payments (1602) tienen solo authenticate; /api/inventory/adjust (2802), /api/kardex/:productId (2739) y todos los /api/stock-counts (3127+) exigen checkRole(['OWNER','ADMIN']). Inconsistencia de gating real entre endpoints que mutan el mismo recurso (stock) y dinero. Severidad medio adecuada; es secundario/complementario al hallazgo 7 (que permite el abuso incluso a un OWNER por falta de validación de negocio).

#### ⚪ [BAJO · CONFIRMED · Capa 1] customer.update sin filtro tenantId en /api/returns (id suelto)
- **Ubicación:** `backend/server.ts:1573`
- **Qué pasa:** El decremento de deuda en devoluciones actualiza el Customer por id sin incluir tenantId en el where, a diferencia de /api/payments que sí lo filtra.
- **Escenario de fallo:** tx.customer.update({ where: { id: sale.customerId }, data:{ currentDebt:{ decrement: returnTotal } } }) sin tenantId (server.ts:1571-1576). Hoy no es explotable cross-tenant porque el update solo corre si paymentMethod==='CREDIT' y los customerId de ventas CREDIT sí se validan contra el tenant al crearse. Pero depende de un invariante mantenido en otro archivo; cualquier cambio futuro que permita un customerId ajeno en una venta CREDIT mutaría la deuda de un Customer de otro tenant.
- **Fix sugerido:** tx.customer.update({ where: { id: sale.customerId, tenantId: authReq.tenantId }, ... }), igual que /api/payments.
- **Nota del verificador:** Confirmado: el where del update NO incluye tenantId, mientras que /api/payments (server.ts:1628) sí lo incluye. Correctamente auto-descrito como no explotable hoy; es un hallazgo de defensa en profundidad. Severidad bajo adecuada.

#### ⚪ [BAJO · CONFIRMED · Capa 4] ReceiptTicket recomputa el total de línea con multiplicación float y toFixed sobre dinero
- **Ubicación:** `components/ReceiptTicket.tsx:101`
- **Qué pasa:** El ticket recalcula el importe de cada línea con (item.price * item.quantity).toFixed(2) usando aritmética float nativa en lugar de decimal.js.
- **Escenario de fallo:** Para price 0.1 x quantity 3 la multiplicación float da 0.30000000000000004 y toFixed(2) redondea a 0.30; en casos límite el importe por línea impreso puede diferir un centavo del cálculo autoritativo del backend y la suma de líneas puede no coincidir con el total.
- **Fix sugerido:** Formatear con helper decimal.js: new Decimal(item.price).mul(item.quantity).toFixed(2), o que el backend envíe el importe por línea ya calculado.
- **Nota del verificador:** Confirmado: línea 101 usa item.price*item.quantity nativo. Impacto acotado a presentación del comprobante impreso; no altera datos persistidos (subtotal/tax/total vienen del backend). Severidad bajo correcta.

### Inventario / Kardex / Conteos

_12 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 4] parseInt() trunca stock fraccionario al editar producto → pérdida silenciosa de inventario y movimiento Kardex fantasma
- **Ubicación:** `backend/server.ts:2541`
- **Qué pasa:** PUT /api/products/:id hace `parseInt(stock)` (2541) y `parseInt(minStock)` (2532), truncando decimales y registrando en el Kardex una diferencia que nunca ocurrió físicamente.
- **Escenario de fallo:** Producto en unidad 'metro' con stock=10.5 (columna Float, confirmado schema.prisma:756). El formulario reenvía stock=10.5; el backend hace newStock=parseInt('10.5')=10, stockDiff=10-10.5=-0.5, fija stock=10 (pierde 0.5 m valorizado) y crea KardexMovement type=ADJUSTMENT quantity=-0.5 reason='Ajuste manual de inventario' que jamás sucedió — corrompe el libro y la auditoría en cada edición que incluya stock.
- **Fix sugerido:** Reemplazar parseInt por parseo decimal (Zod z.number().nonnegative() / decimal.js) preservando fracciones en stock (2541) y minStock (2532); escribir Kardex solo si el stock real cambió respecto al valor sin truncar.
- **Nota del verificador:** CONFIRMADO. schema.prisma:756-757 define stock/minStock como Float @default(0); unit admite kg/litro/metro (758). El parseInt en 2532/2541 trunca inevitablemente. Se dispara cada vez que el body incluye stock (bloque 2540-2560).

#### 🟠 [ALTO · CONFIRMED · Capa 3] DELETE de producto arrasa el Kardex "inmutable" por onDelete:Cascade y sin AuditLog
- **Ubicación:** `backend/server.ts:2726`
- **Qué pasa:** DELETE /api/products/:id hace prisma.product.delete({where:{id}}) (2726); el onDelete:Cascade de KardexMovement/ProductBatch/StockCountItem borra todo el historial y no se escribe ningún AuditLog del borrado ni soft-delete.
- **Escenario de fallo:** OWNER/ADMIN ajusta 'Cemento X' a stock=0 y llama DELETE. product.delete dispara los onDelete:Cascade (schema.prisma:822/848/891): se borran PERMANENTEMENTE todos los KardexMovement, lotes y renglones de conteo — el ledger que el código llama 'inmutable' queda destruido. Los SaleItem quedan apuntando a un productId inexistente (guardado como string sin FK) y NO se escribe AuditLog de quién borró. Pérdida irreversible del rastro de inventario (COGS/DGI no reconstruibles).
- **Fix sugerido:** Sustituir el borrado físico por soft-delete (deletedAt); nunca cascada sobre KardexMovement/StockCountItem (cambiar a Restrict o desacoplar la FK como SaleItem). Antes de desactivar, escribir AuditLog PRODUCT_DELETED con before (snapshot) y userId/tenantId dentro de una $transaction.
- **Nota del verificador:** CONFIRMADO. Cascadas verificadas en schema.prisma:822 (KardexMovement.product), 848 (ProductBatch.product), 891 (StockCountItem.product). server.ts:2726 borra físico sin AuditLog ni deletedAt. Severidad ajustada de crítico→alto: requiere rol OWNER/ADMIN y precondición stock=0 (2720), y es una acción destructiva del propio dueño; aun así la destrucción irreversible del ledger y la ausencia total de traza la mantienen en alto.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Carga masiva reescribe cost (base de valuación) y price sin AuditLog before/after
- **Ubicación:** `backend/server.ts:2442`
- **Qué pasa:** POST /api/products/bulk actualiza cost y price de productos existentes (2442-2445) sin dejar ningún asiento de auditoría, mientras el PUT unitario sí registra PRICE_CHANGED con before/after (2570-2582) — vía de evasión del log.
- **Escenario de fallo:** Un ADMIN sube un CSV con SKUs existentes y un cost manipulado (inflar costo para reducir utilidad/impuestos o encubrir faltantes). En 2442 el update escribe {name,price,cost,stock,minStock,category,unit}: solo el delta de stock genera KardexMovement BULK_IMPORT (2448-2462); el cambio de cost/price —que altera la base de valuación y el COGS futuro— no deja NINGÚN registro before/after. El PUT unitario sí lo audita, así que la carga masiva es un bypass silencioso.
- **Fix sugerido:** Dentro de la misma tx del lote, cuando existing.cost!==cost o existing.price!==price, crear AuditLog (COST_CHANGED/PRICE_CHANGED) con {productId, costBefore, costAfter, priceBefore, priceAfter, userId, tenantId}, igual que el PUT unitario.
- **Nota del verificador:** CONFIRMADO. server.ts:2440-2463 (rama existing) no crea AuditLog para cost/price; contrasta con 2570-2582. Sobreescribir cost contradice además el invariante declarado 'el costo es promedio ponderado del sistema' (server.ts:2618).

#### 🟠 [ALTO · CONFIRMED · Capa 3] PUT /api/products/:id escribe el Kardex fuera de una transacción → el ledger inmutable puede quedar corrupto
- **Ubicación:** `backend/server.ts:2547`
- **Qué pasa:** El KardexMovement.create (2547) y el product.update (2562) se ejecutan como dos llamadas Prisma independientes SIN $transaction, así que un fallo del update deja un asiento Kardex fantasma de un cambio de stock que nunca se aplicó.
- **Escenario de fallo:** Un OWNER edita un producto enviando stock nuevo y un defaultSupplierId inexistente o de otro tenant. La línea 2547 crea y COMMITEA el KardexMovement con stockBefore=existing.stock/stockAfter=newStock; luego 2562 product.update lanza violación de FK (defaultSupplierId, 2537) o el proceso muere entre ambas escrituras y responde 500. Resultado: el Kardex registra un movimiento que jamás se aplicó (product.stock intacto), descuadrando el historial vs el stock real.
- **Fix sugerido:** Envolver kardexMovement.create + product.update (+ el auditLog PRICE_CHANGED) en un único prisma.$transaction; al ajustar stock usar applyStockDelta dentro de esa tx para que ledger y stock cuadren o se reviertan juntos.
- **Nota del verificador:** CONFIRMED. server.ts:2547 usa prisma.kardexMovement.create (cliente global, no tx) y 2562 prisma.product.update por separado; no hay $transaction envolvente. El FK de defaultSupplierId (schema.prisma:787) hace el fallo del update determinístico si se pasa un id inválido.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] parseInt() trunca stock fraccionario al crear producto y en carga masiva
- **Ubicación:** `backend/server.ts:2353`
- **Qué pasa:** POST /api/products (2353: parseInt(stock), 2354: parseInt(minStock)) y POST /api/products/bulk (2420-2421) pierden la parte fraccionaria del stock/minStock inicial pese a que la columna es Float.
- **Escenario de fallo:** CSV con 'Arroz, unidad=libra, stock=25.5' → handler bulk hace parseInt('25.5')=25 (2420); se guarda stock=25 y se emite Kardex IN_PURCHASE de 25 (no 25.5, líneas 2456/2480). Se pierden 0.5 libras desde el alta y el conteo físico posterior (que sí soporta decimales) marcará esa media libra como faltante/sobrante inexistente.
- **Fix sugerido:** Parsear stock/minStock con decimal.js o Number validado por Zod (z.number().nonnegative()) preservando decimales en POST /api/products y /api/products/bulk, y registrar el Kardex con la cantidad fraccionaria real.
- **Nota del verificador:** CONFIRMADO. server.ts:2353-2354 y 2420-2421 usan parseInt; el precio/costo sí usan parseFloat (2351-2352/2418-2419) pero stock no. Columna Float confirmada.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] /api/kardex/record mueve inventario valorizado sin AuditLog ni asiento contable
- **Ubicación:** `backend/server.ts:3395`
- **Qué pasa:** El endpoint acepta type arbitrario (KardexRecordSchema type: z.string().min(1).max(40), schemas.ts:298) incl. ADJUST_LOSS/ADJUST_GAIN y muta el stock creando solo un KardexMovement (3395), sin AuditLog ni asiento en el mayor.
- **Escenario de fallo:** Un ADMIN hace POST /api/kardex/record {productId, type:'ADJUST_LOSS', quantity:-100}. El stock baja 100 uds (merma valorizada) y se crea KardexMovement con before/after, pero —a diferencia de /api/inventory/adjust que sí registra AuditLog INVENTORY_LOSS (2869-2887)— aquí NO se escribe AuditLog y tampoco se postea asiento de merma. La baja de valor queda invisible en el AuditLog; camino paralelo documentado como 'más seguro usar adjust' pero igual expuesto a OWNER/ADMIN.
- **Fix sugerido:** Dentro de la $transaction, para ajuste/pérdida/ganancia escribir AuditLog con before/after/userId/tenantId y postear el asiento contable (createJournalEntry), o retirar/deshabilitar el endpoint y forzar /api/inventory/adjust.
- **Nota del verificador:** CONFIRMADO. schemas.ts:298 confirma type string libre. server.ts:3374-3411 no crea AuditLog ni asiento. inventory/adjust sí audita, pero solo ADJUST_LOSS (2869), no ADJUST_GAIN — la ruta kardex/record no audita nada.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] /api/inventory/adjust usa leer-luego-escribir (lost update) y pisa ventas concurrentes
- **Ubicación:** `backend/server.ts:2848`
- **Qué pasa:** El ajuste hace findFirst (2832) → update con stock ABSOLUTO newStock (2848-2851) dentro de una tx sin bloqueo de fila, por lo que sobrescribe cualquier decremento atómico que otra transacción haya commiteado en medio.
- **Escenario de fallo:** Producto stock=10. La tx de ajuste hace findFirst y lee 10 (lectura de snapshot no bloqueante). En paralelo una venta POS usa applyStockDelta (decrement atómico), descuenta 3 y COMMITEA dejando stock=7. Luego el ajuste ejecuta product.update con el literal stock=10+2=12, pisando el 7: reaparecen 3 unidades ya vendidas y el Kardex guarda stockBefore=10/stockAfter=12 falsos. Mismo lost-update entre dos ajustes simultáneos.
- **Fix sugerido:** Reemplazar findFirst→update por applyStockDelta(tx, {tenantId, productId, delta: adjustQty, enforceSufficient: adjustQty < 0}) —el servicio atómico con UPDATE condicional y row-lock que ya usan la venta y el cierre de conteo— y derivar stockBefore/stockAfter de su retorno.
- **Nota del verificador:** CONFIRMADO. server.ts:2848-2851 escribe valor absoluto derivado de findFirst (2832). El comentario 'Leer stock actual CON LOCK (serializable en la transacción)' (2831) es FALSO: findFirst es lectura no bloqueante; DB es MySQL/InnoDB REPEATABLE READ (schema.prisma:10), y el patrón absoluto pierde el update concurrente en cualquier nivel de aislamiento por defecto. applyStockDelta (stockService.ts) hace el UPDATE relativo con row-lock, confirmando que la alternativa segura ya existe.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] /api/kardex/record repite el patrón leer-luego-escribir sin bloqueo (lost update)
- **Ubicación:** `backend/server.ts:3390`
- **Qué pasa:** Igual que adjust, calcula newStock = product.stock + quantity a partir de un findFirst no bloqueado (3376/3384) y escribe el literal absoluto (3390-3393), sobrescribiendo decrementos atómicos concurrentes; el endpoint sigue montado pese a la nota que recomienda usar adjust.
- **Escenario de fallo:** Producto stock=5. Una venta concurrente (applyStockDelta) lo baja a 2 y COMMITEA. Una llamada a /api/kardex/record con quantity=+1 había leído 5 y escribe stock=6 en 3392, perdiendo la venta de 3 unidades y dejando un Kardex con stockBefore=5/stockAfter=6 falsos. Alcanzable por OWNER/ADMIN validado por Zod.
- **Fix sugerido:** Migrar el handler a applyStockDelta como el resto del módulo (inventory/adjust, batches, writeoff, stock-count close), o desmontar el endpoint legacy si /api/inventory/adjust ya lo reemplaza.
- **Nota del verificador:** CONFIRMADO. server.ts:3384 newStock=product.stock+quantity; 3390-3393 update absoluto. Mismo patrón lost-update que adjust; corre en $transaction (3375) pero sin lock de fila sobre la lectura.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Importador y alta rápida truncan stock fraccionario en el cliente antes de enviarlo
- **Ubicación:** `components/ProductImporter.tsx:37`
- **Qué pasa:** ProductImporter.tsx:37-38 y QuickAddProduct.tsx:101/122 hacen parseInt(stock/minStock) en el frontend, descartando decimales aun cuando el importador reconoce una columna de unidad (kg/litro) en la misma fila (línea 40).
- **Escenario de fallo:** CSV con 'stock=2.75, unidad=kg' → validateRow muestra y envía parseInt('2.75')=2 (ProductImporter.tsx:37); el usuario ve 2 en la vista previa y confirma. Sumado al mismo truncado en el backend, la fracción se pierde en dos capas sin advertencia, pese a que el propio importador maneja unidades fraccionables (línea 40 unidad).
- **Fix sugerido:** Cambiar parseInt por parseFloat (o sanitizeDecimalInput usado en StockCount.tsx) en ProductImporter.tsx:37/38 y QuickAddProduct.tsx:101/122, validando >= 0 sin truncar.
- **Nota del verificador:** CONFIRMADO. ProductImporter.tsx:37 `parseInt(row.stock...)`, :38 minStock; QuickAddProduct.tsx:101 y :122 `parseInt(formData.stock)`. La fila reconoce unidad en ProductImporter.tsx:40.

#### ⚪ [BAJO · CONFIRMED · Capa 4] bulk-edit calcula y almacena el precio con aritmética Float nativa en vez de decimal.js
- **Ubicación:** `backend/server.ts:2636`
- **Qué pasa:** PATCH /api/products/bulk-edit guarda el precio con `Math.max(0, Math.round(Number(p.price)*factor*100)/100)` (pct, 2636) y `Math.round(priceValue*100)/100` (set, 2647), aritmética de punto flotante nativa sobre dinero persistido.
- **Escenario de fallo:** price=1.00, priceValue=0.5 → factor=1.005, 1.00*1.005=1.00499999999999989, *100=100.49999999999999, Math.round=100, precio final=1.00 en vez de 1.01 (decimal.js half-up daría 1.01). En cientos de SKU estos errores de ±1 centavo se acumulan y quedan almacenados como precio de venta.
- **Fix sugerido:** Calcular con decimal.js: new Decimal(p.price).mul(new Decimal(1).plus(new Decimal(priceValue).div(100))).toDecimalPlaces(2) para pct, y new Decimal(priceValue).toDecimalPlaces(2) para set.
- **Nota del verificador:** CONFIRMADO. server.ts:2636 y 2647 usan Math.round sobre float nativo. Nota adicional: la columna price es Float (schema.prisma:752), gap Capa 4 más amplio, pero el error de redondeo del cálculo es real e independiente del tipo de columna.

#### ⚪ [BAJO · CONFIRMED · Capa 3] AuditLog de edición masiva de precios sin valores before/after
- **Ubicación:** `backend/server.ts:2661`
- **Qué pasa:** PATCH /api/products/bulk-edit escribe AuditLog PRODUCT_BULK_EDIT (2656) pero su details (2661-2668) no incluye los precios anteriores/nuevos por producto, por lo que la mutación no es reconstruible.
- **Escenario de fallo:** Un ADMIN aplica bulk-edit priceMode:'pct', priceValue:-30 sobre 400 productos. Se crea AuditLog PRODUCT_BULK_EDIT pero details solo lleva {count, requestedIds, category, priceMode, priceValue, timestamp}: no se guardan los precios before/after de cada producto. Ante una disputa/reversión no se puede saber cuánto valía cada precio — asiento existe pero 'sin before/after'.
- **Fix sugerido:** En modo 'pct' (que ya lee cada producto en la tx, 2631-2634) capturar {id, priceBefore, priceAfter} por producto y guardarlos en details; en modo 'set' leer los ids afectados antes del updateMany para registrar los precios previos.
- **Nota del verificador:** CONFIRMADO. server.ts:2661-2668 muestra details sin before/after. En modo pct los precios previos ya están disponibles (p.price en 2635-2636) y se descartan.

#### ⚪ [BAJO · CONFIRMED · Capa correctitud] Cierre de toma física calcula el delta contra un stock de libro leído sin bloqueo
- **Ubicación:** `backend/server.ts:3289`
- **Qué pasa:** En el cierre, currentBook se lee en el findMany inicial (3266-3269) y el delta counted-currentBook (3290) se aplica más tarde con applyStockDelta (3293); una venta que commitee en medio hace que el libro final no iguale la cantidad físicamente contada.
- **Escenario de fallo:** Ítem con libro=10 (leído en 3289) y contado=12 → delta=+2 (3290). Si entre esa lectura y applyStockDelta (3293) una venta descuenta 1 y COMMITEA, applyStockDelta aplica el delta RELATIVO (+2) sobre 9 y el libro queda en 11 en vez del 12 físicamente contado. La conciliación —cuyo fin es dejar el libro EXACTAMENTE en el conteo— queda incorrecta sin error visible, y el asiento de merma/sobrante no refleja la realidad.
- **Fix sugerido:** Determinar el ajuste bajo bloqueo: releer/lock del stock inmediatamente antes de calcular delta, o fijar stock=counted con un UPDATE condicionado al stock esperado reconciliando diferencias; y/o exigir POS en pausa para el alcance contado.
- **Nota del verificador:** CONFIRMADO. currentBook=Number(it.product.stock) proviene del snapshot del findMany en 3266-3269, no de una relectura bloqueada antes del delta (3290). applyStockDelta aplica el delta relativo (stockService.ts:64), por lo que ventas commiteadas entre snapshot y aplicación desplazan el resultado. Severidad bajo: ventana corta y requiere venta concurrente durante el cierre, pero rompe el propósito de la conciliación.

### Compras / Proveedores / Órdenes de compra

_9 accionables · 0 descartados_

#### 🔴 [CRÍTICO · CONFIRMED · Capa 1] POST /api/purchases no verifica que supplierId pertenezca al tenant → fuga de datos cross-tenant del proveedor
- **Ubicación:** `backend/server.ts:3670`
- **Qué pasa:** El endpoint valida que los productos pertenezcan al tenant pero nunca valida el supplierId del body, y luego devuelve el registro completo del proveedor (include: { supplier: true }), permitiendo que el tenant A lea datos del proveedor de otro tenant.
- **Escenario de fallo:** El tenant A hace POST /api/purchases con supplierId = <id de un proveedor del tenant B> e items con productos propios válidos. Se crea Purchase con tenantId=A y supplierId=B; como purchase.create usa include:{supplier:true} y la respuesta devuelve purchase:result, A recibe name/ruc/contactName/phone/email/address del proveedor de B, y el nombre ajeno queda persistido en el Expense (CASH).
- **Fix sugerido:** Dentro de la transacción agregar const supplier = await tx.supplier.findFirst({ where:{ id:supplierId, tenantId:authReq.tenantId } }); if(!supplier) throw 'SUPPLIER_NOT_FOUND'; replicando el patrón de purchaseOrders.ts:167.
- **Nota del verificador:** CONFIRMADO. schemas.ts:116 solo exige supplierId string min(1). En el handler (server.ts:3636-3661) se valida SOLO product.findFirst con tenantId; no hay ninguna verificación del supplier. server.ts:3684 usa include:{items:true,supplier:true} y 3782 devuelve purchase:result; 3770 persiste purchase.supplier.name en el Expense. El schema Prisma confirma supplierId con FK plana a Supplier.id (sin @@unique/compuesta con tenantId), por lo que un Purchase tenantId=A + supplierId=B es válido a nivel BD. Lectura cross-tenant confirmada → crítico correcto.

#### 🔴 [CRÍTICO · CONFIRMED · Capa correctitud] POST /api/purchases/:id/pay: pago no idempotente → doble débito de billetera (TOCTOU)
- **Ubicación:** `backend/server.ts:3815`
- **Qué pasa:** El chequeo de estado se hace fuera de la transacción y el UPDATE dentro no re-verifica el estado de forma atómica, permitiendo que dos pagos concurrentes/doble-click debiten la billetera dos veces.
- **Escenario de fallo:** Compra CREDIT en PENDING_PAYMENT total=C$10,000. Dos requests concurrentes leen status=PENDING_PAYMENT (guard en 3811), ambas entran a $transaction, cada una hace tx.purchase.update incondicional (3817) + tenant.update decrement (3823) + expense.create (3829). Resultado: -C$20,000 y 2 gastos por una factura.
- **Fix sugerido:** Reemplazar el update incondicional por prisma.purchase.updateMany({ where:{ id, tenantId, status:'PENDING_PAYMENT' }, data:{ status:'COMPLETED' } }) dentro de la tx y abortar (409) si count===0; recién entonces decrementar wallet y crear el gasto.
- **Nota del verificador:** CONFIRMADO. El guard de estado (3807-3813) está FUERA del $transaction y lee sobre prisma (no tx). Dentro de la tx el update (3817-3820) es incondicional (por id, sin filtro status), no actúa de guard atómico. Bajo Read Committed dos transacciones en vuelo aplican ambos débitos. El doble-click secuencial sí queda cubierto (la 2ª lee COMPLETED), pero la concurrencia real no. Pérdida de dinero real → crítico correcto.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Registro de compra mueve dinero (billetera + gasto) e inventario valorizado sin ningún AuditLog
- **Ubicación:** `backend/server.ts:3625`
- **Qué pasa:** POST /api/purchases debita la billetera, crea un Expense y recalcula stock + costo promedio ponderado dentro de la transacción, pero no escribe ningún asiento en AuditLog.
- **Escenario de fallo:** Una compra de contado por C$50,000 (CASH) decrementa walletBalance (3753), crea Expense (3766) y muta product.stock/product.cost (3702) sin ninguna llamada a auditLog.create. No queda asiento inmutable con before/after del walletBalance ni del costo valorizado.
- **Fix sugerido:** Dentro del $transaction, leyendo el walletBalance previo, agregar tx.auditLog.create con action:'PURCHASE_REGISTERED' y before/after de walletBalance y costo/stock por producto.
- **Nota del verificador:** CONFIRMADO el defecto: no existe auditLog.create entre las líneas 3625-3790 (verificado por grep; los auditLog más cercanos son 3047 y 4767, fuera del bloque de compras). AJUSTO severidad crítico→alto: no es blackout total ni exploit — SÍ hay trazabilidad parcial (KardexMovement con stockBefore/stockAfter en 3730 y el Expense como registro del egreso); lo que falta es el asiento inmutable con before/after de billetera y costo valorizado. Es una brecha de auditoría (Capa 3), gap ya reconocido en la línea base del CLAUDE.md, no una pérdida directa de dinero.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Pago de cuenta por pagar debita billetera y crea gasto sin AuditLog
- **Ubicación:** `backend/server.ts:3797`
- **Qué pasa:** POST /api/purchases/:id/pay descuenta el total de la billetera y crea un Expense en una transacción, pero no registra ningún AuditLog con before/after.
- **Escenario de fallo:** Se paga una factura PENDING_PAYMENT: la transacción (3815-3837) cambia estado a COMPLETED, decrementa walletBalance (3823) y crea Expense PAGO_PROVEEDOR (3829) sin auditLog.create. No queda asiento inmutable de quién autorizó el pago ni del saldo antes/después.
- **Fix sugerido:** Dentro del mismo $transaction, leer walletBalance previo y agregar tx.auditLog.create con action:'PURCHASE_PAID' y before/after de walletBalance y status.
- **Nota del verificador:** CONFIRMADO. No hay auditLog.create en el handler (3797-3845). Severidad alto correcta: hay Expense como registro del egreso pero falta el asiento inmutable before/after exigido por Capa 3 para movimiento de dinero.

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] POST /api/purchases/:id/pay: decremento de billetera sin guard permite saldo negativo
- **Ubicación:** `backend/server.ts:3823`
- **Qué pasa:** El pago de una cuenta por pagar hace tenant.update({ walletBalance: { decrement: total } }) sin condición de saldo suficiente, a diferencia de la ruta CASH de POST /api/purchases que sí usa updateMany con walletBalance >= total.
- **Escenario de fallo:** Billetera=C$500, compra CREDIT PENDING_PAYMENT total=C$8,000. Al llamar /pay, el decrement se aplica sin verificar saldo y walletBalance queda en -C$7,500; el gasto se registra igual.
- **Fix sugerido:** Usar el patrón atómico condicional del path CASH: const debited = await tx.tenant.updateMany({ where:{ id:tenantId, walletBalance:{ gte:purchase.total } }, data:{ walletBalance:{ decrement:purchase.total } } }); if(debited.count===0) throw 'SALDO_INSUFICIENTE'; y devolver 400.
- **Nota del verificador:** CONFIRMADO. server.ts:3823-3826 usa tenant.update con decrement incondicional, sin guard gte. Contrasta directamente con el path CASH de POST /api/purchases (3753-3763) que sí usa updateMany con walletBalance:{gte:total} y aborta si count===0. Inconsistencia real que permite saldo negativo → alto correcto.

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/purchases/:id/pay sin checkRole: cualquier rol autenticado puede pagar a proveedores
- **Ubicación:** `backend/server.ts:3797`
- **Qué pasa:** El endpoint que mueve dinero (débito de billetera + gasto) solo tiene authenticate, sin checkRole, cuando el modelo de permisos reserva purchases:write a MANAGER y superiores.
- **Escenario de fallo:** Un CASHIER o EMPLOYEE (sin purchases:write en ROLE_PERMISSIONS) obtiene su JWT y hace POST /api/purchases/{id}/pay; sin checkRole el pago procede, descuenta la billetera y crea el gasto sin autorización.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN','MANAGER']) al endpoint, en línea con purchaseOrders.ts (ROLES_WRITE) y con suppliers PUT/DELETE.
- **Nota del verificador:** CONFIRMADO. server.ts:3797 declara solo (authenticate). checkRole.ts:14 confirma que CASHIER/EMPLOYEE/VIEWER NO tienen purchases:write; OWNER/ADMIN/MANAGER sí. purchaseOrders.ts usa checkRole(ROLES_WRITE) en todos sus mutadores. Falta de control de rol confirmada → alto.

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/purchases sin checkRole: cualquier rol autenticado puede registrar compras (debita billetera y altera stock/costo)
- **Ubicación:** `backend/server.ts:3625`
- **Qué pasa:** El registro de compras muta inventario, costo promedio y billetera pero solo tiene authenticate + validate, sin checkRole, mientras que las órdenes de compra (purchaseOrders.ts) sí exigen ROLES_WRITE.
- **Escenario de fallo:** Un CASHIER/EMPLOYEE/VIEWER (sin purchases:write) envía POST /api/purchases con paymentMethod='CASH': incrementa stock, recalcula costo promedio y debita la billetera creando un Expense, sin rol autorizado.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN','MANAGER']) (o checkPermission('purchases:write')) al endpoint, consistente con purchaseOrders.ts.
- **Nota del verificador:** CONFIRMADO. server.ts:3625 declara (authenticate, validate(CreatePurchaseSchema)) sin checkRole. purchaseOrders.ts:148 (crear OC) exige checkRole(ROLES_WRITE). Inconsistencia y ausencia de control de rol confirmadas → alto.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Recepción de OC recalcula costo promedio (inventario valorizado) pero el AuditLog no guarda before/after
- **Ubicación:** `backend/routes/purchaseOrders.ts:305`
- **Qué pasa:** El AuditLog PO_RECEIVED de la recepción de mercadería sólo registra itemId y cantidad, no el before/after del stock ni del costo promedio ponderado que la operación modifica.
- **Escenario de fallo:** En POST /:id/receive, applyGoodsReceipt recalcula newAvgCost y actualiza product.cost (63-71). El AuditLog PO_RECEIVED (305-313) sólo persiste {poId,orderNumber,newStatus,received:[{itemId,qty}]} — sin costo unitario, sin costo promedio previo/nuevo ni stock antes/después.
- **Fix sugerido:** En applyGoodsReceipt devolver por producto {productId,stockBefore,stockAfter,costBefore,costAfter,unitCost} e incluir esos before/after en el details del auditLog.create de la recepción.
- **Nota del verificador:** CONFIRMADO. applyGoodsReceipt (línea 40) tiene retorno Promise<void>; calcula oldCost/newAvgCost (59-65) y actualiza cost (70) pero no expone esos valores. El auditLog en 305-313 sólo lleva received:[{itemId,qty}]. El Kardex (99-100) guarda stockBefore/stockAfter en cantidad pero no el cambio de costo/valuación. Severidad medio adecuada: a diferencia de /purchases, aquí SÍ existe un AuditLog, solo que incompleto (sin before/after de costo valorizado).

#### 🟡 [MEDIO · CONFIRMED · Capa 5] POST /api/suppliers sin checkRole ni validación Zod; inconsistente con PUT/DELETE
- **Ubicación:** `backend/server.ts:1278`
- **Qué pasa:** La creación de proveedores solo tiene authenticate (sin checkRole ni Zod), mientras que PUT y DELETE de /api/suppliers exigen checkRole(['OWNER','ADMIN']); además el body se pasa directo a Prisma con cast 'as any' sin validar name/email/ruc.
- **Escenario de fallo:** Un EMPLOYEE/CASHIER (sin suppliers:write) hace POST /api/suppliers y crea proveedores arbitrarios; sin validación puede enviar name vacío/omitido, email o ruc no válidos, ensuciando el catálogo del tenant.
- **Fix sugerido:** Añadir checkRole(['OWNER','ADMIN','MANAGER']) y validate(CreateSupplierSchema) con Zod (name requerido/trim/min, email opcional .email(), etc.), igual que el resto de endpoints de escritura.
- **Nota del verificador:** CONFIRMADO. server.ts:1278 declara solo (authenticate); el body se pasa a supplier.create con cast 'as any' en 1283, sin validación. PUT (1290) y DELETE (1316) sí usan checkRole(['OWNER','ADMIN']). No existe CreateSupplierSchema (grep sin resultados). Inconsistencia real → medio correcto.

### Facturación y Fiscal (DGI)

_12 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 5] Webhook de Stripe confia en eventos SIN verificar firma cuando el secret no esta configurado
- **Ubicación:** `backend/server.ts:135`
- **Qué pasa:** Si STRIPE_WEBHOOK_SECRET esta vacio o es el placeholder, el endpoint hace JSON.parse del body crudo y ejecuta handleWebhookEvent sin validar la firma HMAC.
- **Escenario de fallo:** Con secret sin configurar, un POST no autenticado a /api/billing/webhook con data.object.metadata.tenantId falsificado activa gratis el propio tenant (checkout.session.completed) o cancela el de un competidor (customer.subscription.deleted).
- **Fix sugerido:** Exigir SIEMPRE stripe.webhooks.constructEvent con un STRIPE_WEBHOOK_SECRET real; si falta, responder 500/desactivar el endpoint en produccion. Nunca JSON.parse sin verificar firma.
- **Nota del verificador:** CONFIRMADO en server.ts:135-141: si el secret es '' o el placeholder 'whsec_REEMPLAZAR_...', hace JSON.parse(req.body) sin constructEvent, independiente de NODE_ENV. Precondicion de explotacion: Stripe configurado (getStripe()!=null exige STRIPE_SECRET_KEY con 'sk_') pero webhook secret sin setear. El JSON de ejemplo del candidato para subscription.deleted debe llevar tenantId en data.object.metadata (no top-level), pero el ataque -activacion gratis + DoS cruzado- es real. Alto (condicionado a mala config; seria critico si el secret no se despliega en produccion).

#### 🟡 [MEDIO · CONFIRMED · Capa 4] VET-export a la DGI calcula subtotal/IVA con float nativo y parseFloat en vez de decimal.js
- **Ubicación:** `backend/server.ts:7937`
- **Qué pasa:** El .txt de la Ventanilla Electrónica Tributaria deriva subtotal/IVA de ventas con Number(total) y parseFloat((total/1.15).toFixed(2)) en vez de decimal.js.
- **Escenario de fallo:** Ventas 7936-7938 usan aritmetica float; total=1000.10 -> 1000.10/1.15 con parseFloat(toFixed) introduce redondeo binario distinto al de nicaTax.ts (Decimal ROUND_HALF_UP).
- **Fix sugerido:** Usar new Decimal(s.total.toString()).dividedBy(new Decimal(1).plus('0.15')).toDecimalPlaces(2, ROUND_HALF_UP).
- **Nota del verificador:** CONFIRMADO el uso de float en ventas (7936-7938: Number, parseFloat, toFixed). Matiz importante: las COMPRAS (7952-7954) solo hacen Number() de Decimals ya almacenados (coercion, sin aritmetica de riesgo). Es violacion real de la capa 4 (cero Number/parseFloat en montos). PERO el 'descuadre con la declaracion' esta sobredimensionado: el VET redondea por LINEA a 2 decimales y luego suma, mientras generateMonthlyReport redondea el AGREGADO a 4 decimales; esa diferencia linea-vs-agregado persiste aunque se use decimal.js con ROUND_HALF_UP por linea, asi que el fix NO garantiza cuadre exacto. Bajo de alto->medio.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Constancia de Retencion legal calcula montos retenidos con float y Math.round
- **Ubicación:** `backend/server.ts:7588`
- **Qué pasa:** En /api/fiscal/constancia-retencion, cuando no hay retenciones almacenadas, calcula IR 2%/IMI 1% con Number(purchase.subtotal) y Math.round(base*0.02*100)/100, y suma con reduce+Number.
- **Escenario de fallo:** purchase.subtotal grande/fraccionado -> Math.round(base*0.02*100)/100 sufre error de coma flotante; la constancia es documento fiscal legal que el proveedor usa como credito ante la DGI.
- **Fix sugerido:** new Decimal(purchase.subtotal.toString()).mul('0.02').toDecimalPlaces(2, ROUND_HALF_UP) y sumar con Decimal.plus.
- **Nota del verificador:** CONFIRMADO: baseAmount=Number(purchase.subtotal) (7586), Math.round float (7588-7589), totalRetenido=reduce+Number (7592). Matiz: esta rama solo corre como fallback 'al vuelo' cuando NO existen FiscalRetention almacenadas (7587); si hay retenciones guardadas se usan esos valores. Error a nivel centavo. Alto->medio por ser ruta de respaldo, aunque el caracter legal del documento lo mantiene por encima de bajo.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Libro de Ventas (Excel DGI) recalcula subtotal/IVA y totaliza con floats nativos
- **Ubicación:** `backend/server.ts:7778`
- **Qué pasa:** El Libro de Ventas deriva subtotal=parseFloat((total/1.15).toFixed(2)) e iva por fila y totaliza con rows.reduce((s,r)=>s+r[...],0) en float.
- **Escenario de fallo:** La suma flotante de la fila TOTALES (7797-7799) acumula error binario y el total de IVA del Libro no reconcilia centavo a centavo con nicaTax.ts.
- **Fix sugerido:** new Decimal(...), derivar subtotal/IVA con dividedBy/minus.toDecimalPlaces(2, ROUND_HALF_UP), acumular con Decimal.plus, convertir a number solo al escribir la celda.
- **Nota del verificador:** CONFIRMADO el float (7777-7779, 7797-7799). Mismo matiz que el VET: el descuadre contra la declaracion es estructural (redondeo por fila vs agregado de generateMonthlyReport), no puramente por float; decimal.js reduce ruido binario pero no garantiza cuadre exacto. Capa 4 violada, severidad medio.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Libro de Compras (Excel DGI) usa Number() y sumas nativas sobre montos y retenciones
- **Ubicación:** `backend/server.ts:7867`
- **Qué pasa:** Arma cada fila con Number(p.subtotal/tax/total), 'Neto Pagado'=parseFloat((total-ir-imi).toFixed(2)) y totaliza 6 columnas con rows.reduce(+) en float.
- **Escenario de fallo:** Con retenciones cruzadas (Map con Number(r.amount), 7847-7848) y muchas compras, Neto Pagado (7867) y TOTALES (7874-7879) acumulan error de coma flotante.
- **Fix sugerido:** new Decimal(...toString()) para subtotal/tax/total/ir/imi, computar Neto Pagado y totales con Decimal.minus/plus.toDecimalPlaces(2, ROUND_HALF_UP).
- **Nota del verificador:** CONFIRMADO: Number en 7852-7854, parseFloat/toFixed en 7867, reduce+'+' float en 7874-7879, Map de retenciones con Number(r.amount) en 7847-7848. Los valores base son Decimals(12,2) almacenados; el riesgo concreto es la suma flotante de muchas filas. Violacion capa 4 real, medio.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Webhook de Stripe muta estado de facturacion (activa/renueva/cancela) sin escribir AuditLog
- **Ubicación:** `backend/services/stripe.ts:162`
- **Qué pasa:** handleWebhookEvent hace prisma.tenant.update en checkout/invoice.paid/subscription.deleted/payment_failed dejando solo console.log, sin asiento inmutable en AuditLog.
- **Escenario de fallo:** Un tenant paga y Stripe envia invoice.paid (162-168): pone ACTIVE y extiende 30 dias sin registro forense interno; ante disputa/activacion fraudulenta/cancelacion indebida no hay quien/que/cuando.
- **Fix sugerido:** Envolver cada rama que mueve dinero en $transaction con auditLog.create (tenantId, userId SYSTEM/WEBHOOK, action, before/after, event.id de Stripe para idempotencia).
- **Nota del verificador:** CONFIRMADO: las 4 ramas (checkout 136, invoice.paid 162, subscription.deleted 180, payment_failed 202) solo hacen tenant.update + console.log. Contrasta con /api/admin/manual-payments/:id/approve (server.ts:5037-5057) que para el pago equivalente SI crea AuditLog dentro de $transaction. Gap de inmutabilidad (capa 3) real, medio.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] Endpoints fiscales de lectura/exportacion sin checkRole: cualquier usuario autenticado descarga data fiscal y PII
- **Ubicación:** `backend/server.ts:7757`
- **Qué pasa:** Mientras /api/tax-report/generate exige checkRole(['OWNER']) (4409), los endpoints que exponen los mismos datos solo usan authenticate: 4428, 5505, 6106, 7560, 7757, 7821, 7902.
- **Escenario de fallo:** Un CASHIER (pos:write, inventory:read, customers:read) llama GET /api/fiscal/vet-export o /libro-ventas y descarga clientes con RUC/cedula, ventas/compras del periodo y la obligacion tributaria total.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN']) (o checkPermission('reports:read')) a tax-report/:m/:y, dmi, renta-anual, constancia-retencion, libro-ventas, libro-compras y vet-export.
- **Nota del verificador:** CONFIRMADO: grep de rutas muestra checkRole solo en /generate (4409); 4428/5505/6106/7560/7757/7821/7902 solo tienen authenticate. middleware/checkRole.ts confirma que CASHIER/EMPLOYEE/VIEWER no son superuser y accederian igual. Datos con tenant-scope (no cross-tenant) pero fuga interna de PII y finanzas a roles no autorizados, incoherente con /generate=OWNER. Medio.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Rangos de fecha fiscales usan la hora LOCAL del servidor y lte 23:59:59.000 (corrimiento de periodo por TZ + perdida del ultimo sub-segundo)
- **Ubicación:** `backend/server.ts:7750`
- **Qué pasa:** fiscalMonthRange (7750-7751) y nicaTax.ts (66-67, 189-190) construyen new Date(year,month-1,1)/(...,23,59,59) en la zona del servidor, sin pin a America/Managua, y usan lte a 23:59:59.
- **Escenario de fallo:** Servidor en UTC: una venta 31/01 20:00 Managua (=01/02 02:00 UTC) queda excluida de enero e incluida en febrero; una venta a 23:59:59.500 del ultimo dia no cae en ningun reporte (lte a .000).
- **Fix sugerido:** Calcular los rangos en America/Managua (o pinnear process.env.TZ) y usar limite superior EXCLUSIVO: end = inicio del mes siguiente con lt.
- **Nota del verificador:** CONFIRMADO el patron de codigo. grep de process.env.TZ / America/Managua = 0 resultados, no hay pin de TZ. createdAt se guarda en UTC y los rangos se construyen en hora local del servidor. En Docker/Coolify el default suele ser UTC -> corrimiento real de ventas en borde de mes. El sub-segundo perdido (lte .000) es trivial; el corrimiento por TZ es el riesgo real y depende de la TZ del servidor de despliegue. Medio.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] La declaracion anual de IR fabrica los 'anticipos enterados' a partir del PMD en vez de pagos reales
- **Ubicación:** `backend/services/nicaTax.ts:366`
- **Qué pasa:** generateAnnualIR fija anticiposEnterados=max(0, PMD-retencionesIR) y creditos=anticipos+retenciones=max(PMD,retIR), acreditando siempre el PMD completo sin leer pagos reales.
- **Escenario de fallo:** PMD=500k, IR sobre renta=800k, retenciones=100k, sin anticipos pagados en cash: acredita 500k y arroja saldo 300k cuando el credito real es 100k y el saldo real 700k -> subdeclara 400k.
- **Fix sugerido:** Leer los anticipos IR realmente enterados en cash (libro de caja/asientos) en vez de derivarlos del PMD; creditos=anticipos_reales+retenciones.
- **Nota del verificador:** CONFIRMADO del comportamiento: nicaTax.ts:365-367 deriva anticipos del PMD (el propio comentario lo admite). Si irRenta>PMD y no se pagaron anticipos en efectivo, subdeclara el saldo a pagar. Mitigante: el resumen incluye disclaimer 'Revisar con el contador antes de presentar' y todo el IR anual es explicitamente un estimado. Medio.

#### ⚪ [BAJO · CONFIRMED · Capa 4] POST /api/billing/report-manual: persiste Number(amount) en columna Decimal y no valida con Zod (acepta monto negativo/decimales truncados)
- **Ubicación:** `backend/server.ts:4976`
- **Qué pasa:** El endpoint guarda amount: Number(amount) en ManualPayment.amount (Decimal(10,2)) sin Zod; solo hace check truthy !amount\|\|!bank\|\|!referenceNumber.
- **Escenario de fallo:** body {amount:-25,...} pasa el check (!-25===false) y crea un ManualPayment negativo; '100.999' -> Number -> Decimal(10,2) redondea a 101.00 silenciosamente.
- **Fix sugerido:** Definir ManualPaymentSchema Zod (amount positivo string->Decimal, currency enum, bank/referenceNumber no vacios) y persistir new Decimal(String(amount)).toDecimalPlaces(2, ROUND_HALF_UP).
- **Nota del verificador:** MERGE de 2 candidatos (Number(amount) capa 4 + falta de Zod capa 5), mismo endpoint 4956-4990. CONFIRMADO: sin validate(Zod), solo check truthy (4960), persiste Number(amount) (4976) en Decimal(10,2). Correcciones al escenario del candidato: amount='' SI es rechazado (falsy->400) y 0 numerico tambien; PERO amount='-25' (string) o -25 (number) PASAN (no son falsy) -> ManualPayment negativo; '100.999' -> 101.00 por redondeo de Postgres. Impacto contenido: el pago queda PENDING y un SUPER_ADMIN lo revisa/aprueba manualmente (la aprobacion activa 30 dias sin usar el monto), por eso bajo.

#### ⚪ [BAJO · PLAUSIBLE · Capa correctitud] generateMonthlyReport agrega ventas sin excluir status VOIDED (inconsistente con Libro de Ventas/VET)
- **Ubicación:** `backend/services/nicaTax.ts:71`
- **Qué pasa:** El sale.aggregate filtra solo por tenantId+createdAt, sin status:{not:'VOIDED'}, mientras libro-ventas (server.ts:7770) y VET (7917) SI lo excluyen.
- **Escenario de fallo:** Si existiera una venta con status='VOIDED', el reporte la sumaria y sobredeclararia IVA/Anticipo/IMI frente al Libro que la excluye.
- **Fix sugerido:** Agregar status:{not:'VOIDED'} al where del sale.aggregate y al _min/_max de generateDMIReport para unificar criterio con el Libro y el VET.
- **Nota del verificador:** PARCIAL / latente. La inconsistencia de codigo es REAL (el aggregate no filtra status; el Libro/VET si). PERO revise todo el backend: NINGUN endpoint asigna 'VOIDED' a una venta -'VOIDED' solo aparece en esos 2 filtros de exclusion (y en cashMovement.isVoided, no relacionado). Los estados reales de Sale son COMPLETED/PENDING/PAID/CREDIT_PENDING/UNCOLLECTIBLE; las devoluciones (server.ts:1483) crean notas de credito separadas, no anulan la venta. Por tanto HOY el filtro {not:'VOIDED'} es un no-op y ambas consultas devuelven el mismo conjunto -> NO hay sobredeclaracion actual. Es una inconsistencia latente que morderia si se introduce el estado VOIDED. Alto->bajo, PLAUSIBLE (defecto latente, impacto no realizable con el codigo actual).

#### ⚪ [BAJO · PLAUSIBLE · Capa correctitud] Libro de Compras y VET filtran compras por createdAt sin status, distinto a generateMonthlyReport (date + status IN)
- **Ubicación:** `backend/server.ts:7834`
- **Qué pasa:** libro-compras (7834) y vet-export (7924) usan createdAt SIN filtro de status, mientras generateMonthlyReport (nicaTax.ts:86-93) usa date + status IN ['COMPLETED','PENDING_PAYMENT'].
- **Escenario de fallo:** Una compra con date!=createdAt caeria en meses distintos segun reporte vs Libro; una compra fuera de COMPLETED/PENDING_PAYMENT quedaria excluida del reporte pero incluida en el Libro/VET, inflando el credito fiscal.
- **Fix sugerido:** Unificar: filtrar por el mismo campo (date) y el mismo status IN ['COMPLETED','PENDING_PAYMENT'] en libro-compras y vet-export.
- **Nota del verificador:** PARCIAL / latente. Confirmado que las 3 consultas usan criterios distintos. PERO ambas divergencias son no-ops hoy: (1) las 2 rutas de purchase.create (server.ts:3667, 6603) NUNCA setean `date` -> toma default now() ~= createdAt (mismo mes), asi que date vs createdAt da el mismo resultado; el escenario date=15/01 vs createdAt=03/02 no ocurre porque no hay input de usuario para `date`. (2) Purchase solo toma COMPLETED o PENDING_PAYMENT (3676, 6611) y el unico update lo lleva a COMPLETED (3819) -> nunca hay estado fuera del set permitido. Por tanto no hay credito IVA indebido actual. Inconsistencia latente real (se romperia si se agrega input de `date` o un estado CANCELLED). Medio->bajo, PLAUSIBLE.

### Contabilidad / Ledger / Depreciación

_12 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] Baja de activo fijo no deja asiento contable NI AuditLog (derecognición sin rastro)
- **Ubicación:** `backend/server.ts:6085`
- **Qué pasa:** PATCH /api/accounting/fixed-assets/:id/baja solo cambia estado='BAJA' sin postear la derecognición del valor en libros y sin escribir un AuditLog con before/after/userId/tenantId.
- **Escenario de fallo:** Al dar de baja un activo (p.ej. vehículo costo C$500,000, dep. acum. C$120,000, valor en libros C$380,000), el endpoint ejecuta solo prisma.fixedAsset.update({...estado:'BAJA'}) (6085): (a) no crea ningún JournalEntry → Mobiliario/Equipo (1.2.1) y Depreciación Acumulada (1.2.2) siguen inflando el Balance General; (b) no escribe AuditLog → no queda traza forense de quién dio de baja qué activo ni su valor en libros. Un ACCOUNTANT (permitido por checkRole) elimina activos de la vista sin before/after.
- **Fix sugerido:** Envolver la baja en $transaction: leer el activo completo, postear el asiento de derecognición (Debe 1.2.2 + Debe cuenta de Pérdida/Gasto por el valor en libros / Haber 1.2.1) y crear tx.auditLog.create con action 'FIXED_ASSET_DISPOSAL', details con before/after, userId, tenantId.
- **Nota del verificador:** Confirmado: 6080-6088. El endpoint SÍ tiene checkRole(['OWNER','ADMIN','ACCOUNTANT']) y SÍ filtra por tenantId (findFirst con tenantId, 6083) — la parte de aislamiento/rol no es el defecto. El defecto real es la ausencia de asiento de derecognición y de AuditLog. Contrasta con POST /api/accounting/journal (5690) y reopen (5871) que sí escriben AuditLog. alto se sostiene: el balance queda sobrestimado y la disposición no es auditable.

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/accounting/fiscal-close sin checkRole: cualquier rol puede cerrar el periodo fiscal
- **Ubicación:** `backend/server.ts:6836`
- **Qué pasa:** El endpoint que CIERRA (bloquea) el periodo fiscal solo lleva authenticate, sin checkRole, mientras su inverso (reopen) exige OWNER.
- **Escenario de fallo:** Un CASHIER/VIEWER que pasa authenticate hace POST /api/accounting/fiscal-close {month,year}; fiscalClose upsert FiscalPeriod→CLOSED. A partir de ahí cada venta llama recordSale→createJournalEntry→assertPeriodOpen, que lanza PeriodLockedError; ese error es tragado por el try/catch fail-soft de salesService.ts:319, así que la venta se guarda (stock y deuda del cliente se mueven) pero el asiento de doble partida NUNCA se registra → Balance/Estado de Resultados desfasados. Además solo OWNER puede reabrir (checkRole(['OWNER']) en 5850), así que el usuario de bajo privilegio deja el mes bloqueado sin poder revertirlo.
- **Fix sugerido:** Agregar checkRole(['OWNER']) (o ['OWNER','ADMIN','ACCOUNTANT'] como el asiento manual) al POST /api/accounting/fiscal-close, alineándolo con reopen. Validar month/year con Zod (int 1-12, año válido).
- **Nota del verificador:** Confirmado en toda la cadena: 6836 solo tiene authenticate; reopen (5850) tiene checkRole(['OWNER']); asiento manual (5642) tiene checkRole(['OWNER','ADMIN','ACCOUNTANT']); salesService.ts:308-321 confirma el fail-soft que traga PeriodLockedError y deja la venta sin asiento. También falta validación Zod de month/year. alto correcto — escalada de privilegio con daño contable persistente y difícil de revertir.

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] fiscalClose sobrescribe el TaxReport con IVA neto inflado y totalToPay=0
- **Ubicación:** `backend/services/accounting.ts:773`
- **Qué pasa:** El snapshot de cierre persiste totalIVAPaid:0 e ivaNeto = IVA cobrado completo (ignora el IVA crédito fiscal de compras) y totalToPay:0, pisando el TaxReport correcto.
- **Escenario de fallo:** fiscalClose hace taxReport.update/create sobre la MISMA fila (tenantId, month, year) que escribe saveMonthlyReport y que lee GET /api/tax-report/:month/:year (server.ts:4433, key tenantId_month_year). El reporte mensual correcto (generateMonthlyReport, nicaTax.ts:99-100) calcula ivaNeto = IVA_cobrado - IVA_pagado. Luego el cierre fija totalIVAPaid:0 (773), ivaNeto = Decimal.max(0, IVACollected - 0) = IVA cobrado completo (780), totalToPay:0 (777) y totalCompras = costo de ventas (772). El upsert sobrescribe la fila correcta: el usuario ve un IVA neto sobrestimado (podría pagar de más a la DGI) y un TOTAL A PAGAR de 0 que contradice el propio ivaNeto.
- **Fix sugerido:** En fiscalClose calcular totalIVAPaid/ivaNeto/totalToPay reales (reutilizar generateMonthlyReport/nicaTax) o no tocar los campos fiscales del TaxReport y limitar el cierre a marcar el FiscalPeriod. No escribir 0 en campos que otro flujo ya calcula.
- **Nota del verificador:** Confirmado: reportData en accounting.ts:766-780 fija totalIVAPaid:0, totalToPay:0 y deriva ivaNeto sin restar IVA de compras; nicaTax.ts:96-133 (saveMonthlyReport vía POST /api/tax-report/generate, server.ts:4417) escribe la misma fila con valores correctos; GET tax-report (4433) usa la clave única tenantId_month_year. Sobrescritura real de datos fiscales correctos con valores erróneos e internamente contradictorios. alto correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Balance General (estado financiero NIIF) calculado con aritmética float nativa en vez de decimal.js
- **Ubicación:** `backend/services/accounting.ts:539`
- **Qué pasa:** getBalanceGeneral suma todos los totales del balance y evalúa el invariante isBalanced con Number()/+/- nativos en lugar de Decimal.js.
- **Escenario de fallo:** En getBalanceGeneral totalAssets/totalLiabilities/totalEquity se calculan con reduce((sum,a)=> sum + Number(a.balance),0) (539-547), netIncome con totalRevenue - totalExpenses nativo (548), y el cuadre con Math.abs(totalAssets - (totalLiabilities+totalEquity+netIncome)) < 0.01 (560). Es el balance general que alimenta /api/financial-health y el dashboard de supervivencia.
- **Fix sugerido:** Acumular con Decimal (assets.reduce((s,a)=> s.plus(a.balance.toString()), new Decimal(0))), derivar netIncome/equityPlusIncome con .minus()/.plus() y evaluar isBalanced con Decimal(...).minus(...).abs().lessThan('0.01').
- **Nota del verificador:** Leído tal cual: líneas 539-548 y 560 usan Number()/+/-/Math.abs nativos sobre montos. account.balance viene Decimal de BD pero se convierte a Number y se suma en double. Es violación directa de la regla 'cero Number en montos' sobre un estado financiero oficial; el impacto monetario es sub-centavo a escala PyME (la tolerancia 0.01 absorbe el error float) así que es un defecto de estándar/precisión, no un bug funcional. medio se sostiene por ser estado financiero NIIF (no mero display).

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Estado de Resultados (rama Acumulado) usa sumas y restas float nativas sobre montos
- **Ubicación:** `backend/services/accounting.ts:614`
- **Qué pasa:** En getEstadoResultados sin periodo, revenue/COGS/expenses/grossProfit/netIncome se calculan con Number()/+/- nativos, a diferencia de la rama con periodo que sí usa Decimal.
- **Escenario de fallo:** Líneas 614-625: totalRevenue = revenue.reduce((sum,a)=> sum + Number(a.balance),0), totalExpenses idem, grossProfit: totalRevenue - totalCOGS, netIncome: totalRevenue - totalCOGS - totalExpenses, todo nativo. La rama con month/year (579-606) sí usa Decimal, dejando el mismo estado computado con dos precisiones distintas.
- **Fix sugerido:** Replicar el patrón Decimal de la rama con periodo: acumular con new Decimal(a.balance.toString()).plus(...) y derivar grossProfit/netIncome con .minus() antes de .toNumber().
- **Nota del verificador:** Confirmado leyendo ambas ramas: 579-606 usa Decimal correctamente; 610-626 (rama Acumulado) usa Number nativo. Inconsistencia real dentro de la misma función. Impacto sub-centavo, defecto de estándar de precisión.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Cierre fiscal bloquea el período y genera retenciones/TaxReport sin AuditLog (asimétrico con la reapertura)
- **Ubicación:** `backend/services/accounting.ts:792`
- **Qué pasa:** fiscalClose() cierra el FiscalPeriod (lo bloquea), crea/actualiza TaxReport y genera FiscalRetention del período pero no escribe ningún AuditLog inmutable con before/after, a diferencia de la reapertura que sí lo hace.
- **Escenario de fallo:** POST /api/accounting/fiscal-close → fiscalClose (746-812) llama generateRetentions (createMany sin AuditLog), hace upsert de TaxReport con montos fiscales y upsert de FiscalPeriod a CLOSED (792) — todo sin AuditLog. Aunque FiscalPeriod.closedBy guarda el actor, no hay asiento inmutable ni snapshot before/after del estado financiero congelado. La reapertura (server.ts:5871) SÍ escribe AuditLog 'PERIOD_REOPENED': se audita reabrir pero no cerrar.
- **Fix sugerido:** Mover upsert de FiscalPeriod/TaxReport/generateRetentions a $transaction y añadir tx.auditLog.create con action 'FISCAL_CLOSE', userId=closedBy, tenantId y details con snapshot before/after. Análogo al AuditLog del reopen.
- **Nota del verificador:** Confirmado: fiscalClose (746-812) no contiene ninguna llamada auditLog.create; el reopen en 5866-5877 sí, dentro de $transaction. Asimetría real. medio correcto (traza forense faltante en operación que congela cifras fiscales).

#### 🟡 [MEDIO · CONFIRMED · Capa 5] POST /api/accounting/retentions sin checkRole
- **Ubicación:** `backend/server.ts:6789`
- **Qué pasa:** Endpoint de escritura que genera las retenciones DGI del mes está protegido solo con authenticate, sin restricción de rol.
- **Escenario de fallo:** Un CASHIER/VIEWER hace POST /api/accounting/retentions {month,year}; generateRetentions crea filas FiscalRetention para todas las compras del período. Como la generación es idempotente (existing>0 ⇒ se salta, accounting.ts:647-652), un usuario de bajo privilegio puede 'fijar' las retenciones tempranamente sobre compras incompletas: una regeneración legítima posterior queda bloqueada por el conteo existente. Contrasta con POST /api/accounting/retenciones-sufridas, que sí exige checkRole(['OWNER','ADMIN','ACCOUNTANT']).
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN','ACCOUNTANT']) y validar month/year (Zod) igual que el resto de endpoints contables sensibles.
- **Nota del verificador:** Confirmado: 6789 solo tiene authenticate; retenciones-sufridas (5969) sí tiene checkRole(['OWNER','ADMIN','ACCOUNTANT']). Idempotencia por conteo confirmada en generateRetentions (647-652). Asimetría real. medio correcto (falta control de rol + posible congelamiento prematuro de retenciones).

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] fiscalClose hace escrituras multi-tabla sin $transaction
- **Ubicación:** `backend/services/accounting.ts:792`
- **Qué pasa:** generateRetentions (createMany FiscalRetention), taxReport upsert y fiscalPeriod upsert corren fuera de una transacción, dejando estado parcial ante fallo intermedio.
- **Escenario de fallo:** En fiscalClose, generateRetentions ejecuta fiscalRetention.createMany (726) y luego se hacen taxReport.update/create (783-788) y fiscalPeriod.upsert→CLOSED (792) como awaits secuenciales independientes. Si el proceso/DB falla tras crear las FiscalRetention pero antes del upsert del FiscalPeriod, las retenciones quedan committeadas, el período sigue OPEN y el TaxReport no se guarda. Un reintento ve existing>0 en generateRetentions y NO regenera, quedando retenciones desalineadas con el cierre.
- **Fix sugerido:** Envolver generateRetentions + taxReport upsert + fiscalPeriod upsert en un único prisma.$transaction interactivo, pasando tx a las funciones internas, para atomicidad del cierre.
- **Nota del verificador:** Confirmado leyendo 750-796: cuatro operaciones de escritura (createMany, taxReport update/create, fiscalPeriod upsert) como awaits sueltos sin $transaction. Contrasta con reopen (5866, $transaction) y asiento manual (5685, $transaction). Riesgo de estado parcial real, agravado por la idempotencia de generateRetentions. medio correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] recordPurchase deriva el subtotal del inventario con resta float nativa (subtotal = total - tax)
- **Ubicación:** `backend/services/accounting.ts:274`
- **Qué pasa:** En el asiento de compra, el monto que se debita a Inventario (1.1.4) se calcula con resta JS nativa entre dos montos no cero, en vez de decimal.js.
- **Escenario de fallo:** Línea 274: const subtotal = total - tax; con total y tax numéricos ambos no cero; subtotal se postea como débito a Inventario 1.1.4 (281). Ruta de escritura del libro contable con aritmética nativa; el error dejaría de estar absorbido si la columna migra a Decimal(18,4) o si el caller pasa >2 decimales.
- **Fix sugerido:** const subtotal = new Decimal(total).minus(tax).toDecimalPlaces(4).toNumber(); (o pasar Decimals a createJournalEntry).
- **Nota del verificador:** Confirmado: línea 274 es resta Number nativa. Contrasta con recordReturn (338-340) y recordBadDebt (364), en el mismo archivo, que sí usan Decimal. Violación de estándar en ruta de escritura del mayor; impacto acotado hoy por el redondeo de columna Decimal en BD.

#### ⚪ [BAJO · CONFIRMED · Capa 4] /api/reports/expenses agrega montos con reduce float nativo y Math.round
- **Ubicación:** `backend/server.ts:3580`
- **Qué pasa:** El reporte de gastos suma amount con sum + Number(e.amount) y agrupa por categoría con acumulación float nativa, redondeando al final con Math.round.
- **Escenario de fallo:** Líneas 3580, 3586 y 3590: totalExpenses = expenses.reduce((sum,e)=> sum + Number(e.amount),0), byCategory[cat] = (byCategory[cat]\|\|0) + Number(e.amount), y Math.round(totalExpenses*100)/100. Aritmética nativa sobre dinero, inconsistente con /api/reports/sales.
- **Fix sugerido:** Acumular con Decimal (new Decimal(0).plus(e.amount.toString())) tanto total como cada categoría y convertir a number sólo al serializar.
- **Nota del verificador:** Confirmado leyendo 3580-3590. Reporte de lectura (display); el Math.round limpia el error a sub-centavo. Violación de estándar, severidad bajo correcta.

#### ⚪ [BAJO · CONFIRMED · Capa 4] /api/dashboard/stats calcula ventas, gastos y utilidad del día con float nativo
- **Ubicación:** `backend/server.ts:1039`
- **Qué pasa:** El dashboard suma total/amount con reduce nativo y deriva netProfitToday con resta JS nativa sobre montos.
- **Escenario de fallo:** Líneas 1016, 1031, 1034-1036 y 1039: dayTotal/totalSalesToday = ...reduce((sum,s)=> sum + Number(s.total),0), totalExpensesToday = ...+ Number(e.amount), netProfitToday = totalSalesToday - totalExpensesToday (resta nativa).
- **Fix sugerido:** Sumar con Decimal y netProfitToday = new Decimal(totalSalesToday).minus(totalExpensesToday), convertir a number sólo al armar la respuesta.
- **Nota del verificador:** Confirmado: 1016, 1031, 1036 y 1039 usan Number/+/- nativos. Cifras de tablero (display); impacto sub-centavo. bajo correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] /api/financial-health calcula EBITDA y punto de equilibrio con resta/división float nativa sobre montos
- **Ubicación:** `backend/server.ts:6701`
- **Qué pasa:** Los KPIs (EBITDA, break-even, cogsRatio) se derivan con aritmética JS nativa sobre montos provenientes del estado de resultados.
- **Escenario de fallo:** Líneas 6700-6710: cogsRatio = estado.costOfSales / revenue, breakEven = estado.operatingExpenses.total / (1 - cogsRatio), ebitda = Math.round((estado.grossProfit - estado.operatingExpenses.total)*100)/100. Además estado.* ya viene con sumas float (hallazgo #2 relacionado), propagando la imprecisión.
- **Fix sugerido:** EBITDA con new Decimal(estado.grossProfit).minus(estado.operatingExpenses.total); mantener ratios como number pero derivarlos de bases Decimal.
- **Nota del verificador:** Confirmado leyendo 6699-6710. Ratios/KPIs de visualización; la resta EBITDA sobre montos incumple el estándar. bajo correcto. Nota: comparte causa raíz con el hallazgo del estado de resultados acumulado.

### Nómina / RRHH

_16 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] Liquidación final (finiquito) mueve dinero y cambia estado del empleado sin AuditLog inmutable
- **Ubicación:** `backend/server.ts:6940`
- **Qué pasa:** POST /api/hrm/settlement/:employeeId (checkRole OWNER/ADMIN/ACCOUNTANT) crea TerminationSettlement, paga vía recordSettlement (fail-soft), marca al empleado TERMINATED y pone vacationDays=0, todo sin ningún tx.auditLog.create con before/after dentro de la $transaction.
- **Escenario de fallo:** Se liquida a un empleado con antigüedad alta (p.ej. total C$120,000): se crea el settlement, se acredita Caja, el empleado pasa a TERMINATED y su saldo de vacaciones se borra a 0. recordSettlement está en try/catch fail-soft (6954-6958): si assertPeriodOpen falla o falta una cuenta, el asiento se omite pero el settlement, TERMINATED y vacationDays=0 igual se comprometen. No queda ningún AuditLog (before/after de status y vacationDays, userId, montos), imposibilitando auditar quién liquidó ni detectar montos inflados.
- **Fix sugerido:** Dentro de la $transaction agregar tx.auditLog.create (action 'SETTLEMENT_PAID') con userId, tenantId, before/after (status y vacationDays previos), reason y montos. Evaluar hacer obligatorio el asiento (no fail-soft) para atomicidad dinero↔traza.
- **Nota del verificador:** CONFIRMADO: verifiqué que createJournalEntry (accounting.ts:137) escribe journalEntry/journalLine con createdBy, NO AuditLog; el before/after de la mutación de la entidad (TERMINATED, vacationDays=0) no queda en ningún lado. ALTO justificado: mayor pago único de RRHH, irreversible, sin traza before/after. Matiz: cuando el asiento contable SÍ corre queda un journalEntry con userId (traza parcial del pago, no de la mutación de la entidad).

#### 🟠 [ALTO · CONFIRMED · Capa 5] GET /api/employees expone el PIN, cuenta bancaria y salario de toda la plantilla a cualquier rol autenticado
- **Ubicación:** `backend/server.ts:1342`
- **Qué pasa:** El endpoint solo lleva authenticate (sin checkRole) y devuelve el registro Employee completo con `...emp` (1371), incluyendo pin, bankAccount, baseSalary, cedula e inss.
- **Escenario de fallo:** Un CASHIER/EMPLOYEE/VIEWER hace GET /api/employees y recibe, por cada empleado, su pin de 4 dígitos, bankAccount, baseSalary, cedula e inss. Con esos PINs puede marcar clock-in/out de compañeros (hr.ts) alterando horas extra pagadas en nómina, además de la fuga de PII financiera de toda la plantilla.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN','MANAGER','ACCOUNTANT']) y reemplazar `...emp` por un select explícito que omita pin y bankAccount (o exponerlos solo a roles de RRHH).
- **Nota del verificador:** CONFIRMADO: endpoint solo con authenticate (1342); schema.prisma:299-308 confirma pin/bankAccount/baseSalary/cedula/inss en Employee; línea 1371 hace spread `...emp`. Viola capa 5. ALTO justificado (fuga de PIN + PII financiera a cualquier autenticado).

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/employees sin checkRole ni validación Zod: cualquier autenticado crea empleados con salario/comisión arbitrarios
- **Ubicación:** `backend/server.ts:1383`
- **Qué pasa:** La creación de empleados solo exige authenticate; no valida el body con Zod y toma baseSalary/commissionRate/role directamente de req.body vía Number().
- **Escenario de fallo:** Un CASHIER/EMPLOYEE hace POST /api/employees con baseSalary=999999 y commissionRate alto (o role arbitrario). El empleado entra en la corrida de nómina inflando gasto y comisiones; con baseSalary/commissionRate ausentes, Number(undefined)=NaN se persiste en campos Decimal. No hay barrera de rol para una operación sensible de RRHH.
- **Fix sugerido:** Añadir checkRole(['OWNER','ADMIN','ACCOUNTANT']) y validate(EmployeeCreateSchema) con Zod (baseSalary/commissionRate numéricos ≥0, role en enum permitido, PIN 4 dígitos).
- **Nota del verificador:** CONFIRMADO: solo authenticate (1383), sin Zod, Number(baseSalary)/Number(commissionRate) crudos (1408-1409). Viola capa 5. ALTO correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Aguinaldo (treceavo mes) pagado y contabilizado se calcula con float nativo + toFixed, no con decimal.js
- **Ubicación:** `backend/server.ts:4290`
- **Qué pasa:** computeAguinaldo calcula el monto con `Number((baseSalary * Math.min(1, dias/360)).toFixed(2))` en aritmética JS nativa; ese valor se persiste en Aguinaldo.monto (4357) y se contabiliza vía recordAguinaldoPayment (4362).
- **Escenario de fallo:** Con baseSalary=15333.33 y dias=200, 15333.33 * (200/360) se evalúa en binario flotante y luego .toFixed(2); el resultado es el dinero realmente pagado y asentado. Puede diverger en centavos del motor Decimal ROUND_HALF_UP de nicaLabor.calculateSettlement (que sí usa Decimal.mul), rompiendo la conciliación entre lo pagado, el asiento y la liquidación del mismo empleado.
- **Fix sugerido:** Reescribir computeAguinaldo con decimal.js: new Decimal(baseSalary).mul(Decimal.min(1, new Decimal(dias).div(360))).toDecimalPlaces(2). Idealmente reutilizar el motor de nicaLabor.ts.
- **Nota del verificador:** CONFIRMADO: es float puro sobre dinero real (viola capa 4, regla 'cero Float/Number en montos'). Bajé de alto a MEDIO: el impacto monetario es sub-céntimo por empleado; el riesgo real es la divergencia de redondeo vs. el motor Decimal en el finiquito. Nota: nicaLabor tambien computa el ratio dias/360 en float, solo la multiplicacion final es Decimal, asi que la divergencia es en el borde de medio centavo.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Comisión de nómina se calcula con multiplicación float nativa antes de entrar al motor Decimal
- **Ubicación:** `backend/server.ts:4005`
- **Qué pasa:** En POST /api/payroll/calculate la comisión se obtiene con `ventasMes * Number(emp.commissionRate)` (float) y ese monto alimenta calculatePayroll (totalIncome, INSS, IR, neto) y se guarda en Payroll.commissions.
- **Escenario de fallo:** Para ventasMes=123456.78 y commissionRate=0.03, la multiplicación se hace en binario flotante antes de envolverse en Decimal dentro del motor; el error de representación entra en la base gravable y se arrastra a INSS (7%), IR progresivo y neto declarado al SIE.
- **Fix sugerido:** Calcular la comisión con Decimal: new Decimal(ventasMes).mul(new Decimal(emp.commissionRate.toString())).toDecimalPlaces(4) antes de pasarla a calculatePayroll.
- **Nota del verificador:** CONFIRMADO en línea 4005. Viola capa 4. Severidad MEDIO adecuada: impacto sub-céntimo pero se propaga a retenciones legales.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Fee del adelanto de salario (5%) y el límite (30%) se calculan con float
- **Ubicación:** `backend/routes/hr.ts:203`
- **Qué pasa:** `fee: amount * 0.05` (203) sobre un amount crudo de req.body, y `maxAdvance = Number(employee.baseSalary) * 0.30` (188) usan multiplicación float. El fee luego se suma al adelanto y se descuenta del neto.
- **Escenario de fallo:** amount=1000.10 → fee = 1000.10 * 0.05 = 50.005 en binario flotante guardado en SalaryAdvance.fee; en server.ts:4054 monto = Number(adv.amount)+Number(adv.fee) se resta del neto, arrastrando el residuo flotante al pago del trabajador.
- **Fix sugerido:** Normalizar amount con Decimal al recibirlo y calcular fee = new Decimal(amount).mul('0.05').toDecimalPlaces(2); usar Decimal también para maxAdvance.
- **Nota del verificador:** CONFIRMADO líneas 188 y 203. El mismo patrón float existe en el gemelo /api/me/advance (server.ts:7156 `fee: monto * 0.05`, 7151 max). Viola capa 4.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Aplicación de adelantos y neto final se calculan con Number()+ y toFixed(2) en vez de Decimal
- **Ubicación:** `backend/server.ts:4054`
- **Qué pasa:** El descuento de adelantos y el neto final que se persiste/paga se computan con `Number(adv.amount)+Number(adv.fee)` (4054), `(advanceApplied+monto).toFixed(2)` (4058) y `(disponible - advanceApplied).toFixed(2)` (4064); netFinal sobrescribe netSalary (4081).
- **Escenario de fallo:** disponible viene del motor Decimal (calc.netSalary) pero netFinal se recalcula en float y es lo que se guarda en Payroll.netSalary (4081), se registra como Expense (4231) y se asienta vía recordPayroll(Number(updated.netSalary)) (4241). El neto pagado/contabilizado queda determinado por aritmética flotante, no por decimal.js.
- **Fix sugerido:** Operar disponible, monto, advanceApplied y netFinal con decimal.js (Decimal.min/minus/plus, toDecimalPlaces(2)); revisar el epsilon 0.001 y guardar el neto calculado íntegramente en el motor.
- **Nota del verificador:** CONFIRMADO líneas 4054-4064 y 4081. Viola capa 4. Además hay un epsilon 0.001 en el comparador (4057) que es exactamente el tipo de parche que delata la aritmética float. MEDIO correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Pago de nómina mensual mueve efectivo sin dejar AuditLog con before/after
- **Ubicación:** `backend/server.ts:4221`
- **Qué pasa:** POST /api/payroll/:id/pay (checkRole OWNER/ADMIN/ACCOUNTANT) marca PAGADO, crea Expense por el neto, llama recordPayroll y recordLaborProvision (ambos fail-soft) e incrementa vacationDays 2.5, sin ningún tx.auditLog.create con before/after en la $transaction.
- **Escenario de fallo:** Se paga la nómina: status→PAGADO, Expense por netSalary, vacationDays +2.5. Ninguna mutación deja AuditLog (userId/before/after de status/netSalary). Con recordPayroll/recordLaborProvision en fail-soft (4240-4244, 4252-4256), si el período está cerrado el Expense y el PAGADO se comprometen sin asiento ni AuditLog.
- **Fix sugerido:** Escribir tx.auditLog.create (action 'PAYROLL_PAID') con userId, tenantId y before/after del payroll dentro de la $transaction.
- **Nota del verificador:** CONFIRMADO: no hay auditLog.create en el bloque 4221-4265. Bajé de alto a MEDIO: es un pago mensual rutinario (menor magnitud/irreversibilidad que el finiquito) y, cuando el asiento corre, el journalEntry (referenceType PAYROLL, createdBy=userId) sí deja una traza inmutable parcial. El gap real es before/after de la entidad + el caso fail-soft.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Corrida de aguinaldo paga efectivo a todos los empleados sin AuditLog
- **Ubicación:** `backend/server.ts:4355`
- **Qué pasa:** POST /api/payroll/aguinaldo/:year/run (checkRole OWNER/ADMIN/ACCOUNTANT) crea Aguinaldo en status PAGADO y acredita Caja vía recordAguinaldoPayment (fail-soft), sin ningún tx.auditLog.create por empleado ni por la corrida.
- **Escenario de fallo:** Por cada empleado activo se crea un Aguinaldo PAGADO y recordAguinaldoPayment acredita Caja. recordAguinaldoPayment está en try/catch fail-soft (4361-4365): si falla el catálogo/período el asiento se omite pero el Aguinaldo PAGADO persiste, dejando el egreso sin asiento ni AuditLog, sin traza de quién corrió ni los montos.
- **Fix sugerido:** Dentro de cada $transaction agregar tx.auditLog.create (action 'AGUINALDO_PAID') con userId, tenantId, employeeId, diasLaborados y monto.
- **Nota del verificador:** CONFIRMADO: sin auditLog.create en 4355-4366. MEDIO correcto. Igual que #8, el journalEntry (referenceType AGUINALDO) da traza parcial cuando el asiento no falla.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] PATCH /api/employees/:id/pin sin checkRole: cualquier autenticado reasigna el PIN de un compañero
- **Ubicación:** `backend/server.ts:1422`
- **Qué pasa:** El cambio de PIN valida pertenencia al tenant pero no exige rol; cualquier usuario autenticado del tenant puede cambiar el PIN de cualquier empleado.
- **Escenario de fallo:** Un EMPLOYEE/CASHIER hace PATCH /api/employees/<idDeOtro>/pin con {pin:'1234'}. Cambia el PIN de asistencia de un compañero (sabotaje o para impersonarlo en clock-in/out), afectando el registro de horas que alimenta la nómina.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN','MANAGER']); permitir auto-servicio del PIN propio solo verificando que el empleado objetivo esté vinculado a req.userId.
- **Nota del verificador:** CONFIRMADO: solo authenticate (1422); valida tenant (1433) pero no rol. Viola capa 5. MEDIO correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] POST /api/hr/advance/request no valida monto positivo: un adelanto negativo sobrepaga en nómina
- **Ubicación:** `backend/routes/hr.ts:189`
- **Qué pasa:** `amount` solo se compara contra el límite superior (amount > maxAdvance, 189); no hay Zod ni cota inferior, y fee = amount*0.05 hereda el signo.
- **Escenario de fallo:** Se envía {amount:-5000}. -5000 > maxAdvance es false → pasa; se crea SalaryAdvance con amount=-5000, fee=-250. Tras aprobarse, en calculate monto=amount+fee=-5250 cumple `monto <= restante + 0.001` (4057), advanceApplied se vuelve negativo y netFinal = disponible - (negativo) = disponible + 5250 → el empleado cobra de más.
- **Fix sugerido:** Validar con Zod monto positivo finito en /api/hr/advance/request, igual que /api/me/advance; rechazar amount<=0 y no numérico antes de crear el adelanto.
- **Nota del verificador:** CONFIRMADO: sin validación de cota inferior (189); el gemelo server.ts:7147 sí exige monto>0, evidenciando la omisión. Mitigante: el adelanto requiere aprobación (requireHRAdmin en hr.ts:214) que debería detectar un monto negativo, y approve no re-valida. MEDIO correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] payroll/calculate aplica adelantos y actualiza su estado en escrituras separadas sin $transaction
- **Ubicación:** `backend/server.ts:4086`
- **Qué pasa:** Por empleado se hacen tres escrituras no atómicas: payroll.upsert (4086, que ya resta advanceApplied del neto) y luego dos salaryAdvance.updateMany (4097 DEDUCTED / 4101 diferidos), sin envolver en prisma.$transaction.
- **Escenario de fallo:** Si el proceso cae entre el upsert (4086-4092) y el updateMany a 'DEDUCTED' (4097), la nómina queda con advanceDeduction descontado pero el SalaryAdvance sigue en 'APPROVED' con payrollId null. Si esa planilla se paga (el endpoint pay no toca adelantos) sin recalcular, el mismo adelanto se vuelve a tomar en la siguiente corrida → doble descuento al trabajador.
- **Fix sugerido:** Envolver el upsert de payroll y los updateMany de SalaryAdvance de cada empleado en un prisma.$transaction para que la marca DEDUCTED y el descuento del neto sean atómicos.
- **Nota del verificador:** CONFIRMADO: las tres escrituras (4086, 4097, 4101) están fuera de $transaction. El defecto de atomicidad es real; requiere un fallo/corte en la ventana entre upsert y updateMany. MEDIO correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] Endpoints de lectura de nómina/pasivos/liquidación sin checkRole exponen salarios de toda la plantilla
- **Ubicación:** `backend/server.ts:4122`
- **Qué pasa:** GET /api/payroll/:month/:year (4122), /api/payroll/sie (4150), /api/labor-liabilities (4383), /api/hrm/settlement-preview/:id (6870) y /api/hrm/dashboard (6984) solo usan authenticate, sin checkRole.
- **Escenario de fallo:** Un CASHIER/EMPLOYEE/VIEWER hace GET /api/payroll/07/2026 y recibe netSalary, cédula e INSS de cada empleado; /api/labor-liabilities devuelve el pasivo por salario de todos y settlement-preview la liquidación de cualquier colega. Fuga de datos salariales sensibles a roles que no deberían verlos.
- **Fix sugerido:** Aplicar checkRole(['OWNER','ADMIN','ACCOUNTANT','MANAGER']) a estos GET; para autoservicio usar los endpoints /api/me/* existentes.
- **Nota del verificador:** CONFIRMADO: verifiqué los cinco endpoints; todos solo con authenticate (4122, 4150, 4383, 6870, 6984). Viola capa 5. MEDIO correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Deducción por ausencias sin goce se calcula con división/multiplicación float
- **Ubicación:** `backend/server.ts:4009`
- **Qué pasa:** El descuento por ausencias UNPAID se computa con `(baseSalary / 30) * diasAusencia` (4009) en float antes de pasarse como absenceDeduction a calculatePayroll.
- **Escenario de fallo:** baseSalary=10000 y diasAusencia=7 → (10000/30)*7 = 2333.333... en binario flotante; el residuo entra en la base devengada (earnedBase) y con ella en INSS/IR/neto.
- **Fix sugerido:** new Decimal(baseSalary).div(30).mul(diasAusencia).toDecimalPlaces(4) antes de calculatePayroll.
- **Nota del verificador:** CONFIRMADO línea 4009. El motor lo re-envuelve en Decimal (nicaLabor:129) pero el valor ya llega contaminado por el float. Impacto sub-céntimo; BAJO correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Provisión mensual de prestaciones se asienta al mayor con división float
- **Ubicación:** `backend/server.ts:4251`
- **Qué pasa:** Al pagar la nómina, la cuota del pasivo laboral se calcula con `Number(owned.grossSalary) / 12` (4251) y se pasa tres veces a recordLaborProvision (4253).
- **Escenario de fallo:** grossSalary=10000 → cuota = 833.333... en binario flotante; recordLaborProvision aplica .toFixed(2) a cada componente pero el residuo del float ya está en la cuota, y el asiento se repite mes a mes en las cuentas de pasivo.
- **Fix sugerido:** new Decimal(owned.grossSalary.toString()).div(12).toDecimalPlaces(2) antes del asiento.
- **Nota del verificador:** CONFIRMADO línea 4251. recordLaborProvision (accounting.ts:460) redondea con toFixed(2) por componente, atenuando pero no eliminando el defecto float. BAJO correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 3] POST /api/payroll/:id/pay marca PAGADO y crea el gasto aunque el asiento de partida doble falle en silencio
- **Ubicación:** `backend/server.ts:4241`
- **Qué pasa:** recordPayroll está en un try/catch que solo hace console.warn (4242-4244), mientras la actualización a PAGADO, el Expense y el incremento de vacaciones sí persisten en la $transaction, devolviendo 200.
- **Escenario de fallo:** Si recordPayroll lanza (período bloqueado por assertPeriodOpen o cuenta faltante), la excepción se traga: la nómina queda PAGADO, se crea el Expense 'NOMINA' y se acreditan 2.5 días de vacaciones, pero el libro de partida doble no registra el asiento. El operador ve 200 mientras el mayor queda descuadrado, sin alerta ni AuditLog de la omisión.
- **Fix sugerido:** Registrar la omisión en AuditLog y devolver una advertencia explícita (o encolar el asiento para reintento) en vez de solo console.warn + 200. recordLaborProvision (4252-4256) tiene el mismo patrón fail-soft.
- **Nota del verificador:** CONFIRMADO líneas 4240-4256. Relacionado con el hallazgo #8 (mismo endpoint) pero es un tema distinto: aquí el defecto es el fail-soft silencioso que retorna 200 con el mayor descuadrado, no la ausencia de AuditLog. BAJO correcto. El mismo fail-soft aplica a recordSettlement (6954) y recordAguinaldoPayment (4361).

### Cobranza / CxC / Créditos

_6 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] El abono de cobranza (/api/credits/payment) no descuenta customer.currentDebt: la deuda del cliente se infla permanentemente y bloquea ventas a crédito legítimas
- **Ubicación:** `backend/server.ts:5366`
- **Qué pasa:** POST /api/credits/payment reduce sale.balance pero nunca decrementa customer.currentDebt, dejando el saldo del cliente sobrevaluado de forma permanente. (Fusión de los dos hallazgos candidatos duplicados sobre line 5366.)
- **Escenario de fallo:** María tiene creditLimit C$10,000 y compra a crédito C$8,000 → executeSale (salesService.ts:301-306) hace currentDebt.increment(8,000). Paga los C$8,000 desde Cobranza (AccountsReceivable.tsx:149 → POST /api/credits/payment). Verifiqué la transacción completa server.ts:5347-5411: crea Payment (5356), actualiza Sale.balance=0 (5366) y escribe AuditLog (5378), pero NUNCA llama a tx.customer.update sobre currentDebt, que queda en 8,000. En su próxima compra a crédito de C$5,000, salesService.ts:173 evalúa currentDebt(8,000)+5,000=13,000 > 10,000 → CREDIT_LIMIT_EXCEEDED, rechazando una venta legítima. El estado de cuenta (server.ts:5321) y Clients.tsx muestran deuda fantasma. Confirmado que es el comportamiento intencionado y aquí falta: el hermano /api/payments (server.ts:1626-1631) y el writeoff (server.ts:5444-5449) SÍ decrementan currentDebt.
- **Fix sugerido:** Dentro de la misma $transaction, tras actualizar la venta: if (updatedSale.customerId) await tx.customer.update({ where: { id: updatedSale.customerId, tenantId: authReq.tenantId }, data: { currentDebt: { decrement: monto } } }) con clamp a 0 como en el writeoff (5447), usando decimal.js. Idealmente unificar con /api/payments para eliminar la divergencia entre ambos endpoints de pago.
- **Nota del verificador:** CONFIRMADO leyendo server.ts:5347-5411 completo: no existe ninguna escritura a currentDebt en la transacción del abono. Fusioné aquí los dos candidatos idénticos (uno 'alto', otro 'critico', ambos line 5366, mismo tema). Ajusté severidad a ALTO (no 'critico'): sale.balance sí queda correcto y no se pierde dinero ni se corrompe el mayor contable; lo que se corrompe es el contador derivado currentDebt que gatilla el crédito y se muestra en UI. Sigue siendo grave porque afecta el flujo primario de cobranza (el que usa la pantalla) en cada abono.

#### 🟠 [ALTO · CONFIRMED · Capa 5] PUT/POST /api/customers sin checkRole: cualquier rol autenticado (p. ej. CASHIER) puede desbloquear crédito o subir el límite de un cliente
- **Ubicación:** `backend/server.ts:1246`
- **Qué pasa:** PUT /api/customers/:id (creditLimit, isBlocked) y POST /api/customers sólo exigen authenticate, sin checkRole ni validación Zod, dejando los controles de crédito modificables por cualquier usuario.
- **Escenario de fallo:** Verifiqué server.ts:1246 (PUT) y 1199 (POST): ambos declarados solo con authenticate. Un cajero (CASHIER) desde Clients.tsx puede togglear isBlocked → PUT /api/customers/:id { isBlocked:false } y el cliente moroso vuelve a comprar a crédito (salesService.ts:166), o subir creditLimit arbitrariamente evadiendo el límite de riesgo. Los hermanos /api/suppliers PUT/DELETE (server.ts:1290/1316) sí exigen checkRole(['OWNER','ADMIN']); el control financiero de clientes quedó abierto. Además creditLimit no se valida (creditLimit\|\|0 en 1212, Number(creditLimit) en 1255) permitiendo valores negativos/no numéricos, e isBlocked no se registra en AuditLog.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN']) a PUT /api/customers/:id (y evaluar en POST). Validar req.body con Zod: creditLimit como monto >= 0 (decimal.js), isBlocked boolean estricto, name requerido. Registrar en AuditLog los cambios de isBlocked/creditLimit por ser controles de crédito sensibles.
- **Nota del verificador:** CONFIRMADO leyendo server.ts:1199 y 1246 (solo authenticate) y contrastando con 1290/1316 (checkRole). El PUT usa updateMany con filtro tenantId (1253), así que el aislamiento multi-tenant SÍ está; el defecto es puramente de autorización por rol + falta de validación Zod. Severidad alto correcta.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Aritmética de dinero con Number nativo en /api/credits/payment (viola regla decimal.js)
- **Ubicación:** `backend/server.ts:5352`
- **Qué pasa:** El abono calcula y persiste montos con aritmética JS nativa (Number(sale.balance) - Number(amount)) y guarda amount/balance como floats, en vez de decimal.js como exige CLAUDE.md.
- **Escenario de fallo:** CreatePaymentSchema (schemas.ts:100 → moneyAmountPositive, verificado en schemas.ts:21-31) NO limita decimales, así que amount puede ser '50.005'. En server.ts:5352 newBalance = Number('100.00') - Number('50.005') = 49.994999… que la columna Sale.balance redondea a 49.99; el hermano /api/payments (server.ts:1618) usa new Decimal(sale.balance.toString()).minus(paymentAmount) = 49.995 → redondea a 50.00. Mismos datos, saldos persistidos distintos; y Payment.amount se guarda como Number('50.005')=50.005 (server.ts:5359), rompiendo la cuadratura (total − balance) = Σ abonos. Confirmado que solo este endpoint usa Number crudo; el resto del módulo (worklist, statement 5325-5328, writeoff 5435) usa Decimal.
- **Fix sugerido:** Reescribir como el hermano /api/payments: const saldo = new Decimal(sale.balance.toString()); const monto = new Decimal(amount); const newBalance = saldo.minus(monto).toDecimalPlaces(2); persistir amount/balance como .toNumber()/string de esos Decimal y la comparación de tolerancia (-0.01 / <=0.01) sobre Decimal.
- **Nota del verificador:** CONFIRMADO: server.ts:5352 usa Number(sale.balance) - Number(amount); 5359 persiste amount: Number(amount); 5369 balance: newBalance. moneyAmountPositive no restringe a 2 decimales (schemas.ts:24,29 solo checan parseFloat>0). Divergencia real de 1 centavo y desajuste de auditoría frente a /api/payments. Severidad medio adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] El endpoint POST /api/payments registra abonos (mueve dinero y baja la deuda del cliente) sin dejar ningún AuditLog ni asiento contable
- **Ubicación:** `backend/server.ts:1602`
- **Qué pasa:** POST /api/payments crea un Payment, reduce sale.balance y decrementa customer.currentDebt dentro de una $transaction pero no escribe AuditLog ni journal entry, dejando ese cobro sin rastro inmutable.
- **Escenario de fallo:** Verifiqué la $transaction server.ts:1614-1633: tx.payment.create (1615), tx.sale.update balance/status (1621), tx.customer.update currentDebt.decrement (1627) y return payment (1632) — sin ninguna llamada a tx.auditLog.create ni motor contable. Un usuario autenticado del tenant que llame directo a esta ruta aplica un pago (o un monto menor quedándose con la diferencia) y el KPI de recaudado se mueve sin registro inmutable de quién/antes/después/método. Contrasta con /api/credits/payment (5378) que sí escribe AuditLog CREDIT_PAYMENT.
- **Fix sugerido:** Dentro de la $transaction existente (antes del return de 1632) agregar tx.auditLog.create con action 'CREDIT_PAYMENT' y details { saleId, amount, balanceBefore, balanceAfter, customerId, method }, replicando /api/credits/payment. Idealmente consolidar ambas rutas de pago en un único handler auditado.
- **Nota del verificador:** CONFIRMADO: no hay auditLog en la transacción de /api/payments. AJUSTÉ severidad de 'alto' a MEDIO: grep en todo el repo (**/*.{ts,tsx,js}) muestra que /api/payments NO está cableado a ningún frontend/servicio — es un endpoint huérfano; la UI de Cobranza usa /api/credits/payment (que sí audita). Sigue siendo un hueco de capa 3 real y alcanzable por cualquier token del tenant, pero su superficie práctica de fraude es menor que la del candidato. Nota adicional: este endpoint también comparte el patrón de lost-update (write de balance absoluto) del hallazgo de concurrencia.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Lost update / abono duplicado en /api/credits/payment: lectura sin bloqueo + escritura de balance absoluto
- **Ubicación:** `backend/server.ts:5352`
- **Qué pasa:** El endpoint lee sale.balance con findFirst (sin bloqueo) y luego escribe un balance absoluto en vez de un decremento atómico, permitiendo pagos duplicados y pérdida de actualizaciones ante concurrencia/doble envío.
- **Escenario de fallo:** Doble clic, reintento de red o dos cajas disparan dos POST /api/credits/payment casi simultáneos para la misma venta con balance=100 y amount=100. Verifiqué: server.ts:5349 lee con tx.sale.findFirst (sin SELECT ... FOR UPDATE), 5352 calcula newBalance en memoria, 5366-5369 escribe el valor ABSOLUTO (balance: newBalance) y 5356 crea un Payment. Bajo READ COMMITTED ambas transacciones leen balance=100 antes de tomar cualquier lock, ambas escriben 0 y ambas insertan un Payment de 100 (no hay clave de idempotencia en Payment.create). Resultado: balance=0 pero DOS pagos de 100 contra una deuda de 100 → cobranza del día y AuditLog inflados, recibo/estado de cuenta inconsistente. El guard del frontend (submitting) sólo cubre un cliente.
- **Fix sugerido:** Actualizar con decremento atómico condicionado (data: { balance: { decrement: amount } } con where que exija saldo suficiente) o SELECT ... FOR UPDATE / control optimista por versión dentro de la $transaction, más idempotencia del abono (clave única/token). Validar además que sale.paymentMethod === 'CREDIT' antes de aceptar el pago.
- **Nota del verificador:** CONFIRMADO el anti-patrón: findFirst sin FOR UPDATE (5349), escritura de balance absoluto (5369) y Payment.create sin idempotencia (5356). Es el patrón clásico de lost-update bajo READ COMMITTED; la explotabilidad exacta depende del timing de concurrencia pero la protección (lock/idempotencia/decremento atómico) está genuinamente ausente. Mismo file:line que el hallazgo de decimal.js pero TEMA distinto (concurrencia vs precisión), por eso se mantiene separado. Nota: /api/payments (1618-1623) comparte el mismo defecto de balance absoluto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] PUT /api/customers/:id coacciona creditLimit (columna de dinero) con Number()
- **Ubicación:** `backend/server.ts:1255`
- **Qué pasa:** Al actualizar el límite de crédito se escribe creditLimit: Number(creditLimit) sobre una columna Decimal, usando Number() sobre un monto en contra de la regla del loop, sin validación Zod.
- **Escenario de fallo:** server.ts:1255 hace creditLimit: creditLimit !== undefined ? Number(creditLimit) : undefined sin Zod ni decimal.js antes de persistir en Customer.creditLimit. Para valores normales el impacto es nulo, pero incumple 'cero Number/parseFloat en montos' y no valida el cuerpo (a diferencia de otros endpoints del módulo). Un valor no numérico produce Number(x)=NaN.
- **Fix sugerido:** Validar el body con Zod (moneyAmount >= 0) y pasar el valor como string a Prisma (acepta string decimal): data.creditLimit = new Decimal(creditLimit).toDecimalPlaces(2).toString(). Evitar Number() sobre el monto.
- **Nota del verificador:** CONFIRMADO en server.ts:1255. Solapa con el hallazgo de authz/validación de /api/customers (abajo), pero como defecto de capa 4 (Number sobre monto) es real y está bien clasificado como bajo.

### Caja / Turnos

_6 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/shifts/close sin checkRole ni verificación de propiedad: cualquier cajero puede cerrar el turno de otro con un efectivo declarado arbitrario
- **Ubicación:** `backend/server.ts:1701`
- **Qué pasa:** El cierre de turno solo filtra por tenantId; no valida que el turno sea del usuario ni exige rol admin/manager, así cualquier usuario autenticado cierra el turno de un colega con cifras fabricadas.
- **Escenario de fallo:** El cajero A obtiene el shiftId del turno abierto del cajero B y envía POST /api/shifts/close {shiftId:'shift_B', declaredCash:0}. El backend lo encuentra por el único filtro {id, tenantId}, calcula expectedCash desde las ventas de B (p.ej. C$5000), difference=-5000, marca CLOSED y escribe AuditLog SHIFT_CLOSED + THEFT_ALERT nombrando a B. B queda cerrado a media jornada y señalado por un faltante de C$5000 con auditoría inmutable falsa.
- **Fix sugerido:** Autorizar el cierre: permitir solo si shift.userId === authReq.userId, o si authReq.role ∈ ['OWNER','ADMIN','SUPER_ADMIN','MANAGER'] (force-close administrativo); rechazar 403 en otro caso, replicando el patrón inline de /api/cash-movements/:id/void (2195-2197).
- **Nota del verificador:** CONFIRMED: la ruta (1696) usa solo authenticate + validate(CloseShiftSchema); el findFirst (1701-1702) filtra {id: shiftId, tenantId} y no compara userId ni aplica checkRole. El endpoint de void SÍ tiene el gate de rol inline (2195-2197), demostrando que el patrón existe pero no se aplicó aquí. Severidad 'alto' correcta (insider del mismo tenant, incrimina a un colega con registros inmutables).

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] Anular movimiento de caja (void) no revierte el Expense auto-creado: gasto fantasma permanente
- **Ubicación:** `backend/server.ts:2211`
- **Qué pasa:** Al crear una salida GASTO_OPERATIVO/PAGO_PROVEEDOR se auto-crea un Expense enlazado (expenseId), pero la anulación solo marca isVoided=true y jamás elimina/revierte ese Expense, dejando el gasto contabilizado.
- **Escenario de fallo:** Un cajero registra OUT C$500 categoría PAGO_PROVEEDOR: se crea Expense C$500 y CashMovement OUT C$500 (expenseId enlazado). El admin anula el movimiento. El void pone isVoided=true (el efectivo esperado se recupera +500), pero el Expense C$500 sigue existiendo y apareciendo en reportes de gastos/P&L. Resultado: gasto fantasma que infla costos y subestima utilidad; el libro de caja y el de gastos divergen de forma permanente.
- **Fix sugerido:** Dentro de la $transaction del void, si movement.expenseId != null, soft-delete (deletedAt) o marcar anulado el Expense enlazado y registrarlo en el AuditLog.
- **Nota del verificador:** CONFIRMED: en POST /api/cash-movements se crea el Expense y se enlaza expenseId (2047-2057); en el void (2211-2237) la $transaction solo actualiza isVoided/voidReason/voidedAt/voidedBy y crea el AuditLog, sin leer ni tocar el Expense enlazado. Severidad 'alto' defendible: corrompe silenciosamente el libro de gastos y el P&L, contradiciendo la integridad financiera del CLAUDE.md.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Apertura de caja (/api/shifts/open) no deja asiento de auditoría inmutable del fondo inicial
- **Ubicación:** `backend/server.ts:1676`
- **Qué pasa:** El handler crea el Shift con initialCash (baseline del arqueo) sin escribir ningún AuditLog ni usar $transaction, a diferencia del cierre que sí registra SHIFT_CLOSED.
- **Escenario de fallo:** Un cajero abre turno declarando initialCash=C$0 cuando físicamente recibió C$1000 de fondo. El arqueo al cierre calcula expectedCash = initialCash + ventasEfectivo + INs - OUTs, por lo que espera C$1000 menos; el cajero se embolsa el fondo y la diferencia sale C$0 (sin alerta). No hay asiento inmutable de apertura para reconstruir/desmentir el monto declarado, y el Shift es mutable y sin deletedAt.
- **Fix sugerido:** Envolver la creación del Shift en prisma.$transaction junto con tx.auditLog.create({ action: 'SHIFT_OPENED', tenantId, userId, details: JSON.stringify({ before: null, after: { shiftId, initialCash, employeeId, cajero } }) }), replicando el patrón de SHIFT_CLOSED (1742-1762).
- **Nota del verificador:** CONFIRMED: lineas 1676-1689 solo hacen prisma.shift.create sin $transaction ni auditLog. Grep confirma que la accion 'SHIFT_OPEN'/'SHIFT_OPENED' no existe en ningun lado del backend y no hay middleware prisma.$use que audite creates. La apertura fija el baseline del dinero → cae bajo Capa 3. Severidad 'medio' adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Validación de saldo para salidas (OUT) fuera de la transacción: race condition permite sobregiro de la caja
- **Ubicación:** `backend/server.ts:2034`
- **Qué pasa:** El chequeo 'amount > availableCash' se calcula desde una lectura hecha ANTES de la $transaction y no se re-verifica dentro de ella, así dos salidas concurrentes pasan ambas y dejan efectivo físico negativo.
- **Escenario de fallo:** El turno tiene availableCash=C$100. Doble clic (o dos terminales) disparan dos OUT de C$80. Ambas peticiones leen currentShift (2009) antes de su transacción, ambas calculan 100, ambas pasan 80<=100 y ambas appendan el OUT. La gaveta queda en -C$60 y la garantía 'CERO TOLERANCIA A SALIDAS FANTASMA' queda burlada. El row-lock de LedgerHead serializa el append pero no recalcula el saldo.
- **Fix sugerido:** Mover la lectura del turno y el recálculo de availableCash DENTRO de la $transaction interactiva (bloqueando la fila del Shift con SELECT ... FOR UPDATE via queryRaw, o serializando por la LedgerHead ya bloqueada) y revalidar amount <= availableCash justo antes del append, abortando si no alcanza.
- **Nota del verificador:** CONFIRMED (TOCTOU real): la lectura currentShift está en 2009-2015, el gate en 2020-2040, y la $transaction que appenda arranca en 2043 sin re-leer ni re-validar el saldo. appendSignedCashMovement (ledger.ts 91) hace row-lock sobre LedgerHead que serializa el orden de append pero NO recomputa la caja, así que no protege del sobregiro. Distinto tema que el hallazgo #1 (float) aunque comparte líneas ~2032-2034 → no se fusiona. Severidad 'medio' adecuada (requiere concurrencia).

#### ⚪ [BAJO · CONFIRMED · Capa 4] Gate de saldo para salidas de caja (OUT) calculado con float nativo en vez de decimal.js
- **Ubicación:** `backend/server.ts:2032`
- **Qué pasa:** El efectivo disponible que autoriza o rechaza una salida de caja se computa sumando montos con Number() y aritmetica JS nativa (+/-), no con decimal.js, arrastrando errores de representacion binaria en la decision.
- **Escenario de fallo:** Turno con initialCash C$0.10 y una entrada (IN) de C$0.07. En la linea 2032 availableCash = Number(0.10) + 0.07 se evalua en float como 0.16999999999999998. El cajero intenta retirar C$0.17; la comparacion de la linea 2034 `0.17 > 0.16999999999999998` es verdadera, por lo que la salida legitima se rechaza aunque ambos montos se muestran identicos con toFixed(2). El mismo patron float recurre en GET /api/cash-movements/balance (2165) y en GET /api/shifts/monitor estimatedPhysicalCash (1894).
- **Fix sugerido:** Computar availableCash con decimal.js: new Decimal(currentShift.initialCash).plus(cashSalesTotal).plus(totalINs).minus(totalOUTs) y comparar con new Decimal(amount).greaterThan(availableCash). Extraer un helper compartido y reusarlo en 2165 y 1894.
- **Nota del verificador:** CONFIRMED leyendo lineas 2020-2040 (gate), 2155-2165 (balance) y 1871-1894 (monitor): las tres usan Number()+aritmetica nativa sobre Decimal de Prisma. Es una desviacion real del mandato decimal.js del CLAUDE.md (Capa 4). Severidad 'bajo' correcta: el impacto practico es sub-centavo y las ventas en NIO suelen ser a 2 decimales, pero la deriva se acumula en lecturas en vivo y puede bloquear el retiro del total exacto de la gaveta.

#### ⚪ [BAJO · CONFIRMED · Capa 5] POST /api/shifts/open sin rate-limit estricto ni bloqueo de PIN: fuerza bruta del PIN de 4 dígitos para suplantar a otro empleado
- **Ubicación:** `backend/server.ts:1660`
- **Qué pasa:** El PIN de 4 dígitos se coteja en texto plano contra la BD sin límite dedicado (solo el globalLimiter de 300/15min), a diferencia de /api/auth/login que usa 5/hora, permitiendo enumerar el PIN de un compañero.
- **Escenario de fallo:** Un cajero autenticado scriptea POST /api/shifts/open recorriendo employeePin de '0000' a '9999'. Bajo el globalLimiter (~1200/hora) cubre las 10000 combinaciones en ~8 horas, sin bloqueo por cuenta ni por PIN. Al acertar el PIN de un compañero abre turno con su employeeId; las alertas de arqueo y el reporte Z quedan atribuidos al empleado suplantado.
- **Fix sugerido:** Aplicar un limiter dedicado y estricto a /api/shifts/open (similar a loginLimiter, 5-10 intentos/usuario-IP/hora) y/o contador de intentos fallidos de PIN por empleado con bloqueo temporal. Hashear los PIN en vez de compararlos en texto plano.
- **Nota del verificador:** CONFIRMED: /api/shifts/open (1654) solo hereda el globalLimiter (300/15min, definido en 170-177); no hay limiter dedicado como loginLimiter (5/h, 180-187). El PIN se compara en texto plano: findFirst({ where:{ tenantId, pin: String(employeePin) } }) (1660-1662), sin lockout por empleado. Mantengo 'bajo' (requiere insider autenticado, el globalLimiter da algo de throttle), pero el almacenamiento del PIN en texto plano y la ausencia de lockout son debilidades compuestas que empujan hacia 'medio'; además el hallazgo #3 ya permite el mismo daño de atribución sin siquiera conocer el PIN.

### Prestamista (Lender / Fintech / Scoring)

_9 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 4] /api/loans/request muta walletBalance y creditLimit con Number(amount) crudo, sin Zod ni cota inferior: monto negativo infla el límite de crédito y permite acuñar saldo gastable
- **Ubicación:** `backend/server.ts:1129`
- **Qué pasa:** El endpoint no usa validate() y aplica aritmética JS nativa (Number(amount)) directamente sobre el dinero persistido (walletBalance increment / creditLimit decrement), sin validar que amount sea un número finito y positivo.
- **Escenario de fallo:** POST /api/loans/request con body { amount: -1000000 }. La guarda 'Number(amount) > Number(tenant.creditLimit)' es falsa para un negativo → pasa. 'creditLimit: { decrement: -1000000 }' INCREMENTA creditLimit en 1,000,000 y 'walletBalance: { increment: -1000000 }' lo lleva a negativo. Variante: amount='x' → Number('x')=NaN, NaN > creditLimit es falso → pasa la guarda e intenta increment/decrement por NaN.
- **Fix sugerido:** Registrar con validate() y un schema Zod moneyAmountPositive; calcular con decimal.js y comparar con Decimal.gt; auditar before/after de walletBalance y creditLimit.
- **Nota del verificador:** CONFIRMADO leyendo server.ts:1119-1133. El handler NO tiene validate() ni checkRole; 'const { amount } = req.body' es crudo; la única guarda es 'Number(amount) > Number(tenant.creditLimit)' (falsa para negativos y NaN); increment/decrement usan Number(amount), violando la regla decimal.js. Un amount negativo SÍ infla creditLimit y SÍ empuja walletBalance a negativo (corrupción real). MATIZ ADVERSARIO: la afirmación de 'acuñar saldo gastable' con un SOLO monto negativo está sobredimensionada — el decrement de walletBalance es simétrico al increment de creditLimit, así que por la vía negativa aislada el neto se compensa y no genera dinero gratis directo. El vector real de dinero gratis es la carrera concurrente (ver hallazgo server.ts:1119). Aun así, la ausencia total de validación + corrupción de creditLimit/walletBalance + NaN + Number() justifica severidad alto. Solapa parcialmente con el hallazgo TOCTOU de la misma ruta.

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/loans/request desembolsa sin validación Zod ni $transaction (TOCTOU / doble-giro sobre la línea de crédito)
- **Ubicación:** `backend/server.ts:1119`
- **Qué pasa:** El endpoint que acredita walletBalance real contra creditLimit no valida el body con Zod y hace check-then-act (findUnique + update) en operaciones separadas sin transacción ni bloqueo de fila, ni checkRole.
- **Escenario de fallo:** creditLimit = C$10,000. Dos POST /api/loans/request concurrentes con amount=10000: ambos leen creditLimit=10000 (1123), ambos evalúan 10000 > 10000 = falso (1125) y ambos ejecutan el update (1127): walletBalance += 20,000 y creditLimit -= 20,000. El tenant obtuvo C$20,000 gastables (drenables en /api/b2b/order) contra una línea de C$10,000 → pérdida directa.
- **Fix sugerido:** validate(LoanRequestSchema) con moneyAmountPositive; envolver lectura+chequeo+update en $transaction con SELECT FOR UPDATE o updateMany condicionado 'creditLimit >= amount' verificando count; checkRole(['OWNER','ADMIN']); decimal.js.
- **Nota del verificador:** CONFIRMADO en server.ts:1119-1133. Hay un findUnique (1123) y luego un tenant.update (1127) SIN prisma.$transaction ni bloqueo de fila: check-then-act clásico. Dos requests concurrentes leen el mismo creditLimit y ambos acreditan walletBalance → doble-giro con dinero gastable real vía /api/b2b/order (server.ts:1140-1159 solo verifica walletBalance >= orderTotal). Confirmado además: sin checkRole (mount app.use('/api/loans', loanRoutes) en 204 no añade rol; el handler solo tiene authenticate). Este es el verdadero vector de dinero gratis; complementa al hallazgo de precisión/Zod de la misma ruta (1129). Severidad alto correcta.

#### 🟠 [ALTO · CONFIRMED · Capa 5] POST /api/loans/collectors crea usuarios (credenciales de login) sin checkRole ni validación Zod
- **Ubicación:** `backend/routes/loans.ts:587`
- **Qué pasa:** El endpoint que da de alta usuarios COLLECTOR solo exige authenticate: no tiene checkRole ni validación de body, permitiendo que cualquier usuario del tenant cree cuentas con contraseñas vacías/débiles.
- **Escenario de fallo:** Un COLLECTOR toma su token válido y hace POST /api/loans/collectors con { name, email, password:'' }. Sin checkRole → pasa; name/email/password se leen crudos sin Zod (589) y bcrypt.hash('') genera un hash válido → se crea user con role='COLLECTOR' y contraseña vacía, ligado a la bóveda del prestamista.
- **Fix sugerido:** Añadir checkRole(['OWNER','ADMIN']) y un CreateCollectorSchema Zod (name no vacío, email .email(), password min(8) con complejidad).
- **Nota del verificador:** CONFIRMADO en loans.ts:587: 'router.post('/collectors', authenticate, async...)' — solo authenticate, sin checkRole ni validate (verificado que loans.ts no importa ni usa checkRole en absoluto; grep sin coincidencias). Contraste real: /api/inventory/.../writeoff y otros endpoints sensibles SÍ usan checkRole(['OWNER','ADMIN']). password se pasa crudo a bcrypt.hash (599): con '' produce hash válido (cuenta con contraseña vacía); con undefined lanzaría y caería a 500. Cualquier usuario autenticado del tenant (incluido un COLLECTOR de baja confianza) puede auto-aprovisionar cuentas COLLECTOR con acceso a repayments/gastos/bóveda. Severidad alto correcta.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Desembolso de préstamo a wallet sin AuditLog con before/after, con acción errónea y fuera de transacción
- **Ubicación:** `backend/server.ts:1131`
- **Qué pasa:** POST /api/loans/request acredita walletBalance y descuenta creditLimit pero su AuditLog usa action='SURPLUS_ALERT', sin before/after y como await separado fuera de cualquier $transaction.
- **Escenario de fallo:** amount=5000 dentro del creditLimit: walletBalance +5000 y creditLimit -5000 (1127-1130). El asiento (1131) queda action='SURPLUS_ALERT', details='Préstamo: $5000', sin balanceBefore/After. tenant.update y auditLog.create son awaits separados; si el proceso cae entre ambos el wallet queda acreditado sin rastro.
- **Fix sugerido:** Envolver tenant.update y auditLog.create en un mismo $transaction con tx.auditLog.create; action='LOAN_WALLET_DISBURSED' con walletBefore/After y creditLimitBefore/After.
- **Nota del verificador:** CONFIRMADO en server.ts:1131: literal action:'SURPLUS_ALERT', details:`Préstamo: $${amount}` (texto, sin before/after), y es un prisma.auditLog.create separado del tenant.update (1127) sin $transaction. Viola la Capa 3 (asiento inmutable con before/after para movimientos de dinero). AJUSTE DE SEVERIDAD: bajé de alto a medio — sí existe un asiento (aunque mal etiquetado y sin before/after), la pérdida total de traza solo ocurre en caída entre ambos awaits; el impacto financiero directo lo cubren los hallazgos 1119/1129. Sigue siendo un defecto real de auditoría.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] Gasto de ruta (salida de efectivo) se registra sin ningún AuditLog
- **Ubicación:** `backend/routes/loans.ts:391`
- **Qué pasa:** POST /api/loans/route-expenses crea un RouteExpense que reduce el efectivo esperado del motorizado, pero no escribe ningún asiento inmutable en AuditLog.
- **Escenario de fallo:** Un COLLECTOR llama POST /api/loans/route-expenses con amount=500. Se crea RouteExpense (391) que baja el efectivo a entregar en arqueo, sin AuditLog. Como ningún modelo tiene soft-delete (línea base), ese RouteExpense puede editarse/borrarse en BD sin traza inmutable, permitiendo inflar/eliminar gastos ficticios.
- **Fix sugerido:** Envolver en $transaction y agregar tx.auditLog.create action='ROUTE_EXPENSE' con {expenseId, collectedBy, amount, description}.
- **Nota del verificador:** CONFIRMADO en loans.ts:385-405: la creación de routeExpense NO tiene auditLog.create alguno (verificado en todo el handler). Es una salida de efectivo (reduce el arqueo) sin asiento inmutable → viola Capa 3. AJUSTE DE SEVERIDAD: bajé de alto a medio — SÍ existe una fila RouteExpense persistida (no es una salida totalmente invisible), aunque mutable/borrable sin soft-delete. MATIZ: el endpoint SÍ tiene validate(RouteExpenseSchema) y amount ya viene validado como moneyAmountPositive, por lo que la sugerencia de 'usar decimal.js en vez de parseFloat' es de bajo valor (no hay aritmética, solo conversión para persistir); el defecto real es la ausencia de AuditLog.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] AuditLog de originación de crédito (LOAN_DISBURSED) escrito fuera del $transaction del desembolso
- **Ubicación:** `backend/routes/loans.ts:109`
- **Qué pasa:** El asiento LOAN_DISBURSED se crea con prisma.auditLog.create después de cerrar el $transaction (línea 107), por lo que el préstamo puede quedar persistido sin auditoría si el asiento falla.
- **Escenario de fallo:** El $transaction (68-107) confirma el Loan y sus LoanInstallment. Luego, en 109, prisma.auditLog.create falla por corte de conexión: el préstamo desembolsado queda persistido pero el asiento LOAN_DISBURSED se pierde, a diferencia de repayments/penalty que usan tx.auditLog.create dentro de la transacción.
- **Fix sugerido:** Mover el auditLog.create dentro del prisma.$transaction usando tx.auditLog.create, junto a la creación del loan y las cuotas.
- **Nota del verificador:** CONFIRMADO en loans.ts: el prisma.$transaction cierra en la línea 107 (return loan) y el 'await prisma.auditLog.create' está en 109-123 FUERA de la tx, usando prisma. (no tx.). Contraste verificado: repayments usa tx.auditLog.create dentro de la tx (193) y penalty también (561). Inconsistencia real → si el asiento falla, el desembolso queda sin registro. Severidad medio adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Registro de cobro no acota el sobrepago: balanceRemaining puede quedar negativo
- **Ubicación:** `backend/routes/loans.ts:176`
- **Qué pasa:** El repayment decrementa balanceRemaining sin límite y marca PAID_OFF, sin rechazar montos mayores al saldo, a diferencia de /api/credits/payment que sí valida el excedente.
- **Escenario de fallo:** Préstamo con balanceRemaining=C$100. Se registra amountPaid=5000. El decrement (179) lleva balanceRemaining a -4900 y la línea 186 (<=0) lo marca PAID_OFF; el Repayment queda con amountPaid=5000. La cartera muestra saldo negativo y el arqueo/bóveda espera C$5,000 por una deuda de C$100.
- **Fix sugerido:** Antes del decrement, rechazar (400) si payment excede balanceRemaining más una tolerancia, o clampear al saldo y registrar el excedente aparte; usar decimal.js y setear balanceRemaining=0 exacto al liquidar.
- **Nota del verificador:** CONFIRMADO en loans.ts:133-232. RepaymentSchema valida amountPaid>0 pero NO contra balanceRemaining; el handler solo revisa isNaN/<=0 (139) y luego decrementa sin cota (179) marcando PAID_OFF con '<= 0' (186). No hay comparación payment vs owned.balanceRemaining. Contraste CONFIRMADO en server.ts:5352-5353 (/api/credits/:saleId/payment): 'if (newBalance < -0.01) throw El abono excede el saldo pendiente'. Inconsistencia real que deja balanceRemaining negativo y descuadra arqueo/bóveda. Severidad medio adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] GET /api/fintech/score muta creditLimit/creditScore del tenant sin checkRole (write en un GET)
- **Ubicación:** `backend/server.ts:1108`
- **Qué pasa:** Un GET recalcula y sobrescribe creditLimit y creditScore del tenant sin restricción de rol, exponiendo la mutación de un campo que gobierna el monto prestable a cualquier usuario autenticado o a prefetch/caché.
- **Escenario de fallo:** Un usuario de bajo privilegio (VIEWER/CASHIER/COLLECTOR) hace GET /api/fintech/score; el endpoint ejecuta prisma.tenant.update (1108) reescribiendo creditLimit según el motor de scoring, sin checkRole. Como creditLimit es el tope que consume /api/loans/request, cualquier empleado —o un prefetch del navegador— puede alterarlo.
- **Fix sugerido:** Convertir el recálculo con escritura en POST y protegerlo con checkRole(['OWNER','ADMIN']); dejar el GET como solo-lectura del score cacheado.
- **Nota del verificador:** CONFIRMADO en server.ts:1104-1117: 'app.get('/api/fintech/score', authenticate, ...)' ejecuta prisma.tenant.update (1108) escribiendo creditScore y creditLimit — es un GET con efecto secundario de escritura y sin checkRole. Riesgo real de prefetch/caché y de que cualquier rol autenticado dispare el recálculo. MATIZ ADVERSARIO: el valor escrito proviene de calculateTenantScore(tenantId) (determinista sobre datos del propio tenant), no es un valor arbitrario controlado por el atacante, así que no es escalada directa de creditLimit a voluntad; el defecto es semántico (mutación en GET + sin gate de rol). Severidad medio correcta.

#### ⚪ [BAJO · CONFIRMED · Capa 3] Depósito de efectivo a bóveda con AuditLog no atómico (fuera de transacción)
- **Ubicación:** `backend/routes/loans.ts:681`
- **Qué pasa:** POST /api/loans/vault/deposit crea el CollectorDeposit y luego su AuditLog como dos escrituras separadas sin $transaction.
- **Escenario de fallo:** Cobrador entrega C$10,000: prisma.collectorDeposit.create (670) confirma el depósito, pero prisma.auditLog.create (681) falla (hiccup de BD). El manejo de efectivo queda sin asiento inmutable atómico.
- **Fix sugerido:** Envolver collectorDeposit.create y auditLog.create en un mismo $transaction con tx.auditLog.create.
- **Nota del verificador:** CONFIRMADO en loans.ts:670-692: collectorDeposit.create (670) y auditLog.create (681) son dos 'await prisma.' separados sin $transaction. El asiento SÍ incluye amount y depositId (no le faltan before/after porque es una entrada, no un delta de saldo), por lo que el único defecto es la no-atomicidad. Severidad bajo correcta. La sugerencia de decimal.js es de bajo valor: amount ya viene validado por VaultDepositSchema (moneyAmountPositive) y no hay aritmética.

### Delivery / Motorizados / Pedidos

_12 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] Entrega de pedido crea Sale + Payment + asiento contable sin AuditLog inmutable
- **Ubicación:** `backend/routes/pedidos.ts:364`
- **Qué pasa:** Al marcar 'entregado' el endpoint factura (Sale, Payment CASH, recordSale) dentro de la $transaction pero no escribe ningún AuditLog de la venta, a diferencia del flujo POS canónico.
- **Escenario de fallo:** PATCH /api/v1/pedidos/:id/estado con estado='entregado' (sin lat/lng) crea Sale, Payment CASH y postea a Caja/Ventas/IVA/Costo/Inventario, pero NO inserta fila en AuditLog: el único auditLog.create del bloque es GPS_AUDIT_ALERT (319), condicionado a lat && lng. La venta en efectivo queda sin el asiento inmutable que toda venta POS deja (salesService.ts:324 escribe 'SALE_CREATED'), sin atribución de quién cobró ni before/after.
- **Fix sugerido:** Dentro de la misma $transaction, tras crear Sale/Payment y vincular facturaId, agregar tx.auditLog.create con action 'SALE_CREATED', tenantId/userId del authReq y details con { pedidoId, saleId, total, paymentMethod, before:{estado,facturaId:null}, after:{estado:'entregado',facturaId:sale.id} }. Idealmente centralizar la creación de venta en executeSale/helper compartido.
- **Nota del verificador:** CONFIRMADO: el bloque 336-395 no tiene auditLog.create; el único de la ruta es GPS_AUDIT_ALERT (319) atado a lat&&lng. Contrastado con salesService.executeSale (324-337) que audita toda venta. CLAUDE.md admite que la cobertura AuditLog no es universal (baseline), pero esta es una operación específica que mueve dinero e inventario sin ningún rastro — mantengo alto por Capa 3.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Entrega vía Driver App genera Sale + Payment + contabilidad sin AuditLog (cobro externo sin rastro)
- **Ubicación:** `backend/routes/driver.ts:312`
- **Qué pasa:** PATCH /api/driver/me/orders/:orderId/deliver crea Sale, Payment CASH (collectedBy=motorizadoId) y recordSale en la $transaction, pero no escribe AuditLog de la venta; el único auditLog es GPS_AUDIT_ALERT condicional a lat/lng y con userId 'SYSTEM'.
- **Escenario de fallo:** Un repartidor de la Red NORTEX (tenantId ajeno, no empleado) entrega SIN GPS un pedido de C$8,000: se crea Sale, Payment CASH con collectedBy=motorizadoId y el asiento contable, pero no hay AuditLog de la venta (GPS_AUDIT_ALERT en 278 se salta sin lat/lng, y aun con GPS registra alerta con userId 'SYSTEM', no la venta). No queda asiento inmutable de que un motorizado externo cobró efectivo y cerró la venta.
- **Fix sugerido:** En la misma $transaction, tras Sale/Payment/recordSale, agregar tx.auditLog.create incondicional con action 'SALE_CREATED', tenantId=pedido.tenantId, userId identificando al actor (p.ej. driver:${motorizadoId}) y details con before/after (estado, facturaId). Reutilizar el helper de venta del POS.
- **Nota del verificador:** CONFIRMADO (312-337, GPS_AUDIT_ALERT en 277-292). Riesgo de Capa 3 igual o mayor que pedidos.ts porque el cobrador es un tercero externo (collectedBy=motorizadoId, línea 328). Mantengo alto. No es duplicado de finding 6 (distinto file/endpoint/actor).

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] Venta 'entregado' factura y contabiliza COGS sin descontar inventario cuando no pasó por 'preparando'
- **Ubicación:** `backend/routes/pedidos.ts:356`
- **Qué pasa:** El descuento de stock/Kardex solo ocurre en la transición a 'preparando' (276-311); al facturar en 'entregado' el decremento está comentado (355-359) y driver.ts deliver no toca stock, así que hay rutas reales que crean Sale + asiento de COGS sin reducir Product.stock.
- **Escenario de fallo:** DeliveryManager.assignMotorizado auto-avanza el pedido a 'en_camino' saltándose 'preparando' (DeliveryManager.tsx:108-115). El repartidor entrega vía driver.ts:294-338: crea Sale, Payment y recordSale (que acredita Inventario 1.1.4 al costo) pero NO decrementa Product.stock ni crea KardexMovement. El stock físico queda sobrevalorado, el mismo producto puede revenderse en mostrador, y el libro contable de inventario diverge del stock físico. Igual si un admin marca 'entregado' directo por PATCH /api/v1/pedidos/:id/estado sin pasar por 'preparando' (bloque 355-359 comentado).
- **Fix sugerido:** Descontar stock + KardexMovement OUT de forma idempotente en el momento de la venta ('entregado' en pedidos.ts y en el deliver de driver.ts), o garantizar que toda ruta a 'entregado' reserve primero. Que assignMotorizado no salte a 'en_camino' sin reserva. Usar referenceType (PEDIDO_RESERVA/PEDIDO_VENTA) para no descontar dos veces.
- **Nota del verificador:** CONFIRMADO end-to-end: (a) reserva solo en estado 'preparando' (276), (b) decremento en 'entregado' comentado (355-359), (c) driver.ts deliver (294-338) sin ninguna escritura de stock/kardex, (d) assignMotorizado salta a 'en_camino' (DeliveryManager.tsx:109-114), (e) estadosValidos no fuerza orden (240). El estado máquina libre + el auto-salto del frontend rompen la suposición de que 'preparando' siempre ocurre. alto justificado (inventario fantasma revendible + divergencia con la cuenta contable 1.1.4).

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Conversión PublicOrder→Quotation calcula subtotal, IVA y total con float nativo y los persiste
- **Ubicación:** `backend/server.ts:7508`
- **Qué pasa:** PATCH /api/public-orders/:id/convert computa subtotal (Number*Number), tax (subtotal*0.15) y total (subtotal+tax) con aritmética float nativa y los guarda en Quotation, en vez de decimal.js.
- **Escenario de fallo:** Con items que producen fracciones, subtotal += Number(item.price)*Number(item.quantity) (7499-7500) y tax = subtotal*0.15 (7508) acumulan error binario. Cada campo se persiste independientemente en columnas Decimal(10,2) (redondeadas por el driver), de modo que subtotal_stored + tax_stored puede diferir de total_stored en 1 centavo; además el JSON de respuesta (7538) devuelve el float crudo (p.ej. 15.014999999999999).
- **Fix sugerido:** Reemplazar 7497-7509 por decimal.js: subtotal.plus(new Decimal(price).mul(qty)), tax = subtotal.mul('0.15'), total = subtotal.plus(tax), todo con .toDecimalPlaces(2) antes de persistir y de responder. Evitar Number() sobre montos.
- **Nota del verificador:** CONFIRMADO leyendo 7497-7509 y schema Quotation (Decimal(10,2), líneas 932-934). Regresión real frente a pedidos.ts:80-98 que sí usa Decimal. FUSIONADO con el hallazgo duplicado 'convert calcula IVA y total con float (layer correctitud, bajo)' — mismo file:line 7508 y mismo tema; se consolida en este. Severidad medio: aunque el DB redondea a 2dp al persistir, el descuadre inter-campo de 1 centavo en un documento financiero y el float crudo en la respuesta justifican medio.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] COGS del pedido entregado se acumula con Number()+float y se envía a recordSale
- **Ubicación:** `backend/routes/pedidos.ts:345`
- **Qué pasa:** En PATCH /:id/estado (estado='entregado') costTotal += (Number(prod.cost\|\|0) * item.cantidad) usa float nativo y se pasa como COGS a recordSale() (388).
- **Escenario de fallo:** Para cada item unitCost=Number(prod.cost\|\|0) (344) y costTotal += unitCost*item.cantidad (345); con costos fraccionarios y muchos items la suma float arrastra deriva sub-centavo hacia el asiento de Costo de Ventas/Inventario que arma recordSale.
- **Fix sugerido:** Acumular con decimal.js: costTotal = costTotal.plus(new Decimal(prod.cost\|\|0).mul(item.cantidad)) y pasar costTotal.toDecimalPlaces(4).toNumber(). Idealmente Product.cost debería ser Decimal, no Float.
- **Nota del verificador:** CONFIRMADO (líneas 344-345, 388). Product.cost es Float en schema (línea 753) y cantidad es Int, así que el error real es sub-centavo y acotado; recordSale internamente usa Decimal, pero recibe un total ya sumado en float. Es una violación real de Capa 4 que alimenta el libro contable, por lo que mantengo medio (no lo exagero: impacto monetario mínimo).

#### 🟡 [MEDIO · CONFIRMED · Capa 4] COGS en la entrega vía Driver App usa Number()+float hacia recordSale
- **Ubicación:** `backend/routes/driver.ts:301`
- **Qué pasa:** En PATCH /api/driver/me/orders/:orderId/deliver costTotal += (Number(prod.cost\|\|0)*item.cantidad) (300-301) usa float y se pasa como COGS a recordSale (332).
- **Escenario de fallo:** Idéntico patrón a pedidos.ts: unitCost float acumulado y asentado como COGS al facturar la entrega desde la app del motorizado; deriva sub-centavo en Inventario/Costo de Ventas.
- **Fix sugerido:** Usar decimal.js (Decimal.plus/mul) para costTotal antes de pasarlo a recordSale, alineado con Capa 4.
- **Nota del verificador:** CONFIRMADO (líneas 300-301, 332). Mismo defecto y mismo impacto acotado que pedidos.ts:345. No es duplicado: distinto file/endpoint.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Reserva de inventario en 'preparando' permite stock negativo (sin verificación de disponibilidad)
- **Ubicación:** `backend/routes/pedidos.ts:286`
- **Qué pasa:** Al reservar en 'preparando' se calcula stockAfter = stockBefore - cantidad y se escribe sin guarda contra negativos ni chequeo de disponibilidad, permitiendo sobreventa.
- **Escenario de fallo:** El catálogo público (POST /api/v1/pedidos, sin auth) admite cantidad hasta 999 (Zod, línea 42) sin validar stock. Al mover el pedido a 'preparando', pedidos.ts:285-292 hace findUnique + update con stockAfter = 5 - 999 = -994. Inventario negativo y mercancía inexistente vendida.
- **Fix sugerido:** Validar prod.stock >= item.cantidad antes de reservar (o marcar backorder explícito) y hacer el decremento condicional (updateMany where stock >= cantidad, abortar si count===0) para respetar la política del tenant y ser atómico.
- **Nota del verificador:** CONFIRMADO (285-292). Además de no chequear negativos, es un read-then-write NO atómico (findUnique + update con valor calculado), vulnerable a lost-update bajo concurrencia — a diferencia del POS canónico que usa applyStockDelta con enforceSufficient y respeta tenant.allowNegativeStock (salesService.ts:236-282). Esta ruta ignora esa política por completo. medio correcto.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] /api/public/orders confía en el precio enviado por el cliente (no lo resuelve desde la BD)
- **Ubicación:** `backend/server.ts:7437`
- **Qué pasa:** El endpoint público toma item.price del body (solo acotado a [0,999999]) y lo persiste como 'snapshot' en PublicOrder; luego /convert lo usa para armar la Quotation, sin validarlo contra Product.
- **Escenario de fallo:** POST /api/public/orders con items=[{productId, name:'Taladro', quantity:1, price:0.01}]: server.ts:7436-7444 acepta y guarda el precio del cliente. En PATCH /convert (7498-7509) se calcula subtotal/total con ese Number(item.price) manipulado y se crea una Quotation con precios falsos. No hay validación de que productId pertenezca al tenant/esté publicado, ni Zod.
- **Fix sugerido:** Ignorar item.price del body; resolver precio y validar productId contra prisma.product del tenant (isPublished) como en pedidos.ts:69-94. Validar body con Zod. Recalcular montos con decimal.js.
- **Nota del verificador:** CONFIRMADO (7436-7444 → 7498-7509). Contraste real con pedidos.ts que lee el precio de la BD (líneas 69-94). Mitigante: la Quotation es un documento no vinculante revisado por el negocio antes de venderse, y el endpoint tiene rate limit (10/15min) — por eso medio y no alto, pero el principio (cliente fija el precio en un documento de negocio persistido, sin autoridad server-side) es una violación real de Capa 5.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Liquidación diaria del motorizado suma efectivo y comisiones con float y retorna sin redondeo
- **Ubicación:** `backend/routes/motorizados.ts:152`
- **Qué pasa:** GET /:id/liquidacion acumula totalCobradoEfectivo += Number(p.total) y totalComisiones += Number(p.costoEntrega) y calcula netoADepositar = resta float, devolviéndolos crudos.
- **Escenario de fallo:** Con muchos pedidos la suma float (148-149) y la resta (152) pueden mostrar artefactos como 11111.099999999999 en netoADepositarA_Tienda; el endpoint responde crudo sin toFixed/Decimal.
- **Fix sugerido:** Acumular con decimal.js y devolver .toDecimalPlaces(2); calcular el neto con Decimal.minus.
- **Nota del verificador:** CONFIRMADO (148-152). AJUSTE DE SEVERIDAD medio→bajo: es un endpoint GET de solo lectura; no persiste nada y el desvío real es sub-centavo (el efectivo se maneja en centavos). El impacto es de presentación/UX (mostrar colas binarias), no de integridad de datos almacenados. El candidato calificó este bajo el mismo defecto como 'bajo' en driver.ts (finding 5) — normalizo ambos a bajo.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Liquidación del día en Driver App (me/orders) usa float para efectivo y neto a depositar
- **Ubicación:** `backend/routes/driver.ts:220`
- **Qué pasa:** GET /api/driver/me/orders acumula totalCobradoEfectivo/totalComisiones con Number() (212-213) y computa netoADepositarA_Tienda con resta float (220), sin decimal.js.
- **Escenario de fallo:** El resumen 'liquidación del día' del repartidor puede exhibir colas de coma flotante en el neto a depositar en jornadas con muchos pedidos.
- **Fix sugerido:** Reemplazar la acumulación por decimal.js y redondear a 2 decimales antes de responder; neto con Decimal.minus.
- **Nota del verificador:** CONFIRMADO (212-220). Solo lectura, sin persistencia, impacto de presentación sub-centavo — bajo correcto. Mismo defecto que motorizados.ts:152 pero distinto endpoint; no lo fusiono.

#### ⚪ [BAJO · CONFIRMED · Capa 5] Catálogo público expone productos NO publicados cuando el tenant no tiene ninguno publicado
- **Ubicación:** `backend/server.ts:7373`
- **Qué pasa:** Si el tenant no ha publicado productos, el fallback hace un segundo findMany SIN filtro isPublished y devuelve TODO el catálogo (nombre, precio, descripción, imagen) a un endpoint sin auth.
- **Escenario de fallo:** GET /api/public/catalog/:slug de un negocio sin productos publicados: products.length===0 dispara el fallback (7373-7382) que expone públicamente productos internos/borrador.
- **Fix sugerido:** No revelar no publicados: si no hay publicados devolver lista vacía con mensaje ('catálogo en construcción') en vez de exponer todo el inventario.
- **Nota del verificador:** CONFIRMADO (7371-7382). El primer findMany filtra isPublished:true (7363); el fallback lo omite (7375). Endpoint sin authenticate. bajo correcto: información sensible pero acotada al catálogo del propio tenant y solo cuando 0 publicados.

#### ⚪ [BAJO · CONFIRMED · Capa 5] Crear/editar motorizados y resetear su PIN de login sin control de rol (checkRole)
- **Ubicación:** `backend/routes/motorizados.ts:96`
- **Qué pasa:** POST /api/v1/motorizados (38) y PATCH /api/v1/motorizados/:id (77) solo usan authenticate (sin checkRole); cualquier usuario autenticado del tenant puede crear repartidores y fijar/resetear el PIN de acceso a la Driver App.
- **Escenario de fallo:** Un usuario de bajo privilegio (p.ej. cajero) llama PATCH /api/v1/motorizados/:id con { pin:'1234' } (96-100): resetea el PIN de un repartidor de la flota propia (pinHash, línea 100) y obtiene credenciales de la Driver App (marcar entregas, ver liquidaciones/wallet) sin ser dueño/admin.
- **Fix sugerido:** Aplicar checkRole (OWNER/ADMIN) a POST y PATCH de /api/v1/motorizados, en especial al reseteo de PIN.
- **Nota del verificador:** CONFIRMADO factualmente: ambos handlers usan solo authenticate. MITIGANTE que acota el blast radius: el PATCH está scopeado al tenant (findFirst con tenantId, 84-85), así que un usuario NO puede tocar riders de otro tenant, solo de su propia flota. El defecto es de granularidad de autorización intra-tenant (todo usuario autenticado = admin de flota). Depende de si el modelo de roles pretende restringir a cajeros; dado que CLAUDE.md menciona checkRole como estándar para endpoints sensibles, la ausencia es un gap real. bajo correcto.

### Sync / Offline (PWA)

_10 accionables · 0 descartados_

#### 🔴 [CRÍTICO · CONFIRMED · Capa correctitud] Venta a crédito sincronizada offline pierde la cuenta por cobrar (se registra como pagada)
- **Ubicación:** `backend/routes/sync.ts:130`
- **Qué pasa:** Para CREDIT el sync pone status='CREDIT_PENDING' pero no setea Sale.balance ni dueDate, no incrementa Customer.currentDebt, y crea un Payment por el total; además omite validación de creditLimit/isBlocked.
- **Escenario de fallo:** Venta a crédito offline sincronizada: Sale.balance queda en default 0 (schema.prisma:503), currentDebt del cliente sin cambio, y un Payment por amount=sale.total (130-137). /api/credits/debtors filtra paymentMethod:'CREDIT' AND balance:{gt:0} (server.ts:5150-5155) → la venta NUNCA aparece en deudores ni en el estado de cuenta, y el negocio no cobra ese dinero.
- **Fix sugerido:** Reflejar executeSale para CREDIT: validar cliente tenant-scoped, isBlocked y creditLimit; setear Sale.balance=total y dueDate; incrementar customer.currentDebt; NO crear Payment por el total en ventas a crédito. Idealmente delegar en executeSale.
- **Nota del verificador:** Confirmado punto por punto: sync.ts:91-107 no incluye balance (schema default 0) ni dueDate; no hay tx.customer.update de currentDebt; Payment se crea incondicional por sale.total (130-137); no hay chequeo de creditLimit/isBlocked (online sí, salesService.ts:156-185). El debtors endpoint (server.ts:5154 balance:{gt:0}) confirma que la CxC queda invisible. Pérdida de dinero silenciosa en operación normal. critico correcto.

#### 🟠 [ALTO · CONFIRMED · Capa 1] Sync offline inyecta shiftId de otro tenant en la venta → contamina el arqueo y dispara falsa alerta de robo en el tenant víctima
- **Ubicación:** `backend/routes/sync.ts:101`
- **Qué pasa:** POST /api/sales/sync escribe Sale.shiftId directo del payload sin validar propiedad ni estado del turno, a diferencia del POS online que hace findFirst({id, tenantId, status:'OPEN'}).
- **Escenario de fallo:** Usuario del Tenant A envía sale con shiftId = cuid del turno ABIERTO del Tenant B y paymentMethod:'CASH'. Se crea Sale{tenantId:A, shiftId:B, total:999999}. El incremento de caja (254-258) es tenant-scoped → no-op (no error). Al cerrar B su turno (server.ts:1704 include sales:true SIN filtro de tenant) o abrir monitor (server.ts:1863) la relación shift.sales carga la venta de A → cashSales infla expectedCash (1716) → difference muy negativo → AuditLog THEFT_ALERT falso contra el cajero de B (1765-1784).
- **Fix sugerido:** Validar el turno como el online: const shift = await tx.shift.findFirst({where:{id: sale.shiftId, tenantId: callerTenantId, status:'OPEN'}}); si viene shiftId y shift es null → status 'failed' y continue. Defensa en profundidad: filtrar la relación con include:{sales:{where:{tenantId: authReq.tenantId}}} en server.ts:1704 y 1863.
- **Nota del verificador:** Defecto confirmado leyendo el código: sync.ts:101 no valida propiedad ni estado del turno (el online sí, salesService.ts:131-136) y los lectores server.ts:1704 (sales:true) y 1863 cargan shift.sales SIN where de tenant. Baja severidad de critico a alto: la ruta pura cross-tenant exige adivinar un cuid opaco de un turno ABIERTO ajeno y el incremento de caja cross-tenant es no-op; pero la violación de aislamiento (capa 1) es incondicional y también permite adjuntar la venta a un turno propio ya CERRADO (no se chequea status), por lo que el impacto de corrupción de arqueo es real. Corregir.

#### 🟠 [ALTO · CONFIRMED · Capa 3] Las ventas sincronizadas offline no escriben AuditLog (asimetría con el POS online)
- **Ubicación:** `backend/routes/sync.ts:271`
- **Qué pasa:** El $transaction de sync crea Sale/SaleItem/Payment/Kardex/caja/asiento contable pero nunca escribe un AuditLog, a diferencia del online (salesService.ts:324-337).
- **Escenario de fallo:** El PWA sincroniza N ventas offline; cada una persiste con su asiento contable (recordSale crea JournalEntry, NO AuditLog). Para TODA venta de origen offline la tabla AuditLog queda sin la fila SALE_CREATED que el online sí escribe. Un operador puede canalizar ventas por la cola offline para no dejar rastro en AuditLog.
- **Fix sugerido:** Antes de return newSale (271), dentro del $transaction: await tx.auditLog.create({data:{tenantId: callerTenantId, userId: req.userId, action:'SALE_CREATED', details: JSON.stringify({saleId, offlineId, total, source:'OFFLINE_SYNC', itemCount, paymentMethod})}}).
- **Nota del verificador:** Confirmado: no existe ninguna llamada a auditLog.create en sync.ts; recordSale solo crea JournalEntry. El online sí lo escribe (salesService.ts:324-337). Violación de capa 3. Nota: el userId del AuditLog debe salir de req.userId (JWT), no de sale.userId (ver hallazgo #7).

#### 🟠 [ALTO · CONFIRMED · Capa 5] El total de la venta se toma del payload del cliente sin recomputar en el servidor
- **Ubicación:** `backend/routes/sync.ts:96`
- **Qué pasa:** sale.total (cliente) se persiste tal cual en Sale.total (95), Payment.amount (133), incremento de caja (257) y asiento contable (267), sin recomputarlo desde los ítems.
- **Escenario de fallo:** Dispositivo autenticado/PWA manipulado envía total=0 con items reales: se escribe Sale.total=0, Payment.amount=0, no incrementa systemExpectedCash, recordSale con total=0, pero SÍ decrementa stock. La mercadería sale del inventario con cero ingreso y cero efectivo esperado: faltante invisible en el corte Z y en el libro fiscal.
- **Fix sugerido:** Recomputar el total autoritativamente en el servidor desde items (precio*cantidad*descuentos) con decimal.js, como executeSale; nunca persistir el total del payload.
- **Nota del verificador:** Confirmado: sync.ts usa sale.total en 95/133/257/267 sin recomputar. El online documenta 'el caller NUNCA provee el total' y lo recalcula con Decimal (salesService.ts:139-149). Severidad alto adecuada (roza critico combinado con la ausencia de Zod: permite shrinkage de inventario con ingreso cero).

#### 🟠 [ALTO · CONFIRMED · Capa 5] userId de auditoría (cobro y Kardex) se toma del payload, no del JWT
- **Ubicación:** `backend/routes/sync.ts:135`
- **Qué pasa:** collectedBy del Payment (135), userId de cada KardexMovement (211/230/246) y userId del asiento (recordSale, 265) usan sale.userId del payload; el endpoint nunca lee req.userId.
- **Escenario de fallo:** Usuario del tenant envía sale.userId con el id de otro empleado. El servidor atribuye el cobro, todos los Kardex y el asiento contable a ese id, ignorando el usuario autenticado por JWT. La pista de auditoría queda falsificada: un fraude puede endosarse a un empleado inocente.
- **Fix sugerido:** Usar req.userId (JWT) para collectedBy, para el userId de KardexMovement y para recordSale; ignorar sale.userId del payload.
- **Nota del verificador:** Confirmado: sync.ts nunca lee req.userId (solo req.tenantId en línea 46); usa sale.userId en 135/211/230/246/265. authenticate sí popula req.userId (disponible, sin usar). Violación de capa 5 / integridad de auditoría.

#### 🟠 [ALTO · CONFIRMED · Capa 5] req.body sin validación Zod: cantidad negativa infla stock, enums libres y array sin tope
- **Ubicación:** `backend/routes/sync.ts:45`
- **Qué pasa:** El body se castea sin Zod (solo se verifica que sales sea array no vacío); quantity, paymentMethod y el tamaño del lote no se validan.
- **Escenario de fallo:** Con item.quantity=-5, línea 159 calcula delta=-effectiveQty=+5; applyStockDelta con delta>0 entra en la rama increment (stockService.ts:64) y AUMENTA el stock en 5, con un Kardex 'SALE' de cantidad positiva. paymentMethod es cadena libre (cae en la rama de contado) y sales[] no tiene tope (N transacciones → DoS).
- **Fix sugerido:** Validar el body con Zod antes de procesar: quantity positiva, price>=0, paymentMethod enum, items.min(1) y sales.max(N); rechazar con 400 ante fallo de parseo. El online ya usa CreateSaleSchema.
- **Nota del verificador:** Confirmado: sync.ts:45-50 solo hace Array.isArray+length. Traza de inflación de stock verificada: quantity=-5 → delta=+5 → stockService.ts:57-64 rama increment (where sin gte, data increment:delta). paymentMethod string libre y sin sales.max. El online valida todo con CreateSaleSchema (salesService.ts:65-86). Severidad alto adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] COGS de ventas offline se calcula con float nativo (Number + *), no con decimal.js, y se postea sin redondear al libro contable
- **Ubicación:** `backend/routes/sync.ts:151`
- **Qué pasa:** costTotal se acumula con aritmética JS nativa sobre Number(p.cost) (116,140,151) y se pasa sin redondear a recordSale (268), a diferencia del online que usa Decimal y toDecimalPlaces(2).
- **Escenario de fallo:** Venta offline con cost=0.10 y qty=3: linea 151 costTotal += 0.10*3 = 0.30000000000000004 (float). Con varios items el error de punto flotante se acumula y se asienta como Costo de Ventas 5.1.1 / Inventario 1.1.4 en recordSale.
- **Fix sugerido:** Como salesService.ts: Map con new Decimal(p.cost) (116), costTotal = new Decimal(0) (140), costTotal.plus(costD.mul(effectiveQty)) (151), y pasar costTotal.toDecimalPlaces(2).toNumber() a recordSale (268). Importar Decimal.
- **Nota del verificador:** Confirmado: offline usa Number/float (116,140,151,268), online usa Decimal (salesService.ts:231,259,316). Es violación de capa 4 (CLAUDE.md prohíbe Number/parseFloat en montos). Severidad medio correcta: mitigado en parte porque en recordSale ambas líneas (5.1.1 debe y 1.1.4 haber) usan el MISMO costTotal → el asiento queda cuadrado, y las columnas Decimal redondean al persistir; el ruido es sub-centavo pero real y divergente del gemelo online.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] createdAt del cliente sin validar permite antedatar ventas; rompe el orden cronológico de facturas
- **Ubicación:** `backend/routes/sync.ts:105`
- **Qué pasa:** createdAt se toma del string del cliente y se pasa a new Date() sin validación, mientras el invoiceNumber se toma de la serie viva actual.
- **Escenario de fallo:** El cliente envía createdAt con fecha de un mes ya cerrado (o futura). El servidor persiste esa fecha en Sale (105) pero asigna invoiceNumber correlativo del momento del sync (85). Factura #101 fechada antes que la #100 → rompe la correlatividad cronológica exigida por DGI y ensucia el libro de ventas y reportes que agrupan por Sale.createdAt.
- **Fix sugerido:** Acotar createdAt: <= ahora y dentro de una ventana/periodo abierto; rechazar o marcar para revisión las fechas fuera de rango.
- **Nota del verificador:** Código confirmado: sync.ts:105 usa new Date(sale.createdAt) sin validar; invoiceNumber sale de la serie viva (85). PERO la sub-afirmación de 'ventas caen en periodos contables cerrados corrompiendo el mayor' está MITIGADA: recordSale→createJournalEntry NO recibe date, usa new Date() (accounting.ts:147), así assertPeriodOpen valida contra la fecha de sync (abierta) y el asiento cae en el periodo actual, no en el cerrado. El impacto real se reduce a la cronología de facturas y a reportes de ventas que filtran por Sale.createdAt. Por eso severidad medio (no critico).

#### 🟡 [MEDIO · CONFIRMED · Capa 1] Service Worker cachea todas las respuestas /api/ sin scoping por tenant/usuario ni invalidación en logout
- **Ubicación:** `vite.config.ts:50`
- **Qué pasa:** runtimeCaching aplica NetworkFirst a cualquier /api/ y guarda respuestas autenticadas en un Cache Storage compartido por origen (10 min, 50 entradas), sin partición por tenant/sesión ni limpieza al cerrar sesión.
- **Escenario de fallo:** Terminal POS compartida: usuario A del tenant X trabaja y su app cachea /api/ en 'nortex-api-cache'. A cierra sesión, B inicia; dentro de los 10 min, si la red está lenta u offline (>5s timeout), la app de B sirve datos de negocio de A desde caché. El logout (utils/auth.ts) no limpia el cache.
- **Fix sugerido:** No cachear en runtime respuestas autenticadas de /api/ (o excluir endpoints sensibles), limpiar 'nortex-api-cache' (caches.delete) en handleAuthError/logout, y/o particionar por tenant/sesión.
- **Nota del verificador:** Config confirmada: vite.config.ts:47-57 NetworkFirst sobre /^https?:\/\/.*\/api\// en cache compartido, 10 min. Confirmado además que utils/auth.ts (logout/handleAuthError) solo hace localStorage.removeItem y NUNCA caches.delete → el cache persiste tras cambio de usuario. Severidad medio: la fuga entre usuarios está condicionada a offline/red lenta dentro de la ventana de 10 min (NetworkFirst normalmente sirve fresco de red), pero el gap de config (sin partición ni purga en logout) es un defecto real y confirmado.

#### ⚪ [BAJO · CONFIRMED · Capa 1] Sync offline persiste customerId y employeeId del payload sin verificar propiedad del tenant (FK cross-tenant colgante)
- **Ubicación:** `backend/routes/sync.ts:99`
- **Qué pasa:** Sale.customerId (99) y Sale.employeeId (100) se toman crudos del payload sin comprobar pertenencia a callerTenantId; hoy las lecturas conocidas filtran por tenantId, pero se planta una FK cross-tenant.
- **Escenario de fallo:** Tenant A sincroniza una venta con customerId/employeeId de Tenant B. La Sale queda con tenantId=A apuntando a registros de B. No hay fuga inmediata (debtors filtra por tenant, groupBy por employeeId filtra por tenant), pero cualquier query futura que joinee por customerId/employeeId sin filtro de tenant filtraría la venta de A en la vista de B.
- **Fix sugerido:** Resolver customerId/employeeId con findFirst({where:{id, tenantId: callerTenantId}}) dentro de la tx y setear null (o rechazar) si no pertenecen.
- **Nota del verificador:** Código confirmado: sync.ts:99-100 no valida propiedad. Severidad bajo correcta: sin ruta de lectura vulnerable confirmada. Matiz importante: NO es una asimetría real con el online — salesService.ts:210-211 tampoco valida propiedad de customerId (para no-CREDIT) ni de employeeId; es un gap compartido de defensa en profundidad, no exclusivo del sync.

### Admin / SuperAdmin / Team / Tenant

_9 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] Payout de dinero real al repartidor sin asiento de auditoría del actor (SUPER_ADMIN)
- **Ubicación:** `backend/server.ts:4619`
- **Qué pasa:** El endpoint de payout debita el wallet del repartidor (dinero que sale) pero no escribe ningún AuditLog ni registra el userId del SUPER_ADMIN que lo autorizó.
- **Escenario de fallo:** Un SUPER_ADMIN (o token comprometido) hace POST /api/admin/motorizados/:id/wallet/payout {amount:5000}. Se resta 5000 y se crea un DriverWalletMovement type='PAGO_NORTEX' amount=-5000 (firmado, inmutable), PERO ni el modelo ni el input llevan actor/userId y el handler no crea AuditLog. Ante un payout fraudulento la forense ve el movimiento pero no puede atribuirlo a un usuario.
- **Fix sugerido:** Dentro del mismo $transaction, agregar prisma.auditLog.create({ data:{ tenantId, userId: req.userId!, action:'DRIVER_PAYOUT', details:`Payout C$${monto} al repartidor ${driver.nombre} (${driver.id})` }}); idealmente añadir performedByUserId a DriverWalletMovement e incluirlo en los campos firmados.
- **Nota del verificador:** Confirmado: el handler 4601-4642 no llama auditLog.create (contraste directo con /loans/approve que sí lo hace en 4859). DriverMovementInput (ledger.ts:193-201) y driverMovementSignedFields (204-224) no tienen campo de actor; el modelo DriverWalletMovement (schema:1391-1411) no tiene columna userId. Money-out sin trazabilidad de actor = violación real de Capa 3; severidad alto justificada.

#### 🟠 [ALTO · CONFIRMED · Capa correctitud] Aprobación de préstamo B2B siempre falla: accessor Prisma mal escrito (tx.b2bOrder en vez de tx.b2BOrder)
- **Ubicación:** `backend/server.ts:4846`
- **Qué pasa:** El endpoint /api/admin/loans/approve usa tx.b2bOrder (undefined) en lugar de tx.b2BOrder, por lo que la transacción siempre lanza TypeError y el desembolso nunca ocurre.
- **Escenario de fallo:** El modelo es B2BOrder → delegate b2BOrder (usado bien en 1162, 4660, 4819, 4881). En 4846 tx.b2bOrder es undefined; tx.b2bOrder.update(...) lanza 'Cannot read properties of undefined'. Como la callback es async (tx: any) (4844), tsc no lo detecta. Al aprobar una solicitud desde SuperAdmin.tsx la tx revienta, cae al catch y responde 500; la orden nunca pasa a APPROVED y el wallet nunca recibe fondos.
- **Fix sugerido:** Cambiar tx.b2bOrder por tx.b2BOrder en 4846. Tipar la callback como async (tx: Prisma.TransactionClient) para que tsc capture este typo.
- **Nota del verificador:** Confirmado con evidencia fuerte: schema:709 model B2BOrder; delegate Prisma correcto b2BOrder usado en 1162/4660/4819/4881; solo 4846 escribe b2bOrder (minúsculas), que no existe → undefined. callback (tx:any) en 4844 impide detección por tsc. Feature de aprobar préstamos B2B rota en producción. Severidad alto correcta.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] El fee del adelanto de salario se calcula con aritmética JS nativa (float), no con decimal.js
- **Ubicación:** `backend/server.ts:7156`
- **Qué pasa:** En POST /api/me/advance el monto se toma con Number() y el fee se calcula con `monto * 0.05` (float nativo) para persistirse como dinero real que se descuenta de la nómina.
- **Escenario de fallo:** Un colaborador solicita un adelanto con amount='333.33'. Línea 7146 `monto = Number('333.33')`; línea 7151 el límite `Number(emp.baseSalary) * 0.30` se compara en float; línea 7156 persiste `fee: 333.33 * 0.05 = 16.6665` en SalaryAdvance.fee. Ese fee es dinero real que luego se deduce de la nómina, calculado con float nativo violando el estándar decimal.js.
- **Fix sugerido:** Calcular con decimal.js: `const monto = new Decimal(String(req.body?.amount))`, `const max = new Decimal(emp.baseSalary.toString()).times('0.30')`, `fee: monto.times('0.05').toDecimalPlaces(2)`, y comparar con `.gt()/.lte()`.
- **Nota del verificador:** Confirmado leyendo 7146-7156: monto=Number(amount), max=Number(baseSalary)*0.30, fee=monto*0.05. Todo float sobre dinero. La columna SalaryAdvance.fee es Decimal(10,2) (schema:1136), así que el valor persistido se redondea a 2 decimales, pero el estándar del loop (Capa 4: cero Number en montos) igual se viola. Severidad medio es adecuada; el impacto real por solicitud es de centavos.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Desembolso de préstamo al wallet del tenant con Number(amount) en vez de decimal.js
- **Ubicación:** `backend/server.ts:4855`
- **Qué pasa:** En POST /api/admin/loans/approve el crédito se abona al wallet del tenant con `walletBalance: { increment: Number(amount) }`, tomando amount crudo de req.body sin Zod ni decimal.js.
- **Escenario de fallo:** El SUPER_ADMIN aprueba un préstamo con body {orderId, amount}. Línea 4855 incrementa tenant.walletBalance con Number(amount): dinero gastable convertido a float antes de persistir en la columna Decimal, y amount llega crudo del cliente (sin Zod ni tope), así que un valor con muchos decimales o notación exponencial se acredita tal cual.
- **Fix sugerido:** Validar amount con Zod (positivo, escala 2) y usar decimal.js: `increment: new Decimal(String(amount)).toDecimalPlaces(2)`. Idealmente derivar el monto de order.total en lugar del body.
- **Nota del verificador:** El código en 4855 usa Number(amount) sobre dinero (Capa 4 violada) y amount viene sin validación (solo `if(!orderId\|\|!amount)` en 4839). IMPORTANTE: actualmente esta línea es INALCANZABLE porque la línea 4846 (tx.b2bOrder) lanza TypeError antes y aborta la tx — ver hallazgo del typo. El defecto de precisión es real pero solo se materializará una vez corregido el accessor.

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Payout al repartidor: monto y chequeo de sobregiro con Number()/float en vez de decimal.js
- **Ubicación:** `backend/server.ts:4617`
- **Qué pasa:** En POST /api/admin/motorizados/:id/wallet/payout el monto se toma con Number() y la protección de sobregiro compara `Number(driver.walletBalance) < monto` en float, luego persiste `amount: -monto`.
- **Escenario de fallo:** El SUPER_ADMIN registra un pago con amount='49.999' contra un driver con walletBalance=50.00. Línea 4604 monto=Number('49.999'); línea 4617 la comparación float `50 < 49.999` pasa el chequeo; línea 4624 pasa amount:-49.999 que la columna Decimal(12,2) redondea a -50.00 al persistir. El control de sobregiro validó 49.999 pero el libro se debita 50.00.
- **Fix sugerido:** Usar decimal.js: `const monto = new Decimal(String(amount)).toDecimalPlaces(2)`, comparar `new Decimal(driver.walletBalance.toString()).lt(monto)` y pasar el monto ya redondeado (negado) al movimiento.
- **Nota del verificador:** Confirmado 4604/4617/4624. appendDriverWalletMovement (ledger.ts:199) recibe amount como number (float) y lo pasa directo a create sobre Decimal(12,2) (schema:1397). El desajuste chequeo-vs-débito por subredondeo es real. Severidad medio adecuada.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Aprobación de préstamo sin guarda de idempotencia ni validación del monto → doble desembolso al corregir el typo
- **Ubicación:** `backend/server.ts:4836`
- **Qué pasa:** /api/admin/loans/approve no verifica que la orden esté en PENDING antes de incrementar walletBalance y no valida que amount sea decimal positivo, de modo que una segunda llamada sobre la misma orden vuelve a acreditar dinero.
- **Escenario de fallo:** El update fija status:'APPROVED' incondicionalmente (sin filtrar status actual) y luego increment: Number(amount). Corregido el accessor (hallazgo anterior), un doble clic/reintento sobre el mismo orderId ejecuta el increment dos veces: el tenant recibe crédito duplicado. Además amount se toma de req.body sin Zod: negativo resta del wallet, y no numérico → Number(amount)=NaN corrompe/tumba el update.
- **Fix sugerido:** Leer la orden dentro de la tx y abortar si status !== 'PENDING' (idempotencia). Validar amount con Zod como Decimal(18,4) > 0. Considerar tomar el monto autorizado de la propia orden en lugar del body.
- **Nota del verificador:** Confirmado: 4839 solo hace `if(!orderId\|\|!amount)` (no Zod, no escala/positividad); 4846-4850 update pone status:'APPROVED' sin where de status (no idempotente). El AuditLog de 4859 existe pero solo guarda un string de detalle, sin before/after estructurado del wallet, así que la observación del candidato es correcta. Latente: hoy no se ejecuta por el typo de 4846, pero es defecto real una vez corregido. Nota: NaN no llega al update de la orden porque `!amount` con amount NaN... en realidad Number('abc')=NaN pero el guard usa el amount crudo del body ('abc' es truthy) → pasaría el guard y Number('abc')=NaN llegaría al increment; el punto se sostiene.

#### 🟡 [MEDIO · CONFIRMED · Capa 5] /api/tenant/slug sin checkRole: cualquier rol autenticado fija un slug público INMUTABLE del tenant
- **Ubicación:** `backend/server.ts:7272`
- **Qué pasa:** El endpoint que configura el slug público del negocio (inmutable una vez seteado) solo usa authenticate, sin checkRole, a diferencia de los endpoints hermanos /api/tenant/fiscal e /api/tenant/inventory-settings que sí exigen ADMIN/OWNER.
- **Escenario de fallo:** Un usuario de bajo privilegio del mismo tenant (CASHIER/VIEWER/EMPLOYEE) llama PUT /api/tenant/slug {slug:'lo-que-sea'}. authenticate no aplica barrera de rol, así que persiste. Como el código bloquea cambios posteriores (7294-7298 'ya está configurado y no puede ser cambiado'), un cajero deja fijado permanentemente un slug incorrecto/ofensivo para el catálogo público (/pedidos/<slug>) y el dueño no puede cambiarlo salvo intervención en BD.
- **Fix sugerido:** Agregar checkRole(['ADMIN','OWNER']) al endpoint, igual que /api/tenant/fiscal y /api/tenant/inventory-settings.
- **Nota del verificador:** Confirmado: 7272 solo authenticate; los hermanos en 5519 y 5540 llevan checkRole(['ADMIN','OWNER']). La inmutabilidad del slug (7294) convierte un mal set en permanente. Inconsistencia de autorización real; severidad medio adecuada.

#### ⚪ [BAJO · CONFIRMED · Capa 4] KPIs financieros de plataforma (MRR/wallet/intereses) calculados con aritmética JS nativa
- **Ubicación:** `backend/server.ts:4690`
- **Qué pasa:** En GET /api/admin/stats el total de wallets, el platformFee (2%) y el interestIncome (5%) se calculan sumando/multiplicando montos con float nativo y Math.round en vez de decimal.js.
- **Escenario de fallo:** El panel SuperAdmin abre stats: 4685 totalWallet suma Number(t.walletBalance) con + nativo; 4690-4693 platformFee=Math.round(monthlySales*0.02*100)/100 e interestIncome=Math.round(totalDebtLent*0.05*100)/100. Con muchos tenants/montos grandes, la acumulación float y Math.round introducen error de centavos en las cifras mostradas al CEO.
- **Fix sugerido:** Acumular y multiplicar con decimal.js y exponer .toNumber() solo al serializar el JSON.
- **Nota del verificador:** Confirmado 4685/4690-4693. Es solo reporte (no mueve dinero), por eso bajo es correcto. Instancia real de aritmética de dinero fuera del estándar.

#### ⚪ [BAJO · CONFIRMED · Capa 5] Email reservado de SUPER_ADMIN no se bloquea en el registro (defensa en profundidad)
- **Ubicación:** `backend/server.ts:223`
- **Qué pasa:** SUPER_ADMIN_EMAILS está hardcodeado en auth.ts y otorga bypass total en authenticate por el email del JWT, pero /api/auth/register solo rechaza el email si ya existe una cuenta, sin reservar explícitamente ese correo privilegiado.
- **Escenario de fallo:** authenticate (auth.ts:73) da bypass total a cualquier token cuyo email esté en SUPER_ADMIN_EMAILS ('noelpinedaa96@gmail.com', auth.ts:19). register (server.ts:228-231) solo valida existingUser por email. En una BD fresca/restaurada donde esa cuenta aún no exista, un atacante registra ese correo, obtiene un JWT con ese email y consigue control SUPER_ADMIN sobre TODOS los tenants. El único candado actual es 'el email ya está tomado'.
- **Fix sugerido:** Rechazar explícitamente en /api/auth/register (y en el accept de invitación) cualquier email incluido en SUPER_ADMIN_EMAILS, y provisionar la cuenta de super admin por seed controlado.
- **Nota del verificador:** Confirmado: bypass por email en auth.ts:73 (y requireSuperAdmin en 138); register en 228-231 solo chequea existingUser, sin reservar el correo privilegiado. Es un hueco real de defensa en profundidad que depende de que la cuenta ya exista para estar mitigado; severidad bajo correcta. No verifiqué el flujo de aceptar invitación (no incluido en el candidato), pero el register queda confirmado.

### Auditoría (AuditLog) — capa transversal 3

_17 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] POST /api/payments mueve Sale.balance y deuda del cliente sin AuditLog
- **Ubicación:** `backend/server.ts:1614`
- **Qué pasa:** El abono a una venta crea Payment, reduce Sale.balance y decrementa Customer.currentDebt dentro de una $transaction que no escribe ningún AuditLog.
- **Escenario de fallo:** Un cajero registra POST /api/payments {saleId, amount:5000} contra una venta a crédito: se marca PAID y baja la deuda del cliente C$5000, pero se embolsa el efectivo. No queda asiento inmutable con userId/before/after. Es el mismo vector que SÍ está cubierto en /api/credits/payment pero sobre este endpoint paralelo aún sin cubrir.
- **Fix sugerido:** Dentro del $transaction (1614-1633) agregar tx.auditLog.create con action 'PAYMENT_APPLIED', userId, tenantId y details {saleId, amount, balanceBefore: sale.balance, balanceAfter: newBalance, method}, igual que /api/credits/payment (5378).
- **Nota del verificador:** CONFIRMADO leyendo 1602-1636 y grep de auditLog.create. La tx (1614-1633) crea Payment, actualiza Sale.balance/status y Customer.currentDebt sin ningún auditLog. Verificado que /api/credits/payment SÍ escribe tx.auditLog.create action 'CREDIT_PAYMENT' con balanceBefore/After (5378-5391): la asimetría es real. Alto justificado (movimiento de dinero/deuda sin traza inmutable).

#### 🟠 [ALTO · CONFIRMED · Capa 3] POST /api/returns revierte inventario y deuda sin AuditLog
- **Ubicación:** `backend/server.ts:1524`
- **Qué pasa:** La devolución crea ProductReturn, restaura stock (kardex RETURN), decrementa Customer.currentDebt y postea asiento contable dentro de una $transaction, pero no escribe ningún AuditLog before/after.
- **Escenario de fallo:** Un empleado procesa POST /api/returns de una venta a crédito por C$8000: el stock vuelve, la deuda baja C$8000 y se registra la nota de crédito, sin efectivo real devuelto. Solo queda un KardexMovement con referenceType='RETURN', que detectSuspiciousKardex ni siquiera marca porque su filtro es type IN ['ADJUSTMENT','OUT'] (audit.ts:93). No hay asiento inmutable con userId ni before/after de la deuda.
- **Fix sugerido:** Agregar tx.auditLog.create dentro del $transaction (antes del return, 1588) con action 'RETURN_PROCESSED' y details {saleId, returnId, returnTotal, costTotal, items, debtBefore/debtAfter si aplica}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 1507-1596 y grep. La tx (1524-1589) no contiene auditLog; recordReturn (1585) es solo asiento contable (JournalEntry), no AuditLog. Verificado además que audit.ts:90-99 filtra type IN ['ADJUSTMENT','OUT'] → el kardex type 'RETURN' (1558) NO entra al detector, confirmando el punto ciego forense. Alto justificado.

#### 🟠 [ALTO · CONFIRMED · Capa 3] POST /api/purchases mueve inventario, costo promedio y wallet sin AuditLog
- **Ubicación:** `backend/server.ts:3631`
- **Qué pasa:** El registro de compra incrementa stock, recalcula el costo promedio ponderado (Product.cost), decrementa Tenant.walletBalance y crea Expense dentro de una $transaction sin escribir ningún AuditLog.
- **Escenario de fallo:** Un admin registra POST /api/purchases de contado con unitCost inflado a un proveedor cómplice: el wallet se debita el total, se crea Expense y —más grave— el costo promedio ponderado sube (3696-3706), contaminando COGS y utilidad futura de todas las ventas. No queda AuditLog con userId/before/after del costo ni del walletBalance.
- **Fix sugerido:** Dentro del $transaction (3631-3777) agregar tx.auditLog.create action 'PURCHASE_CREATED' con details {purchaseId, supplierId, total, walletBefore/walletAfter, y por producto costBefore/costAfter, stockBefore/stockAfter}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 3624-3790 y grep. La tx recalcula costo promedio (3696-3706), debita wallet (3753-3756) y crea Expense (3766-3773) sin ningún auditLog. Alto justificado por la contaminación de COGS + drenaje de billetera no auditables.

#### 🟠 [ALTO · CONFIRMED · Capa 3] POST /api/hrm/settlement/:employeeId paga liquidación laboral sin AuditLog
- **Ubicación:** `backend/server.ts:6940`
- **Qué pasa:** La liquidación crea TerminationSettlement (aguinaldo+vacaciones+indemnización), postea el asiento contable de pago y termina al empleado dentro de una $transaction sin escribir AuditLog.
- **Escenario de fallo:** Un contador liquida a un empleado con salarioMensual/vacationDays inflados: se genera un totalAmount (indemnización de decenas de miles de C$) y se postea el pago, pero no queda AuditLog inmutable con userId, montos y before/after del saldo de vacaciones. La operación es irreversible (empleado TERMINATED, vacationDays a 0) y solo hay un intento por empleado.
- **Fix sugerido:** Agregar tx.auditLog.create dentro del $transaction (6940-6973) con action 'SETTLEMENT_PROCESSED' y details {settlementId, employeeId, reason, aguinaldo, vacaciones, indemnizacion, total, vacationDaysBefore: employee.vacationDays, salarioMensual}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 6913-6981 y grep. El endpoint SÍ tiene checkRole(['OWNER','ADMIN','ACCOUNTANT']) (6914) — eso es Capa 5, correcto — pero la tx (6940-6973) no escribe AuditLog; recordSettlement (6955) es solo JournalEntry. Hallazgo de Capa 3 CONFIRMADO. Alto justificado por irreversibilidad y monto.

#### 🟠 [ALTO · CONFIRMED · Capa 5] Endpoints forenses /api/audit/* accesibles a cualquier rol autenticado (sin checkRole)
- **Ubicación:** `backend/server.ts:6731`
- **Qué pasa:** Los cuatro dashboards forenses del dueño (/api/audit/feed 6731, /kardex-suspicious 6744, /voided-movements 6759, /discounts 6774) solo usan authenticate y no checkRole, exponiendo la inteligencia antifraude del tenant a CASHIER/EMPLOYEE/VIEWER.
- **Escenario de fallo:** Un CASHIER autenticado hace GET /api/audit/discounts y /api/audit/voided-movements y recibe el reporte forense completo del tenant: nombres de cajeros, montos anulados, descuentos y niveles de riesgo con sus umbrales (audit.ts:210,301). El cajero aprende exactamente qué dispara las alertas y se mantiene bajo umbral, evadiendo la detección; además ve la actividad de sus compañeros.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN']) a los cuatro endpoints (incluir 'ACCOUNTANT' sólo donde el diseño lo requiera).
- **Nota del verificador:** CONFIRMADO leyendo 6730-6786: los cuatro endpoints declaran solo (authenticate, async...) sin checkRole. Contrastado con settlement/payroll/aguinaldo/stock-count que sí usan checkRole, confirmando la inconsistencia. Es info-disclosure read-only intra-tenant; alto es defendible por tratarse de inteligencia antifraude expuesta a los propios vigilados, aunque medio también sería sostenible.

#### 🟠 [ALTO · CONFIRMED · Capa 5] /api/audit-logs expone la bitácora inmutable completa a roles de baja confianza
- **Ubicación:** `backend/server.ts:1988`
- **Qué pasa:** GET /api/audit-logs solo aplica authenticate; cualquier usuario autenticado del tenant obtiene los últimos 50 asientos del AuditLog (acciones, detalles, userId de toda operación de dinero/inventario/usuarios).
- **Escenario de fallo:** Un usuario CASHIER/EMPLOYEE/VIEWER hace GET /api/audit-logs con su token y recibe la bitácora inmutable del tenant: todas las acciones registradas con detalles y el userId responsable (THEFT_ALERT, SURPLUS_ALERT, ajustes, pagos, etc.). Fuga de la traza de control interna hacia roles operativos que no deberían ver la actividad de otros usuarios.
- **Fix sugerido:** Agregar checkRole(['OWNER','ADMIN']) al endpoint (1988), consistente con el resto de endpoints de reportes/administración.
- **Nota del verificador:** CONFIRMADO leyendo 1988-1994: solo (authenticate, ...), findMany del auditLog filtrado por tenantId pero sin restricción de rol. Alto defendible por la sensibilidad del contenido (userId + acciones de todas las operaciones de dinero, incl. alertas de robo).

#### 🟡 [MEDIO · CONFIRMED · Capa 4] Libros fiscales DGI (Ventas/Compras/VET) calculan IVA y totales con float + toFixed en vez de decimal.js
- **Ubicación:** `backend/server.ts:7778`
- **Qué pasa:** Los tres endpoints /api/fiscal/* que alimentan la pestaña 'Exportaciones DGI' re-derivan subtotal/IVA con división de punto flotante (total/1.15), .toFixed(2) y parseFloat, y suman la fila TOTALES con reduce((s,r)=>s+r,0) nativo, violando el estándar de precisión (cero Number/parseFloat/toFixed en montos).
- **Escenario de fallo:** Un tenant con cientos de ventas del mes descarga el Libro de Ventas (subtotal/iva en 7778-7779, totales reduce 7797-7799), el Libro de Compras ('Neto Pagado' = parseFloat((total-ir-imi).toFixed(2)) en 7867, totales reduce 7874-7879) o el archivo VET (subtotal/iva 7937-7938, salida .toFixed 7945). El IVA y los totales se recalculan en float independientemente del IVA que el ERP calculó con decimal.js al momento de la venta; la acumulación de redondeos toFixed por línea más la suma flotante de la fila TOTALES pueden desviar el IVA declarado en centavos respecto al mayor contable, de modo que la VET no reconcilia con los libros.
- **Fix sugerido:** Derivar subtotal/IVA con decimal.js (new Decimal(total).div(new Decimal(1).plus(IVA_RATE)).toDecimalPlaces(2)) y acumular los totales con Decimal (.plus en el reduce). Idealmente tomar el IVA ya persistido por venta en lugar de re-derivarlo.
- **Nota del verificador:** CONFIRMADO leyendo 7775-7970. Libro Ventas: Number(s.total) 7777, parseFloat(...toFixed) 7778-7779, reduce nativo 7797-7799. Libro Compras: Number en 7852-7855, parseFloat(...toFixed) 7867, reduce nativo 7874-7879. VET: parseFloat(...toFixed) 7937-7938, subtotal.toFixed/iva.toFixed/total.toFixed en salida 7945/7958. Violación clara de Capa 4. Medio es apropiado por el riesgo fiscal DGI.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] POST /api/purchases/:id/pay drena el wallet sin AuditLog
- **Ubicación:** `backend/server.ts:3815`
- **Qué pasa:** El pago de una cuenta por pagar decrementa Tenant.walletBalance, marca la compra COMPLETED y crea un Expense dentro de una $transaction sin escribir AuditLog.
- **Escenario de fallo:** Un usuario ejecuta POST /api/purchases/:id/pay: el walletBalance baja en purchase.total y se crea un Expense PAGO_PROVEEDOR, pero no queda asiento inmutable con userId/before/after del saldo.
- **Fix sugerido:** Dentro del $transaction (3815-3837) agregar tx.auditLog.create action 'PURCHASE_PAID' con details {purchaseId, invoiceNumber, total, walletBefore/walletAfter}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 3797-3845 y grep. La tx (3815-3837) actualiza purchase.status, decrementa tenant.walletBalance (3823-3826) y crea Expense sin ningún auditLog. Medio apropiado.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] POST /api/payroll/:id/pay paga nómina sin AuditLog
- **Ubicación:** `backend/server.ts:4221`
- **Qué pasa:** El pago de nómina marca Payroll PAGADO, crea Expense por el neto, postea asientos de nómina/provisión y acumula vacaciones dentro de una $transaction sin escribir AuditLog.
- **Escenario de fallo:** Un admin paga una nómina con netSalary manipulado: se registra el Expense y el asiento de caja por el neto, pero no queda AuditLog con userId ni los montos (neto, INSS, IR, patronal) ni before/after del estado.
- **Fix sugerido:** Dentro del $transaction (4221-4264) agregar tx.auditLog.create action 'PAYROLL_PAID' con details {payrollId, employeeId, month, year, netSalary, inssLaboral, irLaboral, inssPatronal, inatec, statusBefore: owned.status}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 4201-4272 y grep. Endpoint con checkRole (4202) OK; pero la tx (4221-4264) sólo tiene recordPayroll/recordLaborProvision (JournalEntry) — ningún tx.auditLog.create. Capa 3 CONFIRMADA. Medio apropiado.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] POST /api/payroll/aguinaldo/:year/run paga aguinaldo masivo sin AuditLog
- **Ubicación:** `backend/server.ts:4355`
- **Qué pasa:** La corrida de aguinaldo crea registros Aguinaldo en estado PAGADO y postea el asiento de pago por cada empleado, dentro de $transaction, sin escribir ningún AuditLog.
- **Escenario de fallo:** Un contador corre POST /api/payroll/aguinaldo/:year/run: se generan pagos de aguinaldo para todos los empleados activos y se postean asientos de caja, pero no queda AuditLog con userId/monto por empleado. Un abuso (baseSalary inflado o empleados fantasma) mueve dinero sin traza inmutable del operador.
- **Fix sugerido:** Dentro del $transaction por empleado (4355-4366) agregar tx.auditLog.create action 'AGUINALDO_PAID' con details {aguinaldoId, employeeId, year, diasLaborados, baseSalary, monto}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 4334-4379 y grep. Endpoint con checkRole (4335) OK; la tx por empleado (4355-4366) sólo tiene recordAguinaldoPayment (JournalEntry), sin auditLog. Capa 3 CONFIRMADA. Medio apropiado.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] POST /api/stock-counts/:id/close aplica merma valorizada sin AuditLog
- **Ubicación:** `backend/server.ts:3256`
- **Qué pasa:** El cierre de toma física ajusta el stock de libro contra el conteo (ADJUST_LOSS/ADJUST_GAIN), calcula merma/sobrante valorizado y postea el asiento contable, pero no escribe AuditLog.
- **Escenario de fallo:** Un admin cierra una toma física con conteos manipulados a la baja: el stock se ajusta a ADJUST_LOSS, se reconoce una pérdida valorizada (lossValue·costo) y se postea el asiento, pero el inventario robado queda 'blanqueado' como merma. Solo hay KardexMovement; no hay AuditLog inmutable con userId, lossValue/gainValue y el resumen de ajustes.
- **Fix sugerido:** Dentro del $transaction (antes del return, 3331) agregar tx.auditLog.create action 'STOCK_COUNT_CLOSED' con details {countId, adjusted, countedItems, lossValue, gainValue}, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 3248-3349 y grep. Endpoint con checkRole(['OWNER','ADMIN']) (3249) OK; la tx (3256-3339) escribe kardex (3300) y recordStockCountAdjustment (3322, JournalEntry) pero ningún auditLog. Capa 3 CONFIRMADA. Medio apropiado.

#### 🟡 [MEDIO · CONFIRMED · Capa 3] POST /api/inventory/adjust audita solo ADJUST_LOSS, no ADJUST_GAIN
- **Ubicación:** `backend/server.ts:2869`
- **Qué pasa:** El ajuste manual de inventario escribe AuditLog solo cuando movementType es ADJUST_LOSS; los ADJUST_GAIN (que inflan el inventario valorizado) no dejan asiento de auditoría.
- **Escenario de fallo:** Un admin ejecuta POST /api/inventory/adjust con type 'ADJUST_GAIN' y quantity grande para inflar el stock de un producto (que luego vende/roba, o para maquillar faltantes previos): el stock sube y sube el valor del inventario en el balance, pero el bloque de auditoría (2869) solo dispara para ADJUST_LOSS. El aumento manual de inventario no queda en AuditLog.
- **Fix sugerido:** Mover el tx.auditLog.create fuera del if (movementType==='ADJUST_LOSS') para que cubra todo ajuste manual (LOSS y GAIN), con action 'INVENTORY_ADJUSTMENT' variando details.direction, stockBefore/stockAfter, quantity, reason, userId, tenantId.
- **Nota del verificador:** CONFIRMADO leyendo 2802-2896. Línea 2869 'if (movementType === \'ADJUST_LOSS\')' encapsula el único tx.auditLog.create (2870-2886); ADJUST_GAIN crea kardex (2854) pero no AuditLog. Cobertura asimétrica confirmada. Medio apropiado.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Descargas fiscales DGI (Libro Ventas/Compras/VET) rotas: <a href download> sin cabecera Authorization
- **Ubicación:** `components/AuditDashboard.tsx:202`
- **Qué pasa:** La pestaña 'Exportaciones DGI' descarga /api/fiscal/libro-ventas\|libro-compras\|vet-export vía anchors <a href download> (202, 215, 228) que no envían el JWT, pero esos endpoints exigen Bearer en el header (authenticate).
- **Escenario de fallo:** El dueño/contador hace clic en 'Libro de Ventas': el navegador navega a /api/fiscal/libro-ventas/:mes/:año como descarga por <a href>, sin cabecera Authorization (el token vive en localStorage). El middleware authenticate exige token en req.headers.authorization (auth.ts:48-61) → 401. Idéntico para libro-compras y vet-export. Los tres exportables de cumplimiento DGI quedan inutilizables desde la UI.
- **Fix sugerido:** Descargar vía fetch(url, { headers: { Authorization: `Bearer ${token}` } }) y generar un blob URL, o que los endpoints /api/fiscal/* acepten un token corto firmado por query param.
- **Nota del verificador:** CONFIRMADO leyendo AuditDashboard.tsx 201-238 (tres <a href={`/api/fiscal/...`} download> sin JS) y auth.ts 48-61 (authenticate lee EXCLUSIVAMENTE req.headers.authorization; sin authHeader → 401, sin fallback a cookie). La navegación nativa del anchor no puede adjuntar el header. Medio apropiado (funcionalidad de cumplimiento tributario rota, sin impacto de seguridad).

#### ⚪ [BAJO · CONFIRMED · Capa 1] POST /api/purchases confía supplierId del body sin verificar propiedad del tenant (fuga de datos de proveedor de otro tenant)
- **Ubicación:** `backend/server.ts:3670`
- **Qué pasa:** El endpoint de compras usa supplierId tomado directamente de req.body en purchase.create sin validar que el proveedor pertenezca a req.tenantId, y devuelve el proveedor en la respuesta (include: { supplier: true }).
- **Escenario de fallo:** Un usuario del tenant A que conozca el cuid de un proveedor del tenant B envía POST /api/purchases con supplierId=<proveedor de B>. Los productos SÍ se validan por tenant (findFirst con tenantId, línea 3641-3643) pero supplierId (3670) no. Se crea una Purchase de A que referencia al proveedor de B; la respuesta (result → include supplier, 3684 + res.json 3782) devuelve al tenant A los datos del proveedor de B (name, ruc, contactName, phone, email, address). Queda además una referencia cruzada permanente en las cuentas por pagar de A. Barrera: cuid aleatorio de 25 caracteres no enumerable.
- **Fix sugerido:** Antes de crear la compra, validar propiedad dentro de la tx: const supplier = await tx.supplier.findFirst({ where: { id: supplierId, tenantId: authReq.tenantId! } }); if (!supplier) throw new Error('Proveedor no encontrado');
- **Nota del verificador:** CONFIRMADO leyendo 3630-3685. Productos validados por tenant (3641-3643); supplierId inyectado crudo en data.supplierId (3670) sin ninguna consulta de propiedad. include: { supplier: true } (3684) y res.json(result) (3782) exponen la PII del proveedor de B → es una lectura cross-tenant real, no solo referencial. Severidad bajo es defendible por el cuid no enumerable; se podría argumentar medio por tratarse de fuga de PII cross-tenant en la respuesta.

#### ⚪ [BAJO · CONFIRMED · Capa 1] POST /api/capital/finance-purchase confía supplierId (y productId de items) del body sin verificar el tenant
- **Ubicación:** `backend/server.ts:6606`
- **Qué pasa:** El endpoint de financiamiento de compra crea Purchase con supplierId de req.body sin validar que el proveedor sea del tenant, y almacena items[].productId del body sin verificar que los productos pertenezcan al tenant.
- **Escenario de fallo:** Un usuario del tenant A envía POST /api/capital/finance-purchase con supplierId=<proveedor del tenant B> e items con productId ajenos. No hay ninguna consulta que valide supplierId ni productId contra authReq.tenantId (a diferencia de /api/purchases, aquí ni siquiera los productos se validan). Se crea Purchase + CapitalLoan vinculados que referencian entidades del tenant B, dejando referencias cruzadas persistentes. No hay fuga directa en la respuesta porque productName viene del body (6618) y el objeto purchase se crea sin include de supplier.
- **Fix sugerido:** Validar propiedad dentro de la transacción: supplier vía tx.supplier.findFirst({ where: { id: supplierId, tenantId } }) y cada item vía tx.product.findFirst({ where: { id: i.productId, tenantId } }); rechazar (404/400) si alguno no pertenece al tenant.
- **Nota del verificador:** CONFIRMADO leyendo 6600-6663. supplierId inyectado crudo (6606); items.map usa i.productId/i.productName del body (6616-6622) sin validar tenant. No se valida propiedad de proveedor ni de producto. La compra se crea sin include, así que no hay fuga de PII en la respuesta — el impacto es puramente referencial (rompe aislamiento y ensucia cuentas por pagar/reportes). Bajo es correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 4] El motor forense de Auditoría suma dinero con Number() y += nativo (float) para clasificar riesgo
- **Ubicación:** `backend/services/audit.ts:198`
- **Qué pasa:** analyzeVoidedMovements y analyzeDiscounts acumulan montos con aritmética JS nativa sobre Number() (totalAmountVoided += Math.abs(Number(mov.amount)) en 198; totalDiscountGiven += Number(sale.globalDiscount) en 293) y comparan esos totales contra umbrales de dinero, en lugar de decimal.js.
- **Escenario de fallo:** Con muchos movimientos anulados/descuentos cercanos a los umbrales (totalAmountVoided >= 5000 en 210, totalDiscountGiven > 10000 en 301), el error de punto flotante acumulado puede dejar el total apenas por debajo/encima del umbral y NO marcar (o marcar de más) el riesgo HIGH/MEDIUM, degradando la señal antifraude del panel forense.
- **Fix sugerido:** Acumular con decimal.js (totalAmountVoided = totalAmountVoided.plus(new Decimal(mov.amount).abs())) y comparar los umbrales con Decimal, eliminando Number()/+= sobre montos.
- **Nota del verificador:** CONFIRMADO leyendo 184-306. Línea 198 += Math.abs(Number(mov.amount)); línea 293 += Number(sale.globalDiscount); comparaciones de umbral de dinero en 210 (>=5000/>=2000) y 301 (>10000/>3000). Es Capa 4 pero de bajo impacto real: el drift flotante que cruce exactamente un umbral es diminuto. Bajo es correcto.

#### ⚪ [BAJO · CONFIRMED · Capa 5] Query params startDate/endDate de /api/audit/* sin validación (Zod) causan 500 con fecha inválida
- **Ubicación:** `backend/server.ts:6748`
- **Qué pasa:** Los endpoints /api/audit/kardex-suspicious (6748), /voided-movements (6763) y /discounts (6778) hacen new Date(req.query.startDate) sin validar, incumpliendo el estándar Zod de CLAUDE.md.
- **Escenario de fallo:** GET /api/audit/kardex-suspicious?startDate=abc produce new Date('abc') = Invalid Date (objeto truthy), que fluye a dateFilter.gte y luego a Prisma como date: { gte: Invalid Date }; Prisma lanza error de argumento inválido capturado por el catch → 500 'Error al analizar kardex' en lugar de un 400 claro. Sin fuga ni pérdida de dinero, pero es entrada no validada (Capa 5).
- **Fix sugerido:** Validar los query params con Zod (p.ej. z.coerce.date().optional()) y responder 400 ante fechas inválidas antes de consultar Prisma.
- **Nota del verificador:** CONFIRMADO leyendo 6743-6786 (server) y audit.ts 86-99/165-179/235-243. new Date(req.query.startDate) sin validación en 6748/6763/6778; el Invalid Date truthy activa el filtro dateFilter.gte y se pasa a Prisma → error → catch → 500. Bajo correcto (feed en 6731 no toma query params, no afectado).

### Integraciones (Stripe / WhatsApp / Email)

_7 accionables · 0 descartados_

#### 🟠 [ALTO · CONFIRMED · Capa 3] El webhook de Stripe activa/renueva/cancela suscripciones (dinero real) sin dejar ningún AuditLog
- **Ubicación:** `backend/services/stripe.ts:136`
- **Qué pasa:** handleWebhookEvent muta el estado de cobro del tenant (ACTIVE, +30 dias, CANCELLED, PAST_DUE) ante eventos de pago reales de Stripe pero no escribe AuditLog; solo console.log.
- **Escenario de fallo:** checkout.session.completed (L136-143) activa +30 dias, invoice.paid (L162-168) renueva +30 dias, customer.subscription.deleted (L180-186) cancela, invoice.payment_failed (L202-205) marca PAST_DUE. Ninguno escribe auditLog.create. Si un evento se reprocesa, un bug flipea a CANCELLED, o (con el bypass de firma del hallazgo #3) llega un evento falsificado, no queda rastro forense de que cambio, cuando ni por que valor. La via manual (server.ts L5037-5057) SI envuelve tenant.update + auditLog.create('MANUAL_PAYMENT_APPROVED') en un $transaction; la via automatica principal no deja nada.
- **Fix sugerido:** Para cada caso que mueve valor, leer estado previo del tenant y envolver tenant.update + auditLog.create en un $transaction, con action tipada (SUBSCRIPTION_ACTIVATED/RENEWED/CANCELLED/PAST_DUE), tenantId, before/after y event.id de Stripe (idempotencia). Como el webhook no tiene req.userId, usar un userId de sistema o volver AuditLog.userId nullable.
- **Nota del verificador:** Verificado: los 4 case de handleWebhookEvent (stripe.ts L128-210) solo hacen prisma.tenant.update + console.log, sin auditLog. Contraste confirmado en server.ts L5049-5056 (el approve manual SI audita dentro de $transaction). Severidad alto sostenida: CLAUDE.md marca Capa 3 como OBLIGATORIA para movimientos de dinero y esta es la via principal de ingreso, con cero trazabilidad.

#### 🟠 [ALTO · CONFIRMED · Capa 5] Webhook de Stripe acepta eventos SIN verificar firma cuando el secret está vacío o es el placeholder
- **Ubicación:** `backend/server.ts:135`
- **Qué pasa:** /api/billing/webhook cae a un modo dev que hace JSON.parse del body sin validar firma si STRIPE_WEBHOOK_SECRET no está seteado o quedó en el placeholder.
- **Escenario de fallo:** Con STRIPE_WEBHOOK_SECRET='' (por el \|\| '') o el literal 'whsec_REEMPLAZAR_CON_TU_WEBHOOK_SECRET', la rama else (L137-141) construye el evento con JSON.parse(req.body.toString()) sin verificar stripe-signature. El endpoint se monta en L124, ANTES del globalLimiter de L177, asi que no tiene rate-limit. Un atacante POSTea {type:'checkout.session.completed', data:{object:{metadata:{tenantId:'<suyo>'}, subscription:'sub_fake'}}} -> su tenant queda ACTIVE +30 dias; o forja customer.subscription.deleted con el tenantId de un competidor y le cancela la suscripcion. Sin autenticacion. Precondicion: getStripe() no nulo (STRIPE_SECRET_KEY con sk_).
- **Fix sugerido:** Eliminar la rama dev. Exigir STRIPE_WEBHOOK_SECRET presente y verificar SIEMPRE con stripe.webhooks.constructEvent; si falta el secret, hard-fail al arrancar (misma regla que 'JWT secret nunca con fallback literal'). Nunca aceptar eventos sin firma.
- **Nota del verificador:** Verificado server.ts L135-141: la condicion excluye '' y el placeholder exacto, y el else parsea sin verificar firma (solo console.warn). Ruta registrada en L124 antes del globalLimiter (L170-177) -> sin rate limit. getStripe() (stripe.ts L17,24) exige sk_ para no ser null, por lo que el ataque requiere key real + webhook secret vacio/placeholder: es un estado de config parcial realista que el codigo habilita silenciosamente. Alto correcto (roza critico si se despliega con el placeholder por defecto).

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Reintento del webhook de WhatsApp nunca reenvía la respuesta tras un fallo de red en sendText
- **Ubicación:** `backend/services/whatsapp/inbound.ts:92`
- **Qué pasa:** El entrante se persiste (dedupe por waMessageId @unique) ANTES de sendText/persistir salida, asi que si sendText o la $transaction fallan, el reintento choca con P2002 y retorna sin volver a responder.
- **Escenario de fallo:** processInboundJob crea el WhatsAppMessage IN (L36-46), corre el agente y llama channel.sender.sendText (L92). Si Meta da un 5xx/red transitorio, sendText lanza -> el job lanza -> InMemoryQueue.run reintenta (maxRetries:2, queue.ts L56-59). En el reintento, prisma.whatsAppMessage.create del entrante tira P2002 (ya existe) y hace return (L48-51): NUNCA se reintenta el envio, el cliente se queda sin respuesta y el fallo queda silencioso. La cola aporta cero resiliencia al paso de envio.
- **Fix sugerido:** Separar idempotencia de persistencia del entrante del envio: marcar el inbound como 'respondido' solo tras enviar, y en el reintento, si existe pero no fue respondido, continuar el pipeline en vez de return. Alternativa: encolar el envio como job propio idempotente por waMessageId de salida.
- **Nota del verificador:** Verificado inbound.ts: create del entrante en L36 es la primera op de DB; P2002 -> return en L48-51; sendText en L92 despues. queue.ts L52-63 confirma que run() reintenta llamando de nuevo al handler completo, que vuelve a chocar con P2002 y retorna antes de enviar. Medio correcto: no hay perdida de dinero ni cross-tenant, pero es un drop silencioso de respuesta al cliente ante fallo transitorio de envio.

#### 🟡 [MEDIO · CONFIRMED · Capa correctitud] Invalidación de caché de tenant se omite en invoice.paid / invoice.payment_failed (metadata del invoice sin tenantId)
- **Ubicación:** `backend/server.ts:147`
- **Qué pasa:** Tras el webhook, la invalidacion lee event.data.object.metadata?.tenantId, pero los objetos Invoice de Stripe no llevan ese metadata (solo checkout session/subscription), asi que en renovaciones y pagos fallidos no se invalida la cache.
- **Escenario de fallo:** Llega invoice.paid de una renovacion: handleWebhookEvent resuelve el tenant por stripeSubscriptionId y actualiza ACTIVE + subscriptionEndsAt (stripe.ts L153-168). En server.ts L147-149, obj.metadata?.tenantId es undefined (el Invoice no hereda el metadata de la subscription; el codigo solo setea metadata en checkout/subscription_data, stripe.ts L84-91), por lo que invalidateTenantCache no se llama. El tenant se sirve de cache con estado viejo (PAST_DUE o endsAt vencido) hasta que expire, pese a haber pagado. Igual en invoice.payment_failed.
- **Fix sugerido:** Que handleWebhookEvent devuelva el tenantId afectado (que ya resuelve por stripeSubscriptionId) y usar ese valor para invalidateTenantCache, en vez de depender de event.data.object.metadata.tenantId, que solo existe para checkout.session.completed.
- **Nota del verificador:** Verificado server.ts L146-149 (lee obj.metadata?.tenantId generico) contra stripe.ts: invoice.paid (L149-172) y invoice.payment_failed (L192-209) resuelven por stripeSubscriptionId, no por metadata; el metadata.tenantId solo se setea en checkout session y subscription_data (stripe.ts L84-91), nunca en el Invoice. checkout.session.completed SI invalida (su object es la session con metadata). Medio correcto: staleness de cache tras pago/fallo, sin corrupcion de datos.

#### ⚪ [BAJO · CONFIRMED · Capa 4] Aritmética nativa de punto flotante sobre dinero al calcular crédito disponible (WhatsApp)
- **Ubicación:** `backend/services/whatsapp/tools.ts:80`
- **Qué pasa:** El crédito disponible del cliente se calcula con resta nativa de JS sobre valores Decimal convertidos con Number(), en lugar de decimal.js.
- **Escenario de fallo:** En consultar_deuda, currentDebt y creditLimit se convierten a number en L78-79 (Number(customer.currentDebt) / Number(customer.creditLimit)) y se restan en float nativo: Math.max(0, limit - debt) en L80. Violacion de Capa 4. Hoy la salida pasa por money() con toFixed(2) que enmascara el error ~1e-13, pero el patron es latente si se reutiliza en una ruta que mueva/compare dinero. Mismo patron en L102 (Number(agg._sum.total)) y en money() L33.
- **Fix sugerido:** Operar con decimal.js: new Decimal(customer.creditLimit).minus(customer.currentDebt) con clamp via .lessThan(0); money() aceptar Decimal y formatear con .toFixed(2) del propio Decimal; reemplazar Number() de L102 y de rag.ts L100.
- **Nota del verificador:** Verificado leyendo tools.ts L78-80 (Number()+resta nativa), L102 (Number(agg._sum.total)) y money() L33 (n.toFixed(2)); rag.ts L100 confirma Number(r.price). Severidad bajo correcta: flujo de solo lectura, money() redondea la salida a 2 decimales y el approve no depende de este valor. Es una violacion real de Capa 4 aunque hoy sin impacto en el centavo mostrado.

#### ⚪ [BAJO · CONFIRMED · Capa 5] /api/billing/report-manual sin validación Zod ni de signo del monto, y usa Number() para dinero
- **Ubicación:** `backend/server.ts:4960`
- **Qué pasa:** El endpoint valida presencia con if(!amount \|\| !bank ...) pero no valida tipo/positividad con Zod y guarda amount: Number(amount), permitiendo montos negativos, NaN o strings.
- **Escenario de fallo:** Un tenant autenticado envia {amount:'-500', bank:'BAC', referenceNumber:'x'}. !amount es false (string no vacio), pasa la guarda (L4960), y Number('-500')=-500 se persiste en ManualPayment.amount (L4976); o amount:'abc' -> Number('abc')=NaN que Prisma Decimal rechaza con 500 no controlado. El monto no condiciona los 30 dias del approve (L5034), pero queda en el AuditLog ($${payment.amount}, L5054) con un valor manipulado, ensuciando la evidencia contable.
- **Fix sugerido:** Validar req.body con Zod (amount z.number().positive() o Decimal via decimal.js, currency enum, referenceNumber string acotado) y rechazar antes de crear el registro.
- **Nota del verificador:** Verificado server.ts L4956-4983: guarda if(!amount \|\| !bank \|\| !referenceNumber) sin Zod ni chequeo de positividad; amount: Number(amount) en L4976 (Capa 4 + Capa 5). El endpoint SI tiene authenticate (L4956). referenceNumber se coacciona con String() (L4979). Bajo correcto: impacto acotado a integridad de dato/auditoria, el monto es informativo y el super admin revisa antes de aprobar; el approve otorga 30 dias fijos independientes del monto.

#### ⚪ [BAJO · CONFIRMED · Capa correctitud] Aprobación de pago manual: chequeo de estado PENDING fuera de la transacción (TOCTOU)
- **Ubicación:** `backend/server.ts:5030`
- **Qué pasa:** Se lee el pago y se verifica status !== 'PENDING' fuera del $transaction, y el update dentro no filtra por status, por lo que dos aprobaciones concurrentes del mismo pago pueden ejecutarse ambas.
- **Escenario de fallo:** Doble clic sobre 'aprobar' el mismo manualPayment. Ambas requests leen status=PENDING en L5030-5032 antes de que ninguna escriba, y ambas ejecutan el $transaction (L5037-5057): dos entradas AuditLog 'MANUAL_PAYMENT_APPROVED' para el mismo pago y tenant.update dos veces, contaminando la auditoria inmutable.
- **Fix sugerido:** En la transaccion usar prisma.manualPayment.updateMany({ where:{ id, status:'PENDING' }, data:{...} }) y abortar si count===0, o releer el pago dentro del $transaction; asi una sola aprobacion gana la carrera.
- **Nota del verificador:** Verificado server.ts L5030-5032 (findUnique + check status FUERA del $transaction) y L5037-5057 (manualPayment.update filtra solo por id, sin status). El TOCTOU existe: duplica el AuditLog. Bajo correcto: subscriptionEndsAt se recomputa como now+30 en cada request (L5034), por lo que NO se acreditan 60 dias (no se apilan); el dano real es entradas de auditoria duplicadas, no perdida de dinero.

## No verificable en este entorno (pendiente de QA en vivo)

Esta auditoría es **estática/de código**. No se pudo levantar el backend (necesita PostgreSQL y `prisma generate`, cuyo engine no se pudo descargar por la política de red del entorno). Por tanto quedan pendientes de verificación funcional en un entorno con base de datos:

- Flujos end-to-end reales (login → venta → asiento contable → cierre de caja).
- Pruebas de concurrencia real (dobles ventas, condiciones de carrera en stock).
- Integraciones externas en vivo (Stripe webhooks, WhatsApp, correo).
- Rendimiento de queries y N+1.

## Metodología

- **15 módulos** derivados del código real (`backend/server.ts` de 8.055 líneas y 173 endpoints, 7 rutas, 13 servicios, 70 modelos Prisma, 55 componentes).
- **5 pasadas por módulo:** 4 lentes de búsqueda en paralelo + 1 verificación adversaria que marca cada hallazgo `CONFIRMED` / `PLAUSIBLE` / `REFUTED` y ajusta severidad.
- Los hallazgos `REFUTED` se conservan (colapsados) para trazabilidad de qué se revisó y por qué se descartó.
