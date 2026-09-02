# Unificación Apple de superficies públicas — 2026-09-02

## Estado

- Candidato local verificado el 2026-09-02 sobre `bc42bb0d22379227143f153442c90ad2b4f67ed3`.
- Producción permanece bloqueada.
- La publicación a staging requiere una aprobación nueva después de mostrar y
  aceptar la vista local.

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
- `mise exec -- npm audit --omit=dev`

Resultado:

- TypeScript: verde.
- Diseño: verde.
- Suite enfocada: `61/61` pruebas verdes.
- Suite completa: `3952` pruebas (`3884` verdes, `68` skip) sin fallos.
- Build + prerender SEO: verde (`71` rutas prerenderizadas).
- Prisma generate: verde.
- Prisma validate: verde con una URL MySQL sintética local, sin conexión ni
  lectura de datos.
- Auditoría de dependencias de producción: `0` vulnerabilidades.
- Revisión independiente final del bloque de reset: sin P0, P1 ni P2 abiertos.

## Evidencia visual local

- Carpeta de capturas aceptadas:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final`
- Incluye:
  - `01-login-light.png`
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
- Comparación final de la home y login con texto escrito:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/final`
- Blog y legal Día/Noche:
  `/tmp/nortex-public-apple-editorial`
- Landings verticales en escritorio/móvil y Día/Noche:
  `/tmp/nortex-public-qa.c9NihE`

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
- La reclamación concurrente del token de reset está protegida por un
  `updateMany` condicional dentro de transacción, pero no se reprodujo una carrera
  simultánea contra MySQL 8 en este ciclo visual.
- No se verificó staging ni producción; esta evidencia es local.
- El navegador integrado tenía una sesión previa en `127.0.0.1:4174`, por lo
  que la revisión pública se rehízo en un puerto limpio para evitar falsos
  negativos por redirección automática al app autenticado.
- La visibilidad del texto escrito en modo Día quedó validada por estilos
  efectivos y pruebas automatizadas; no se envió ningún formulario real.

## Aceptación

- Landing, login, registro, recuperación y reset comparten una sola familia
  visual Apple en Día y Noche.
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
