# Plan de desarrollo — Nortex Prestamistas (tenant LENDER)

> Auditoría + roadmap del módulo de préstamos de calle (gota a gota / financiera).
> Todos los hallazgos están **verificados contra el código** (`archivo:línea`), no
> asumidos. El módulo mueve **dinero real** → cada fase se construye con el loop
> `nortex-feature` (recon → rama → implementación → rondas de QA → PR draft) y se
> corrige antes de pushear.

## Diagnóstico ejecutivo

El **motor financiero es sólido** (`backend/routes/loans.ts`): motor dual
francés/flat con `decimal.js`, cobros atómicos con guarda anti-sobrepago,
imputación a cuotas más viejas primero, refinanciamiento con arrastre de saldo y
`AuditLog` en cada movimiento. **El problema está en la periferia**: autorización
por rol incompleta, la pantalla del cobrador está desconectada, el menú lleva a
pantallas de retail que no son del prestamista, faltan índices, y no hay
analítica de cartera — que para un prestamista *es el producto*.

En una frase: **el backend sabe prestar; el producto todavía no sabe mostrarlo ni
protegerlo.**

---

## 1. Inventario — lo que YA existe

### Backend (`backend/routes/loans.ts`, 754 líneas) — 14 endpoints
| Endpoint | Qué hace | Estado |
|---|---|---|
| `POST /` | Originar crédito (motor dual francés/flat) + plan de cuotas + AuditLog | ✅ sólido |
| `POST /:id/repayments` | Registrar cobro (atómico, anti-sobrepago, imputa a cuotas viejas) | ✅ sólido |
| `GET /` | Cartera del inversor (filtra por `assignedToId` si es COLLECTOR) | ⚠️ sin índice/paginación |
| `GET /:id/schedule` | Plan de cuotas real con mora por cuota | ✅ backend — ❌ sin UI |
| `GET /:id/payments` | Historial de pagos (lazy) | ✅ backend — ❌ sin UI |
| `GET /clients` / `PATCH /clients/:id` | CRM + bloquear/límite | ⚠️ sin índice/paginación |
| `POST /route-expenses` / `GET /route-expenses` | Gastos de ruta | ✅ |
| `POST /:id/refinance` | Refinanciar (arrastra saldo) | ✅ motor — ⚠️ sin role gate |
| `POST /:id/penalty` | Aplicar multa | ⚠️ se guarda como Repayment negativo |
| `POST /collectors` | Reclutar cobrador (rol COLLECTOR) | ✅ (único con `checkRole`) |
| `PATCH /:id/assign` | Asignar cobrador a préstamo | ✅ backend — ❌ dropdown vacío |
| `POST /vault/deposit` | Depósito del cobrador a la bóveda | ✅ — ⚠️ sin libro firmado |

### Data model (`backend/prisma/schema.prisma`)
`Loan` · `LoanInstallment` · `Repayment` · `RouteExpense` · `CollectorDeposit`.
(`CapitalLoan` es un sistema **distinto** — Nortex Capital financiando compras de
sus propios tenants; no es el producto prestamista de calle.)

### Frontend
| Pantalla | Rol | Estado |
|---|---|---|
| `LenderMode/LenderDashboard.tsx` (1077 líneas, 5 tabs: Panel, Clientes, Reportes, Tropas, Caja) | Inversor/dueño | ✅ viva, rica |
| `LenderMode/MotorizadosPanel.tsx` (375 líneas: ruta de cobro, offline "modo búnker", recibo WhatsApp) | Cobrador | 🔴 **huérfana / código muerto** |

---

## 2. Hallazgos — priorizados por riesgo × valor

### 🔴 P0 — Seguridad e integridad (arreglar YA)

