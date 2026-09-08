# Runbook de auditoría y mejora preproducción del frontend

> **Estado del primer ciclo P0 (2026-09-01): QA LOCAL COMPLETA · PENDIENTE STAGING.** El
> detalle y la evidencia están en
> `docs/releases/2026-09-01-frontend-audit-remediation.md`. La auditoría de
> producción es la línea base; no demuestra por sí sola qué sigue presente en el
> candidato local ni que algún hallazgo ya esté reparado. No marcar este ciclo como
> completado hasta cerrar adjudicación, QA, evidencia local, staging y sus compuertas.

## Propósito y resultado esperado

Usá este runbook cuando una auditoría visual, funcional o de accesibilidad encuentre
problemas en Nortex. Cada hallazgo debe recorrer, sin saltos:

`auditoría → adjudicación → prioridad → reparación vertical → QA → evidencia visual local → staging → autorización de producción → verificación`

El resultado previo a producción es un candidato de SHA exacto, con evidencia
reproducible y una demostración del producto final al responsable. Un parche local,
una captura bonita, CI verde o staging saludable **no** autorizan producción.

## 1. Límites operativos antes de comenzar

1. Leé `AGENTS.md` y `CLAUDE.md` completos.
2. Ejecutá y guardá como evidencia:

   ```bash
   git status --short --branch
   git rev-parse HEAD
   ```

3. Si el worktree está sucio:
   - inventariá los archivos existentes antes de editar;
   - no cambies de rama, no hagás rebase, reset, clean, restore ni checkout;
   - no modifiqués, formateés ni incluyás cambios ajenos;
   - si un archivo necesario ya tiene cambios, inspeccioná el diff y detenete si no
     podés separar con seguridad la reparación;
   - usá un worktree aislado solamente con autorización explícita y desde un commit
     base verificado.
4. No leás ni expongás `.env*`, tokens, credenciales o datos de clientes. Toda
   captura debe usar un tenant sintético o datos anonimizados.
5. Una inspección en producción es de solo lectura: no cobrar, cerrar caja, mover
   stock, enviar mensajes ni crear datos de negocio.
6. Push, PR, staging y producción son cambios externos distintos; cada uno requiere
   la autorización que corresponda. No inferir una compuerta de otra.

## 2. Inventario vivo del ciclo

Abrí un registro por hallazgo. Un contador o evidencia solo vale si incluye ambiente,
fecha, ruta, viewport y SHA/build observado.

| Campo | Contenido obligatorio |
|---|---|
| ID y título | Identificador estable, por ejemplo `P0-4 Contraste` |
| Fuente | Auditoría, reporte de usuario, test, métrica o incidente |
| Ambiente | Producción, staging o local; URL sin secretos |
| Build | SHA exacto o `DESCONOCIDO` |
| Condición | Ruta, rol, tenant sintético, navegador, viewport y preferencias |
| Reproducción | Precondiciones y pasos mínimos numerados |
| Resultado | Esperado y observado, sin interpretación ambigua |
| Evidencia | Captura/video, DOM/CSS, consola/red redactada y comando reproducible |
| Alcance | Rutas, componentes y flujos de dominio potencialmente afectados |
| Estado | `NUEVO`, `ADJUDICADO`, `EN REPARACIÓN`, `QA LOCAL`, `STAGING` o `CERRADO` |
| Responsable | Persona/agente, fecha objetivo y PR/commit cuando exista |

### Línea base del primer ciclo P0

Fuente: auditoría del DOM y CSS compilado de producción del 2026-09-01. Todos los
ítems siguen **abiertos dentro de este ciclo** hasta contrastarlos con el repo y el
candidato local.

