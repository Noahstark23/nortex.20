# Runbook — evaluación local de NortexGPT con Haiku

Entorno privado de QA para medir NortexGPT contra `claude-haiku-4-5-20251001`.
El backend y la base MySQL descartable corren en `127.0.0.1` con negocios
sintéticos. **No conecta bases reales, no toca el POS ni inicia servicios de
producción.** Una consulta con `--allow-paid-model`, tras sus compuertas, sí
envía una solicitud al proveedor y consume presupuesto sintético.

## 0. Lo que este runbook no hace

- No compra créditos, no activa recarga automática ni cambia de modelo.
- No habilita ejecución de dinero o inventario, extracción de documentos,
  WhatsApp comercial ni envíos privados. Tener clave no es autorizar capacidades.
- No aprueba nada: la casilla `expectedOutcomesReviewed` la marca una persona.

## 1. Credencial privada

La variable que espera el backend es `ANTHROPIC_API_KEY`. Se guarda en el llavero
de macOS y sólo se carga en la memoria del proceso que la necesita.

```sh
# Guardar (la clave la pide `security` con entrada oculta; no se muestra ni se
# escribe en el historial, en un archivo .env, en el repo ni en un argumento).
scripts/qa/nortexgpt-credential.sh guardar

# Consultar sin exponerla: presencia, bytes y huella sha256 truncada.
scripts/qa/nortexgpt-credential.sh estado

# Retirar.
scripts/qa/nortexgpt-credential.sh retirar
```

Todo proceso que necesite la clave se arranca a través del lanzador:

```sh
scripts/qa/nortexgpt-qa-run.sh <comando> [args...]
```

El lanzador lee el llavero, exporta la variable **sólo** al proceso hijo y se
reemplaza con `exec`. Sin credencial falla cerrado con código 3 y no arranca el
comando: una consulta sin clave devolvería el respaldo determinista y gastaría un
turno de la evaluación.

**Exposición residual, declarada:** el backend recibe el secreto como variable de
entorno, así que en macOS el propio usuario puede leer el entorno de sus procesos
(`ps -E`). El lanzador evita disco, historial y argumentos; ese canal no.

### Prueba del lanzador antes de usar la clave real

```sh
node scripts/qa/nortexgpt-launcher-selftest.mjs \
  --report reports/assistant-evaluation/launcher-selftest.json
```

Usa una credencial **sintética** en un servicio de llavero aparte
(`nortex-qa-anthropic-selftest`), que borra al terminar. Comprueba propagación,
ausencia de filtraciones y el comportamiento sin credencial. No llama al proveedor.

Corre **en aislamiento**: construye el entorno del hijo con una lista blanca corta,
así que un `ANTHROPIC_API_KEY` exportado en tu terminal no se hereda ni contamina el
resultado. La búsqueda de filtraciones recorre una **lista explícita** de archivos que
la prueba produce o gobierna —nunca el repositorio— y una guarda rechaza rutas de
`.env`, llaves o certificados aunque alguien las agregue. Un fallo de lectura o de un
comando **hunde** la comprobación; nunca la aprueba en vacío.

## 2. Base descartable y negocios sintéticos

```sh
export DATABASE_URL='mysql://qa:qa@127.0.0.1:3306/nortex_quality_operativo'
export NORTEX_QA_DATABASE_ACK='disposable-database'

mise exec -- npx --no-install prisma db push --schema backend/prisma/schema.prisma
# Regenerar el cliente: sin esto AssistantUsage.runId no existe para Prisma y el
# consumo por ejecución no se acredita (el código se degrada, no se rompe).
mise exec -- npx --no-install prisma generate --schema backend/prisma/schema.prisma
mise exec -- node --import tsx scripts/assistant-operations-demo.ts
```

La fixture siembra ferretería y farmacia sintéticas. Es idempotente: si ya existe
un montaje parcial se detiene en vez de duplicar efectos.

## 3. Configurar el modo de evaluación

```sh
mise exec -- node --import tsx scripts/qa/nortexgpt-enable-synthetic.ts

# Primer corte web del piloto, con operaciones apagadas:
mise exec -- node --import tsx scripts/qa/nortexgpt-enable-synthetic.ts --pilot-first-cut
```