**H1. El COLLECTOR ve el panel completo del inversor (fuga de información).**
`components/Dashboard.tsx:832` decide solo por `getTenantType() === 'LENDER'`; **no
distingue COLLECTOR**. Como `MotorizadosPanel` está huérfano y el homePath del
cobrador es `/app/dashboard`, un `LENDER_COLLECTOR` recibe el `LenderDashboard`
completo: capital, retorno, CRM, comisiones, bóveda. **Contradice la promesa que
el propio sistema muestra** al reclutar (`LenderDashboard.tsx:962-964`: "el
motorizado tendrá acceso ÚNICAMENTE a la pantalla de cobranza").
*Verificado: `grep` de `MotorizadosPanel` no devuelve referencias fuera de su archivo.*

**H2. Autorización por rol ausente en endpoints de dinero.** Solo `POST /collectors`
tiene `checkRole(['OWNER','ADMIN'])`. **Originar, refinanciar, multar, asignar,
bloquear cliente, cambiar límite de crédito y depósito a bóveda no tienen gate** →
un COLLECTOR autenticado puede llamarlos por API. Combinado con H1 es una brecha
de dos capas (UI + API).

**H3. Cero índices en `Loan` y `Repayment`.** El schema no tiene `@@index` en
`Loan` (la cartera hace `findMany where lenderId orderBy createdAt` + nested
payments por fecha + schedule) ni en `Repayment`. Table-scan garantizado con
cartera real. *Irónicamente `CapitalLoan` sí los tiene* (`schema.prisma:1335-1336`).
Viola el guardrail "índices con cada query" (CLAUDE.md / SCALING_AUDIT).

### 🟠 P1 — Funcionalidad rota (el módulo no cumple lo que promete)

**H4. `MotorizadosPanel` desconectado.** La pantalla del cobrador no está enrutada
en `App.tsx` ni en `Dashboard.tsx`. En la práctica **no hay UI viva para que el
cobrador registre abonos en ruta** (el único consumidor de `POST /:id/repayments`
es este panel huérfano).

**H5. `GET /api/loans/collectors` no existe.** `LenderDashboard.tsx:99`
(`fetchCollectors`) llama un endpoint inexistente → 404 → dropdown "Asignar
cobrador" vacío → **la asignación es inusable** pese a que `PATCH /:id/assign`
funciona. *Verificado: no hay `router.get('/collectors'...)` en `loans.ts`.*

**H6. El dueño no puede registrar un abono desde su panel.** `LenderDashboard` no
llama `POST /:id/repayments`. Si el cliente paga en el local (no en ruta), no hay
dónde registrarlo.

**H7. El menú del prestamista lleva a pantallas de retail.** `utils/navigation.ts:53-58`:
3 de 4 items (`/app/clients`, `/app/reports`, `/app/team`) renderizan los
componentes **genéricos de retail** (`Clients`, `Reports`, `TeamManagement`), que
consultan endpoints de ventas/clientes retail — **no** `/api/loans/*`. Las
pantallas reales del prestamista existen solo como *tabs internas* del dashboard,
inalcanzables desde el menú lateral.

### 🟡 P2 — Precisión y datos

**H8. La mora se calcula "a ojo" en el cliente.** `GET /:id/schedule` devuelve la
mora real por cuota, pero **ningún componente lo consume**; la UI la aproxima por
días transcurridos (`LenderDashboard.tsx:408-409`, `MotorizadosPanel.tsx:221-247`).
Fuente de verdad ignorada → números que no cuadran con el backend.

**H9. La multa se guarda como `Repayment` con `amountPaid` negativo**
(`loans.ts:599-606`). Contamina el historial de pagos y el arqueo diario (un
"cobro" negativo). Debería ser su propio tipo de movimiento.

**H10. El efectivo del prestamista no usa el libro firmado** (`ledger.ts`). Cobros
y depósitos dejan solo `AuditLog`, sin cadena HMAC verificable — a diferencia del
wallet del motorizado de delivery, que sí la tiene.

### 🟢 P3 — Escala y arquitectura

**H11.** `new PrismaClient()` propio en `loans.ts:16` (1 de los 21 del guardrail A2).
**H12.** Sin paginación en `GET /` ni `GET /clients` (`findMany` sin `take`).
**H13.** Sin integración contable (los intereses ganados no llegan a un P&L).
**H14.** Reportes 100% en cliente — no hay endpoint de analítica de cartera.
**H15.** Sin soft-delete (`deletedAt`) — consistente con el resto del sistema.

---

## 3. Lo que FALTA (módulos nuevos)

1. **Pantalla del cobrador enrutada** (conectar `MotorizadosPanel` con gate real).
2. **Cobro manual desde el panel del dueño** (pago en local).
3. **Amortización cuota-a-cuota en UI** (consumir `/:id/schedule`).
4. **Analítica de cartera** (endpoint agregado en SQL): capital colocado, saldo
   vivo, **mora por antigüedad (aging 1-30/31-60/60+)**, interés ganado vs.
   proyectado, tasa de recuperación, rendimiento por cobrador.
5. **Motor de mora automática** (interés/penalidad por atraso configurable, no
   manual) — opcional según el modelo de negocio.
6. **Estado de cuenta del cliente** (PDF/WhatsApp) reutilizando el patrón de
   Cobranza retail.
7. **Contabilidad del prestamista** (interés = ingreso; capital = activo).

---

## 4. Plan por fases (PRs secuenciales, cada uno con loop de QA)

Cada fase = rama `claude/<feature>` desde `origin/main` → implementación aditiva
que no toca el motor de dinero probado → **rondas de QA** (tsc+validate, casos de
lógica pura, aislamiento por tenant/rol, build+regresión) → PR draft con la QA
documentada. Los hallazgos de QA se corrigen antes del push.

### Fase 0 — Blindaje (P0, 1 PR, **primero e innegociable**)
- **H2:** agregar `checkRole(['OWNER','ADMIN'])` a originar, refinanciar, multar,
  asignar, `PATCH /clients/:id` y `vault/deposit`. El COLLECTOR solo conserva
  `POST /:id/repayments` y `POST /route-expenses`.
- **H1:** en `Dashboard.tsx`, si el rol es COLLECTOR → renderizar la pantalla de
  cobranza, nunca el `LenderDashboard`. (Se apoya en la Fase 1 para la pantalla.)
- **H3:** migración aditiva con `@@index([lenderId, status])`, `@@index([lenderId, createdAt])`
  en `Loan` y `@@index([loanId])`, `@@index([paymentDate])` en `Repayment`.
- **QA:** aislamiento por rol probado con un COLLECTOR real (skill `run-nortex`);
  `prisma validate`; regresión de que el dueño sigue pudiendo todo.
- **Aceptación:** un COLLECTOR autenticado recibe 403 en originar/refinanciar/
  multar; la cartera consulta usa índice (`EXPLAIN`).

### Fase 1 — Conectar al cobrador (P1, 1 PR)
- **H4/H1:** enrutar `MotorizadosPanel` (ruta propia `/app/ruta` o gate en
  `Dashboard`); el COLLECTOR aterriza ahí y **solo** ahí.
- **H8:** que el panel del cobrador consuma `GET /:id/schedule` (mora real) en vez
  de calcularla a ojo.
- **QA:** login como COLLECTOR → ve ruta, registra abono, no ve capital/CRM;
  screenshots antes/después (`run-nortex`).

### Fase 2 — Cerrar los huecos del panel del dueño (P1, 1 PR)
- **H5:** crear `GET /api/loans/collectors` (tenant-scoped) → arreglar el dropdown
  de asignación.
- **H6:** botón "Registrar abono" en el `LenderDashboard` (pago en local).
- **H8:** tab/expandible de amortización consumiendo `/:id/schedule`.
- **H7:** apuntar los items del menú LENDER a las pantallas reales (o convertir las
  tabs del dashboard en rutas) para que el menú lateral llegue a ellas.

### Fase 3 — Analítica de cartera (P3→valor, 1 PR)
- **H14/H12:** endpoint `GET /api/loans/analytics` que **agrega en SQL** (no trae
  filas y suma en JS): capital colocado, saldo vivo, **aging de mora**, interés
  ganado, recuperación, ranking de cobradores. Paginar `GET /` y `GET /clients`.
- Reemplazar los cálculos en cliente de la tab Reportes por este endpoint.

### Fase 4 — Integridad financiera (P2, 1 PR)
- **H9:** modelar la multa como movimiento propio (no Repayment negativo).
- **H10:** enganchar cobros y depósitos al libro firmado (`ledger.ts`).
- **H13:** postear interés (ingreso) y capital (activo) a contabilidad si el
  prestamista tiene plan de cuentas.
- **H11:** consolidar al cliente Prisma compartido.

### Fase 5 (opcional) — Mora automática y estado de cuenta
- Motor de penalidad por atraso configurable; estado de cuenta PDF/WhatsApp.

---

## 5. Alcance negativo (qué NO se toca)
- El **motor de cálculo** (francés/flat, imputación, guarda anti-sobrepago) está
  probado y auditado: se le agregan gates e índices **alrededor**, no se reescribe.
- `CapitalLoan` (Nortex Capital) es otro subsistema — fuera de este plan.
- No se introduce dependencia nueva; el bundle del SPA está al límite del PWA.

## 6. Métricas de éxito
- Un COLLECTOR no puede, ni por UI ni por API, ver capital/CRM ni originar/refinanciar.
- La cartera y los clientes paginan y usan índice (sin table-scan).
- La mora que ve el dueño == la que calcula el backend (una sola fuente de verdad).
- El dashboard de Reportes sale de un endpoint agregado, no de sumar filas en el navegador.
- El cobrador registra abonos desde una pantalla viva, con mora real y modo offline.

---

*Auditoría verificada contra el código el 2026-07 · método `nortex-feature` +
`nortex-security-audit`. Los ítems P0 (H1-H3) son prerequisito de todo lo demás.*
