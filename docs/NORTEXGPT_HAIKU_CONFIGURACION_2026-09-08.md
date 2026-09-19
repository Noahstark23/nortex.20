# NortexGPT: configuración de Haiku para QA local — 8 de septiembre de 2026

Configuración reproducible y privada para evaluar NortexGPT contra
`claude-haiku-4-5-20251001` en un entorno local de QA. **Cero llamadas al
proveedor, cero gasto observado, cero datos reales de negocios, sin despliegue,
sin push y sin mensajes externos.** La revisión humana sigue pendiente y es
previa a cualquier consulta pagada.

Procedimiento operativo completo: [runbook de evaluación](runbooks/nortexgpt-evaluacion-haiku.md).
Manifiesto y evidencia: [verificación de esta entrega](evidence/nortexgpt/evaluation-20260908/verification.json).

## 1. Estado por categoría

| Estado | Qué cubre |
|---|---|
| **Implementado y verificado** | Almacenamiento en llavero, lanzador que carga el secreto sólo en el proceso hijo, exclusión deliberada del proveedor en la compuerta obligatoria, propagación explícita en el lanzador de evaluación. TypeScript de los archivos nuevos aprobado con Node 22.23.2. |
| **Probado en simulación** | Las 15 comprobaciones del lanzador (propagación, ausencia de filtraciones, falla cerrada sin credencial) con credencial **sintética** y un doble del comando `security`. No acredita el llavero real. |
| **Implementado, sin ejecutar** | Habilitación por negocio, montaje sintético, preparación de formularios y verificación de consumo: requieren MySQL 8 descartable en la Mac. |
| **Llamadas reales** | Ninguna. `paidCalls: 0`, consumo observado **US$0,000000**. |
| **Revisión humana** | Pendiente. `expectedOutcomesReviewed` sigue en `false` y ningún archivo declara revisor. |
| **Pendiente de tu intervención** | Workspace y clave en Claude Console; guardar la clave en el llavero; completar los dos formularios; ejecutar la compuerta del repositorio en la Mac. |

## 2. Comparación con el estado anterior

Los 19 archivos del [manifiesto del 2026-09-07](evidence/nortexgpt/evaluation-20260907/verification.json)
conservan su hash exacto: **19/19 intactos**. No se reescribió evidencia antigua
ni se sustituyó ningún registro previo. El adaptador, el orquestador, el corpus
reservado y el CLI del evaluador se reutilizan sin modificarlos.

Coincide con lo que ese informe declaraba pendiente: «Configuración privada de
Haiku». Esta entrega cubre la configuración, no la evaluación.

## 3. Credencial privada

La variable que espera el backend es `ANTHROPIC_API_KEY`.

- `scripts/qa/nortexgpt-credential.sh` — guarda, consulta y retira la clave en el
  llavero de macOS. Al guardar, el valor lo pide `security` con entrada oculta:
  no pasa por el script, ni por el historial, ni por argumentos. Al consultar
  informa presencia, bytes y huella sha256 truncada, **nunca el valor**.
- `scripts/qa/nortexgpt-qa-run.sh` — lee el llavero, exporta la variable **sólo**
  al proceso hijo y se reemplaza con `exec`. Sin credencial sale con código 3 y
  **no arranca el comando**: una consulta sin clave devuelve el respaldo
  determinista y gastaría un turno de la evaluación.

No hay `.env`, ni variables `VITE_*`, ni escritura del secreto en scripts,
fixtures, informes o logs. No se leyó ningún `.env` ni credencial existente.
El agente **no almacenó ninguna clave**: eso lo hacés vos en tu llavero.

**Exposición residual declarada:** el backend recibe el secreto como variable de
entorno, así que en macOS el propio usuario puede leer el entorno de sus procesos
(`ps -E`). El lanzador cierra disco, historial y argumentos; ese canal no.

## 4. El lanzador de QA, adaptado

`scripts/run-quality-integration.mjs` no propagaba claves del proveedor, pero por
omisión: simplemente no las listaba. Ahora la decisión es explícita y está en un
solo lugar revisable, `scripts/qa/provider-credential.mjs`:

- La **compuerta obligatoria** llama `applyProviderCredential(env, { allow: false })`,
  que *retira* activamente la variable. Propagarla ahí haría que cada corrida
  gastara presupuesto real y que las suites dejaran de ser deterministas.
