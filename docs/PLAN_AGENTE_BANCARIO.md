# Plan de desarrollo — Módulo Agente Bancario (corresponsalía en Caja/POS)

> Estado: **Fase A en implementación** · Rama `claude/agente-bancario`
> Insumos: investigación de mercado (agentes/corresponsales en Nicaragua) + recon
> técnico del módulo de Caja. Este documento sintetiza ambos y define el roadmap.

## 1. El problema

Muchos clientes de Nortex (ferreterías, pulperías, farmacias, distribuidoras) son
además **agentes bancarios / corresponsales no bancarios**: Agente Banpro (3,600+
puntos), Rapibac (BAC), ServiRED (Lafise), Caja Ficohsa/Avanz vía redes
agregadoras (Puntoxpress, Punto Fácil, AirPak/Western Union). El sector creció
+50% desde 2017 (10,217 corresponsales en 2023).

El POS/Caja de Nortex **no contempla estas operaciones**: hoy un depósito de un
cliente del banco entra a la gaveta sin registro (o se anota en cuaderno aparte),
el arqueo no cuadra, y no hay forma de saber cuánto le debe el negocio al banco
ni cuánto ganó en comisiones.

## 2. Hechos que definen el diseño (de la investigación)

1. **El dispositivo transaccional es del banco/red** (POS del banco o app, en
   línea/tiempo real, exigido por la Norma CD-SIBOIF-827-1-MAR28-2014). Nortex
   registra **en paralelo** (shadow ledger) para cuadrar caja — no ejecuta la
   transacción bancaria. No hay APIs públicas de agente.
2. **Dos saldos espejo**: efectivo físico en gaveta ↔ saldo/float con el banco.
   Un DEPÓSITO del cliente = entra efectivo (IN) y el negocio queda **debiendo**
   al banco; un RETIRO = sale efectivo (OUT) y el banco queda debiendo al negocio.
3. **Nada del monto principal es ingreso** (no es venta, no genera IVA): va a una
   cuenta puente de balance. **Solo la comisión es ingreso**, devengada por
   transacción y liquidada (típicamente mensual) por el banco a la cuenta.
4. **Comisiones y límites NO son públicos en Nicaragua** → configurables por
   convenio × tipo de operación, nunca hardcodeados.
5. **Multi-convenio**: un mismo negocio puede ser Agente Banpro + Rapibac +
   punto Puntoxpress + subagente AirPak a la vez (BDF opera sobre la red Banpro).
6. **El tope real de retiro lo pone la gaveta del negocio** (Banpro lo delega
   explícitamente al comercio) → validar efectivo disponible en cada OUT.
7. **Comprobante**: el voucher del dispositivo del banco es el documento válido →
   guardar su referencia/folio (`externalRef`) para conciliación.
8. **Reversas** son un estado con contrapartida, no un borrado.
9. Operaciones mínimas: depósito, retiro, pago de tarjeta, pago de préstamo,
   pago de servicios (luz/agua/teléfono/cable), recarga, remesa pagada (OUT) /
   enviada (IN). Moneda C$ y US$.

## 3. Qué existe en el código (del recon)

- `CashMovement` (IN/OUT, `category` string libre, moneda NIO/USD) **firmado**
  en un libro encadenado por tenant (`ledger.ts: appendSignedCashMovement`,
  DEBE llamarse dentro de una transacción). El arqueo (`/api/shifts/close`) y el
  balance de caja **suman IN/OUT sin mirar categoría** → una operación de agente
  registrada como CashMovement cuadra el arqueo sin tocar la fórmula.
- Guarda anti-sobregiro para OUT con revalidación `FOR UPDATE` dentro de la tx
  (patrón a replicar; ojo: el raw SQL existente usa comillas dobles estilo
  PostgreSQL — en el código nuevo va con backticks MySQL).
- Contabilidad de partida doble (`accounting.ts`): catálogo NIIF auto-sembrado
  (`createMany skipDuplicates` → cuentas nuevas llegan a tenants viejos sin
  migración) + `createJournalEntry` con validación debe=haber y bloqueo de
  período. Códigos libres: `1.1.7` (activo), `2.1.12` (pasivo), `4.1.4` (ingreso).
- `AuditLog` dentro de la misma transacción (patrón de `POST /api/cash-movements`).
- **No existe nada** de corresponsalía (grep exhaustivo) — campo virgen.
- Gap conocido (no bloquea): los movimientos manuales de caja hoy NO se asientan
  en partida doble (`recordCashIn`/`recordExpense` importados pero nunca
  invocados). El módulo nuevo SÍ cablea sus asientos desde el día 1.

## 4. Diseño (aditivo, sin tocar el core)

### Modelo de datos (nuevo, schema estrictamente aditivo)

- **`AgentAgreement`** (convenio del negocio con un banco/red):
  `tenantId, name ("Agente Banpro"), kind (BANCO | RED_RECAUDADORA | REMESERA),
  active, commissionConfig Json ({ OPERACION: { fija, pct } }),
  settlementBalance Decimal(18,4)` (cuánto le debe el negocio al banco; puede ser
  negativo = el banco le debe al negocio), `commissionAccrued Decimal(18,4)`
  (comisiones devengadas sin liquidar).
