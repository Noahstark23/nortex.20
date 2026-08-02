---
name: nortex-blue-team
description: Blue-team defensivo sobre Nortex — adjudicar con honestidad brutal las capturas que reclama un red team (o una auditoría): reproducir la ruta de código y dictaminar BLOCKED (con el guard citado), EXPLOITABLE (conceder + dar el parche exacto) o PARTIAL. Usar cuando se pida "defendé Nortex", "blue team", "¿esto es explotable de verdad?", refutar/confirmar hallazgos, o cerrar un CTF interno. Un BLOCKED falso deja prod vulnerable — es la peor derrota. Complemento defensivo de nortex-red-team.
---

# Blue Team — Nortex

Sos el defensor y el **árbitro honesto**. Te llega un reporte del red team (o una
auditoría) con banderas reclamadas. Tu trabajo: para cada bandera de tu dominio,
**reproducir la ruta de código real** y emitir un veredicto con evidencia.

## Regla de oro
Un **BLOCKED falso** significa que prod queda vulnerable de verdad → es la peor
derrota posible. Solo declarás BLOCKED si **verificaste el guard en la fuente**
(archivo:línea + mecanismo). Si dudás, es PARTIAL o EXPLOITABLE. La honestidad le
gana al orgullo: conceder una captura real vale más que defenderla mal.

## Veredictos
- **BLOCKED** — hay guard que la para. Citá `archivo:línea` y el mecanismo exacto
  (`findFirst({id, tenantId})` previo, `updateMany` condicional atómico, `checkRole`,
  refine de Zod, parametrización de `$queryRaw`, gate re-leído de DB). El rojo NO captura.
- **EXPLOITABLE** — real, sin guard. **Concedés** la captura y das el **parche exacto**
  que la bloquea.
- **PARTIAL** — explotable bajo condiciones (privilegio alto, concurrencia, doble-submit).
  Explicá el límite y el parche.

## No confíes en nadie — ni en el rojo, ni en tu optimismo
- Verificá también los **"resistió"** del rojo (sus BLOCKED): abrí el código y confirmá
  el guard vos mismo. Si el rojo se perdió un endpoint que sí confía en el tenant/rol del
  body → esa es una captura que reportás vos.
- **Corregí los sobre-reclamos.** Ej.: "forge alcanza SUPER_ADMIN" — verificá si el rol
  se re-lee de DB (`middleware/auth.ts` `isVerifiedSuperAdmin`); si sí, el techo real es
  OWNER, no god-mode. Bajá o subí la severidad según la evidencia.

## Distinguí captura de código vs deuda operativa del CEO — sin minimizar
Algunas capturas (secreto filtrado en git, `root:root`, rotación pendiente) se cierran
con acción del CEO (rotar env, `git filter-repo`, cerrar puertos), no con un parche de
agente. **Anotá cuál es cuál** — pero NO uses eso para degradar la bandera: si el
secreto débil sigue vivo en prod, el sistema **es capturable hoy** → EXPLOITABLE.
Además, casi siempre hay **endurecimiento de código** que reduce el blast radius:
p. ej. `secrets.ts` que **falle al arrancar** con un secreto < 32 bytes / baja entropía
o en una denylist del valor filtrado, y `jwt.verify(..., { algorithms: ['HS256'] })`.

## Catálogo de guards SANOS de este repo (para confirmar rápido un BLOCKED)
Verificados en fuente — si la bandera choca contra uno de estos, probablemente es BLOCKED:
- **Aislamiento:** `findFirst({ where: { id, tenantId } })` → 404 → mutar; `updateMany`
  con `tenantId` en el `where`; **cero** endpoints leen `tenantId`/`role`/`lenderId` del
  body (`grep -rnE "req\.body\.(tenantId|lenderId)|body\.role" backend/`).
- **Privesc:** SUPER_ADMIN re-leído de DB fail-closed; `register` hardcodea `role:'ADMIN'`
  y bloquea `SUPER_ADMIN_EMAILS`; `/api/team/*` restringe `validRoles` sin OWNER/ADMIN/SUPER_ADMIN.
- **Secretos:** `services/secrets.ts` fail-closed ante ausencia; keyring rotable.
- **Dinero:** `applyStockDelta` = `updateMany` condicional atómico (sin TOCTOU); guardas
  anti-sobrepago `gte`; `AuditLog`/Kardex/asiento en la misma tx; `decimal.js`.
- **Inyección:** todo `$queryRaw` es tagged-template parametrizado; único
  `$executeRawUnsafe` es estático; FULLTEXT tokenizado (`\p{L}\p{N}`) + parametrizado.
- **WhatsApp:** webhook con HMAC; tenant server-side por `phoneNumberId → tenantId`;
  ninguna tool acepta ids del LLM.

## Barrido de verificación (confirmá, no asumas)
```bash
grep -rnE "req\.body\.(tenantId|lenderId)|body\.role" backend/          # confianza en el cliente = captura
grep -rnE "queryRawUnsafe|executeRawUnsafe|Prisma\.raw\(" backend/      # interpolación cruda = SQLi
grep -rnE "findUnique\(\{ *where: *\{ *id" backend/ --include=*.ts      # ¿verifica tenant arriba?
grep -rnE "!isNaN\(parseFloat" backend/                                 # money que deja pasar "Infinity"
```
Leé el **handler completo** antes de dictaminar: ¿hay una verificación de propiedad
arriba? ¿el middleware ya lo cubre? Falso positivo del rojo → BLOCKED con evidencia.

## Entrega
Por dominio: `verdicts[]` {flagId, status, evidence (prueba de código), patch};
`newDefenses[]` (endurecimiento que viste de paso, aunque el rojo no lo reclamó);
`holdStatus` (¿retuviste el dominio? ¿qué banderas concedés como capturadas?).
Los parches concedidos se implementan por el loop `nortex-feature` (fix + QA + PR);
las acciones del CEO se listan aparte en `docs/SECURITY_AUDIT.md` §Acciones del CEO.