El comando sin opción reproduce la evaluación operativa anterior de la sección 6.
Para el primer corte web se usa `--pilot-first-cut`: habilita ayuda e
interpretación y deja operaciones apagadas. Aplica la configuración **por
negocio**; los interruptores **globales** los pone el lanzador del backend. Una
capacidad queda activa sólo si ambos coinciden.

| Capacidad | Evaluación operativa anterior | Primer corte web |
|---|---|---|
| Conversación (`enabled`) | habilitada | habilitada |
| Interpretación de lenguaje | apagada | habilitada |
| Consultas operativas (`operationsEnabled`) | habilitadas | **deshabilitadas** |
| Ejecución de dinero/inventario (`executionEnabled`) | **deshabilitada** | **deshabilitada** |
| Preparación de acciones (`actionsEnabled`) | **deshabilitada** | **deshabilitada** |
| Extracción de documentos (`extractionEnabled`) | **deshabilitada** | **deshabilitada** |
| Promociones (`promotionsEnabled`) | **deshabilitadas** | **deshabilitadas** |
| WhatsApp privado / comercial | **deshabilitados** | **deshabilitados** |

Presupuestos: las constantes del servidor no se tocan — **US$20 globales**,
**US$2 iniciales por negocio** y ampliación aprobada hasta **US$10**. La
configuración por negocio de QA fija tanto el presupuesto como el aprobado en
**US$2**, según `nortexgpt-enable-synthetic.ts`. Una receta anterior de US$5
no concede ese cupo al piloto ni al workspace `Nortex-QA`.

## 4. Arrancar y detener el backend de QA

```sh
# Arrancar (con proveedor):
scripts/qa/nortexgpt-qa-run.sh node scripts/qa/nortexgpt-eval-server.mjs --allow-provider

# Arrancar sin proveedor, para ensayar el recorrido sin gastar:
node scripts/qa/nortexgpt-eval-server.mjs

# Primer corte real del piloto: ayuda + interpretación, operaciones apagadas.
# Esta opción sólo configura el backend de QA; no autoriza ni ejecuta una llamada.
node scripts/qa/nortexgpt-eval-server.mjs --pilot-first-cut
```

Imprime la URL base, la huella de la credencial propagada (nunca el valor) y las
capacidades activas. **Detener:** `Ctrl+C` en esa terminal, o `SIGTERM` al proceso;
el lanzador cierra el backend hijo y libera el puerto.

### Latido de un worker en el primer corte, sin proveedor

Para comprobar el worker activo contra la misma base descartable, iniciá el
backend con `--pilot-first-cut --worker-qa --source-commit <SHA_COMPLETO>` y sin
`--allow-provider`. Este modo exige un SHA de 40 caracteres e imprime un
`assistantStorageDir` temporal. El worker debe usar **ese directorio**, el mismo
SHA y la misma `DATABASE_URL` descartable, con `NORTEX_ASSISTANT_ENABLED=true`,
`NORTEX_ASSISTANT_LANGUAGE_ENABLED=true` y operaciones, extracción, ejecución,
acciones, promociones y canal privado en `false`. Iniciá un solo proceso
`mise exec -- node --import tsx backend/workers/assistant.ts` y consultá
`GET /api/assistant/status` con una sesión OWNER sintética. Exigí
`worker.status=ok`, edad menor de 90 segundos y SHA exacto; el estado global
puede ser `partial` antes de que exista un presupuesto materializado. Detené el
worker y el backend al terminar; un latido anterior no demuestra que el proceso
siga vivo.

La receta de la sección 6 usa `operations-model.mjs` y exige **operations=true**.
No se debe ejecutar contra `--pilot-first-cut`: ese CLI no evalúa el recorrido
que recibirán las cuentas piloto. En ese recorrido el modelo sólo interpreta
la pregunta y los servicios deterministas recuperan ayuda publicada o cifras
autorizadas. Antes de usar proveedor con este modo faltan la revisión humana
del corpus de ayuda, su publicación controlada en QA, una evaluación específica
de mensajes, y evidencia atribuible del consumo. El éxito de la sección 6 no
acredita esas cuatro condiciones.

Para preparar la configuración del negocio sintético en ese modo, tras sembrar
la fixture de la sección 2 ejecutá `nortexgpt-enable-synthetic.ts --pilot-first-cut`
contra la base descartable. El backend debe arrancarse con
`nortexgpt-eval-server.mjs --pilot-first-cut --allow-provider` mediante el
lanzador privado. Preparar el backend no envía una consulta al proveedor.