- El **lanzador de evaluación** (`scripts/qa/nortexgpt-eval-server.mjs`) es el
  único que puede propagarla, y sólo con `--allow-provider`. Valida la forma de
  la clave, rechaza cualquier `VITE_*` y devuelve huella y longitud, nunca el valor.

`tests/qaProviderCredential.test.ts` fija esa conducta, incluida la ausencia de
`allow: true` en la compuerta y la ausencia de `env VAR=valor` en el lanzador.

## 5. Habilitación inicial

Interruptores **globales** (lanzador) y **por negocio** (`AssistantTenantConfig`);
una capacidad queda activa sólo si ambos coinciden.

| Capacidad | Primer paso |
|---|---|
| Conversación | habilitada |
| Consultas operativas | habilitada |
| Ejecución de dinero/inventario | **deshabilitada** |
| Preparación de acciones | **deshabilitada** |
| Extracción de documentos | **deshabilitada** |
| Promociones | **deshabilitada** |
| WhatsApp comercial y envíos privados | **deshabilitados** |

Sólo los dos negocios sintéticos, `operativo-demo-20260905-ferreteria` y
`-farmacia`, en la base descartable. Tener clave no autoriza capacidades.

**Presupuestos.** Las constantes del servidor no se tocaron: `GLOBAL_BUDGET_USD`
sigue en **US$20** y `TENANT_BUDGET_USD` en **US$10**. La configuración por
negocio de QA se fija en **US$5**, más conservadora, para quedar dentro del tope
del workspace. Reserva máxima por consulta: **US$1,127680** para cuatro
iteraciones — es un techo, no un gasto.

## 5.bis Correcciones de la revisión de Codex (2026-09-08)

Dos defectos reales, corregidos y fijados con pruebas.

### a) Atribución de consumo sin evidencia (`nortexgpt-verify-run.ts`)

La versión anterior sumaba `AssistantUsage` filtrando por **usuario, mes corriente y
`createdAt >= run.createdAt`**. Eso no es una correlación: con dos consultas del mismo
usuario, la primera se llevaba el consumo de ambas; con concurrencia, la atribución
dependía del orden de arranque; y un lote de un mes anterior no encontraba filas del
mes corriente y quedaba declarado —falsamente— como respaldo determinista.

La causa de fondo es de datos, no de código: **`AssistantUsage` no guarda el
identificador de la ejecución** y `AssistantRun` no guarda nada del proveedor. No
existe clave de unión. El script ahora:

- Separa **«¿respondió el modelo?»** —que se decide con `degraded:false` sobre la
  ejecución, sin mirar el consumo— de **«¿cuánto consumió esa ejecución?»**.
- Acredita consumo **sólo** con un enlace explícito. Sin él declara
  `consumo_por_ejecucion_no_acreditado` y deja `observedUsdForThisRun` en `null`.
  Nunca usa ventanas de tiempo, usuario ni proximidad.
- Toma el mes **de la ejecución**, no del reloj, así que los lotes de meses
  anteriores se verifican correctamente.
- Rotula los agregados que sí informa como `mes_completo_no_por_ejecucion`.
- Marca `consumo_por_ejecucion_incompleto` si una fila enlazada quedó `RESERVED` o
  `UNKNOWN`: una reserva sin liquidar no es consumo cero.
- Rechaza un enlace hacia otro tenant o usuario por incoherente.

`tests/qaVerifyRunAttribution.test.ts` cubre los tres escenarios pedidos —dos consultas
del mismo usuario, concurrencia y meses anteriores— más enlace válido, enlace
incoherente, liquidación parcial y entradas inválidas.

> Para acreditar gasto por consulta habría que persistir `runId` en la fila de consumo,
> dentro de la misma transacción que la liquidación. Es un cambio aditivo de schema en
> dominio de dinero, fuera del alcance de esta configuración; el script lo aprovecha
> automáticamente si algún día existe.

### b) Barrido indiscriminado y fallos que aprobaban (`nortexgpt-launcher-selftest.mjs`)

La versión anterior buscaba el secreto con `grep -rIl` sobre **todo el repositorio**:
abría archivos que esta prueba no tiene por qué leer, `.env` incluido. Peor, la
condición era `grep.status !== 0 && !grep.stdout.trim()`: `grep` devuelve 1 cuando no
hay coincidencias y 2 **cuando falla**, así que un error de lectura *aprobaba* la
comprobación. Verificado en el contraste: `status 2` con salida vacía daba APRUEBA.

Ahora:

- **Lista explícita** de objetivos que la prueba produce o gobierna. Cero recorrido de
  directorios. Una guarda (`FORBIDDEN_TARGET`) rechaza rutas de `.env`, `.netrc`,
  claves privadas y certificados aunque alguien las agregue a la lista.
- **Un fallo de lectura hunde la prueba**: `fuga.todos_los_objetivos_legibles` falla y
  arrastra a `fuga.no_en_objetivos_permitidos`, que exige lecturas exitosas.
- **Un fallo de comando hunde la prueba**: un `spawnSync` con error o terminado por
  señal lanza y se registra como `ejecucion.sin_errores_de_comando_o_lectura`.
- La ausencia de fuga en `argv` sólo se afirma si `ps` **respondió de verdad**
  (`fuga.argv_observado_efectivamente`); si no se pudo observar, se falla en vez de
  aprobar en vacío. La visibilidad del entorno no observable se informa `null`, no `false`.
- **Aislamiento**: el entorno del hijo se construye con lista blanca. Un
  `ANTHROPIC_API_KEY` exportado por el operador no se hereda.
- El informe se inspecciona antes de escribirse: si contuviera el secreto, no se escribe.

## 5.ter Vínculo de consumo y clasificación (segunda revisión de Codex)

### a) `AssistantUsage.runId`, escrito en la reserva

Cambio **aditivo**: columna nullable con índice, más
[migración](../backend/prisma/migrations/20260908_assistant_usage_run_link/migration.sql).
Sin `DROP`, sin `NOT NULL`, sin backfill.

Se escribe al **crear la reserva**, no al liquidar. Es la diferencia que importa: los
fallos de proveedor, los reinicios y los costos inciertos (`UNKNOWN`) nunca llegan a
liquidar, así que un vínculo escrito en la liquidación los dejaría fuera justo en los
casos donde saber el gasto más importa. `settleAssistantBudget` no toca el campo, de
modo que lo conserva solo.

**Guarda de compatibilidad.** `USAGE_SUPPORTS_RUN_LINK` consulta el DMMF del cliente
generado y sólo manda el campo si existe. Sin esa guarda, correr el orquestador antes de
`prisma generate` haría fallar cada reserva, y el orquestador trata un fallo de reserva
como respaldo: las consultas habrían caído al respaldo determinista **en silencio**.
Con la guarda el sistema se degrada a *no acreditar consumo*, no a *no responder*.

### b) El verificador tenía que pedir el campo

Mi afirmación anterior —que añadir el campo al schema lo activaría automáticamente—
era falsa: el `select` de Prisma enumera columnas y no incluía `runId`. Ahora el
verificador detecta el campo en el cliente generado, lo agrega al `select` sólo si
existe, y **consulta por ejecución sin filtro de mes**, porque una consulta puede
reservar de un lado del borde del mes y liquidar del otro. Sin el campo trae
candidatas de los meses vecinos únicamente como contexto, nunca como atribución, y el
informe lo dice en `linkFieldPresent`.

### c) `degraded:true` no significa «no se llamó al modelo»

La QA local reprodujo un error de clasificación: una reserva rechazada por
presupuesto deja `iterations = 1` y el proveedor sin invocar. El contador aumenta
antes de reservar; tampoco una reserva liberada tras revocación demuestra envío.

El verificador conserva `respuesta_del_modelo` para `SUCCEEDED/degraded:false`.
Para una respuesta incompleta exige un `providerRequestId` enlazado al mismo run,
negocio y usuario. Sin evidencia suficiente informa
`llamadas_al_proveedor_no_acreditadas` y `providerCallAttempted: null`; no afirma
llamadas pagadas ni liquidación completa. Los importes ausentes, negativos o no
finitos no se convierten en cero. La ausencia de vínculo sigue dejando el costo
por ejecución en `null`.

### Alcance y lo que falta

Es un cambio en dominio de dinero. Type-checked y cubierto por pruebas de
comportamiento con base falsa en ambos estados del cliente (con y sin el campo), pero
**las compuertas obligatorias no se ejecutaron**: `npm run test:integration:required`
(MySQL 8) y `npm run test:mutation` deben correr en la Mac antes de considerarlo
cerrado. El rango de mutación de `budget.ts` (líneas 16-19, `tokenCostUsd`) quedó
byte a byte idéntico; no se elevó ningún presupuesto ni umbral.

## 6. Verificación ejecutada