| ID | Señal reportada | Aceptación mínima | Estado del ciclo |
|---|---|---|---|
| P0-1 | Clases de animación declaradas sin CSS efectivo | Cero clases muertas; entrada y salida verificadas | QA local |
| P0-2 | Rampas `amber`, `red` y `sky` aplanadas o incompletas | Escalones distintos y usos semánticos con contraste válido | QA local |
| P0-3 | Contextos claro/oscuro mezclados en Entregas | Un solo contexto coherente y texto legible | QA local; visual autenticada pendiente |
| P0-4 | Ocho fallos de contraste medidos; mínimo observado 1.00:1 | Cero fallos en las rutas auditadas | Parcial: demo 0/62; rutas autenticadas pendientes |
| P0-5 | Safe area de iOS anulada y cuatro usos de `100vh` reportados | `viewport-fit=cover`, inset efectivo y cero `100vh` afectados | QA local; iPhone físico pendiente |
| P0-6 | Sin contención de overscroll | Sin pull-to-refresh ni scroll chaining en flujos críticos | QA local; dispositivo físico pendiente |
| P0-7 | Cobertura táctil desigual: `noPress` reportado entre 1 y 211 por ruta | `noPress=0`, `under44=0` en el alcance acordado | Parcial: demo 0/24; POS conserva deuda |

Si aparece un P0 de seguridad, aislamiento de tenant, dinero o stock durante esta
revisión, tiene precedencia sobre el pulido visual y se escala de inmediato.

## 3. Adjudicar antes de reparar

Reproducí el hallazgo en el código real y en un candidato local equivalente. Mapeá la
evidencia compilada a los componentes, tokens y reglas fuente. Asigná uno de estos
veredictos:

- **CONFIRMADO:** se reproduce bajo las condiciones documentadas y el código fuente
  explica el comportamiento.
- **REFUTADO:** la misma prueba contradice el reporte. Adjuntá contraevidencia y
  explicá si el reporte era obsoleto, medía otra condición o describía conducta
  esperada.
- **PARCIAL:** solo una parte, ruta, viewport, rol o preferencia se reproduce. Dividí
  el hallazgo si cada parte necesita una reparación distinta.

`BLOQUEADO` puede usarse como estado operativo cuando falta acceso o un ambiente,
pero nunca sustituye el veredicto. Una captura de producción no confirma el estado de
la rama local; un grep tampoco confirma la conducta renderizada.

La ficha de adjudicación debe incluir:

```text
ID / veredicto / fecha / adjudicador
SHA y estado del worktree
condiciones exactas de reproducción
archivo(s) y línea(s) que explican la causa
evidencia a favor y contraevidencia revisada
alcance confirmado y alcance descartado
```

## 4. Priorizar por riesgo e impacto

Evaluá primero integridad y recuperabilidad, después frecuencia y alcance.

| Prioridad | Criterio operativo |
|---|---|
| P0 | Riesgo de seguridad/cross-tenant, dinero o stock incorrecto, pérdida de datos, acción crítica inaccesible o flujo primario sin salida segura |
| P1 | Bloqueo serio o error frecuente con alternativa costosa; incumplimiento de accesibilidad en tareas importantes |
| P2 | Fricción moderada, inconsistencia o rendimiento degradado sin comprometer la operación |
| P3 | Pulido o mejora de baja frecuencia sin riesgo operativo |

Para desempatar, ordená por: severidad × probabilidad × usuarios/rutas expuestos;
subí prioridad cuando el error sea difícil de detectar o revertir. Documentá siempre
el impacto en lenguaje de negocio: venta detenida, monto ilegible, riesgo de recarga
con carrito abierto, cierre de caja confuso, etc.

## 5. Reparación vertical

Una reparación vertical cierra una conducta observable completa, con su guardrail y
evidencia. Evitá barridos horizontales masivos sin pruebas.

Para cada slice:

1. fijá el comportamiento esperado y el contador que debe mejorar;
2. identificá la causa raíz y el conjunto mínimo de archivos;
3. agregá o fortalecé primero el test/ratchet que detecta la regresión;
4. implementá sin aumentar monolitos ni duplicar tokens o lógica;
5. verificá estados normal, carga, vacío, error, deshabilitado y permisos aplicables;
6. dejá rollback o reversión segura antes de pasar a staging.

