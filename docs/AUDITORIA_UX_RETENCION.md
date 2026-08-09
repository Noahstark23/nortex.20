# Auditoría UX + Retención + Seguimiento — Agosto 2026

**Pregunta del CEO:** *"Llega gente, solo se registra y se va, y no hay forma de
seguimiento. ¿Dónde estoy fallando en experiencia de usuario? ¿Mi sitio está mal?"*

**Método:** 4 auditores en paralelo sobre el código real (no la documentación):
(1) capacidad de seguimiento/re-engagement, (2) embudo landing→registro→primer login,
(3) primera sesión real vs. onboarding documentado, (4) calidad móvil/PWA/rendimiento.
Todos los hallazgos citan archivo:línea verificados.

**Complementa** `docs/ONBOARDING_RETENCION.md` (el diseño del onboarding) y el plan
P0/P1/P2 de retención ya en curso. Ya mergeado antes de esta auditoría: P0-A (#135,
palanca de conversión + rompe-primer-uso), P0-B (#136, métricas de retención reales
en el Command Center), catálogo semilla por giro (#137), nunca-bloquear-el-POS (#138).

---

## Veredicto ejecutivo

El sitio **no está mal diseñado**. Está mal **conectado, mal empaquetado y mudo**:

1. **No hay puerta de vuelta.** La home de producción (`public/landing.html`) tiene
   **cero enlaces a `/login`**. El que se registró y vuelve al día siguiente no
   encuentra cómo entrar. (La landing vieja del SPA sí lo tenía — es una regresión.)
2. **La landing miente en los dos números que deciden la compra.** Promete
   **30 días gratis y $20/mes**; el código da **14 días** (`backend/server.ts:288`)
   y **$25** (`components/Billing.tsx:24`). El usuario descubre ambas justo cuando
   decide pagar.
3. **No existe seguimiento.** En todo el código hay **1 solo email saliente**
   (reset de contraseña). No se pide teléfono al registro, no hay email de
   bienvenida, el trial vence en silencio, y el Command Center muestra "N DORMIDAS"
   como número **sin lista, sin contacto, sin exportación**. El propio repo lo admite
   (`docs/ONBOARDING_RETENCION.md:95`, "mejora futura").
4. **El onboarding existe pero casi nadie lo ve.** La bienvenida cuelga de un solo
   hilo (`?welcome=1` tras un modal-peaje de PIN); si `/api/onboarding` falla,
   desaparece sin rastro; el checklist no se entera de la primera venta; y el menú
   simple (`utils/navigation.ts`) es **código muerto** — el Layout sigue con 22
   ítems de jerga ERP y los tenants PULPERIA aterrizan en `/app/inicio`, una
   pantalla que no está en el menú (callejón sin salida).
5. **La app pesa 2.23 MB de JS en un solo archivo.** En el Android de gama baja del
   cliente real: **12–20 s hasta poder usarla**. La PWA instalada abre en la landing
   de marketing y **no abre offline** (`start_url:'/'` está en el denylist del SW).
   En "lie-fi" (3G saturado) **la venta se pierde** con un `alert()` en vez de ir a
   la cola offline. No hay prompt de instalación.
6. **Se diagnostica a ciegas.** 4 `trackEvent` en todo el repo (2 en registro, 2 en
   la calculadora). Cero eventos en POS/Inventario/Onboarding. Los CTAs de la landing
   reportan `location:"unknown"` porque falta `data-loc`. Nadie puede responder
   "¿en qué paso se muere la gente?" — ni el CEO ni nosotros.

---

## Hallazgos por área (evidencia)

### A. Seguimiento (el gap #1 — informe 1)

| # | Hallazgo | Evidencia |
|---|---|---|
| A1 | Único email saliente del sistema = reset de contraseña | `backend/services/email.ts:17` (única función), callsite único `backend/server.ts:842` |
| A2 | No se pide teléfono/WhatsApp al registro; `Tenant.phone` existe pero llega null (solo se llena en el paso fiscal, el último del checklist) | `backend/validation/schemas.ts:246-251`, `schema.prisma:49`, `backend/server.ts:6822` |
| A3 | Sin verificación de email: un typo = tenant inalcanzable para siempre | sin `emailVerified` en `schema.prisma` |
| A4 | `dormantTenants` es un conteo, no una lista; `/api/admin/tenants` no devuelve `lastLogin`, ni phone, ni trialEndsAt; SuperAdmin sin botón de contacto ni export CSV | `backend/server.ts:5874`, `:5916`, `components/SuperAdmin.tsx:326-393` |
| A5 | El trial vence en silencio: `checkExpiredSubscriptions` (corre cada hora) marca PAST_DUE sin avisar a nadie | `backend/server.ts:9553-9578` |
| A6 | WhatsApp saliente existe (`CloudApiSender.sendText`) pero solo con canales de TENANT y solo reactivo; no hay canal de plataforma Nortex→dueños | `backend/services/whatsapp/client.ts:30`, `identity.ts:38-52`, único callsite `inbound.ts:103` |
| A7 | Push notifications: no existen (PWA sin capa de push) | cero hits `web-push`/`pushManager` |
| A8 | `EMAIL_FROM` default `onboarding@resend.dev` — sin dominio verificado nada llega a inbox real | `backend/services/email.ts:12` |

### B. Embudo de entrada (informe 2)

| # | Hallazgo | Evidencia |
|---|---|---|
| B1 | **Cero enlaces a `/login` en la landing de producción** (nav y footer) | `public/landing.html:98-109, 938-969`; regresión vs `components/LandingPage.tsx:19` |
| B2 | Landing promete **30 días / $20**; el producto da **14 días / $25** (también en JSON-LD, FAQ, landings SEO y prerender) | `landing.html:7,70,811,825,638,665,83` vs `backend/server.ts:288`, `Billing.tsx:24,310,441` |
| B3 | CTA primario del hero es un ancla interna ("Ver el sistema"), no `/register`; en móvil el registro queda solo en el botoncito del nav | `landing.html:134-140`, `landing.css:190-192` |
| B4 | `/register` requiere descargar 610 KB gzip / 2.2 MB JS; el prerender muestra título sin formulario (parece roto) | `App.tsx:18` (import estático), `scripts/prerender.ts:112-119` |
| B5 | Rate limit de login 5/hora **por IP** — con CGNAT/WiFi compartido bloquea negocios enteros | `backend/server.ts:202-210` |
| B6 | JWT 7 días con trial de 14 → expulsión garantizada a mitad del trial; `?error=session_expired` que Login nunca lee (login mudo) | `backend/services/secrets.ts:30`, `utils/auth.ts:20`, `components/Login.tsx` |
| B7 | Modal-peaje del PIN al éxito del registro interrumpe el momento de máximo impulso; si no toca "Continuar", pierde la bienvenida para siempre | `RegisterTenant.tsx:134-135, 287-308` |
| B8 | 10 `<image-slot>` sin `src` → cajas grises que dicen literalmente "Foto cliente" bajo "No nos creas a nosotros" | `landing.html:284-339, 686-706, 886` |
| B9 | Los testimonios usan los MISMOS nombres que los empleados ficticios del mockup de planilla (Carlos Salinas, Rosa Mendoza, Jorge Pineda) | `landing.html:520/529/538` vs `:688/698/708` |
| B10 | Urgencia falsa hardcodeada: "QUEDAN 4 LUGARES · ACTUALIZADO HOY" | `landing.html:658` |
| B11 | "Autorizada por la DGI" (claim regulatorio riesgoso) contradicho por la propia FAQ ("vos tramitás tu resolución") | `landing.html:229` vs `:77,852` |
| B12 | Hero muestra "Nortex Score 785" y "Línea $50,000 pre-aprobada" con "Aquí estás vos" — el registro arranca todo en 0/null y el botón sale bloqueado | `landing.html:172-180,205` vs `backend/server.ts:283-286`, `Dashboard.tsx:557` |
| B13 | CTAs sin atribución: `analytics.js` lee `data-loc`, la landing no lo pone en ningún enlace → todo llega como "unknown" | `public/analytics.js:82-86`, 0 hits en `landing.html` |
| B14 | `/precios` no existe (ni ruta ni prerender); `/registro` (español) → página en blanco; Search Console sin verificar (`XXXXXXXXXX`) | `scripts/prerender.ts:53`, `App.tsx:143-167`, `index.html:13` |

### C. Primera sesión (informe 3)

| # | Hallazgo | Evidencia |
|---|---|---|
| C1 | Bienvenida solo con `?welcome=1` (2 productores en el repo); el login normal, el flujo con carrito y el reset de contraseña nunca la muestran | `OnboardingHub.tsx:75-77`, `Login.tsx:33-36`, `RegisterTenant.tsx:128` |
| C2 | Si `/api/onboarding` falla o tarda: TODO el onboarding desaparece sin error ni reintento (`if (!data) return null`) | `OnboardingHub.tsx:63-90` |
| C3 | El checklist no se refresca tras la primera venta; venta #1 = venta #500, cero celebración | `OnboardingHub.tsx:83-85`, `POS.tsx:1341-1356` (0 hits de "primera venta") |
| C4 | **`utils/navigation.ts` es código muerto**: Layout no lo importa; menú hardcodeado de 22 ítems con jerga ERP ("Blueprint", "Mercado B2B", "Salud Financiera") | `Layout.tsx:1-5, 138-200` |
| C5 | Tenants PULPERIA aterrizan en `/app/inicio` (`MiNegocio`, pantalla excelente) — que NO está en el menú: si navega a otro lado, no puede volver | `App.tsx:72-73`, `navigation.ts:192`, 0 hits de `/app/inicio` en `Layout.tsx` |
| C6 | El tour del POS (driver.js) se dispara ENCIMA del modal de apertura de caja (PIN): dos capas modales, tutorial de una pantalla invisible | `POS.tsx:2017`, `utils/tours.ts:197` |
| C7 | El catálogo semilla solo vive en el empty-state del POS (detrás del PIN de caja); el checklist manda primero a Inventario, cuyo empty-state NO lo ofrece | `POS.tsx:2532` (único caller), `Inventory.tsx:1137-1152` |
| C8 | Fetch de productos sin manejo de error → un 500/timeout muestra "Todavía no tenés productos" a quien SÍ tiene (falso empty-state) | `POS.tsx:305-325`, `Inventory.tsx` fetchProducts |
| C9 | El Dashboard de aterrizaje: "Panel Financiero", wallet $0, Score "Sin datos", línea bloqueada, gráfico vacío, botón "ACTIVAR PLAN PRO" — y ni un CTA hacia vender o cargar productos | `Dashboard.tsx:307-620` |
| C10 | Cero instrumentación del embudo dentro de la app (sin `first_sale`, `onboarding_step_done`, etc.) | grep `trackEvent(` = 4 callsites, ninguno en POS/Inventory/OnboardingHub |
| C11 | Menores: "No mostrar más" irreversible; bottom-nav móvil con "Toma Física" el día 1; `MANUAL_NORTEX.md` referenciado pero inexistente; 60 `alert()` nativos; tildes faltantes ("Exito", "Metodo", "Credito") | `OnboardingHub.tsx:98-102`, `Layout.tsx:263`, `HelpCenter.tsx:222`, `POS.tsx:3208-3225` |

### D. Móvil / PWA / rendimiento (informe 4)

| # | Hallazgo | Evidencia |
|---|---|---|
| D1 | Bundle monolítico: **2,225,350 B / 606 KB gzip** — solo el blog es lazy; las ~40 pantallas y xlsx (~430 KB con BIFF/ODS/SYLK/DBF), recharts+d3 (~450 KB) van en el chunk inicial | `App.tsx:6-58`, imports en `POS.tsx:11`, `Inventory.tsx:2`, `HRM.tsx:3`, `Dashboard.tsx:3` |
| D2 | **PWA rota**: `start_url:'/'` colisiona con el denylist del SW y con la landing → la app instalada abre marketing y NO abre offline; un solo ícono SVG 192 (falta 512 PNG); cero `beforeinstallprompt` | `vite.config.ts:28,49`, `backend/server.ts:9514-9517` |
| D3 | Offline a medias: el catálogo NO se cachea (recarga sin internet = POS vacío); "lie-fi" pierde la venta (`navigator.onLine` true + fetch sin timeout → `alert()` en vez de cola); sync silencioso ante 401 | `POS.tsx:305,1278,1322,1358,361-370`, `lib/db.ts` |
| D4 | Cascadas secuenciales: Dashboard 4 `await` en serie (~2–4 s regalados), POS igual; SWR instalado pero solo lo usa SuperAdmin | `Dashboard.tsx:69-123`, `POS.tsx:414-470` |
| D5 | `/api/products` sin `page` devuelve el catálogo ENTERO e incluye `creator.email` por producto; el POS renderiza todo sin virtualizar (3,000 SKUs ≈ 1.5 MB JSON + 24,000 nodos DOM) | `backend/server.ts:2889-2935`, `POS.tsx:2545` |
| D6 | Sin `ErrorBoundary` en todo el repo → crash = pantalla negra | `index.tsx` |
| D7 | Polling de `/api/public-orders` cada 30 s sin pausar en background (~2,880 req/jornada en datos prepago) | `Layout.tsx:59-85` |
| D8 | `user-scalable=0` (sin zoom, público présbita); `pb-safe` y `mobile-only-layout` son clases inexistentes; `h-screen` en vez de `h-dvh`; tablas sin `overflow-x-auto` (kardex, lotes, 4 en Reports) | `index.html:5`, `Layout.tsx:124,203,262`, `Inventory.tsx:1384,2191`, `Reports.tsx:452,647,980,1039` |
| D9 | `<head>` sucio: importmap muerto a esm.sh (riesgo supply-chain), Google Fonts render-blocking sin preconnect (8 pesos), `blur-[120px]` ×2 en el Login (GPU de gama baja) | `index.html:50,60-76`, `Login.tsx:56-57` |
| D10 | Lo que SÍ está bien (no tocar): `runtimeCaching:[]` multi-tenant seguro, `inputMode` numérico en ~40 inputs, cola offline con idempotencia, paginación server-side de Inventario, landing de 23 KB | `vite.config.ts:50-58`, `POS.tsx:37-57`, `lib/db.ts` |

---

## Plan de corrección

Ordenado por (impacto en retención ÷ esfuerzo). Cada fase es un PR chico y mergeable.

### R0 — El día de los 5 minutos (1 PR, ~medio día, sin riesgo)

Puros arreglos quirúrgicos que hoy cuestan usuarios todos los días:

1. **"Entrar" en la landing** (nav + footer + visible en móvil) → arregla B1.
2. **Login lee `?error=session_expired`** y muestra "Tu sesión venció, volvé a entrar" → B6.
3. **`data-loc` en todos los CTAs** de la landing (register + wa.me) → B13, y con eso el
   GA4 existente empieza a decir qué CTA convierte.
4. Landing: quitar "QUEDAN 4 LUGARES" (B10), renombrar testimonios colisionados (B9),
   "autorizada por la DGI" → "compatible con facturación computarizada DGI" (B11),
   bajar el volumen de Nortex Capital en el hero (B12: quitar "$50,000 pre-aprobada"
   o marcar "Próximamente").
5. **PWA**: `start_url` → `/app/pos`, íconos 192+512 PNG (+maskable) → D2 (la mitad).
6. `<head>`: borrar importmap muerto, `preconnect` a fonts, quitar `user-scalable=0`,
   `defer` en `image-slot.js` → D9.
7. Rate limit de login: por email (o subir a 15/h por IP) → B5.
8. Definir `pb-safe` en Tailwind, `h-screen`→`h-dvh`, envolver las 6 tablas rotas
   en `overflow-x-auto` → D8.

**⚠️ Decisión del CEO requerida (no la toma un agente): B2.** ¿Trial de 30 días y
$20 (subir el código a la promesa) o 14 días y $25 (bajar la landing a la realidad)?
Cualquiera de las dos es un cambio de 10 minutos; lo inaceptable es que difieran.
Tocar: `landing.html` (8 menciones), `server.ts:288`, `Billing.tsx:24,310,441`,
landings SEO, `prerender.ts` (5 menciones), `BlogPost.tsx:139`.

### R1 — Seguimiento: de "N dormidas" a lista de llamadas (1–2 PRs, ~2 días)

Responde directo al "no hay forma de seguimiento". Todo reutiliza infra existente,
cero dependencias nuevas, cero migraciones (los campos ya existen):

1. **Prerrequisito CEO (30 min, sin código):** verificar dominio en Resend y setear
   `EMAIL_FROM=Nortex <hola@...>` — sin esto ningún email llega a inbox (A8).
2. **Lista contactable de dormidos** (A4): `lastLogin` + `phone` + `trialEndsAt` en
   `/api/admin/tenants`, filtro `?dormant=1`, columnas "Última actividad"/"Contacto"
   en SuperAdmin con botones `mailto:` y `wa.me` (patrón ya copiado 9 veces en el
   repo), y "Exportar CSV" (~15 líneas con Blob). **El mayor retorno de toda la
   auditoría: convierte un número muerto en una lista de llamadas.**
3. **Teléfono/WhatsApp opcional en el registro** (A2): campo en `RegisterSchema` +
   `RegisterTenant` → `Tenant.phone` (ya existe). Etiqueta: "WhatsApp (para ayudarte
   a arrancar)".
