# Unificación Apple de superficies públicas — 2026-09-02

## Estado

- Candidato preparado en los PR `#199`, `#200` y `#201`. El SHA promovido es
  `2834497f6090c2d55bcc48d5edb86887f6993ae3`.
- **Staging verificado** el 2026-09-02 (run `33688959590`, job `deploy-staging`,
  22:21:16Z → 22:25:18Z UTC). El paso `Verificar STAGING sano y en el commit
  esperado` exigió `ok`, `db: up` y ese commit exacto en `/api/health` antes de
  cerrar en verde.
- **Producción promovida y verificada** el 2026-09-02. El responsable aprobó el
  environment protegido; el job `deploy-production` del mismo run arrancó a las
  23:13:47Z, disparó el webhook de Coolify a las 23:13:51Z y su paso `Verificar
  PROD sano y en el commit esperado` cerró en verde a las 23:19:05Z tras 5 min
  14 s de reintentos. `scripts/verify-deployed-release.mjs` solo pasa con `ok`,
  `db: up` y el commit exacto, así que producción sirve ese SHA.
- **Falta cerrar el ciclo como `PRODUCCIÓN VERIFICADA`.** El runbook exige,
  además de la salud por SHA, un smoke autenticado con tenant sintético y una
  observación de 30 minutos. Ninguno de los dos se ejecutó en este ciclo.

### Intento anterior de promoción

Un primer ciclo llegó a staging verde sobre
`b6adb7d6005c2feb9dca5531b93e7e9e007c96e2` (run `33681015333`) y dejó
`deploy-production` en `waiting`. El merge del PR `#201` avanzó `main` y la
regla `concurrency` con `cancel-in-progress` canceló ese run junto con su
aprobación pendiente. Aprendizaje operativo: **mientras un `deploy-production`
esté en `waiting`, ningún merge a `main` es inocuo** — cancela la promoción y
obliga a repetir staging sobre el SHA nuevo. Promover primero, mergear después.

## Por qué existe este ciclo

La auditoría visual de staging confirmó que el sistema Apple Día/Noche no cubría
la experiencia pública completa:

1. `/` se servía desde `public/landing.html` con el sistema oscuro “Obsidian”.
2. `/login` y `/register` tenían otro tratamiento oscuro y no heredaban el tema
   del workspace.
3. `/forgot-password` y `/reset-password/:token` conservaban una tercera capa
   visual heredada.
4. La referencia Apple gris cálida aprobada existía en `/apple`, pero estaba
   documentada como una prueba no promovida. En el candidato actual `/apple`
   pasa a ser un alias de compatibilidad de la misma home pública; la captura
   aprobada queda congelada como referencia visual, no como segunda implementación.

Por tanto, el release anterior no podía describirse como una aplicación Apple
coherente de punta a punta.

## Evidencia auditada

| Paso | Superficie | Salud antes del cambio |
| --- | --- | --- |
| 1 | Landing productiva | Funcional y rica en SEO, pero fuera del lenguaje Apple y sin tema Día/Noche. |
| 2 | Login | Funcional, oscuro fijo, sin control de tema. |
| 3 | Registro | Funcional, oscuro fijo, sin control de tema. |
| 4 | Recuperación | Funcional, usa estilos heredados distintos al login. |
| 5 | Reset inválido | Funcional, pero pertenece a la misma capa visual heredada. |
| 6 | Referencia `/apple` previa | Captura visual aprobada: gris cálido, azul de acción, jerarquía sobria y foco visible. |

La auditoría interna autenticada continúa limitada: no se usaron ni solicitaron
credenciales, y no se creó una empresa de prueba en staging.

## Resultado local verificado

El 2 de septiembre de 2026 se volvió a auditar la experiencia pública y de
autenticación en una instancia limpia del frontend local (`127.0.0.1:4188`) y
la landing estática real (`/landing.html`). El handoff final se levanta desde el
build verificado en un origen nuevo para no heredar service workers locales:

1. `/landing.html` carga en Día por defecto, conserva su toggle único y cambia
   a Noche sin perder el contrato visual Apple.
2. `/login`, `/register`, `/forgot-password` y `reset invalid` usan el shell
   Apple claro, con una sola acción Día/Noche y CTA azul consistente.