Los tests nuevos deben comprobar conducta renderizada o funciones extraídas. No
leás un monolito como `POS.tsx` desde una prueba para fijar strings de implementación:
eso impide extraer responsabilidades y el presupuesto de deuda debe rechazarlo. Un
contrato estático solo es aceptable sobre una primitive pequeña y estable cuando no
exista una observación conductual equivalente.

### UX pura frente a dinero o stock

| Cambio | Compuerta obligatoria |
|---|---|
| UX pura | El frontend puede cambiar presentación o interacción, pero no inventar reglas ni prometer una fuente de fondos/stock que el backend no garantice. Probar teclado, touch, foco, lectores, carga/error y viewport. |
| Dinero | Total autoritativo en backend, `Decimal`/`decimal.js`, Zod, tenant del JWT, idempotencia, auditoría atómica y pruebas de mutación/concurrencia según el flujo. Una captura visual no prueba exactitud contable. |
| Stock | Mutación explícita por `applyStockDelta`, tenant del JWT, Kardex y auditoría en la misma transacción; probar insuficiencia, reintento y concurrencia. Un gesto o escaneo nunca debe mutar inventario por accidente. |
| Mixto | Separar la mejora visual de la mutación de dominio y exigir ambas compuertas. Si el texto de UI contradice al backend, validar primero la verdad del dominio. |

### Trinquetes que no pueden empeorar

Registrá el valor antes y después sobre el mismo SHA, rutas y viewport. El objetivo no
se sube para hacer pasar un PR.

| Trinquete | Regla |
|---|---|
| Contraste | Cero pares bajo 4.5:1; 3:1 solo para texto grande definido por WCAG |
| Touch | `noPress` y controles menores de 44×44 solo bajan hasta cero |
| Movimiento | Cero clases muertas, sin `transition: all`; duraciones/easing salen de tokens |
| Sheets continuos | Valor presentado y velocidad sobreviven interrupción; salida bloquea taps al fondo hasta desmontar |
| Reduced motion | Toda interacción conserva función sin rebote o desplazamiento decorativo |
| Viewport/scroll | Cero `100vh` problemáticos; safe area y overscroll siguen cubiertos |
| POS | El presupuesto de `components/POS.tsx` y sus dependencias históricas solo baja |
| Dinero | El mutation score solo sube; nunca bajar umbral ni debilitar aserciones |
| Backend/BD | Cero clientes Prisma nuevos, listados nuevos paginados e índices/DDL aditivos |

## 6. QA local y accesibilidad

Ejecutá primero tests focalizados y después la compuerta proporcional al riesgo. Usá
Node `22.23.2` con `mise` y el lockfile npm canónico.

```bash
# Compuerta segura completa, sin deploy
mise exec node@22.23.2 -- sh scripts/ci-local-safe.sh

# Si tu shell ya expone el wrapper del proyecto
nortex check

# Si cambia lógica de dinero
NORTEX_CI_MUTATION=1 mise exec node@22.23.2 -- sh scripts/ci-local-safe.sh
```

Además, verificá `git diff --check -- <archivos-del-slice>` y revisá el diff solo de
los archivos propios. Si una falla proviene de cambios ajenos del worktree, separala
con evidencia; no la escondás ni la atribuyás a la reparación.

Checklist mínimo de interacción:

- touch real o emulado: área mínima 44×44, respuesta en `pointerdown`, sin selección
  accidental ni doble activación;
- teclado: orden de foco, `Enter`/`Space`, `Escape`, foco visible y retorno al trigger;
- contraste: 4.5:1 normal y 3:1 únicamente para texto grande;
- `prefers-reduced-motion: reduce`: mismo resultado funcional, sin transform ni
  rebote decorativo; los gestos esenciales siguen disponibles por otra vía;