4. **Email de bienvenida** (A1): clonar el template del reset; CTA directo a
   `/app/dashboard?welcome=1` + el PIN 1234 → permite además eliminar el modal-peaje
   del registro (B7) y navegar directo al valor.
5. **Secuencia de trial** (A5): job diario junto a los `setInterval` existentes —
   D+1 sin producto / D+3 sin venta (reusando la lógica de `/api/onboarding`
   extraída a función) / D-3 del vencimiento / vencido. Idempotencia vía `AuditLog`
   `action:'EMAIL_TRIAL_D3'` (ya indexado por `[tenantId, action, createdAt]`),
   guard contra multi-instancia.

### R2 — Primera sesión que no muere (1–2 PRs, ~2–3 días)

1. **Bienvenida sin hilo frágil** (C1): mostrar si `completed === 0 && !dismissed`,
   sin depender de `?welcome=1`. Manejar error/loading en OnboardingHub con
   reintento (C2).
2. **Cerrar el loop aha** (C3): evento `nortex:data-changed` tras la venta →
   checklist se refresca en vivo; mensaje especial en el modal de éxito cuando es
   la PRIMERA venta.
3. **Bloque de arranque en el Dashboard** (C9): si `products===0 && sales===0`,
   arriba de todo: "Empezá acá" con 2 botones grandes (cargar catálogo de ejemplo /
   agregar mi primer producto). Las tarjetas fintech bajan.