3. `/ferreterias`, `/farmacias` y `/nicaragua` comparten el shell público Apple,
   `href="/"` documental y un único toggle.
4. `/privacy` y `/terms` ya no quedan en una familia oscura separada; ahora
   usan el mismo chrome editorial público.
5. El texto de inputs en modo Día quedó cubierto por la primitive común y por
   la prueba de contraste de workspace/auth.
6. El primer paint de la SPA y los prerenders públicos parten del mismo canvas
   claro/oscuro, evitando el destello Obsidian antes de hidratar.
7. `/apple` y `/` ya no pueden divergir dentro de la SPA: ambos consumen la
   misma `PublicHomePage`, mientras la raíz servida por Express conserva su
   documento estático SEO.
8. La marca instalada (favicon, iconos PWA y Apple touch icon) usa la `N` blanca
   sobre material negro, sin el acento morado anterior.

## Verificación ejecutada

- `git diff --check`
- `mise exec -- npx --no-install prisma generate --schema backend/prisma/schema.prisma`
- `mise exec -- npx tsc --noEmit`
- `mise exec -- npm run check:design`
- `DATABASE_URL='mysql://validation:validation@127.0.0.1:3306/nortex_validation' mise exec -- npx --no-install prisma validate --schema=backend/prisma/schema.prisma`
- `mise exec -- npx vitest run tests/passwordResetRoute.test.ts tests/authAppleExperience.test.tsx tests/resetPasswordSessionContract.test.ts tests/publicLandingApple.test.ts tests/publicAppleRoutes.test.tsx tests/publicEditorialApple.test.tsx tests/publicExperience.test.ts tests/publicFirstPaintTheme.test.ts tests/lightWorkspaceFormContrast.test.ts`
- `mise exec -- npm test -- --run`
- `mise exec -- npm run build:seo`

Resultado:

- TypeScript: verde.
- Sistema de diseño: `83` archivos revisados, `0` violaciones.
- Suite enfocada: `61/61` pruebas verdes.
- Suite completa: `3952` pruebas (`3884` verdes, `68` skip) sin fallos.
- Build + prerender SEO: verde (`71` rutas prerenderizadas, `72` URLs en sitemap).
- Prisma generate: verde.
- Prisma validate: verde con una URL MySQL sintética local, sin conexión ni
  lectura de datos.
- Evidencia de ejecución: los logs y capturas de estas corridas viven fuera del
  repo, en `/private/tmp/nortex-public-apple.CdwEfO/evidence`.

## Evidencia visual local

- Carpeta de capturas aceptadas:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final`
- Incluye:
  - `01-login-light.png`
  - `02-login-light-typed.png`
  - `03-login-dark.png`
  - `04-register-light.png`
  - `05-forgot-light.png`
  - `06-reset-invalid.png`
  - `07-ferreterias-light.png`
  - `08-farmacias-light.png`
  - `09-nicaragua-light.png`
  - `10-privacy-light.png`
  - `11-terms-light.png`
  - `12-landing-static-light.png`
  - `13-landing-static-dark.png`
- Handoff final de la raíz sobre build limpio:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/final`
  - `03-login-day-typed.png`
  - `05-home-final-4192-day.jpg`
  - `06-home-final-4192-night.jpg`

## Evidencia ejecutable y contractual

- Shell público Apple compartido y toggle único en SPA:
  `tests/publicAppleRoutes.test.tsx` y `tests/publicEditorialApple.test.tsx`
- Shell Apple de autenticación, persistencia de tema y sesión post-login/reset:
  `tests/authAppleExperience.test.tsx`
- Contrato SEO, tema y accesibilidad de la landing estática:
  `tests/publicLandingApple.test.ts`
- Contraste de textboxes en modo Día:
  `tests/lightWorkspaceFormContrast.test.ts`
- Contrato GET/POST del reset y sesión completa posterior:
  `tests/resetPasswordSessionContract.test.ts`

## Alcance correctivo

### Landing real

- Mantener la entrega estática de `/` y todos sus metadatos, JSON-LD, copy,
  tracking, enlaces, chat y contrato SEO.