- sheets/drawers: abrir, interrumpir, retargetear, arrastrar arriba/abajo, soltar a
  ambos lados del umbral, cerrar por backdrop/Escape y verificar que ningún tap
  alcance el fondo mientras la salida sigue visible;
- sheets/drawers bajo reduced motion: el estado abierto debe presentarse antes del
  primer frame de animación; vaciar la cola rAF y mirar solo el resultado final no
  detecta un destello inicial incorrecto;
- rotación/resize con el sheet abierto y bajo el dedo: recalcular extensión, umbral
  y progreso del backdrop sin saltar ni perder la captura del puntero;
- carcasa responsive: montar una sola rama; en móvil exigir diálogo, foco y body
  lock, en desktop exigir superficie inline sin semántica modal; probar ambos cruces
  del breakpoint y que el contenido no desaparezca ni duplique IDs;
- `prefers-contrast: more` cuando aplique y zoom de texto sin cortar acciones;
- desktop y móvil, incluidos safe area, teclado virtual, scroll interno y rotación;
- estados de red lenta/error sin perder carrito, formulario ni contexto.

## 7. Evidencia visual local y muestra del producto final

Levantá MySQL y el stack seguro con `nortex db-up`, `nortex backend` y
`nortex frontend`. Antes de usar login o registro, verificá que
`http://127.0.0.1:4174/api/health` responda JSON de la API y no el fallback HTML de
Vite. Para cada hallazgo capturá antes/después con los mismos datos, ruta, viewport
y preferencias.

Cuando el criterio sea “mostrar el producto”, `/demo` no basta. Creá o reutilizá un
tenant sintético local y recorré explícitamente las rutas autenticadas incluidas en
el alcance. Si la sincronización de schema solicita `--accept-data-loss`, detenete:
agregá un preflight/migración aditiva o usá una base nueva y aislada. Nunca fuerces
la base compartida para obtener una captura.
La evidencia debe registrar:

```text
ID del hallazgo y veredicto
SHA / fecha / navegador y versión
ruta / rol / tenant sintético
viewport, DPR y preferencias de movimiento/contraste
pasos ejecutados y resultado
ruta del screenshot o video, sin PII
salida del test o contador asociado
limitaciones: qué NO fue probado
```

Antes de solicitar staging, mostrá al responsable:

1. el flujo completo reparado, no solo el componente aislado;
2. comparación antes/después;
3. móvil, desktop, teclado y reduced motion;
4. ratchets antes/después y QA ejecutado;
5. riesgos pendientes y rollback.

La aprobación de esta demostración significa **“candidato local aceptado”**. No
equivale a autorización de push, staging ni producción.

## 8. Compuerta de staging

Staging requiere autorización propia. Después de obtenerla:

1. fijá el SHA candidato y revalidá que la base relevante no avanzó; CI verde de un
   SHA viejo no sirve;
2. corré preflight de schema/backup cuando aplique y confirmá que no hay DDL
   destructivo ni `--accept-data-loss`;
3. desplegá **solo staging** y verificá `/api/health`: `ok`, `db` y commit exacto;
4. repetí las rutas, viewports, preferencias y contadores de la evidencia local;
5. para dinero/stock, hacé smoke autenticado con tenant sintético, idempotencia y
   ausencia de movimientos no esperados;
6. adjuntá evidencia de staging y cualquier diferencia respecto de local.

Un `503` transitorio no es éxito ni fracaso definitivo: reintentá de forma acotada y
aceptá únicamente una respuesta saludable del SHA esperado. Staging saludable deja el
candidato en `LISTO PARA PRODUCCIÓN`, no en `PRODUCCIÓN`.

## 9. Autorización y producción

La autorización debe nombrar ambiente, alcance y SHA. Formato recomendado:

