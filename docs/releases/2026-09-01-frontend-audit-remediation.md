# Reporte de mejora preproducción — auditoría frontend — 2026-09-01

Estado: **QA LOCAL · WORKSPACE AUTENTICADO DÍA/NOCHE · MENÚ + TICKET + SELECTOR + EFECTIVO + ENTREGAS FLUIDOS · PROGRAMA APPLE INCOMPLETO · NO PRODUCCIÓN**

Base local observada: `d326c589a756db7977d14c94a625b6c895cb3313`

Candidato: worktree local no commitido y compartido; no existe todavía un SHA candidato

Producción: **NO AUTORIZADA**

## Resumen ejecutivo

La meta global Apple/HIG **no estaba cumplida** al iniciar esta revisión. La ruta
separada `/apple`, la landing y `/demo` probaron una dirección visual, pero no
demostraron adopción en el ERP autenticado. La matriz fresca de rutas confirmó la
inconsistencia: Inventario, Compras, Clientes, Proveedores e Inicio trabajaban sobre
canvas claro, mientras Cartera, Entregas, Caja y RR. HH. conservaban fondos oscuros
de módulo completo. Por tanto, el resultado anterior fue una rebanada y no “todo
Nortex”.

Este ciclo sí encontró y reparó infraestructura P0 —rampas de color, presión,
safe area, `dvh`, overscroll y objetivos táctiles— y dejó QA reproducible sobre un
tenant sintético aislado. También unificó el workspace de las **33 entradas de ruta
autenticadas** (30 pantallas distintas y tres aliases del panel prestamista): Cartera,
Entregas, Caja, RR. HH., Blueprint y Team dejaron de presentar fondos de módulo
incompatibles. El contrato central vive en `Layout.tsx` y `index.css`; POS conserva
su ticket/checkout oscuro como excepción funcional.

Eso todavía **no equivale a haber aplicado todo el programa Apple en todo Nortex**.
La auditoría original exige además sheets interrumpibles con gesto, migración del
ticket/menú/cobro móvil, drag del kanban, swipe operativo e indicadores animados.
El menú móvil autenticado fue la primera integración real de Fase 2 sobre el
motor spring rAF (`utils/fluidMotion.ts`); el ticket móvil, el selector de métodos
de pago, el cobro clásico en efectivo del POS y el kanban seguro de Entregas ya
reutilizan el mismo lenguaje de interacción.
La presión está cubierta en las ocho rutas originales, pero las fases 2 y 3 no
están integradas de extremo a extremo. Además, marketing,
autenticación, legal, blog, catálogos públicos, tracking, repartidores y superadmin
viven fuera de `Layout` y todavía usan varias familias visuales. Por eso la respuesta
honesta a “¿está en todo Nortex?” es **NO**.

No hubo staging, push, merge ni deploy. Producción continúa **NO AUTORIZADA** y una
compuerta local verde no cambia esa decisión.

## Actualización de cierre — apariencia Día/Noche y contraste

Esta pasada cerró la queja concreta del shell negro y del texto que se perdía sobre
fondos claros, sin declarar terminado el programa Apple completo de movimiento y
gestos. El `Layout` autenticado ahora expone una sola preferencia visual persistente
por dispositivo:

- **Día:** menú y header en material claro translúcido, con selección verde suave;
- **Noche:** shell, canvas, tarjetas y tonos semánticos oscuros sin negro puro;
- un único control conceptual `Día/Noche`, visible en el header de escritorio y
  dentro del menú completo en móvil, con `aria-pressed`, icono y objetivo de 44 px;
- `Inicio` y `Mi Equipo` migrados a texto y tonos semánticos que conservan contraste
  en ambos temas;
- POS conserva su composición operativa: catálogo claro y ticket/checkout oscuro.
  El bridge claro excluye explícitamente su chrome interno para no oscurecer textos
  sobre el ticket; esta regresión se detectó y reparó durante la verificación visual;
- la vista exclusiva del cobrador conserva su contexto oscuro aislado.

El contrato vive en `utils/workspaceTheme.ts`, `components/Layout.tsx`,
`nortex-tokens.css` e `index.css`. Las migraciones focales están en
`components/MiNegocio.tsx` y `components/TeamManagement.tsx`. No se modificó lógica
de negocio, permisos, dinero, inventario ni endpoints.

Contraste medido del contrato: shell tenue claro **4.72:1**, canvas tenue claro
**4.90:1**, tonos semánticos claros **5.40–6.52:1** y tonos oscuros al menos
**6.82:1**. Inicio, Equipo, menú móvil y POS se inspeccionaron en runtime; los
viewports desktop y 390×844 reportaron cero desborde horizontal. El botón se probó
`Día → Noche → Día` y la preferencia sobrevivió navegación entre rutas.

Evidencia exacta de esta pasada:

- Día / Inicio: `.codex/apple-theme-audit-2026-09-01/14-final-home-light-stable.png`;
- Noche / Inicio: `.codex/apple-theme-audit-2026-09-01/15-final-home-dark.png`;
- Día / Equipo: `.codex/apple-theme-audit-2026-09-01/03-after-team-light.png`;
- Noche / Equipo: `.codex/apple-theme-audit-2026-09-01/06-after-team-dark.png`;
- menú móvil: `08-after-mobile-menu-dark.png` y `09-after-mobile-menu-light.png`;
- POS después del aislamiento: `12-pos-final-operational-surface.png`.

QA final del worktree compartido: `nortex check` aprobado con Prisma generate,
TypeScript, **243 archivos de prueba aprobados y 10 omitidos**, **3,262 pruebas
aprobadas y 63 omitidas**, sistema de diseño 69/0, build de 2,504 módulos y PWA con
154 entradas. Las cinco suites focales de apariencia aprobaron **39/39**.
`git diff --check` también aprobó. No hubo deploy, push, webhook ni mutación de BD.

### Ajuste final solicitado — menú legible y botón único

La revisión visual posterior detectó que la primera pasada todavía dejaba el rail
de escritorio demasiado cercano al negro y que el selector textual ocupaba más
espacio del necesario. El corte final se limitó al shell:

- el material Día adopta el gris cálido translúcido de la referencia `/apple`;
- el material Noche eleva menú y header sobre un grafito translúcido en vez de
  usar negro plano;
- iconos y etiquetas del rail, barra inferior y menú completo heredan siempre el
  color semántico del shell, sin depender de utilidades claras u oscuras heredadas;
- el selector es un único botón circular de 44 px: luna para entrar a Noche y sol
  para volver a Día. El texto de acción sigue disponible para lectores de pantalla,
  `title` y la semántica de botón presionado;
- los items del menú recuperan relieve propio con borde y material sutil, así el
  texto deja de perderse tanto sobre blanco como sobre grafito;
- el menú completo conserva cards, footer, foco, cierre y scroll sin recortes en
  390×844.

El contraste calculado de los tres niveles del shell sobre su material compuesto es
**14.56:1 / 8.66:1 / 5.18:1 en Día** y **15.56:1 / 11.14:1 / 7.66:1 en Noche**
(principal / secundario / tenue). La inspección real no encontró P0/P1 de contraste,
solapamiento ni recorte.

Evidencia fresca de este ajuste:

- referencia Apple: `.codex/apple-theme-audit-2026-09-01/21-apple-landing-reference-current.png`;
- escritorio Día/Noche: `team-menu-final-light.png` y `team-menu-final-dark.png`;
- menú móvil Día/Noche: `team-mobile-menu-final-light.png` y
  `team-mobile-menu-final-dark.png`.

La compuerta final aprobó Prisma 6.4.1 generate, TypeScript, **248 archivos de
prueba aprobados y 10 omitidos**, **3,291 pruebas aprobadas y 63 omitidas**, sistema
de diseño **73/0**, build de **2,508 módulos** y PWA con 154 entradas. Las cuatro
suites focales del shell aprobaron **27/27** y `git diff --check` quedó limpio. El
cambio no tocó rutas, permisos, dinero, inventario, endpoints ni datos de negocio,
y no hubo deploy, push, webhook o mutación de BD.

### Cierre verificable del shell Día/Noche

El ajuste final dejó el rail y el header fuera del negro plano y redujo el
selector a un solo botón de 44 px, sin perder semántica ni foco. La revisión
visual aceptada en la misma corrida local quedó en:

- escritorio Día: `.codex/apple-theme-audit-2026-09-01/team-menu-final-light.png`
- escritorio Noche: `.codex/apple-theme-audit-2026-09-01/team-menu-final-dark.png`
- menú móvil Noche: `.codex/apple-theme-audit-2026-09-01/team-mobile-menu-final-dark.png`
- workspace autenticado Noche: `.codex/apple-system-e2e-2026-09-01-cycle4/11-inventory-desktop-night-fixed`

La primera compuerta completa detectó dos regresiones honestas del propio corte:

- `tests/moduleSurfaceTheme.test.ts` seguía leyendo `components/POS.tsx` como texto;
- `components/POS.tsx` se había pasado del presupuesto por 2 líneas.

Se corrigió el acople de la prueba y el POS quedó en **7,579 líneas**, por debajo
del techo de **7,581**, sin mover la lógica de cobro. Después de esa corrección,
la compuerta completa local pasó con Prisma generate, TypeScript, **257 archivos
de prueba aprobados y 11 omitidos**, **3,356 pruebas aprobadas y 64 omitidas**,
sistema de diseño **75/0**, build de **2,512 módulos** y PWA de **154 entradas**.
`git diff --check` quedó limpio. Los únicos avisos no bloqueantes siguieron siendo
la base de Browserslist desactualizada y chunks mayores de 500 kB.

## Actualización Fase 2 — menú móvil fluido real

Esta pasada sustituyó el montaje instantáneo del menú móvil por una hoja reusable
`FluidSheet`, integrada en el `Layout` autenticado. No es una animación de landing:
usa las rutas, permisos, aviso de venta en curso, nombre del negocio y selector de
apariencia reales del ERP.

El corte mantiene la lógica de negocio fuera de la primitive y agrega:

- resorte rAF interrumpible desde el valor presentado, con transferencia de
  velocidad cuando cambia el destino;
- arrastre desde una zona táctil de 44 px, histéresis de 10 px, `rubberband` en el
  límite superior y decisión de cierre mediante velocidad + `projectMomentum`;
- backdrop y opacidad ligados continuamente al desplazamiento;
- cierre por gesto, backdrop, botón y `Escape`, con captura de foco, restauración
  del foco original y bloqueo de scroll;
- absorción de taps durante la cola de salida para impedir click-through a la
  pantalla subyacente;
- apertura inmediata bajo `prefers-reduced-motion`, conservando el gesto directo
  de la persona sin reproducir un resorte automático;
- recálculo de altura, umbral y backdrop al rotar o cambiar el viewport;
- material Día/Noche derivado de tokens, incluidos `prefers-reduced-transparency`
  y safe areas.

QA de este vertical:

- `tests/fluidSheet.test.tsx`: apertura, foco, Escape, rubberband, snap de retorno,
  descarte por umbral, backdrop, protección contra click-through, resize,
  interrupción y reduced motion;
- `nortex check`: Prisma 6.4.1 generate, TypeScript, **244 archivos aprobados y
  10 omitidos**, **3,269 pruebas aprobadas y 63 omitidas**, diseño **70/0**, build
  de **2,505 módulos** y PWA con 154 entradas;
- navegador autenticado real en 390×844: apertura Día/Noche, contraste computado,
  foco inicial, cierre por arrastre, cierre por Escape, restauración de foco,
  scroll liberado y **0 errores/warnings de consola**;
- la cola completa de cierre quedó en aproximadamente **696 ms** en la prueba viva;
  la superficie sigue bloqueando taps hasta desmontarse.