- **`AgentTransaction`** (una operación de mostrador):
  `tenantId, agreementId, cashMovementId (1:1 con el CashMovement firmado),
  shiftId, userId, operation, direction (IN|OUT), amount Decimal(18,4), currency,
  commission Decimal(18,4), externalRef (folio del voucher), customerRef?,
  status (COMPLETED | REVERSED), createdAt` + índices
  `[tenantId, createdAt]`, `[agreementId, createdAt]`, `[shiftId]`.

La operación genera SIEMPRE un `CashMovement` firmado con
`category: 'AGENTE_BANCARIO'` → arqueo, balance de caja, panóptico y libro
firmado funcionan **sin cambios**.

### Mapa operación → dirección de efectivo (función pura, testeable)

| Operación | Efectivo | Saldo con el banco |
|---|---|---|
| DEPOSITO, PAGO_TARJETA, PAGO_PRESTAMO, PAGO_SERVICIO, RECARGA, REMESA_ENVIO | IN (entra) | + (debemos más) |
| RETIRO, REMESA_COBRO | OUT (sale) | − (nos deben) |

### Contabilidad (un solo asiento balanceado por transacción, `referenceType: 'AGENT_TX'`)

Cuentas nuevas en `CHART_OF_ACCOUNTS` (auto-siembra):
- `1.1.7 Comisiones por Cobrar Corresponsalía` (ASSET/CURRENT_ASSET)
- `2.1.12 Corresponsalía Bancaria por Liquidar` (LIABILITY/CURRENT_LIABILITY)
- `4.1.4 Comisiones por Corresponsalía` (REVENUE)

- Operación IN: `Debe 1.1.1 Caja / Haber 2.1.12` (monto)
- Operación OUT: `Debe 2.1.12 / Haber 1.1.1` (monto)
- Comisión (si > 0, en el mismo asiento): `Debe 1.1.7 / Haber 4.1.4`

### API (`backend/routes/agentBanking.ts`, montado en `/api/agent-banking`)

| Endpoint | Rol | Qué hace |
|---|---|---|
| `GET /agreements` | autenticado | Lista convenios del tenant |
| `POST /agreements` | OWNER/ADMIN | Crea convenio (Zod) |
| `PATCH /agreements/:id` | OWNER/ADMIN | Activa/desactiva, comisiones (ownership check `findFirst {id, tenantId}`) |
| `POST /transactions` | autenticado + caja abierta | Registra operación: guarda OUT bajo `FOR UPDATE`, `appendSignedCashMovement` + `AgentTransaction` + saldos del convenio + asiento + `AuditLog`, **todo en una `$transaction`** |
| `GET /transactions` | autenticado | Lista paginada (`take`), filtro por convenio |

El router usa el cliente Prisma compartido nuevo `backend/lib/prisma.ts`
(inicia la consolidación SCALING_AUDIT A2 en vez de sumar el cliente #22).

### UI (POS)

Botón **"Agente"** junto a Entrada/Salida (solo con caja abierta) → modal:
convenio, operación, monto, moneda, referencia del voucher, comisión
auto-calculada del convenio (editable). Si no hay convenios y el rol es
OWNER/ADMIN, el modal permite crear el primero (nombre + tipo).

## 5. Roadmap

### Fase A (este PR) — registrar y cuadrar
- Schema aditivo (`AgentAgreement`, `AgentTransaction`) + migración.
- Cuentas contables nuevas + `recordAgentTransaction` en `accounting.ts`.
- `backend/lib/prisma.ts` (cliente compartido) + `routes/agentBanking.ts`.
- Zod schemas + validación de gaveta para OUT (FOR UPDATE, backticks MySQL).
- POS: botón + modal Agente (con quick-create de convenio para admin).
- QA loop: tsc/validate/generate · casos puros en `.cjs` (dirección, comisión,
  saldo espejo) · aislamiento por tenant · build + regresión · prueba en vivo.

### Fase B — conciliar y proteger (en implementación)
- Reversa de operación (estado REVERSED + contrapartida FIRMADA en el turno
  abierto actual — el registro original es inmutable — + saldos y asiento espejo).
- Liquidación de comisiones (el banco paga → `1.1.2 Bancos` contra `1.1.7`).
- Traslado de efectivo caja↔banco como operaciones `LIQUIDACION_ENTREGA` /
  `LIQUIDACION_FONDEO` (solo manager, comisión 0, mismo motor de transacciones).
- Vault "Agente Bancario" separado en el panóptico (`/api/shifts/monitor` +
  `CashRegisters.tsx`) + panel de conciliación con saldos por convenio.
- (Las alertas de gaveta mín/máx se mueven a Fase C: requieren umbrales
  configurables por tenant, que van junto a los límites por operación.)

### Fase C — límites, alertas, reportes y escala
- Límites configurables por convenio × operación (por transacción / por día).
- Alertas de gaveta: mínimo (no poder pagar retiros) y máximo (riesgo de robo,
  sugerir entrega al banco) — umbrales configurables por tenant.
- Reporte de corresponsalía (por convenio: volumen, comisiones, conciliación
  contra liquidación mensual del banco) — agregado en SQL.
- Tipo de cambio por transacción para USD; billetera móvil; multi-caja.

## 6. Fuera de alcance (explícito)
- Integración en línea con APIs de bancos (no existen públicas para agentes).
- Emisión de comprobantes propios (el voucher válido es el del banco).
- Tratamiento fiscal fino de la comisión (IR/IVA) — pendiente de leer la norma
  SIBOIF completa y confirmar con el contador de un cliente real.