El secreto JWT de QA se conserva en `~/.nortex-qa/eval-jwt-secret` (0600) para que
un reinicio no invalide la sesión del evaluador. No es la clave del proveedor.

### Sesión local de Nortex

```sh
node scripts/qa/nortexgpt-qa-session.mjs --base-url http://127.0.0.1:PUERTO --vertical ferreteria
```

Escribe el token en `~/.nortex-qa/sesion-<vertical>` con permisos 0600. **Es la
sesión autenticada de Nortex, nunca la clave del proveedor.**

## 5. Formularios de revisión

```sh
mise exec -- node --import tsx scripts/qa/nortexgpt-prepare-review.ts \
  --out docs/evidence/nortexgpt/evaluation-20260923
```

Deja los dos formularios con datos del montaje y resultados esperados calculados
con consultas ORM propias — **no** con `checkInventoryBurnRate`, para que sirvan de
contraste y no de eco. Quedan con `expectedOutcomesReviewed: false` y `reviewer: null`.

Los formularios generados el 23 de septiembre de 2026 están en esa carpeta,
con una lectura resumida en su `README.md`. Si la consulta se ejecuta otro día
civil de Managua, usar una carpeta fechada nueva, regenerar y volver a revisar
las expectativas: cambian la ventana de salidas y los vencimientos.

**Paso humano obligatorio:** revisar montaje, productos, lotes, fechas, período,
existencias vendibles, salidas BASE y OC pendientes contra evidencia independiente;
completar `reviewer`, `reviewedAt` y `humanVerdict`; recién entonces poner
`expectedOutcomesReviewed: true`. El CLI rechaza el lote mientras esa casilla sea
falsa. Nadie más puede marcarla.

## 6. Consulta real — como máximo una por vertical

```sh
mise exec -- node --import tsx scripts/assistant-evaluation/operations-model.mjs \
  --allow-paid-model --synthetic-tenant --base-url http://127.0.0.1:PUERTO \
  --vertical ferreteria --role OWNER --limit 1 --max-reserved-usd 2 \
  --review-file docs/evidence/nortexgpt/evaluation-20260923/model-review-ferreteria.json \
  --session-token-file ~/.nortex-qa/sesion-ferreteria \
  --report reports/assistant-evaluation/ferreteria-lote-01.json
```

- Informe **nuevo** por lote: el CLI rechaza sobrescribir una ruta existente.
- Ante interrupción, repetir **los mismos argumentos** más `--resume`. La
  reanudación sólo hace GET. **Nunca crear una consulta sustituta** para recuperar
  una respuesta perdida: podría gastar presupuesto dos veces.
- Reserva máxima conservadora: **US$1,127680** por consulta de hasta cuatro
  iteraciones. Es un techo, no un gasto.

### Comprobar que respondió Haiku y no el respaldo

```sh
mise exec -- node --import tsx scripts/qa/nortexgpt-verify-run.ts \
  --report reports/assistant-evaluation/ferreteria-lote-01.json
```

Responde **dos preguntas separadas, con evidencias distintas**:

1. **¿Respondió el modelo?** Separar respuesta, contacto acreditado e incertidumbre:

   | Clase | Significado |
   |---|---|
   | `respuesta_del_modelo` | `SUCCEEDED` con `degraded: false`: respuesta validada, pendiente de evaluación humana. |
   | `incompleta_con_llamadas_al_proveedor` | Hay un `providerRequestId` en consumo válido enlazado al mismo run, negocio y usuario; la respuesta no llegó a validarse. No demuestra que todo el consumo esté liquidado. |
   | `respaldo_determinista_sin_llamadas` | `SUCCEEDED` con `iterations = 0`, sin respuesta ni contacto acreditado. |
   | `llamadas_al_proveedor_no_acreditadas` | El contador o una reserva no permiten decidir si hubo envío; `providerCallAttempted` queda en `null`. |

   El orquestador incrementa `iterations` **antes de reservar presupuesto**. Un
   presupuesto agotado, una revocación o un plazo vencido pueden detenerlo antes
   de enviar. `UNKNOWN` tampoco acredita recepción del proveedor. No inferir
   llamadas pagadas ni liquidación completa del contador. Se conserva la consulta
   por `runId` sin ventanas temporales para acreditar consumo.