Evidencia: `.codex/apple-system-audit-2026-09-01/20-mobile-fluid-menu-light.png`
y `21-mobile-fluid-menu-dark.png`. No se abrió caja, confirmó venta, escribió
inventario ni cambió una regla financiera.

El alcance de esta primera integración fue deliberadamente parcial: el menú quedó
cerrado antes de tocar el POS. Las pasadas siguientes migraron la carcasa del ticket,
el selector de métodos y, en un corte separado, la presentación del cobro clásico
sin mover su validación financiera.

## Actualización Fase 2 — ticket móvil real del POS

Esta pasada reemplazó el `translate-y-full/translate-y-0` de duración fija que
servía como drawer móvil del ticket por una composición responsive sobre
`FluidSheet`. El contenido del ticket sigue siendo un único árbol: no se duplicaron
formularios, IDs, totales, cliente, líneas ni acciones de cobro.

La frontera nueva `components/pos/PosTicketShell.tsx` decide solamente presentación:

- por debajo de `lg`, el ticket es una hoja modal de altura completa con resorte,
  backdrop, handle de 44 px, foco contenido, `Escape`, restauración del foco y
  bloqueo de scroll;
- en `lg+`, sigue siendo el sidebar persistente existente, sin backdrop, sin
  `aria-modal` y sin bloquear el `body`;
- al pasar de escritorio a móvil, el ticket se abre para conservar el contexto en
  vez de desaparecer durante un resize u orientación;
- solo una rama se monta a la vez, evitando IDs duplicados en los formularios de
  cliente;
- `showMobileCart` continúa siendo el estado de presentación autoritativo de POS.
  No se movieron ni alteraron `handleCheckout`, `openCashCheckout`, otros pagos,
  parqueo, totales, stock, red ni endpoints.

La revisión independiente detectó antes del gate que el primer corte podía ocultar
el ticket al reducir una ventana desktop. Se corrigió la continuidad del breakpoint
y se agregó una prueba que exige ticket visible, un solo contenido, body lock
correcto y foco útil. El primer `nortex check` también rechazó una prueba estática
que leía `POS.tsx` como texto; esa prueba se eliminó en vez de ampliar una lista
blanca. La cobertura final renderiza la carcasa y el presupuesto de `POS.tsx`
permanece en **7,730/7,730 líneas**.

QA final de este vertical:

- `tests/posTicketShell.test.tsx`: móvil modal, foco, `Escape`, retorno al trigger,
  desktop inline, montaje único y ambos sentidos del breakpoint;
- `tests/fluidSheet.test.tsx`: gesto, rubberband, umbral, interrupción, resize,
  reduced motion y protección contra click-through;
- contratos financieros existentes de Caja Nica y pruebas críticas del POS sin
  cambios de expectativa;
- `nortex check`: Prisma 6.4.1 generate, TypeScript, **245 archivos aprobados y
  10 omitidos**, **3,273 pruebas aprobadas y 63 omitidas**, diseño **71/0**, build
  de **2,506 módulos** y PWA con 154 entradas;
- navegador autenticado real en viewport 771×623: apertura desde la barra de venta,
  `role=dialog`, `aria-modal`, título asociado, material del ticket, foco en cierre,
  scroll bloqueado, cierre por `Escape`, retorno al trigger y **0 errores/warnings
  de consola**. No se confirmó una venta ni se ejecutó una mutación.

Evidencia visual: `.codex/apple-system-audit-2026-09-01/22-pos-mobile-fluid-ticket.png`.
El selector de métodos y el efectivo clásico se migraron en las secciones
siguientes. Esta evidencia no autoriza staging ni producción.

## Actualización Fase 2 — selector de métodos de pago del POS

Esta pasada migró únicamente la carcasa visual del selector `showPaymentOptions`
a `components/pos/PosPaymentSheet.tsx`, reutilizando `FluidSheet` sin mover la
lógica de cobro. `handleCheckout`, `openCashCheckout`, `openOtherPaymentCheckout`,
totales, turnos, red, caja, inventario y endpoints permanecen en `POS.tsx` con
la misma autoridad funcional. El efectivo clásico se mantuvo fuera de este corte
y se migró después, en la sección siguiente.

El wrapper nuevo aporta solo comportamiento de superficie:

- en escritorio conserva una lectura de modal centrado sobre el ticket oscuro;
- en móvil cae como hoja inferior con el mismo material operativo del POS;
- el primer foco va al método inicial disponible (`Transferencia` en guiado,
  `Efectivo` en no guiado) y el `body` queda bloqueado mientras la hoja está
  abierta;
- `busy` bloquea `Escape`, backdrop y drag para no interrumpir un cobro que ya
  está registrándose;
- `dragToDismiss` se desactiva explícitamente durante `busy`, sin cambiar el
  comportamiento del ticket ni el modal de efectivo;
- si el viewport cruza de escritorio a móvil mientras el selector está abierto,
  el ticket queda suspendido y solo permanece un `dialog` accesible.

La integración reemplazó el backdrop fijo legacy del selector por una sola rama
de render con `role="dialog"`, `aria-modal`, título asociado y contenido único.
El presupuesto del monolito también mejoró: `components/POS.tsx` quedó en
**7,729 líneas**, por debajo del límite de **7,730**. No se tocaron los bloques
que validan efectivo, los atajos de caja ni la confirmación final de venta.

QA de este vertical:

- `tests/posPaymentSheet.test.tsx`: **5/5** sobre árbol único, foco inicial,
  cierre con `Escape`, restauración del flujo, backdrop libre, bloqueo total en
  `busy` y regresión escritorio → móvil con un solo diálogo;
- `tests/fluidSheet.test.tsx`, `tests/posTicketShell.test.tsx` y
  `tests/posVentaCritica.test.tsx`, junto con Caja Nica: **27/27 pruebas
  aprobadas** en la batería focalizada del shell y del flujo crítico de venta;
- compuerta completa local: Prisma 6.4.1 generate, TypeScript,
  **247 archivos de prueba aprobados y 10 omitidos**, **3,279 pruebas aprobadas
  y 63 omitidas**, diseño **72/0**, build de **2,507 módulos** y PWA con
  154 entradas;
- `git diff --check` limpio;
- navegador autenticado real en **1280×720** y **390×844**: selector visible,
  foco inicial correcto, `body` bloqueado, una sola capa modal, cierre operativo,
  viewport restaurado y **0 errores/warnings de consola**. Para alcanzar la
  superficie se abrió únicamente una caja del tenant sintético con C$0; no se
  confirmó venta ni se movió inventario, el carrito se descartó y la caja quedó
  cerrada con esperado/declarado C$0.00.

Evidencia visual:
`.codex/apple-system-audit-2026-09-01/23-pos-payment-sheet-desktop.png` y
`.codex/apple-system-audit-2026-09-01/24-pos-payment-sheet-mobile.png`.
La producción continúa **NO AUTORIZADA**; esto cierra solo la carcasa del
selector de métodos de pago.

## Actualización Fase 2 — efectivo clásico fluido del POS

Esta pasada sustituyó el backdrop/modal fijo de `showCashPreModal` por
`components/pos/PosCashSheet.tsx`, compuesto sobre la misma
`PosPaymentSheet`/`FluidSheet`. La extracción es presentacional: estados de efectivo,
turno, `cashPaymentValidation` y `handleCheckout('CASH')` continúan en `POS.tsx`;
el guard autoritativo vuelve a validar el monto antes del lock, la cola offline y
el POST. No cambió el payload ni se movió autoridad de dinero o inventario.

La superficie nueva aporta:

- encabezado y acciones fijos, con un cuerpo interno desplazable dentro de `dvh`
  y safe areas; vuelto y faltante se desplazan dentro de ese cuerpo hasta quedar
  visibles sin mover el diálogo completo ni la página;
- foco inicial en el input para teclado físico y en `Monto exacto` cuando el
  dispositivo declara puntero grueso, evitando abrir dos teclados en NIO;
- captura USD tolerante a estados parciales como `.` y `123.`, sin construir un
  `Decimal` inválido durante render;
- vuelto/faltante con `role="status"`, `aria-live`, `aria-describedby`,
  `aria-invalid`, selector USD con `aria-pressed` y confirmación válida por Enter;
- todos los inputs, moneda, denominaciones, keypad, cierre y acciones quedan
  deshabilitados durante `processing`; `Escape`, backdrop y drag ya estaban
  bloqueados por la carcasa;
- F2, F4, F7, F8, F9 y Ctrl/Cmd+K/Enter quedan suspendidos mientras el selector
  de método o el efectivo están abiertos, para no enfocar ni abrir operaciones
  detrás del diálogo;
- el ticket móvil también se suspende durante `showCashPreModal`. La prueba visual
  detectó que el primer corte dejaba dos diálogos al cruzar desktop → móvil; el
  guard y la regresión de render exigen ahora una sola capa accesible.

La revisión independiente final también cerró una carrera de foco al entrar en
`processing`: `FluidSheet` conserva su efecto y consulta `closeOnEscape` mediante
una referencia estable, sin devolver momentáneamente el foco al buscador de fondo.

El trinquete de deuda bajó `components/POS.tsx` de **7,729 a 7,581 líneas** y el
presupuesto quedó pegado en **7,581/7,581**. La lógica extraída no se duplicó en el
monolito.

QA final de este vertical:

- `tests/posCashSheet.test.tsx`: **6/6** sobre foco/body lock, USD parcial,
  conversión Decimal, keypad, sugerencias, vuelto/faltante anunciado, bloqueo
  completo en `processing`, scroll interno de vuelto/faltante y
  confirmación/cancelación única;
- `tests/posVentaCritica.test.tsx`: **12/12**, incluido POS no guiado real,
  efectivo insuficiente sin POST, selector ocupado, suspensión de hotkeys y
  transición desktop → móvil con un solo diálogo;
- batería focal final de `FluidSheet`, selector, efectivo, flujo crítico y
  presupuesto POS: **35/35**;
- compuerta completa local final: Prisma 6.4.1 generate, TypeScript,
  **248 archivos de prueba aprobados y 10 omitidos**, **3,291 pruebas aprobadas y
  63 omitidas**, diseño **73/0**, build de **2,508 módulos** y PWA con 154 entradas;
- `git diff --check` limpio;
- navegador autenticado real en **1280×720** y **390×844**: C$158.00 de total,
  C$200.00 recibido y C$42.00 de vuelto visibles, un solo diálogo en móvil y
  viewport restaurado. No se pulsó `Cobrar`.

Evidencia visual:
`.codex/apple-system-audit-2026-09-01/25-pos-cash-sheet-desktop.png` y
`.codex/apple-system-audit-2026-09-01/26-pos-cash-sheet-mobile.png`.
Para alcanzar la superficie se abrió una caja del tenant sintético con C$0.00;
el carrito se descartó sin venta ni movimiento de inventario y el turno terminó
cerrado con esperado/declarado C$0.00. Producción continúa **NO AUTORIZADA**.

## Contrato visual global Apple/HIG

El contrato aprobado para las rutas operativas autenticadas es:

- una preferencia `light | dark` explícita y persistente; canvas, tarjetas, texto,
  shell y estados cambian juntos mediante tokens, sin invertir imágenes ni datos;
- en Día, material claro translúcido en la navegación y canvas neutro/cálido; en
  Noche, superficies elevadas oscuras sin negro puro;
- tipografía de sistema desde `--nx-font` y `--nx-font-display`;
- esmeralda como único acento primario de acción y selección;
- rojo y ámbar reservados para peligro, vencimiento, bloqueo o advertencia;
- superficies oscuras funcionales explícitas permitidas dentro del POS y en el
  contexto aislado del conductor;