```text
AUTORIZO PRODUCCIÓN del ciclo <ID>, SHA <sha-completo>, alcance <resumen>,
ventana <fecha/hora>, con rollback <referencia>.
Autorizado por: <nombre> · Fecha: <ISO-8601>
```

“Aprobado”, “se ve bien”, aprobación del PR o autorización de staging no bastan si no
nombran producción. Sin esa autorización, detenerse en `LISTO PARA PRODUCCIÓN`.

Después de una autorización válida:

- promover exactamente el SHA mostrado y verificado;
- verificar salud, DB, SHA, rutas críticas y los ratchets en producción;
- para cambios financieros, ejecutar smoke autenticado con tenant sintético y una
  observación mínima de 30 minutos;
- si cambia el comportamiento esperado, detener la promoción y usar el rollback
  autorizado; nunca improvisar un rollback destructivo de schema.

## 10. Definition of Done

Un hallazgo puede marcarse **CERRADO PREPRODUCCIÓN** solamente si:

- tiene veredicto y causa raíz con evidencia reproducible;
- la reparación vertical y sus tests están en un SHA exacto;
- QA focalizada y compuerta local pasaron;
- ningún trinquete empeoró y el contador objetivo llegó a aceptación;
- existe evidencia local antes/después, incluida accesibilidad relevante;
- el responsable vio y aceptó el producto final local;
- staging sirve el mismo SHA y pasó smoke proporcional al riesgo;
- riesgos, limitaciones y rollback están documentados.

El ciclo solo puede marcarse **PRODUCCIÓN VERIFICADA** después de autorización
separada, promoción del SHA exacto, smoke y observación. Mientras cualquier P0 siga
abierto o parcial sin mitigación aceptada, el primer ciclo permanece **EN EJECUCIÓN**.

## 11. Aprendizaje y documentación del ciclo

Al cerrar cada slice, documentá: causa raíz, por qué escapó, señal más temprana que lo
habría detectado, test/ratchet agregado, deuda no resuelta y responsable del siguiente
paso. Si el problema puede repetirse, el aprendizaje debe convertirse en automatización
o criterio de aceptación, no quedarse únicamente en una nota.

## 12. Plantilla de reporte

```markdown
# Reporte preproducción — <ciclo> — <fecha>

Estado: EN EJECUCIÓN | LISTO PARA PRODUCCIÓN | PRODUCCIÓN VERIFICADA
SHA candidato: <sha completo>
Base verificada: <sha completo>
Worktree inicial/final: <resumen; cambios ajenos preservados>

## Resumen ejecutivo
- Qué problema operativo se resolvió:
- Qué sigue abierto:
- Recomendación: CONTINUAR | DETENER | ROLLBACK

## Inventario y adjudicación
| ID | Veredicto | Evidencia | Prioridad | Estado |
|---|---|---|---|---|
| P0-x | CONFIRMADO/REFUTADO/PARCIAL | <ruta> | P0-P3 | <estado> |

## Reparaciones verticales
- ID / causa raíz / archivos propios / conducta antes y después
- Riesgo de dinero, stock o tenant: SÍ/NO; compuerta aplicada

## QA y trinquetes
| Prueba/comando | Resultado | Evidencia |
|---|---|---|
| <comando exacto> | PASS/FAIL/BLOCKED | <artefacto> |
| <contador> | antes → después | <rutas/viewport> |

## Evidencia visual
- Local: <SHA, rutas, desktop, móvil, reduced motion, contraste>
- Muestra al responsable: <fecha, alcance, decisión>
- Limitaciones: <lo que no se probó>

## Staging
- Autorización de staging:
- SHA servido y `/api/health`:
- Smoke sintético y diferencias contra local:

## Producción
- Estado: NO AUTORIZADA | AUTORIZADA | VERIFICADA
- Autorizador, fecha, alcance y SHA:
- Smoke, observación y rollback:

## Aprendizajes y seguimiento
- Por qué escapó:
- Guardrail nuevo:
- Deuda/follow-up, responsable y fecha:
```