- Adoptar la dirección visual de `/apple`: Día como valor inicial, gris cálido,
  tinta oscura, superficies blancas suaves y CTA azul.
- Ofrecer un único botón Día/Noche, persistente y accesible.
- Completar skip-link, `focus-visible`, reducción de movimiento y semántica de
  tabs.

### Autenticación pública

- Compartir un único shell Apple entre login, registro, recuperación y todos
  los estados de reset.
- Conservar requests, validación, tracking, navegación y mensajes de seguridad.
- Hacer legibles input, select, placeholder, cursor y autofill en Día y Noche.
- Mantener objetivos táctiles mínimos de 44 px y foco visible.
- Propagar el tema elegido al scope del usuario cuando login o registro entregan
  una identidad válida, sin cruzar preferencias entre tenants.
- Después de un reset exitoso, persistir la sesión completa de forma transaccional
  en el cliente: si falla una escritura, revertir el storage y pedir login manual.
- Validar en GET y POST que el principal del reset siga activo y pertenezca al
  tenant asociado antes de exponer identidad, cambiar contraseña o emitir sesión.
- Probar los handlers sobre HTTP real local: identidad inválida queda oculta y,
  ante dos POST concurrentes simulados, solo uno puede reclamar el token.

## Fuera de alcance

- Crear o cambiar credenciales.
- Alterar dinero, inventario, schema o datos de clientes.
- Aprobar producción.

## Límites honestos

- No se ejecutó login real ni creación de empresa con datos de negocio.
- La evidencia visual de este informe sigue siendo local. Staging y producción
  quedaron verificados por CI (salud, `db` y SHA exacto contra `/api/health`),
  no por una pasada visual nueva sobre esos ambientes.
- De producción solo está probada la salud por SHA. No se ejecutó smoke
  autenticado con tenant sintético ni la observación de 30 minutos; hasta que
  eso ocurra el ciclo no puede declararse `PRODUCCIÓN VERIFICADA`.
- El navegador integrado tenía una sesión previa en `127.0.0.1:4174`, por lo
  que la revisión pública se rehízo en un puerto limpio para evitar falsos
  negativos por redirección automática al app autenticado.
- La visibilidad del texto escrito en modo Día quedó validada por estilos
  efectivos y pruebas automatizadas; no se envió ningún formulario real.
- Salvo la landing estática y login, varias rutas públicas quedaron verificadas
  por contrato de tests y por una sola captura clara; no se infiere un par
  visual completo Día/Noche para cada pantalla.

## Aceptación

- Landing y login tienen par visual local Día/Noche trazable; registro,
  recuperación, reset inválido, legal y landings verticales quedan cubiertos por
  shell común probado y por capturas parciales claras de este ciclo.
- Existe exactamente un control de tema visible por pantalla.
- Los controles escritos conservan contraste y foco en ambos temas.
- SEO, JSON-LD, tracking y destinos públicos permanecen cubiertos por pruebas y
  por el prerender; no se enviaron formularios reales.
- Tabs públicas anuncian selección y panel asociado correctamente.
- `prefers-reduced-motion` elimina animaciones no esenciales.
- Pruebas enfocadas, TypeScript, sistema de diseño y build terminan verdes.
- La vista local se muestra antes de cualquier nuevo staging.

## Riesgos y mitigaciones

- **Home estática vs SPA:** `public/landing.*` conserva la entrega SEO de `/`, y
  `PublicHomePage` evita que los accesos SPA o `/apple` vuelvan a otra estética.
- **Preferencia antes y después del login:** el tema público usa la clave global;
  al conocer usuario y tenant se persiste bajo la clave scopeada vigente.
- **Regresión de conversión:** se conservan los CTA, parámetros `source`, eventos
  y destinos existentes.
- **Afirmaciones de accesibilidad:** las pruebas de contraste y semántica son una
  compuerta, pero la conformidad total no se inferirá solo de capturas.

## Aprendizaje permanente

Una ruta de demostración no equivale a promoción. La matriz de cobertura debe
nombrar por separado workspace autenticado, autenticación pública, landing real,
demo, SEO y superficies especiales; “todo Nortex” solo se puede afirmar cuando
cada familia tiene contrato y evidencia visual propia.