- ningún módulo operativo puede fijar un tema propio que contradiga la preferencia
  global, salvo esas excepciones documentadas.

La compuerta estática cubre el bridge global de Layout y las migraciones directas de
Dashboard, Inventario, Compras, Clientes, Proveedores, Cartera, Entregas, Caja,
RR. HH. y Blueprint. La matriz renderizada recorre las 33 entradas autenticadas y
separa POS como excepción. Una ruta nueva debe incorporarse explícitamente a la
matriz/contrato antes de considerarse cerrada.

Estado de adopción al abrir esta fase:

| Grupo | Estado | Criterio de cierre |
|---|---|---|
| Shell, Inicio, Inventario, Compras, Clientes, Proveedores | Día/Noche heredado; Inicio migrado directo | Seguir migrando componentes heredados desde el bridge a primitivas semánticas |
| Cartera, Entregas, Caja | Unificación visual local cerrada | Workspace claro, estados focales y capturas autenticadas |
| RR. HH., Blueprint, Team | Día/Noche heredado; Team migrado directo | Código oscuro solo como isla funcional; cerrar deuda del bridge por componente |
| POS | Excepción funcional controlada | Catálogo claro; oscuridad solo en ticket/checkout |
| Conductor | Excepción funcional controlada | Contexto oscuro aislado, no heredado por el ERP |
| Movimiento Apple fase 2 | En progreso: menú, ticket, selector, efectivo y Entregas cerrados | Migrar swipes e indicadores restantes sin tocar autoridad de negocio |
| Gestos de dominio fase 3 | En progreso: drag seguro de Entregas cerrado | Completar swipe operativo e indicadores animados |
| Superficies fuera de `/app/*` | No unificadas | Definir contrato para marketing, auth, legal, blog, catálogo, tracking, driver y admin |

## Condiciones y límites del ciclo

- La rama ya estaba adelantada y el worktree contenía cambios ajenos, incluidos
  backend, schema, dinero e inventario. Se inventariaron y preservaron; no se hizo
  `reset`, `clean`, rebase, cambio de rama ni worktree.
- Las reparaciones del producto son de presentación, interacción y conectividad del
  stack de desarrollo. No cambiaron handlers de negocio, permisos, tenant, cálculos,
  caja ni reglas de stock.
- La primera demo usó `/demo`. La segunda creó `Ferretería Nortex QA Local` y catorce
  productos ficticios dentro de la base aislada `nortex_ui_audit`; no usó
  credenciales, tenants ni datos de clientes.
- Se agregó el proxy `/api` de Vite hacia `127.0.0.1:3210`: sin él, el flujo canónico
  `nortex frontend` + `nortex backend` devolvía HTML en vez de JSON para login,
  registro y datos autenticados.
- `mise exec node@22.23.2 -- sh scripts/ci-local-safe.sh` validó el worktree
  completo, pero no sustituye mutación financiera,
  MySQL concurrente, smoke autenticado ni validación de staging.

## Adjudicación de los hallazgos

| ID | Veredicto | Causa confirmada | Estado al cierre local |
|---|---|---|---|
| P0-1 Movimiento muerto | CONFIRMADO | Clases usadas sin un contrato único de compilación y restos de utilidades muertas | Guardrail de tokens + limpieza focal; QA local |
| P0-2 Rampas aplanadas | CONFIRMADO | Aliases genéricos colapsaban `red`, `amber` y `sky` | Rampas canónicas y semánticos `brand/danger/warning/info`; QA local |
| P0-3 Entregas claro/oscuro | CONFIRMADO | La ruta completa seguía oscura dentro de un producto operativo claro | Convertida a workspace claro y verificada en desktop/móvil local |
| P0-4 Contraste | PARCIAL | La colisión de paleta era real; la primera demo local aún mostró 6 textos a 2.20:1 | Demo corregida a 0/62 y rutas autenticadas inspeccionadas; medición completa en staging pendiente |
| P0-5 Safe area y viewport | CONFIRMADO | Faltaba `viewport-fit=cover` y había alturas operativas con `100vh` | `dvh`, padding seguro y 0 desborde en la demo; dispositivo iOS pendiente |
| P0-6 Overscroll | CONFIRMADO | No había contención global ni en scrollers internos | Contención agregada; prueba física de pull-to-refresh pendiente |
| P0-7 Presión y 44 px | PARCIAL | Cobertura desigual y escalas aisladas; el contador original mezclaba controles que no deben escalar | Ocho módulos no-POS a 0; demo 0/24; POS conserva 99 botones nativos sin primitive |

El estado global permanece **NO LISTO PARA PRODUCCIÓN**. La unificación cromática
del workspace autenticado está cerrada localmente, pero el programa de movimiento y
gestos Apple no está completo; tampoco existe un SHA candidato limpio ni evidencia
de staging/dispositivo físico.

## Reparaciones verticales

### Infraestructura visual y PWA

- `tailwind.config.js`: rampas oficiales para alerta, peligro e información;
  semánticos de producto y contrato de movimiento compilable.
- `index.html` e `index.css`: `viewport-fit=cover`, safe area, `dvh`, contención de
  overscroll, fallback `nx-fluid-press`, foco visible y reduced motion.
- `DeliveryManager.tsx`: el primer ciclo aisló la superficie oscura y corrigió
  objetivos táctiles/transiciones sin tocar dominio; la matriz global posterior
  rechazó esa frontera como solución final y abrió su conversión a workspace claro.
- Se eliminaron tokens muertos y usos operativos afectados de `100vh` en las
  superficies adjudicadas.

### Interacción incremental

- Se reutilizó el motor rAF existente (`useFluidPress`/`fluidMotion`) para los gestos
  continuos; no se agregó una segunda dependencia de animación.
- `FluidSheet` conecta `rubberband`, `projectMomentum`, velocidad y retargeting a
  cuatro contenedores reales: menú móvil, ticket móvil, selector de pago y efectivo
  clásico del POS.
- Los controles discretos usan el fallback CSS inmediato `nx-fluid-press`; los que
  ya usan el motor conservan interrupción, velocidad y reduced motion.
- Layout, Caja, Inventario, Compras, Ventas, Entregas, Cartera y Cuentas por cobrar
  quedaron en cero botones nativos sin primitive dentro del trinquete estático.
- POS redujo su conteo medido de 109 a 99 sin subir el presupuesto de tamaño; las
  extracciones del selector y efectivo clásico dejaron el archivo en 7,581 líneas.
- `transition-all` bajó de 23 a 0 en los nueve módulos auditados.
- Los aliases globales `.btn-primary` y `.btn-ghost` comparten el mismo fallback
  de presión y reduced motion, sin reintroducir `transition-all` ni una escala aislada.

### Hallazgos descubiertos por la muestra renderizada

La primera captura móvil encontró defectos que el grep no detectó:

1. `Tarjetas`, `Compacta` y `Vaciar` medían menos de 44 px en al menos un eje.
   Se corrigieron y el mismo contador pasó de 3/24 a 0/24.
2. Los seis textos `Agregar` usaban verde de marca claro sobre blanco y medían
   2.20:1. Se creó una tinta de marca oscura mediante `text-brand-800`; el mismo
   auditor pasó de 6/62 fallos a 0/62.

Ambas correcciones quedaron protegidas en tests focales.

## Trinquetes y QA

| Evidencia | Resultado local |
|---|---|
| Controles visibles `/demo`, viewport 390×844 | 24 revisados; 0 bajo 44 px |
| Geometría móvil | `clientWidth=384`, `scrollWidth=384`; sin desborde horizontal |
| Contraste de texto visible | 62 pares revisados; 0 bajo WCAG AA |
| Reduced motion emulado | media query activa; transición `0s`, animación `0.00001s`; preferencia restaurada |
| Consola de `/demo` | 0 errores y 0 warnings capturados |
| Teclado | Test de render confirma `Enter` en densidad y `Space` al volver del cobro |
| `tests/frontendInteractionDebt.test.ts` | Presupuestos no-POS solo pueden bajar; 0 deuda en los módulos incluidos |
| Presupuesto POS | 7,581/7,581 líneas; el trinquete bajó con la extracción |
| Matriz autenticada desktop | 33 entradas / 30 pantallas distintas; canvas claro salvo POS; sin desborde horizontal observado |
| Muestra móvil 390×844 | Inicio, Inventario, Cartera y Entregas sin desborde horizontal observado |
| `nortex check` | PASS: Prisma generate, TypeScript, 240 archivos pasaron, 10 omitidos; 3,250 tests pasaron, 63 omitidos; diseño y build/PWA |
| `nortex check` después de `FluidSheet` | PASS: Prisma generate, TypeScript, 244 archivos pasaron, 10 omitidos; 3,269 tests pasaron, 63 omitidos; diseño 70/0 y build/PWA |
| `nortex check` después del ticket POS | PASS: Prisma generate, TypeScript, 245 archivos pasaron, 10 omitidos; 3,273 tests pasaron, 63 omitidos; diseño 71/0, build 2,506 módulos y PWA 154 entradas |
| `nortex check` después del selector de pago | PASS: Prisma generate, TypeScript, 247 archivos pasaron, 10 omitidos; 3,279 tests pasaron, 63 omitidos; diseño 72/0, build 2,507 módulos y PWA 154 entradas |
| `nortex check` después del efectivo clásico | PASS: Prisma generate, TypeScript, 248 archivos pasaron, 10 omitidos; 3,286 tests pasaron, 63 omitidos; diseño 73/0, build 2,508 módulos y PWA 154 entradas |
| `nortex check` final después de revisión independiente | PASS: Prisma generate, TypeScript, 248 archivos pasaron, 10 omitidos; 3,291 tests pasaron, 63 omitidos; diseño 73/0, build 2,508 módulos y PWA 154 entradas |
| `nortex check` después del ciclo de Entregas | PASS: Prisma generate, TypeScript, 251 archivos pasaron, 10 omitidos; 3,313 tests pasaron, 63 omitidos; diseño 75/0, build 2,511 módulos y PWA 154 entradas |
| `git diff --check` | PASS |

Advertencias no bloqueantes observadas: base de Browserslist con seis meses y chunk
`xlsx` sobre el umbral de 500 kB. No se actualizaron dependencias dentro de este
ciclo visual.

## Evidencia visual local

- Escritorio: `.codex/frontend-audit-local-desktop.png`
- Móvil 390×844: `.codex/frontend-audit-local-mobile.png`
- Cobro de escritorio: `.codex/frontend-audit-local-checkout.png`
- Flujo: catálogo → carrito con tres unidades → total C$615.00 → métodos de pago.
- La pestaña local quedó abierta como demostración; en ese primer flujo público no
  se confirmó una venta ni se escribió ningún dato de negocio.

Sistema autenticado real, tenant sintético y base aislada:

- Inicio: `/app/inicio`
- POS con catorce productos: `.codex/nortex-real-pos.jpg`
- Inventario con 950 unidades ficticias: `.codex/nortex-real-inventory.jpg`
- Cartera: `.codex/nortex-real-receivables.jpg`
- Caja, Compras y Entregas también se recorrieron con respuestas reales de API; no
  se abrió turno, procesó compra, creó entrega ni confirmó venta.
- Evidencia final de la unificación: `.codex/apple-system-audit-2026-09-01/07-*.jpg`
  a `17-*.jpg`, con Inicio, Cartera, Entregas, Caja, RR. HH., Blueprint, Team, POS
  y las muestras móviles.
- Menú móvil fluido real: `20-mobile-fluid-menu-light.png` y
  `21-mobile-fluid-menu-dark.png` en el mismo directorio.