4. **Conectar `buildNavigation` al Layout** (C4/C5): el código ya está escrito y
   testeado; mata de un golpe los 22 ítems, la jerga y el callejón de `/app/inicio`.
   (Es el ítem #4 pendiente de P1 — requiere verificación visual del CEO.)
5. **Catálogo semilla en el empty-state de Inventario** (C7) + no disparar el tour
   del POS mientras el modal de caja esté abierto (C6).
6. **Instrumentar 6 eventos** (C10/B13): `onboarding_shown`, `onboarding_step_done`,
   `first_product`, `first_sale`, `tour_started`, `seed_catalog_used`. Sin esto no
   se puede validar nada de lo anterior.
7. Falsos empty-states (C8): distinguir error de red de "no tenés productos", con
   botón Reintentar.

### R3 — Peso y offline de verdad (2 PRs, ~3–4 días)

1. **Partir el bundle** (D1): `React.lazy` en las ~40 rutas (el `<Suspense>` ya
   existe), `import()` dinámico para xlsx en los 4 handlers de export,
   `manualChunks` para recharts+d3. Meta: **de 2.23 MB → <700 KB inicial (−70%)**.
   Verificar que el precache PWA baje del techo de 4 MB a <2 MB.
2. **Offline real** (D3): tabla `products` en Dexie (catálogo sobrevive recargas),
   `AbortSignal.timeout(8000)` en el checkout con fallback a `saveSaleOffline`
   (el arreglo que deja de perder ventas en lie-fi), error visible + backoff en
   `syncOfflineSales`.
3. **Percepción** (D4/D6/D7): `Promise.all` en Dashboard y POS, `ErrorBoundary`
   raíz, pausar el polling con `visibilitychange`.
4. `/api/products` para POS: paginado + sin `creator.email` (D5). Brotli en el
   server (−20% extra).
5. **Prompt de instalación PWA** (`beforeinstallprompt` + botón "Instalar Nortex")
   — la palanca de retención más barata sobre la mesa (D2, segunda mitad).

### R4 — Después (no bloquear con esto)

- Canal WhatsApp de plataforma Nortex→dueños (A6): registrar número propio como
  `WhatsAppChannel`, plantillas pre-aprobadas de Meta (bienvenida / trial / resumen
  del día). Hacer DESPUÉS de que los emails de R1 funcionen.
- `/register` estático de 5 KB (convertir antes de cargar el SPA) — medir primero
  el efecto de R3.1, que puede bastar.
- Rutas `/precios` (prerender) y `/registro` → 301 a `/register` (B14) + verificar
  Search Console.
- Verificación de email (A3) — suave, sin bloquear el ingreso.
- Push notifications (A7) y modelo de eventos de producto persistido — solo cuando
  R1–R3 estén medidos.
- Fotos reales para los 10 `<image-slot>` (B8) — **requiere material del CEO**;
  mientras tanto, considerar quitar la sección de testimonios.

---

## Acciones que solo puede hacer el CEO

1. **Decidir trial/precio**: ¿30 días+$20 o 14 días+$25? (R0 queda bloqueado en ese
   punto hasta decidir; el resto de R0 no.)
2. **Verificar dominio en Resend** (30 min) — sin esto R1 no llega a ningún inbox.
3. Conseguir **fotos reales** (clientes, negocios, fundador) o aprobar quitar los
   testimonios de la landing.
4. Verificar **Google Search Console** (meta tag placeholder en `index.html:13`).

## Métrica de éxito (para no volar a ciegas)

Con los eventos de R2.6 + las métricas ya en el Command Center (#136):

- **Activación**: % de registros con primera venta < 24 h (hoy: desconocido).
- **Time-to-interactive** móvil: de ~12–20 s a < 5 s (R3).
- **Dormidas**: el KPI ya existe; R1 agrega la lista y el canal para bajarlo.
- **Conversión por CTA** de landing: visible en GA4 apenas entre R0.3.