La tabla siguiente conserva la verificación original. La [QA posterior ejecutada en la Mac](evidence/nortexgpt/qa-live-20260908/README.md) aprobó Prisma, TypeScript, 4.814 pruebas generales, 300 casos obligatorios de MySQL, diseño, build y mutación global (99,88%). También verificó el enlace por run y la migración. Haiku real y revisión humana siguen pendientes.

| Comprobación | Resultado |
|---|---|
| Hashes del origen 2026-09-07 | 19/19 intactos |
| TypeScript de los archivos nuevos (proyecto acotado, Node 22.23.2) | aprobado |
| Conducta de `provider-credential.mjs` (7 grupos de aserciones) | aprobada |
| Atribución de consumo (10 grupos: mismo usuario, concurrencia, meses anteriores) | aprobada |
| Aserciones de fijación del endurecimiento (17) | aprobadas |
| Lanzador con credencial sintética y llavero simulado | 21/21 |
| Inyección de fallos: comando inexistente y objetivo ilegible | ambos FALLAN, código 1 |
| Atribución con vínculo (13 grupos, incl. tres clases y borde de mes) | aprobada |
| Reserva/liquidación con base falsa, cliente con y sin `runId` (5 + 5) | aprobadas |
| Rango de mutación de `budget.ts` 16-19 | idéntico al original |
| `test:integration:required` (MySQL) y `test:mutation` tras tocar dinero | **pendientes en la Mac** |
| Rama, worktrees, índice y commits | sin cambios |
| Compuerta canónica del repositorio | **no ejecutada aquí** |
| Vitest completo | **no ejecutado aquí** |
| MySQL obligatorio y mutación | no re-ejecutados: sin cambios de dominio ni de dinero |

Las tres últimas no corren en el entorno de nube: `node_modules` está compilado
para darwin-arm64 y este entorno es Linux. Se ejecutan en la Mac con un comando
—§8— y sus registros quedan en la carpeta de evidencia.

## 7. Lo que falta de tu lado

**a) Claude Console.** No creo workspaces, ni claves, ni cambio límites de gasto.

1. **Settings → Workspaces → Add Workspace**, nombre `Nortex-QA`. Si ya existe,
   reusalo; no crear duplicados.
2. En ese workspace, pestaña **Limits → Change Limit**: fijar **US$5** mensuales.
   El tope del workspace debe ser menor que el de la organización, así que el
   total acordado de US$20 queda a nivel organización.
3. Pestaña **API Keys → Create Key**, nombre `nortex-qa-haiku`. La clave queda
   atada a ese workspace y no se puede mover.
4. **No** comprar créditos ni activar recarga automática.

**b) Guardar la clave.** En la Mac, dentro del repositorio:

```sh
scripts/qa/nortexgpt-credential.sh guardar
```

`security` la pide con entrada oculta. **No la pegues en el chat.**

**c) Revisión humana de los formularios.** Después de sembrar el montaje, revisar
productos, lotes, fechas, período, existencias vendibles, salidas BASE y OC
pendientes contra evidencia independiente; completar `reviewer`, `reviewedAt` y
`humanVerdict`; recién entonces poner `expectedOutcomesReviewed: true`. El CLI
rechaza el lote mientras esa casilla sea falsa. Nadie más puede marcarla.

## 8. Comando único de verificación en la Mac

```sh
sh scripts/qa/nortexgpt-verify-local.sh
```

Corre la compuerta canónica (`scripts/ci-local-safe.sh`: Prisma generate,
TypeScript, Vitest, sistema de diseño y build) y la prueba del lanzador contra el
**llavero real** con una credencial sintética que borra al terminar. No usa la
clave real, no llama al proveedor y no hace deploy, push ni merge. Deja los
registros en `docs/evidence/nortexgpt/evaluation-20260908/`.

## 9. Límites de esta entrega

- Una respuesta correcta del servidor **no** acredita calidad del modelo. El
  estado máximo del CLI es `executed_pending_human_review`.
- La prueba del lanzador usó un doble del comando `security`: verifica la conducta
  del lanzador, no el almacenamiento real de macOS.
- No se sembró el montaje sintético ni se aplicó la habilitación por negocio: sin
  MySQL descartable en esta sesión.
- Sin llamadas al proveedor no hay consumo observado. La reserva máxima conservadora
  no es gasto.
- No se modificaron dominios de dinero/inventario, schema, endpoints ni UI.
  Sin variación de `backend/server.ts` ni `components/POS.tsx`; no se elevaron presupuestos.