- Selector de pago POS real: `23-pos-payment-sheet-desktop.png` y
  `24-pos-payment-sheet-mobile.png` en el mismo directorio.
- Efectivo clásico POS real: `25-pos-cash-sheet-desktop.png` y
  `26-pos-cash-sheet-mobile.png` en el mismo directorio.

## Lo que no está verificado

- No se completó una venta, compra, entrega ni cobro fiado. Las verificaciones del
  selector y efectivo usaron únicamente aperturas/cierres C$0 en el tenant sintético
  aislado; terminaron cuadradas en C$0, sin venta ni movimiento de stock.
- La simulación de teclado del navegador integrado no produjo una transición
  observable; la conducta quedó cubierta por test de render, pero requiere una
  pasada manual en staging.
- No se probó iPhone físico, home indicator, teclado virtual, pull-to-refresh ni
  rotación.
- Menú, ticket móvil, selector de métodos, efectivo clásico y kanban de Entregas ya
  usan el lenguaje fluido; todavía no se migraron los swipes de Inventario/Ventas
  ni todos los indicadores de las fases 2–4.
- No se unificaron bajo un solo contrato Apple las superficies externas a
  `/app/*`: marketing, login/registro/recuperación, legal, blog, catálogo público,
  tracking, repartidor y superadmin.
- No hubo CI remoto, commit candidato, staging, `/api/health` de SHA exacto, smoke
  financiero autenticado del candidato, observación ni rollback ensayado.
- No se verificaron ni aprobaron los cambios ajenos de backend/schema presentes en
  el worktree.
- `nortex app-up` rechazó correctamente un `db push` sobre `nortex_dev`: faltan
  preflights aditivos para dos índices únicos de `ProductReturn`. No se usó
  `--accept-data-loss`; la demostración continuó sobre `nortex_ui_audit` aislada.

## Ciclo 2 — Entregas: gesto seguro, móvil compacto y autoridad del servidor

La reparación se aplicó a la ruta autenticada real `/app/delivery`, no a una
landing. El tenant local disponible tenía cero pedidos y cero motorizados; esa
realidad se conservó y no se fabricaron tarjetas ni escrituras de backend para
producir una captura más vistosa.

### Seguridad de dominio

- El drag solo expone transiciones seguras: `pendiente → preparando` y
  `preparando → en_camino`; nunca permite confirmar `entregado` mediante gesto.
- Pasar a `en_camino` exige un motorizado confirmado por el servidor.
- La asignación ejecuta un único `PATCH` y adopta el `motorizadoId` canónico de la
  respuesta; el valor solicitado por el cliente nunca sustituye la autoridad del
  backend.
- Las mutaciones son optimistas, pero hacen rollback visible ante fallo y usan una
  época de datos para impedir que un polling viejo sobrescriba una transición más
  reciente.
- Cancelar, perder captura de puntero, pulsar Escape o soltar fuera del destino no
  muta el pedido. El botón accesible conserva la misma matriz de estados.

### Reparación de experiencia

- En móvil, las cuatro columnas son un carrusel horizontal compacto con snap y un
  selector `radiogroup` navegable; ya no se apilan cuatro paneles largos.
- El drag de escritorio tiene asa dedicada, seguimiento 1:1 y asentamiento con
  amortiguación crítica; `prefers-reduced-motion` elimina movimiento no esencial.
- El alta de motorizado usa `FluidSheet` con bloqueo de fondo, Escape, trampa y
  restauración de foco, labels reales y cierre protegido durante guardado.
- El workspace oscuro deja de convertir headers translúcidos en superficies claras
  con texto ilegible; Día y Noche conservan contraste en escritorio y móvil.

### Evidencia local de este ciclo

- Escritorio Día: `.codex/apple-delivery-audit-2026-09-01-cycle2/06-after-desktop-light-empty.png`
- Escritorio Noche: `.codex/apple-delivery-audit-2026-09-01-cycle2/05-after-desktop-dark-empty.png`
- Móvil Día: `.codex/apple-delivery-audit-2026-09-01-cycle2/08-after-mobile-light-empty-refined.png`
- Móvil Noche: `.codex/apple-delivery-audit-2026-09-01-cycle2/09-after-mobile-dark-empty-refined.png`
- Sheet de motorizado: `.codex/apple-delivery-audit-2026-09-01-cycle2/10-after-mobile-dark-rider-sheet.png`
- Estado Preparando: `.codex/apple-delivery-audit-2026-09-01-cycle2/11-after-mobile-dark-preparing-tab.png`
- QA focal: 8 archivos, 67 tests pasaron; TypeScript, diseño 75/0 y
  `git diff --check` focal pasaron.
- Compuerta completa final: Prisma generate, TypeScript, 251 archivos y 3,313 tests
  pasaron; 10 archivos y 63 tests fueron omitidos por su configuración; diseño
  75/0, build de 2,511 módulos y PWA de 154 entradas pasaron.
- Revisión independiente: sin hallazgos bloqueantes después de corregir autoridad
  canónica del servidor y semántica del selector.
- Deuda focal rastreada: 37 señales heurísticas antes y 14 después; las 14 restantes
  son duplicaciones mecánicas que quedan visibles en
  `.codex/frontend-tech-debt-delivery-after-2026-09-01.json`.

### Límite de evidencia

No hubo pedido real en el tenant local, por lo que el gesto sobre una tarjeta está
verificado por tests renderizados, no por una escritura autenticada de navegador ni
por touch físico. Tampoco hubo staging, SHA candidato, smoke financiero, deploy o
autorización de producción. La validación E2E autenticada de pedidos en navegador,
los swipes de Inventario/Ventas y las demás superficies del programa Apple siguen
abiertos.

## Ciclo 3 — Entregas: reconciliación histórica y contrato del candidato

Este apartado conserva el historial de la auditoría sin trasladar garantías entre
worktrees. El ciclo original se ejecutó sobre una variante local más amplia; el
candidato de release actual integra solo una parte de ese trabajo y se describe por
separado a continuación.

### Registro histórico del worktree de auditoría

El registro original atribuyó a aquella variante paginación de pedidos, una matriz
de transiciones impuesta por el backend, row-lock en la asignación, schemas estrictos
de flota, un select operativo mínimo, migración al singleton de Prisma y una compuerta
E2E con MySQL efímero. También registró:

- QA focal backend/frontend de 4 archivos y 39 tests, seguida por 3 archivos y 19
  tests de Delivery;
- una compuerta completa de 253 archivos y 3,328 tests y, después del recorrido
  visual, otra de 255 archivos y 3,340 tests;
- una corrida HTTP `1/1` contra MySQL con dos tenants sintéticos, reserva/liberación
  de inventario y cleanup de puertos, base y usuario efímeros;
- un recorrido autenticado desde `/login` hasta `en_camino`, sin marcar
  `entregado`, y las siguientes capturas:
  `.codex/apple-delivery-e2e-2026-09-01-cycle3/00-login-reference.png`,
  `00b-home-desktop-day.png`, `01-delivery-desktop-day-pending.png`,
  `02-rider-sheet-desktop-day.png`, `03-delivery-desktop-day-en-route.png`,
  `04-delivery-desktop-night-en-route.png`, `05-mobile-menu-day.png`,
  `06-delivery-mobile-day.png`, `07-rider-sheet-mobile-day.png`,
  `08-mobile-menu-night.png` y `09-delivery-mobile-night.png`.

Esos conteos, capturas y resultados preservan la trazabilidad de aquella sesión,
pero **no son evidencia de que esas mismas piezas estén presentes o hayan pasado en
el candidato actual**. En particular, no se usan para afirmar paginación, matriz de
estados, row-lock de asignación, singleton ni E2E MySQL en esta rama.

### Contrato real del candidato actual

- `GET /api/v1/pedidos` devuelve en una sola respuesta todos los pedidos del tenant,
  ordenados por fecha. No acepta `page`/`limit` ni devuelve `pageInfo`. El frontend
  hace una sola petición compatible con ese contrato y ya no introduce un límite
  artificial de 5 o 1,000 filas; la paginación de extremo a extremo sigue pendiente.
- Una selección de motorizado sigue siendo una sola acción para la persona, pero el
  frontend ejecuta y valida una cadena explícita contra el servidor:
  `PATCH motorizado → PATCH preparando/reserva → PATCH en_camino`. Si el pedido ya
  estaba en `preparando`, continúa desde el despacho. `en_camino` solo se solicita
  después de recibir confirmación de `preparando`, de modo que un fallo de reserva no
  dispara el despacho; si falla el último paso, la UI conserva y comunica que la
  asignación y la reserva sí quedaron confirmadas.
- La UI adopta el `motorizadoId` canónico de la respuesta, bloquea cambios simultáneos
  y evita que el polling de 15 segundos reemplace una transición pendiente con datos
  viejos. Cada respuesta de estado debe confirmar el estado esperado antes de
  actualizar la vista.
- El backend sí aísla por `tenantId` las lecturas de pedido y la reserva hacia
  `preparando`; esta última usa la transacción de fulfillment y mueve inventario con
  `applyStockDelta` y Kardex. También protege estados terminales en el handler
  general. Este apartado no atribuye un AuditLog general a la reserva: el código
  actual solo lo escribe para condiciones específicas de reconciliación de lotes.
- El backend impone una matriz autoritativa de estados bajo row-lock: la reserva solo
  puede comenzar desde `pendiente` o `asignado`; la entrega solo puede reclamarse
  desde un estado ya reservado/activo; y los estados de ruta `en_ruta`, `en_camino`
  y `en_punto` exigen un motorizado asignado. Un cliente PWA anterior ya no puede
  ejecutar `pendiente → en_camino`, reabrir terminales ni entregar sin pasar por la
  reserva. Los reintentos de preparación y cancelación conservan sus contratos de
  error/idempotencia.
- La Driver App ahora solo ofrece `Entregar y Cobrar` cuando el pedido ya está en un
  estado entregable (`en_tienda`, `en_ruta`, `en_camino`, `en_punto`). Si un pedido
  viejo aparece todavía como `asignado` o `preparando`, la UI lo muestra como
  pendiente de preparación en vez de invitar a una operación que el backend rechaza.
- `PATCH /api/v1/pedidos/:id/motorizado` ejecuta lock, relectura tenant-scoped,
  autorización del motorizado, compare-and-set del pedido y evento de tracking en una
  sola transacción. Rechaza pedidos facturados/terminales y devuelve `409` si pierde
  una carrera; asignar, reasignar o desasignar nunca deja el evento separado de la
  escritura canónica.
- El alta visual exige un PIN numérico de 4 a 6 dígitos y envía nombre, teléfono,
  zona, PIN y placa opcional al endpoint; el backend recorta los textos y normaliza
  el teléfono. El `POST` exige un PIN numérico de 4 a 6 dígitos antes de consultar
  credenciales o crear la fila, detecta conflictos por teléfono y el login del
  repartidor falla cerrado si encuentra identidades ambiguas. `PATCH` conserva el
  bootstrap/reset de PIN para registros legacy que todavía tengan `pinHash = null`.
- `GET`, `POST` y `PATCH /api/v1/motorizados` usan un select operativo explícito que
  excluye `pinHash`, tenant, KYC, imágenes de documentos, saldo y metadatos de wallet.
  El listado y el detalle autenticado de pedidos reutilizan ese mismo select al
  anidar el motorizado, por lo que tampoco serializan el modelo completo.
- `backend/routes/motorizados.ts` todavía instancia su propio `PrismaClient`; la
  migración al cliente compartido no forma parte de este candidato.
- `GET /api/v1/motorizados/:id/liquidacion` permanece aislado por el `tenantId`
  autenticado, pero aún devuelve el identificador interno `walletId`; reducir ese
  DTO queda como deuda de minimización y no se presenta como una fuga cross-tenant.