2. **¿Cuánto consumió esa ejecución?** Sólo con `AssistantUsage.runId`, escrito al
   **crear la reserva** —antes de llamar al proveedor—, de modo que también quedan
   vinculados los fallos, los reinicios y los costos inciertos. Con el vínculo
   disponible la consulta va **por ejecución y sin filtro de mes**, para no perder
   una consulta que reserva de un lado del borde del mes y liquida del otro.

   Si el cliente Prisma no conoce el campo (falta `prisma generate`), el informe trae
   `linkFieldPresent: false`, la respuesta es `consumo_por_ejecucion_no_acreditado` y
   `observedUsdForThisRun` queda en `null`. Correlacionar por usuario y fecha
   atribuiría mal el consumo con dos consultas del mismo usuario, con concurrencia o
   al cruzar el borde del mes: el script **no lo hace**. Los totales que sí informa
   están rotulados `mes_completo_no_por_ejecucion`.

Con `--require-cost-attribution` la falta de acreditación devuelve código distinto de
cero, para usarlo donde el gasto por consulta sea un requisito y no un dato ausente.

### Ensayo separado del primer corte web

[`first-cut-help-review.json`](../evidence/nortexgpt/evaluation-20260923/first-cut-help-review.json)
contiene una sola pregunta sintética y la cita `reposicion` `web3` esperada.
Está en `expectedOutcomesReviewed: false`: el CLI rechaza `--allow-paid-model`
antes de leer la sesión o hacer una llamada. Una persona debe revisar el texto,
la fuente, el hash del manifiesto y los criterios y completar revisor y fecha.
La publicación del corpus en QA requiere una decisión editorial separada;
este evaluador no cambia `DRAFT`, `REVIEWED` ni `PUBLISHED`.

Una vez revisado el formulario, con la ayuda del hash exacto publicada **sólo
en la base sintética autorizada**, el servidor local en modo `--pilot-first-cut`
y el negocio configurado con `--pilot-first-cut`, el comando es:

```sh
DATABASE_URL='mysql://.../nortex_quality_first_cut_model' \
NORTEX_QA_DATABASE_ACK=disposable-database \
mise exec -- node --import tsx scripts/assistant-evaluation/first-cut-model.mjs \
  --allow-paid-model --synthetic-tenant --base-url http://127.0.0.1:PUERTO \
  --review-file docs/evidence/nortexgpt/evaluation-20260923/first-cut-help-review.json \
  --session-token-file ~/.nortex-qa/sesion-ferreteria \
  --max-reserved-usd 2 --report reports/assistant-evaluation/first-cut-ferreteria-01.json
```

El servidor reserva como máximo US$0,281920 para este mensaje; el costo real
se consulta por `AssistantUsage.runId = message:<conversationId>:<requestId>`.
El informe se guarda antes del único POST. Si se corta la respuesta, repetir
**los mismos argumentos** con `--resume`: sólo hace GET y lecturas de la base.
Una reserva `UNKNOWN` o sin vínculo no acredita costo ni calidad del modelo.
Un `providerRequestId` liquidado acredita contacto y gasto; por sí solo no
demuestra que el plan interpretado se aplicó. La respuesta, cita y ausencia de
`AssistantRun` se registran aparte y requieren juicio humano posterior.

## 7. Retirar la credencial al terminar

```sh
scripts/qa/nortexgpt-credential.sh retirar          # borra la clave del llavero
rm -f ~/.nortex-qa/sesion-*                          # tokens de sesión de QA
rm -f ~/.nortex-qa/eval-jwt-secret                   # opcional: invalida sesiones viejas
```

La base descartable se elimina aparte (`DROP DATABASE nortex_quality_operativo`).
Los informes bajo `reports/assistant-evaluation/` contienen respuestas privadas y
están excluidos de Git; borrarlos o archivarlos fuera del repositorio.

## 8. Qué no acredita este recorrido

Una respuesta exitosa del servidor **no** acredita calidad del modelo. El estado
máximo alcanzable por el CLI es `executed_pending_human_review`. La revisión humana
por fuente, permisos, información faltante, ausencia de ejecución sin confirmar y
utilidad del siguiente paso sigue pendiente hasta que una persona la registre.
