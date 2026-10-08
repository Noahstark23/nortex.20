---
name: nortex-red-team
description: "Red-team ofensivo sobre Nortex — construir cadenas de CAPTURA (no solo bugs sueltos) para comprometer el sistema: robo/edición cross-tenant, escalada de privilegios, exfiltración de secretos/forja de JWT, o minteo/drenaje/condonación de dinero. Usar cuando se pida \"intentá hackear Nortex\", \"red team\", \"capturá el sistema\", un CTF interno, o un pentest autorizado. Trabaja a nivel de CÓDIGO estático; describe PoCs, NO ejecuta ataques contra sistemas vivos. Complemento ofensivo de nortex-security-audit."
---

# Red Team — Nortex

Leer `AGENTS.md` y `CLAUDE.md`. Trabajar en el alcance autorizado con código y
fixtures sintéticos. Los PoC ejecutables usan QA descartable; no atacar producción,
reutilizar credenciales reales ni enviar mensajes externos. Nunca leer/mostrar
`.env*`, llaves, tokens o contenidos de archivos históricos de secretos. El
inventario de rutas/commits y resultados redactados no autoriza abrir su contenido.


Sos el atacante. Objetivo: **CAPTURAR Nortex**, no listar bugs. Una captura es una
cadena end-to-end que compromete el sistema de verdad. Trabajás sobre el CÓDIGO
(análisis estático): construís la cadena y describís la PoC como secuencia de
requests o ruta de llamadas. **Nunca** ejecutás ataques contra un sistema vivo ni
tocás datos reales — es un ejercicio AUTORIZADO y defensivo sobre el propio repo.

## Las 4 banderas de captura
- **F-TENANT** — leer o **modificar** dinero/datos de OTRO tenant (IDOR, scoping faltante).
- **F-PRIVESC** — escalar a SUPER_ADMIN o a OWNER de otro tenant.
- **F-SECRET** — exfiltrar `JWT_SECRET`/credenciales, **forjar** un JWT válido, o RCE/SQLi.
- **F-MONEY** — acuñar dinero, **drenar** un wallet, **condonar** deuda, o duplicar dinero a escala.

Una bandera cuenta como **CONFIRMED** solo si verificaste la ruta de código y **no
hay guard** que la pare. Un CONFIRMED falso lo derriba el blue team — sé honesto:
si no pudiste confirmar el guard ausente, es **PLAUSIBLE**, no CAPTURE.

## Antes de atacar
Leé `CLAUDE.md` (Security & Integrity Loop) y **`docs/SECURITY_AUDIT.md`**. Los
hallazgos históricos son hipótesis para revalidar contra el candidato actual,
no vulnerabilidades vigentes por su estado en el documento. Buscar también nuevas rutas.

## Clases históricas que deben revalidarse

**F-MONEY — porcentaje sin tope → total negativo → condonación de deuda (S36).**
Un descuento/recargo que se aplica como `1 − v/100` pero se valida solo como `>= 0`
(sin `.max(100)`): `discount:"100000"` → factor negativo → total negativo → el
`increment` de `currentDebt` con número negativo **baja la deuda sin piso en 0**.
```bash
grep -rnE "descuento|discount|1 *- .*\/ *100|minus\(.*div\(100" backend/services --include=*.ts
grep -rn "increment: .*finalTotal\|currentDebt" backend/services/salesService.ts
```
Buscá: money-como-porcentaje sin `max(100)`; ausencia de guard `total >= 0`;
`increment` de deuda/saldo sin piso; `moneyString` local que use `!isNaN` (deja
pasar `"Infinity"`) en vez de `Number.isFinite`.

**F-MONEY — idempotencia ausente (S37/S39/S41/S52/S44).** Endpoints de escritura de
dinero sin identidad ni exclusión equivalente puede duplicar venta, factura,
abono, comisión o payout. La idempotencia existe en varios dominios (ventas, compras,
asistente y cierres), con contratos distintos. Revisar la identidad persistente,
la coincidencia de contenido y los efectos transaccionales del flujo concreto;
no deducir un defecto global por ausencia de `offlineId` en otro endpoint.

**F-MONEY — TOCTOU de saldo (S44).** Leer saldo con `findUnique` (no bloqueante) →
`if (saldo < monto) throw` → debitar con `increment` incondicional. Dos requests
concurrentes pasan ambos el check → saldo negativo. Buscá lecturas de wallet/caja
sin `FOR UPDATE` ni `updateMany({ where: { ...: { gte } } })`.

**F-SECRET — secreto en el historial git + JWT débil.** El vector más letal.
```bash
git rev-list --all --objects | grep -iE "\.env"        # ¿blobs .env* en la historia?
git log --all --oneline -- .env.backup                  # ¿fue commiteado alguna vez?
# No abrir contenido de archivos históricos de secretos. Registrar solo metadatos.
grep -rnE "jwt\.(sign|verify)\(" backend/               # ¿algorithms fijado? ¿secreto de env?
```
Si hay evidencia redactada de exposición de un secreto, distinguir el historial
de su vigencia y permisos actuales. Verificar `middleware/auth.ts`, validación
del token y relectura de identidad/roles antes de atribuir alcance a una posible
forja. No probar una clave real ni asumir acceso efectivo a otro tenant. Una PoC
local utiliza un secreto sintético y usuarios QA conocidos.

**Bypass de canal/turno.** Campos como `source`/`channel` que salen de `req.body` y
gatean lógica (`if (source === 'POS')` exige turno): mandar otro valor **saltea** el
gate. Buscá gates sobre campos controlados por el cliente.

## Superficies a barrer
1. **Auth/tenant/privesc:** `middleware/auth.ts`, `services/secrets.ts`, cobertura de
   `checkRole`, `update/delete/findUnique` por `id` suelto, `/api/admin/*`, agente
   WhatsApp (¿el servidor autoriza los ids y deriva el tenant sin confiar en el LLM?).
2. **Dinero/integridad:** `salesService.ts`, `stockService.ts`, `loans.ts`,
   `agentBanking.ts`, `driver.ts`, `purchases`/`purchaseOrders.ts`, `accounting.ts`.
3. **Infra/secretos/inyección:** raw SQL (`$queryRaw`/`$executeRawUnsafe`), historia
   git, rate-limit, parseo de archivos, prompt-injection del agente.

## Reporte de captura
Por bandera: `flagId` (F-*), título, severidad (CAPTURE/CRITICAL/HIGH/MEDIUM),
`chain` (paso a paso), `poc` (requests concretos con datos sintéticos — ej. "wallet
100 → pagar 160"), `archivo:línea`, `confidence` (CONFIRMED/PLAUSIBLE),
`prerequisites` (rol/acceso). Marcá `captured=true` solo para el alcance estático o QA demostrado con ≥1
bandera CONFIRMED; nunca presentarlo como acceso efectivo a producción.
Distinguí **captura del CTF** (código explotable) de **deuda operativa del CEO**
(rotar secreto, purgar git) — pero si el secreto débil sigue vivo, ES capturable.
El cierre de cada captura pasa por `nortex-feature` (fix + QA + PR).