### Pendientes verificables antes de declarar completo el hardening

1. Paginar o cursar `GET /api/v1/pedidos` y hacer que el tablero consuma todas las
   páginas sin ocultar pedidos.
2. Auditar los teléfonos legacy y, después de sanear colisiones, definir una garantía
   de unicidad resistente a carreras para la identidad de login del repartidor.
3. Retirar `walletId` de la liquidación operativa si ningún consumidor autorizado lo
   necesita y fijar el DTO con una prueba de contrato.
4. Migrar la ruta al singleton Prisma y ampliar pruebas de integración de rutas y
   concurrencia contra MySQL 8.

Los tests focales del candidato cubren la secuencia de asignación, fallo de reserva,
fallo de despacho, respuestas no autoritativas, polling tardío, cambios rápidos y
conflictos de identidad. Sus resultados deben reportarse con la corrida terminal del
candidato, no heredarse de las cifras históricas anteriores. No hay en este apartado
evidencia nueva de staging, dispositivo iOS físico ni autorización de producción.

## Ciclo 4 — Día/Noche legible en el ERP autenticado completo auditado

Esta pasada respondió a la queja concreta de que el menú quedaba negro y de que
iconos, etiquetas y estados desaparecían al cambiar entre fondos claros y oscuros.
El recorrido se hizo sobre el producto autenticado de loopback con tenant sintético,
no sobre `/apple`, `/demo` ni una landing.

### Alcance recorrido en runtime

Se inspeccionaron en **Día y Noche** las rutas `/app/inicio`, `/app/dashboard`,
`/app/sales`, `/app/purchases`, `/app/inventory`, `/app/cash-registers`,
`/app/receivables` y `/app/delivery`. El POS se verificó en su superficie operativa
oscura propia. El menú, navegación y contenido de Inventario también se recorrieron
en 390x844, y el cierre final volvió a 1280x720 sin desborde horizontal.

Los defectos confirmados y reparados fueron:

- ticket/resumen de Compras aclarado con texto blanco y estados semánticos débiles;
- encabezado, pestañas, subtítulo y estado `OK` de Inventario ilegibles al alternar;
- CTA amarillo de suscripción de Dashboard con tinta nocturna incorrecta;
- antetítulo verde de Ventas y badges claros de Caja/Entregas con contraste bajo;
- textos secundarios, total y acciones `Rápido`/`Nuevo` del POS sobre la superficie
  oscura;
- cierre y selector de menú móvil por debajo de 44 px; el selector compacto de
  menú en escritorio también quedó medido en **44 px**;
- preferencia global compartida entre cuentas: el tema ahora se guarda por
  `tenant + usuario`, con Día como valor seguro para una identidad nueva.

La clave global antigua no se migra automáticamente a la nueva clave scoped. Esa
decisión es intencional: el valor legado no permite saber qué usuario lo eligió y
copiarlo podría volver a imponerle el menú oscuro de otra persona en una terminal
compartida. Al primer uso autenticado cada identidad parte de Día y después conserva
su elección.

### Implementación y evidencia

El shell mantiene un solo control conceptual Día/Noche, renderizado en el header de
escritorio o dentro de la hoja móvil según el viewport. Los tokens de ticket,
canvas, estados, headers, tabs y vacíos viven en `nortex-tokens.css` e `index.css`;
las primitivas consumen esos aliases y la persistencia queda en
`utils/workspaceTheme.ts`.

Capturas aceptadas de la misma sesión autenticada:

- Inventario Noche: `.codex/apple-system-e2e-2026-09-01-cycle4/11-inventory-desktop-night-fixed`
- Inventario Día: `.codex/apple-system-e2e-2026-09-01-cycle4/12-inventory-desktop-day-final.png`
- Compras Día: `.codex/apple-system-e2e-2026-09-01-cycle4/07-purchases-desktop-day-final.png`
- POS operativo: `.codex/apple-system-e2e-2026-09-01-cycle4/31-pos-desktop-operational-final.png`
- Menú móvil Día/Noche: `34-mobile-menu-day-final.png` y
  `35-mobile-menu-night.png` en el mismo directorio.
- Cierre final abierto para revisión: `38-inventory-desktop-night-final-tap44`.

La heurística de contraste no dejó fallas reales en las rutas recorridas. Sus dos
señales residuales son falsos positivos conocidos sobre fondos transparentes: el
punto decorativo verde del logotipo y la inicial del avatar. En el cierre desktop
el único `under44` restante corresponde a checkboxes nativos de 15 px; los botones
compactos medidos quedaron en 44 px.

### QA y revisión independiente

La batería focal final aprobó **15 archivos y 114 pruebas**. La compuerta local
completa aprobó Prisma 6.4.1 generate, TypeScript, **257 archivos y 3,356 pruebas**;
11 archivos y 64 pruebas quedaron omitidos por su configuración. El sistema de
diseño revisó **75 archivos con 0 violaciones**, el build transformó **2,512
módulos**, la PWA generó 154 entradas y `git diff --check` quedó limpio.

La primera corrida completa rechazó correctamente dos regresiones del propio
ciclo: POS excedía su presupuesto de líneas y una prueba nueva leía `POS.tsx` como
texto. Se compactó el cambio sin subir el presupuesto y la comprobación visual se
movió a una prueba renderizada; la compuerta completa posterior quedó verde.

La revisión independiente no encontró hallazgos bloqueantes. Dejó explícitos dos
límites medios: `COLLECTOR`/`LENDER_COLLECTOR` continúan en su experiencia operativa
oscura fija sin selector, y la clave global de tema no se importa por la razón de
aislamiento entre cuentas descrita arriba. También permanece deuda de adopción de
presión en partes del POS legacy y `DriverView`; no se presenta este ciclo como el
cierre de todas las fases de gesto/movimiento Apple.

No se tocaron reglas de dinero, inventario, permisos ni endpoints como parte de
esta reparación visual. No hubo datos reales, staging, iPhone físico, push, merge,
deploy ni autorización de producción.

## Ciclo 5 — Menú legible y Día/Noche también para el cobrador autenticado

Este ciclo cerró la excepción concreta que seguía contradiciendo el contrato del
ciclo 4. `COLLECTOR` y `LENDER_COLLECTOR` salían de `Layout` antes de recibir el
workspace Apple, quedaban fijados a `data-nx-theme="dark"` y no tenían selector.
El comentario también confundía esa experiencia de cobro autenticada con la app
pública de repartidor, aunque son sesiones y rutas diferentes.

### Implementación y contrato

- El cobrador conserva su shell operativo reducido y no recibe navegación
  administrativa, pero ahora usa `nx-app-shell`, el bridge Día/Noche y el mismo
  almacenamiento aislado por `tenant + usuario` que el resto del ERP.
- Un único control accesible de al menos 44 px vive en el chrome superior del
  espacio de cobro; expone el modo activo, la acción siguiente y persiste al
  recargar.
- La pantalla de ruta ya no baja toda la sección de efectivo a 30% de opacidad.
  El campo se deshabilita de forma nativa hasta seleccionar un cliente y conserva
  una etiqueta legible en ambos temas.
- La prueba renderizada cubre tanto `COLLECTOR` como `LENDER_COLLECTOR`, confirma
  que el contenido permanece, que no aparece el menú administrativo, que existe
  un solo selector y que la preferencia scoped alterna sin escribir la clave
  global heredada.
- El contrato estático ahora rechaza el viejo `mobile-only-layout`, el tema oscuro
  fijo y la regresión de opacidad ilegible en el paso de efectivo.

### Evidencia autenticada fresca

Se registraron únicamente tenants y usuarios sintéticos en la base QA de loopback
y se entró por `/login`. No se escribió ningún cobro, gasto, venta, inventario ni
dato real. La pestaña final quedó abierta en `/app/team`, no en `/demo` ni en una
landing.

- Menú completo escritorio Día:
  `.codex/apple-collector-audit-2026-09-01-cycle5/08-team-menu-desktop-day-final.png`
- Menú completo escritorio Noche:
  `.codex/apple-collector-audit-2026-09-01-cycle5/09-team-menu-desktop-night-final.png`
- Hoja móvil Noche:
  `.codex/apple-collector-audit-2026-09-01-cycle5/10-team-mobile-menu-night-final.png`
- Hoja móvil Día:
  `.codex/apple-collector-audit-2026-09-01-cycle5/11-team-mobile-menu-day-final.png`
- Cobrador móvil Noche:
  `.codex/apple-collector-audit-2026-09-01-cycle5/06-collector-mobile-night-clean.png`
- Cobrador móvil Día:
  `.codex/apple-collector-audit-2026-09-01-cycle5/07-collector-mobile-day-clean.png`

El recorrido confirmó por DOM accesible y captura que iconos, letras, estados y
acciones permanecen visibles en Día y Noche, en 1280x720 y 390x844. La preferencia
del cobrador siguió activa después de recargar. La consola de la pestaña final no
registró errores.

### QA y límite de release

La batería focal aprobó **11 archivos y 79 pruebas**. La compuerta local completa
aprobó Prisma 6.4.1 generate, TypeScript, **257 archivos y 3,359 pruebas**; 11
archivos y 64 pruebas quedaron omitidos por su propia configuración. El sistema de
diseño revisó **75 archivos con 0 violaciones**, el build transformó **2,512
módulos**, la PWA generó 154 entradas y `git diff --check` quedó limpio. Permanecen
solo los avisos no bloqueantes conocidos de Browserslist y chunks mayores de 500 kB.

La revisión independiente no encontró hallazgos de corrección, seguridad ni
regresión funcional en el delta. Como límites residuales dejó la conveniencia de
sumar una prueba renderizada de dos identidades consecutivas y mantener vigilancia
de solapes/safe area. En este ciclo el solape móvil se comprobó directamente en
390x844 y la tolerancia a storage bloqueado permanece cubierta por la prueba
unitaria del contrato de `workspaceTheme`.

`/driver` y `/driver/:id` siguen siendo una app pública separada con
`nortex_driver_token`; este ciclo no afirma haber migrado esa superficie ni tocó
sus mutaciones de entrega/wallet. Tampoco hubo staging, dispositivo físico, push,
merge, deploy ni autorización de producción.

## Ciclo 6 — Revalidación del menú claro, contraste medible y un solo selector

Se reabrió la compuerta después del reporte concreto de que el menú se veía negro,
los iconos y letras se perdían y algunas tintas claras quedaban sobre fondo blanco.
El foco volvió a `/app/team`; la auditoría pendiente de `/driver` se pausó para no
mezclar una app pública separada con el shell autenticado que la persona estaba
viendo.

### Resultado visual y causa adjudicada

La captura fresca del frontend canónico en `127.0.0.1:4174` confirmó que el bundle
actual ya sirve el contrato corregido del ciclo 5:

- en Día, sidebar, header y hoja móvil usan material claro/translúcido con tinta
  oscura; no queda un menú negro fijo;
- en Noche, menú y contenido cambian juntos a una paleta oscura sin negro puro;
- escritorio expone un único botón `Modo noche`/`Modo día` en el header y móvil
  expone el mismo control conceptual dentro de la hoja; nunca aparecen dos
  selectores visibles en el mismo viewport;
- iconos Lucide y etiquetas heredan la tinta del control, por lo que no pueden
  quedar blancos sobre tarjeta blanca mientras se mantenga el contrato CSS.

Había dos procesos Vite locales de larga duración en `4174` y `4185`, ambos con el
mismo `cwd` y la misma fuente. Es una explicación plausible —no una causa probada—
de que una pestaña abierta antes de la reparación conservara por un tiempo la
impresión del shell anterior. No se usa como excusa ni como prueba de producción:
la aceptación se hizo nuevamente sobre `4174`, la dirección visible solicitada.

