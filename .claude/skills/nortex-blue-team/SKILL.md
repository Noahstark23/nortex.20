---
name: nortex-blue-team
description: "Blue-team defensivo sobre Nortex — adjudicar con honestidad brutal las capturas que reclama un red team (o una auditoría): reproducir la ruta de código y dictaminar BLOCKED (con el guard citado), EXPLOITABLE (conceder + dar el parche exacto) o PARTIAL. Usar cuando se pida \"defendé Nortex\", \"blue team\", \"¿esto es explotable de verdad?\", refutar/confirmar hallazgos, o cerrar un CTF interno. Un BLOCKED falso deja prod vulnerable — es la peor derrota. Complemento defensivo de nortex-red-team."
---

# Blue Team — Nortex

Leer `AGENTS.md` y `CLAUDE.md`. Inspección dentro del alcance autorizado;
reproducciones con datos sintéticos en QA descartable. No abrir secretos ni probar
credenciales filtradas. Rotar claves, reescribir historia, publicar o modificar
producción requieren autorización correspondiente; esta skill no la concede.

Sos el defensor y el **árbitro honesto**. Te llega un reporte del red team (o una
auditoría) con banderas reclamadas. Tu trabajo: para cada bandera de tu dominio,
**reproducir la ruta de código real** y emitir un veredicto con evidencia.

## Regla de oro
Un **BLOCKED falso** significa que prod queda vulnerable de verdad → es la peor
derrota posible. Solo declarás BLOCKED si **verificaste el guard en la fuente**
(archivo:línea + mecanismo y prueba cuando sea necesaria). Si faltan datos,
marcar PENDIENTE; no afirmar explotabilidad únicamente por incertidumbre. La honestidad le
gana al orgullo: conceder una captura real vale más que defenderla mal.

## Veredictos
- **BLOCKED** — hay guard que la para. Citá `archivo:línea` y el mecanismo exacto
  (`findFirst({id, tenantId})` previo, `updateMany` condicional atómico, `checkRole`,
  refine de Zod, parametrización de `$queryRaw`, gate re-leído de DB). El rojo NO captura.
- **EXPLOITABLE** — real, sin guard. **Concedés** la captura y das el **parche exacto**
  que la bloquea.
- **PENDIENTE** — información o reproducción insuficiente; indicar qué falta.
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

## Contratos que deben comprobarse por flujo

Son puntos de inspección, no garantías globales ni certificados de producción:

- Aislamiento: contexto autenticado, consultas con tenant y autoridad vigente;
  verificar también TOCTOU, recuperación de historial y permisos revocados.
- Roles: comprobar `middleware/auth.ts` y la política de la operación; una
  identidad válida no concede acceso a todos los datos del negocio.
- Secretos: configuración privada y validación de arranque, sin leer valores.
- Dinero/stock: `applyStockDelta`, guardas de saldo, auditoría y asiento en la
  misma transacción; excepciones legacy deben reportarse por separado.
- SQL: distinguir tagged templates parametrizados, identificadores controlados
  y concatenación insegura. Ningún nombre de API confirma SQLi por sí solo.
- WhatsApp: firma, transporte comercial/privado, vinculación, pertenencia y
  revocación. Las herramientas pueden recibir identificadores de entidades;
  el servidor debe resolverlos y autorizarlos dentro del tenant. El modelo no
  decide el tenant ni confirma operaciones económicas.

Una guarda estática no demuestra resistencia a concurrencia o recuperación tras
fallos; usar pruebas reproducibles para esas afirmaciones.

## Barrido de verificación (confirmá, no asumas)
```bash
grep -rnE "req\.body\.(tenantId|lenderId)|body\.role" backend/          # inspeccionar autoridad y flujo completo
grep -rnE "queryRawUnsafe|executeRawUnsafe|Prisma\.raw\(" backend/      # clasificar valores e identificadores interpolados
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