### Compuerta nueva contra la regresión

`tests/shellThemeContrast.test.ts` convierte el reporte en una regla ejecutable.
Para Día y Noche calcula contraste WCAG entre las tintas principal, secundaria,
tenue y positiva y los fondos realmente compuestos del shell, sus ítems y su estado
activo; también valida los tres niveles de texto del canvas contra las tarjetas
elevadas. Todos deben quedar en **4.5:1 o mejor**. La misma prueba protege que `svg`
y etiquetas hereden el color del control y que los ítems móviles no activos usen
`--nx-shell-text`.

La revisión independiente detectó además una ambigüedad de `color-scheme` para los
tickets oscuros dentro de Día. Sus variables locales ya conservaban fondo y tinta
oscuros, pero ahora el CSS declara explícitamente `color-scheme: dark` en esas
islas y una prueba lo protege, evitando controles nativos claros sobre el ticket.

Esta compuerta complementa, sin reemplazar, las pruebas renderizadas que cuentan un
solo selector y verifican persistencia por `tenant + usuario` en escritorio, móvil
y cobrador. No se alteró ningún handler, endpoint, permiso, dato, mutación de dinero
o movimiento de inventario.

### Evidencia fresca y QA

- Escritorio Día final:
  `.codex/apple-shell-audit-2026-09-01-cycle6/07-team-desktop-day-final-reviewed.png`
- Escritorio Noche:
  `.codex/apple-shell-audit-2026-09-01-cycle6/02-team-desktop-night-current.png`
- Hoja móvil Noche:
  `.codex/apple-shell-audit-2026-09-01-cycle6/04-team-mobile-menu-night-current.png`
- Hoja móvil Día:
  `.codex/apple-shell-audit-2026-09-01-cycle6/05-team-mobile-menu-day-current.png`

La batería focal aprobó **7 archivos y 51 pruebas**. La compuerta local completa,
ejecutada con Node 22.23.2, aprobó `git diff --check`, Prisma 6.4.1 generate,
TypeScript, **258 archivos y 3,365 pruebas**; 11 archivos y 64 pruebas quedaron
omitidos por su propia configuración. El sistema de diseño revisó **75 archivos
con 0 violaciones**, el build transformó **2,512 módulos** y la PWA generó 154
entradas. Permanecen solo los avisos no bloqueantes conocidos de Browserslist y
chunks mayores de 500 kB.

La pestaña local queda abierta en `/app/team`, en Día, con el selector visible para
que la persona pueda cambiar a Noche con un toque. No hubo staging, push, merge,
deploy ni autorización de producción.

### Cierre visual adicional del shell raíz

La revisión final encontró un borde de integración que podía conservar negro en
zonas transparentes o descubiertas del navegador aunque el contenido ya estuviera
en Día. `Layout` ahora sincroniza `data-nx-theme` en el shell, `html` y `body`, lo
retira al desmontarse y deja la hoja móvil con fondo e tinta de canvas. Así, letras
e iconos heredan el contraste correcto incluso en bordes redondeados, safe areas y
materiales translúcidos; el control sigue siendo un único botón Día/Noche.

La corrección se reabrió en una sesión local autenticada de `/app/team`, no en una
landing, y se volvió a capturar en los cuatro estados relevantes:

- Hoja móvil Día:
  `.codex/apple-shell-audit-2026-09-01-cycle6/10-team-menu-mobile-day-final.png`
- Hoja móvil Noche:
  `.codex/apple-shell-audit-2026-09-01-cycle6/11-team-menu-mobile-night-final.png`
- Escritorio Día:
  `.codex/apple-shell-audit-2026-09-01-cycle6/12-team-desktop-day-final.png`
- Escritorio Noche:
  `.codex/apple-shell-audit-2026-09-01-cycle6/13-team-desktop-night-final.png`

La batería focal conjunta de shell y repartidor aprobó **8 archivos y 60 pruebas**.
Después de este cierre se repitieron Prisma generate, TypeScript, sistema de diseño,
build y la batería completa: **261 archivos y 3,382 pruebas** aprobadas, con 11
archivos y 64 pruebas omitidos por configuración; `git diff --check` quedó limpio.

## Ciclo 7 — App pública de repartidor con Día/Noche aislado por identidad

Se cerró el siguiente hueco visible del producto completo: `/driver`, la app
pública de repartidor. Este ciclo fue estrictamente de presentación y
accesibilidad. No modificó contratos de login, polling, billetera ni la mutación
`PATCH /api/driver/me/orders/:id/deliver`.

### Resultado adjudicado

`components/DriverView.tsx` ya no fuerza un fondo negro fijo y ahora comparte el
vocabulario Apple Día/Noche del producto mediante un `data-nx-theme` propio,
aislado de la sesión ERP. La preferencia visual:

- empieza en Día antes del login;
- se enlaza solo al `driver.id` autoritativo devuelto por backend;
- no se deriva del token, teléfono ni nombre;
- se limpia del scope activo al cerrar sesión, sin borrar la preferencia scoped
  del mismo repartidor;
- no puede filtrarse a otra cuenta por ausencia de clave global y, si un token
  hidrata una identidad distinta del scope obsoleto, vuelve a Día salvo que la
  identidad nueva ya tenga una preferencia propia válida.

El login y el header autenticado comparten un único toggle conceptual por
viewport. Login, tarjetas, hoja de billetera y confirmación de entrega quedaron
con contraste coherente en Día/Noche, targets de 44 px o más, `min-h-dvh`, safe
area inferior y Escape con restauración de foco. Para el diálogo de confirmación
se dejó foco inicial en `Cancelar`, la acción segura por defecto, evitando
confirmaciones accidentales al presionar Enter.

### Compuertas agregadas

- `utils/driverTheme.ts` formaliza el contrato de storage por repartidor.
- `tests/driverTheme.test.ts` cubre login/hidratación, bloqueo de storage,
  logout y no-fuga entre cuentas.
- `tests/driverViewTheme.test.tsx` cubre toggle único, labels de credenciales,
  error de login, hidratación en Noche, logout a Día y que billetera/confirmación
  no disparan `PATCH` hasta confirmar.
- `tests/driverVisualContract.test.ts` trinquetea clases visuales, safe area,
  press states y ausencia de `transition-all`/`active:scale`.
- `tests/frontendInteractionDebt.test.ts` incorpora `components/DriverView.tsx`
  con presupuesto cero para botones sin `nx-fluid-press`.

### Evidencia visual fresca

- Login móvil Día final:
  `.codex/apple-driver-audit-2026-09-01-cycle7/07-login-mobile-day-final.png`
- Login móvil Noche:
  `.codex/apple-driver-audit-2026-09-01-cycle7/04-login-mobile-night-after.png`
- Login escritorio Día:
  `.codex/apple-driver-audit-2026-09-01-cycle7/06-login-desktop-day-after.png`
- Login escritorio Noche:
  `.codex/apple-driver-audit-2026-09-01-cycle7/05-login-desktop-night-after.png`

Las capturas fueron inspeccionadas una por una. La revisión visual independiente
no encontró bloqueantes y midió el estado deshabilitado `ENTRAR` en aproximadamente
**4.83:1 en Día y 8.96:1 en Noche**. El navegador confirmó un solo toggle y labels
accesibles en 390x844 y 1440x900.

### QA y límites

La batería focal aprobó **4 archivos y 26 pruebas**. La compuerta completa local
aprobó Prisma Client 6.4.1 generate con schema explícito, `npx tsc --noEmit`,
**261 archivos y 3,382 pruebas**; 11 archivos y 64 pruebas quedaron omitidos por
su propia configuración. `npm run check:design` revisó **75 archivos con 0
violaciones**, `npm run build` transformó **2,513 módulos**, la PWA generó **154
entradas** y `git diff --check` quedó limpio. Permanecen solo los avisos conocidos
no bloqueantes de Browserslist y chunks mayores de 500 kB.

Este ciclo sí afirma captura fresca del login real en navegador local. No afirma
captura visual autenticada de una sesión real de repartidor: esa parte se validó
con sesión y respuestas **sintéticas en jsdom**, sin ejecutar entregas ni `PATCH`.
Tampoco hubo cobros, staging, dispositivo físico, push, merge, deploy o producción.

## Ciclo 8 — Sesión autenticada sintética de repartidor y dock legible

Se cerró la brecha visual que el ciclo 7 había dejado explícita. La ruta real
`/driver` se abrió desde su formulario de login y el navegador interceptó todas las
llamadas `/api/driver/*` antes del backend. Solo se respondieron con fixtures
ficticios `POST /api/driver/login`, `GET /api/driver/me/orders` y
`GET /api/driver/me/wallet`; ningún dato salió de MySQL y no se ejecutó ningún
`PATCH`, GPS, cobro o entrega.

### Hallazgo adjudicado y reparación

La sesión rica —nombre largo, dos pedidos, dirección y nota extensas, liquidación
y billetera— confirmó que tarjetas, estado vacío, header, wallet y confirmación se
leen correctamente en Día/Noche. También encontró un defecto real que las pruebas
jsdom no podían mostrar: a 390 px el dock fijo comprimía `Entregar a Caja`, partía
la etiqueta en varias líneas y dejaba el monto visible apenas como `C`.

El dock ahora usa un grid responsive con columnas explícitas para viajes, efectivo
a caja y ganancia; reduce icono, gaps y padding solo en móvil, mantiene cifras con
`tabular-nums`, adapta tipografía con `clamp()` y conserva el safe area inferior.
Con comisiones positivas usa tres columnas; sin ellas usa dos, sin reservar un
hueco fantasma. No cambió cálculos, polling, endpoints ni handlers.

La revisión independiente encontró además una carrera de identidad: una respuesta
tardía de billetera o pedidos del repartidor A podía resolverse después del logout
y pintar datos en la sesión B. Ambos fetches ahora adjudican la respuesta contra el
token que inició la solicitud; si la sesión cambió, ignoran el resultado y también
evitan errores/loading obsoletos. Logout limpia wallet, liquidación, confirmación y
estado de proceso, y una hidratación sin `liquidacionDiaria` retira el dock anterior.

La medición renderizada final en 390 px dejó el grid con `clientWidth = 336` y
`scrollWidth = 336`; sus tres bloques terminaron en 79, 154 y 87 px, el efectivo
completo `C$ 8,524.50` quedó dentro del grid y la ganancia `C$ 875.50` permaneció
visible.

La revisión de cierre encontró además un riesgo de sesión compartida que no era
visual pero sí operativo: si una billetera seguía cargando y otro repartidor
entraba en el mismo dispositivo, podían reaparecer por un instante movimientos
de la cuenta anterior. `DriverView` ahora vacía billetera, confirmación,
liquidación y errores al salir; la lectura de billetera ignora respuestas cuyo
token ya no coincide con la sesión activa, y el polling limpia la liquidación
si backend deja de reportarla.

### Evidencia visual fresca

- Antes, autenticado móvil Día:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/02-auth-mobile-day-full-before.png`
- Antes, autenticado móvil Noche:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/03-auth-mobile-night-full-before.png`
- Después, autenticado móvil Noche:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/07-auth-mobile-night-full-after.png`
- Después, autenticado móvil Día:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/08-auth-mobile-day-full-after.png`
- Billetera móvil Día:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/09-wallet-mobile-day-after.png`
- Escritorio Día/Noche:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/10-auth-desktop-day-after.png`
  y `.codex/apple-driver-auth-audit-2026-09-01-cycle8/11-auth-desktop-night-after.png`
- Estado vacío móvil Noche:
  `.codex/apple-driver-auth-audit-2026-09-01-cycle8/12-empty-mobile-night-after.png`

### Trinquetes, QA y límites

`tests/driverViewTheme.test.tsx` ahora prueba el camino real del componente desde
login exitoso hasta token, scope visual e hidratación de pedidos, sin presembrar
sesión. También renderiza una liquidación amplia y exige que los montos completos
existan dentro del grid, que la liquidación desaparezca si el polling ya no la
envía y que la billetera de un repartidor no pueda reaparecer en la sesión del
siguiente. También prueba que un `401` o error de red tardío de A no cierre ni
ensucie la sesión B. `tests/driverVisualContract.test.ts` protege columnas
`minmax(0,1fr)`, tipografías responsivas y padding con safe area.

La batería focal aprobó **4 archivos y 33 pruebas**. La compuerta completa local
aprobó Prisma Client 6.4.1 generate, TypeScript, **261 archivos y 3,389 pruebas**;
11 archivos y 64 pruebas quedaron omitidos por configuración. El sistema de diseño
revisó **75 archivos con 0 violaciones**, el build transformó **2,513 módulos**, la
PWA generó **154 entradas** y `git diff --check` quedó limpio. Solo permanecen los
avisos conocidos no bloqueantes de Browserslist y chunks mayores de 500 kB.

Esta evidencia demuestra el frontend autenticado con red sintética y bloqueo de
escrituras. No demuestra autenticación real de backend, datos de un repartidor real,
conectividad de campo, GPS, entrega, dispositivo físico, staging ni producción.

## Ciclo 9 — Menú autenticado revalidado y cobertura por ruta explícita

Se volvió a la queja original —menú negro en Día, iconos o letras ilegibles y falta
de un cambio sencillo a Noche— sobre la ruta autenticada real `/app/team`. El
runtime actual confirmó que el cierre del shell permanece aplicado:

- Día muestra sidebar, header y hoja móvil claros con tinta oscura;
- Noche cambia shell y canvas juntos sin imponer negro puro;
- iconos y etiquetas heredan la misma tinta visible del control;
- cada viewport expone un solo botón conceptual, rotulado `Modo noche` o
  `Modo día` según la acción disponible;
- el cambio persiste por identidad mediante el contrato de `workspaceTheme`.

No se añadió otra capa visual en este ciclo: el defecto reportado ya estaba
reparado en el candidato local y la decisión segura fue revalidarlo, no duplicar
estilos. La sesión solo abrió el menú y alternó Día/Noche. No se ejecutaron
invitaciones, asistencia, logout ni mutaciones de negocio.

### Evidencia fresca

- Escritorio Día:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/01-team-desktop-day-current.png`
- Escritorio Noche:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/02-team-desktop-night-current.png`
- Móvil Noche:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/03-team-mobile-night-closed.png`
- Móvil Día:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/06-team-mobile-day-closed.png`
- Menú móvil Noche:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/04-team-mobile-menu-night-current.png`
- Menú móvil Día:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/05-team-mobile-menu-day-current.png`

La auditoría accesible confirmó `Navegación móvil`, un diálogo `nortex.`, links con
nombres completos y un botón cuyo nombre cambia de `modo día activo. Cambiar a
modo noche` a `modo noche activo. Cambiar a modo día`.

La batería focal aprobó **4 archivos y 32 pruebas**. La compuerta completa local
aprobó TypeScript, **261 archivos y 3,389 pruebas**; 11 archivos y 64 pruebas
quedaron omitidos por configuración. El sistema de diseño revisó **75 archivos con
0 violaciones**, el build transformó **2,513 módulos**, la PWA generó **154
entradas** y `git diff --check` quedó limpio. Solo permanecen los avisos conocidos
no bloqueantes de Browserslist y chunks mayores de 500 kB.

### Qué significa “aplicado en todo Nortex”

Las 33 rutas autenticadas de `/app/*` permanecen dentro de `Layout`, pero el menú
tematizable y su botón cubren 32. `/app/pos` conserva deliberadamente su superficie
operativa oscura y oculta el header/bottom-nav que alojan el control; no se afirma
que el botón exista dentro de POS. Tampoco la herencia del shell equivale a afirmar
que cada contenido interno ya tiene evidencia propia. La matriz
`docs/product/apple-route-coverage-2026-09-01.md` clasifica por separado rutas con
evidencia sólida, parcial, contractual o tema independiente. El hueco residual más
claro en el corte de ese ciclo quedaba en módulos heredados como `/app/ayuda`,
`/app/mi-espacio` y `/app/accounting`, además de las pantallas públicas que no
usan `Layout`.

Este ciclo no prueba staging, producción, Safari/iOS físico ni todos los estados de
cada módulo. Producción continúa sin autorización.

## Ciclo 10 — Centro de Ayuda nativo del workspace Día/Noche

Se tomó el siguiente hueco explícito de la matriz: `/app/ayuda`. El navegador
mostraba una superficie legible gracias al puente global de compatibilidad, pero
`components/HelpCenter.tsx` todavía estaba escrito con fondos `surface` oscuros,
texto `slate` fijo, bordes blancos translúcidos y `transition-all`. El resultado
dependía de overrides globales y podía recaer al cambiar el shell.

### Reparación adjudicada

El módulo ahora consume el mismo `ModuleHeader`, `nx-workspace`, tarjetas de
canvas y tonos semánticos que las superficies autenticadas ya consolidadas. La
reparación fue únicamente visual y de accesibilidad:

- se retiraron del componente los colores oscuros fijos y `transition-all`;
- el CTA y las cuatro tarjetas de tutorial usan `type="button"`,
  `nx-fluid-press` y un objetivo mínimo de 44 px;
- las secciones están nombradas mediante `aria-labelledby` y los iconos
  decorativos no contaminan el nombre accesible;
- los cuatro destinos permanecen exactamente en POS, Inventario, Fiado y
  Compras, con sus mismos parámetros `tour`;
- se preservó el borrado de flags de onboarding ya aislado por identidad y no se
  cambió `window.location.assign`, contenido de guías ni lógica de negocio.

### Evidencia renderizada

- Antes, escritorio Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/01-desktop-day-before.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/02-desktop-night-before.png`
- Antes, móvil Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/04-mobile-day-before.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/03-mobile-night-before.png`
- Después, escritorio Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/08-desktop-day-after.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/07-desktop-night-after.png`
- Después, móvil Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/05-mobile-day-after.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/06-mobile-night-after.png`

En 390 × 700, los cinco botones propios del módulo quedaron en 44 px o más,
todos con press state, tipo explícito y sin desbordamiento horizontal. Un
muestreador local sobre 84 nodos de texto visibles no encontró valores bajo
4.5:1: el mínimo calculado fue **5.40:1 en Día y 8.92:1 en Noche**. Los resultados
completos viven en `09-contrast-after.json` y `10-mobile-metrics-after.json` del
mismo directorio de evidencia. `11-theme-toggle-after.json` confirma un solo
control visible de 44 px en escritorio y en el menú móvil, ambos rotulados
`Modo noche` mientras Día está activo.

### Trinquetes, QA y límites

`tests/helpCenterThemeContract.test.ts` protege las primitivas semánticas, la
ausencia de clases oscuras heredadas y los destinos. `tests/helpCenter.test.tsx`
renderiza la ruta, exige cinco controles táctiles y recorre las cuatro
navegaciones exactas. El contrato también preserva el handler scoped del
checklist y su regreso al inicio del rol. La batería focal conjunta aprobó **5
archivos y 38 pruebas**.

La compuerta completa local aprobó Prisma Client 6.4.1 generate, TypeScript,
**263 archivos y 3,395 pruebas**; 11 archivos y 64 pruebas quedaron omitidos por
configuración. El sistema de diseño revisó **75 archivos con 0 violaciones**, el
build transformó **2,513 módulos**, la PWA generó **155 entradas** y
`git diff --check` quedó limpio. Persisten solo los avisos conocidos no
bloqueantes de Browserslist y chunks mayores de 500 kB.

La evidencia pertenece a una sesión autenticada local. Solo se alternó el botón
visible Día/Noche y se abrió/cerró el menú; no se pulsaron tutoriales, checklist,
logout ni acciones de dinero o inventario. Este ciclo eleva `/app/ayuda` a
evidencia sólida, pero no convierte automáticamente las demás rutas
contractuales, las superficies públicas, staging o producción en verificadas.
Producción continúa sin autorización.

## Ciclo 11 — Mi Espacio legible y táctil en Día/Noche

Se adjudicó el siguiente hueco de la matriz sobre la ruta autenticada real
`/app/mi-espacio`. La vista general parecía aceptable por el puente global de
compatibilidad, pero la medición y el recorrido de los formularios descubrieron
tres defectos reproducibles en Día:

- el nombre del empleado se dibujaba blanco sobre blanco con contraste **1:1**;
- el `select`, las fechas, el motivo y el monto también quedaban blancos sobre
  blanco, por lo que sus valores parecían vacíos;
- los siete controles propios medían entre 35 y 39.5 px, y la tabla vacía de
  colillas conservaba encabezados recortados y scroll horizontal en 390 px.

### Reparación adjudicada

`components/MiEspacio.tsx` ahora usa `ModuleHeader`, `nx-workspace`, tarjetas y
tinta `nx-canvas-*`, tonos de estado semánticos y controles de 44 px. La tabla
vacía deja de renderizar columnas sin datos; cuando existen colillas, móvil usa
tarjetas legibles y escritorio mantiene la tabla. Los formularios tienen labels
visibles, asociaciones `for`/`id`, ayuda accesible para el monto y press state en
acciones.

La reparación no cambió la secuencia ni los payloads de los cinco endpoints
`/api/me/*`, la autenticación, los handlers de permisos y adelantos, los alerts,
la carga de solicitudes ni el HTML/secuencia de impresión. Tampoco se ejecutó
ninguna solicitud de negocio durante el recorrido del navegador.

La revisión independiente detectó además dos riesgos heredados dentro de la
misma ruta y quedaron cerrados antes de este corte: las fechas civiles de ingreso
y ausencia ahora se formatean en UTC para no retroceder un día en Managua, y el
monto del adelanto ya no permite conservar múltiples separadores decimales.

### Evidencia renderizada

- Antes, escritorio Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/01-desktop-current-before.png`
  y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/03-desktop-night-before.png`
- Antes, formularios móviles Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/07-mobile-day-forms-before.png`
  y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/05-mobile-night-forms-before.png`
- Después, escritorio Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/12-desktop-day-after.png` y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/13-desktop-night-after.png`
- Después, móvil Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/09-mobile-day-after.png` y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/15-mobile-night-after.png`
- Después, formularios móviles Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/11-mobile-day-forms-after.png`
  y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/16-mobile-night-forms-after.png`

En 390 × 700, el root conserva `clientWidth === scrollWidth === 390`. El nombre,
los valores y controles críticos pasan de mínimos de **1:1** a **5.40:1 en Día**
y **7.55:1 en Noche**; inputs y selects llegan a 17.44:1 en Día y 13.88:1 en
Noche. Los siete controles medidos quedan en 44 px y ninguno queda bajo el
objetivo táctil. Los JSON completos son `08-metrics-day-before.json`,
`10-metrics-mobile-day-after.json` y `14-metrics-night-after.json`.

### Trinquetes, QA y límites

`tests/miEspacioThemeContract.test.ts` protege las primitivas semánticas, evita
la reintroducción de clases oscuras heredadas, exige labels/targets táctiles y
preserva endpoints e impresión. `tests/miEspacio.test.tsx` renderiza carga, error,
ausencia, adelanto, saneamiento de monto e impresión diferida con payloads
exactos. La batería focal conjunta aprobó **4 archivos y 42 pruebas**.

La compuerta completa local aprobó Prisma Client 6.4.1 generate, TypeScript,
**265 archivos y 3,408 pruebas**; 11 archivos y 64 pruebas quedaron omitidos por
configuración. El sistema de diseño revisó **75 archivos con 0 violaciones**, el
build transformó **2,513 módulos**, la PWA generó **155 entradas** y
`git diff --check` quedó limpio. Persisten solo los avisos conocidos no
bloqueantes de Browserslist y chunks mayores de 500 kB.

La evidencia pertenece al candidato local autenticado y demuestra la superficie
vacía disponible para esta cuenta. La colilla no vacía, sus badges y la impresión
se verificaron con datos sintéticos en Vitest, no con nómina real. No demuestra
Safari/iOS físico, staging ni producción. Producción continúa sin autorización.

## Ciclo 12 — Contabilidad legible, responsive y coherente en Día/Noche

Se recorrió la ruta autenticada real `/app/accounting`, no una landing ni el
demo. El shell global ya ofrecía un único selector Día/Noche, pero la pantalla
interna seguía fijada a una paleta oscura. En Día eso produjo defectos medibles:

- período, nombres de obligaciones y montos blancos sobre tarjetas blancas con
  contraste **1:1**;
- tabs de 37.5 px, flechas de período de 30 px y acciones de 32 px;
- en 390 px, Débito y Haber del asiento manual comenzaban fuera del viewport y
  los valores de varios inputs parecían vacíos.

### Reparación adjudicada

`components/Contabilidad.tsx` ahora usa `nx-workspace`, `ModuleHeader`, tarjetas,
tipografía, bordes, estados y overlay semánticos. Las 11 pestañas envuelven sin
scroll lateral, los controles visibles tienen un mínimo de 44 px y el asiento
manual cambia a tarjetas móviles con Cuenta, Debe y Haber dentro del viewport.
El diálogo de cierre/reapertura/baja conserva su `alertdialog`, trap de foco,
retorno de foco y confirmación explícita, pero ya responde a ambos temas.

No se cambió ningún rol, endpoint, payload, cálculo, fecha civil, `clientEventId`,
orden lazy de carga ni handler financiero. Tampoco se añadió un segundo selector
de tema: la ruta consume el único botón global de escritorio o menú móvil.

La revisión independiente encontró una regresión de teclado antes del cierre:
tabs y flechas habían suprimido el outline nativo sin reemplazo. Se restauró un
indicador `focus-visible` semántico en ambos controles y se añadió al contrato para
evitar que vuelva a desaparecer.

### Evidencia renderizada

- Antes, escritorio Día:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/01-desktop-day-before.png`
- Después, escritorio Día/Noche:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/19-desktop-day-after.png` y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/18-desktop-night-after.png`
- Antes/después del asiento manual móvil:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/08-mobile-day-asiento-before.png`
  y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/11c-mobile-day-asiento-fields-after.png`
- Después, móvil Día/Noche:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/09-mobile-day-after.png` y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/16-mobile-night-after.png`
- Menú móvil Día/Noche:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/13-mobile-menu-day-after.png`
  y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/14-mobile-menu-night-after.png`
- Diálogo de decisión Día/Noche:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/21-desktop-day-dialog-after.png`
  y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/22-desktop-night-dialog-after.png`

En 390 px, el root conserva `clientWidth === scrollWidth === 390`; en 1280 px
también conserva el ancho exacto. Los textos críticos quedaron en **17.44:1 en
Día** y **13.88:1 en Noche**. Los recorridos de todas las pestañas en
`23-all-tabs-night-after.json` y `24-all-tabs-day-after.json` registran cero
controles menores de 44 px, cero controles fuera del canvas y cero alertas
visibles.

### Trinquetes, QA y límites

`tests/contabilidadThemeContract.test.ts` protege la semántica Día/Noche,
responsive, roles, carga por pestaña, endpoints y barreras de mutación.
`tests/contabilidadUx.test.tsx` conserva los contratos renderizados de acceso,
fecha Managua, diálogos, idempotencia y confirmaciones. La batería focal aprobó
**2 archivos y 24 pruebas**.

La compuerta completa local aprobó Prisma Client 6.4.1 generate, TypeScript,
**266 archivos y 3,414 pruebas**; 11 archivos y 64 pruebas quedaron omitidos por
configuración. El sistema de diseño revisó **75 archivos con 0 violaciones**, el
build transformó **2,513 módulos**, la PWA generó **155 entradas** y
`git diff --check` quedó limpio. Persisten solo los avisos conocidos no
bloqueantes de Browserslist y chunks mayores de 500 kB.

La auditoría del navegador fue de solo lectura salvo alternar tema, navegar tabs,
abrir/cerrar menú y abrir/cerrar un diálogo. No se confirmó un asiento, una
declaración, una retención, un cierre, una reapertura, una depreciación ni una
baja de activo. La evidencia es local y autenticada; no demuestra staging,
Safari/iOS físico ni producción. Producción continúa sin autorización.

## Ciclo 13 — Texto escrito visible en formularios del modo Día

Se reprodujo el defecto en la ruta autenticada real `/app/serials`: el puente
global convertía el fondo heredado `bg-slate-800` a la superficie clara
`#E8EBF0`, pero los controles conservaban `text-white`. El valor
`SERIE-PRUEBA-DIA` quedaba a **1.20:1** y parecía vacío aunque sí estaba escrito.
El mismo riesgo estaba presente en inputs, textareas y selects heredados de
otras rutas que aún dependen del puente de compatibilidad.

### Reparación adjudicada

`index.css` ahora fija en el workspace Día la tinta, el borde y el cursor de
`input`, `textarea`, `select` e `input-premium` mediante tokens semánticos. Los
placeholders usan `--nx-canvas-faint` con opacidad explícita y el autocompletado
WebKit conserva tinta y superficie legibles. Las islas oscuras de POS y ticket
siguen seguras porque redefinen localmente los mismos aliases `--nx-canvas-*`.

No se cambió `components/Serials.tsx`, ningún handler, endpoint, payload, permiso,
consulta, cálculo, dinero ni inventario. En el navegador solo se escribió un
valor local no enviado, se alternó Día/Noche y se abrió/cerró el menú.

### Evidencia renderizada y contraste

- Antes, Series en Día con valor escrito:
  `.codex/apple-input-text-audit-2026-09-02-cycle13/04-serials-day-typed-before.png`
- Después, la misma vista y el mismo valor en Día:
  `.codex/apple-input-text-audit-2026-09-02-cycle13/05-serials-day-typed-after.png`
- Control de regresión de la misma vista en Noche:
  `.codex/apple-input-text-audit-2026-09-02-cycle13/06-serials-night-typed-after.png`

El runtime confirmó en Día fondo `rgb(232, 235, 240)`, texto y cursor
`rgb(23, 26, 31)`, borde `rgb(204, 211, 220)` y placeholder
`rgb(86, 98, 113)`. El texto sube a **14.60:1** y el placeholder a **5.20:1**.
En Noche, el mismo valor permanece visible con fondo `rgb(27, 31, 38)` y tinta
`rgb(244, 246, 249)`. Como control de especificidad, el buscador del POS se
midió con la preferencia global Día y conservó su isla oscura: fondo
`rgb(20, 23, 28)`, tinta `rgb(232, 235, 240)` y cursor visible. El registro está
en `07-pos-ticket-input-control.json`.

### Trinquete, QA y compuerta de release

`tests/lightWorkspaceFormContrast.test.ts` protege el contrato global, el
placeholder/autofill y contraste WCAG AA sobre las dos superficies claras que
usan los textbox. La batería focal aprobó **3 archivos y 28 pruebas**. La
compuerta local completa aprobó Prisma Client 6.4.1 generate, TypeScript,
**267 archivos y 3,417 pruebas**; 11 archivos y 64 pruebas quedaron omitidos por
configuración. El sistema de diseño revisó **75 archivos con 0 violaciones**,
el build y el build SEO transformaron 2,513 módulos, la PWA generó 155 entradas,
el prerender generó 71 rutas y un sitemap de 72 URL, y `git diff --check` quedó
limpio.

La compuerta `release:preflight` **no aprobó**: `npm audit --omit=dev` bloqueó
`qs@6.15.3` por dos avisos moderados de disponibilidad. El test de mutación se
ejecutó aparte, aprobó su dry run de 2,439 pruebas y alcanzó 981 de 4,947
mutantes sin sobrevivientes ni timeouts, pero se detuvo al estimar casi tres
horas; por tanto no cuenta como compuerta terminal. Además, el worktree contiene
cambios ajenos y no existe un SHA candidato limpio, CI terminal, staging por SHA
ni smoke autenticado. La reparación visual está validada localmente; producción
continúa cerrada. La remediación mínima investigada es un cambio separado del
override de `qs` desde 6.15.3 a 6.16.0, regeneración canónica del lockfile y
smokes de query parsing/Stripe antes de repetir el preflight; no se mezcló con
este arreglo visual.

## Próxima compuerta

1. El responsable revisa `/app/serials` en Día/Noche y acepta o devuelve este
   ciclo antes de incorporarlo a un candidato de release.
2. Se repara `qs` como cambio de seguridad separado y se repite el preflight
   completo hasta obtener una corrida terminal verde.
3. Se separa un candidato limpio con SHA exacto sin arrastrar cambios ajenos.
4. Con autorización específica, se ejecuta staging y se repiten rutas autenticadas,
   contraste, touch, teclado, iOS y smokes proporcionales al riesgo.
5. Solo después puede solicitarse una autorización de producción que nombre alcance,
   SHA y ventana. Esta demostración no es esa autorización.

## Aprendizajes convertidos en proceso

- Una auditoría externa es evidencia de entrada, no prueba del estado del candidato:
  cada hallazgo se adjudica contra fuente y runtime.
- Los aliases de color no pueden sustituir rampas semánticas completas.
- Una pantalla que se ve correcta por un bridge de compatibilidad todavía puede
  ser deuda: el cierre real migra la fuente a intención semántica y añade un
  contrato que impida volver a colores fijos.
- Un contador estático detecta regresión de arquitectura; el navegador detecta
  tamaño, composición y contraste reales. Se necesitan ambos.
- Un sheet que se ve fluido puede seguir teniendo un defecto operativo invisible:
  durante su salida debe bloquear taps al fondo hasta completar el desmontaje.
- Una primitive correcta puede producir dos modales si el padre no coordina el
  breakpoint: la verificación desktop → móvil debe contar capas accesibles activas.
- `reduced motion` se valida antes del primer frame; esperar a que la cola rAF se
  vacíe puede ocultar un destello inicial fuera de la preferencia.
- POS no admite nuevos tests acoplados a su texto: la presión restante se reduce al
  extraer componentes y probar conducta renderizada.
- QA verde, captura local y staging son compuertas distintas; ninguna autoriza
  producción por inferencia.
- Una landing o `/demo` nunca satisface “mostrar el producto final” cuando el
  criterio pide rutas autenticadas; esa aceptación debe enumerar módulos y datos.
- El stack local debe probar que `/api/health` desde el origen de Vite devuelve JSON,
  no el fallback HTML de la SPA.

El procedimiento repetible vive en
`docs/runbooks/frontend-preprod-audit.md`.

## Integración local del 4 de septiembre

Se conserva el historial vigente de `main` (2834497). La entrega local posterior
del POS, activación y avisos se documenta en `docs/VERIFICACION_MODULOS_2026-09-04.md`.
Los resultados de esa copia anterior no acreditan este candidato integrado ni
un despliegue: requiere nuevas pruebas sobre el árbol final.
