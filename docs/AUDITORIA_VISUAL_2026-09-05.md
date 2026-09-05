# Auditoría visual de Nortex — 2026-09-05

## Propósito y candidato

Esta ronda separa la calidad demostrada de la autorización de release. Las rutas
públicas y de acceso se revisaron desde un checkout local basado en
`d9cdd7cefb1724ab2fab65458f6aadaf531c339a`, sin enviar formularios, sin
credenciales reales y sin tocar dinero, inventario ni usuarios. La observación
autenticada provino de una sesión QA local ya abierta; es evidencia exploratoria,
no una prueba amarrada al SHA. Nada de esta ronda acredita producción.

El candidato se conserva localmente en la rama
`codex/release-gate-20260905`; no se envió, integró ni desplegó a ningún
entorno.

## Demostrado en navegador local

| Recorrido | Día | Noche | Resultado observado |
| --- | --- | --- | --- |
| Inicio autenticado de QA | Sí | Sí | Observación exploratoria de shell, menú, avisos y cambio de tema; debe repetirse sobre el SHA candidato. |
| Inventario y alta rápida | Sí | Sí | Observación exploratoria de tarjetas, filtros y formulario; el texto escrito quedó oscuro sobre fondo claro. |
| Mi Equipo | Sí | No aplica a una segunda captura | Observación exploratoria de encabezado, cards y jerarquía; la carga inicial resolvió al contenido. |
| Login anónimo | Sí | Sí | Un único control Día/Noche, formulario legible y texto sintético escrito sin enviar. |
| Landing SPA (`/`) | Sí | No en esta ronda | Navegación, CTA, contraste y jerarquía de la superficie pública revisados. |
| Landing estática de producción (`landing.html`) | Sí | Sí | Navegación, CTA, selector de tema, primer hero y contenido SEO visibles y funcionales. |

La última fila se revisó sobre `dist/landing.html` generado por `npm run
build:seo` y servido de forma estática desde el checkout aislado; no se usó
una vista de desarrollo ni una página de demostración distinta.

En el formulario local de inventario se midió texto `rgb(23, 26, 31)` sobre
blanco (aprox. 17.7:1) y placeholder `rgb(86, 98, 113)` (aprox. 6.2:1). Ambos
superan AA para texto normal. Esta medición no sustituye el recorrido de cada
formulario del producto.

## Evidencia ejecutable de este candidato

La ronda focal pasó **57/57** pruebas en ocho archivos:

```sh
mise exec -- npm test -- --run \
  tests/authAppleExperience.test.tsx \
  tests/publicAppleRoutes.test.tsx \
  tests/publicLandingApple.test.ts \
  tests/lightWorkspaceFormContrast.test.ts \
  tests/lightWorkspaceSurfaceInk.test.ts \
  tests/layoutThemeToggle.test.tsx \
  tests/publicEditorialApple.test.tsx \
  tests/moduleSurfaceTheme.test.ts
```

Cubren tema y persistencia de acceso, rutas públicas, landing estática,
contraste/autofill de los campos claros, toggle del layout y contratos de los
módulos. Son controles de regresión; no son una certificación completa de cada
ruta ni de producción.

Como verificación complementaria del checkout aislado, se generó el cliente
Prisma con el schema local y `tsc --noEmit` terminó sin errores. `build:seo`
también terminó correctamente, prerenderizó 71 rutas y dejó 72 URLs en el
sitemap. La advertencia de Browserslist desactualizado y el chunk `xlsx` mayor
de 500 kB quedan como deuda de mantenimiento; no fueron introducidos por esta
ronda.

## Reparación P0: tinta ilegible sobre rellenos sólidos

La revisión posterior encontró combinaciones reales de `text-white` con
rellenos verde, rojo, ámbar y azul cuyo contraste no alcanzaba AA. La causa no
era una paleta uniforme: Tailwind remapea algunos aliases a los canales RGB de
marca/estado, mientras los tokens de texto de estado tienen otro uso. Por eso
no se fusionaron `--nx-danger` ni `--nx-warning` de forma global.

El candidato local añade tintas de control explícitas y reglas de compatibilidad
de selector exacto en `index.css`. Cubren los botones sólidos existentes de
marca (`brand`, `emerald`, `blue`, WhatsApp, etc.), danger/rose/red-500,
warning/orange/amber-500/600 y sky-600, además de los hover que cruzan entre
un tono claro y uno oscuro. La revisión del candidato detectó tres
descendientes que no quedaban protegidos por una regla que coincidía sólo en
el mismo elemento: el icono del acceso rápido con fondo `brand-600`, el cierre
y el subtítulo del toast de pedidos. Ahora usan `text-brand-on` (el subtítulo a
80 %, aún AA) de forma explícita. El icono de selección ámbar también usa una
tinta semántica propia, porque su clase de color vive en el SVG y no en el
contenedor.
Se preservan los rellenos con opacidad y los tonos ya legibles (`red-600+`,
`amber-700+`, `sky-700+`, `green-800+`).

La matriz ejecutable ahora comprueba contraste AA de cada tinta, que el guard
no use selectores amplios ni fondos con opacidad, y los pares reales de
contenedor--icono descendiente. En el mismo checkout del candidato pasaron:

```sh
mise exec -- npx --no-install prisma generate --schema backend/prisma/schema.prisma
mise exec -- npx --no-install tsc --noEmit
mise exec -- npm test -- --run \
  tests/frontendColorSemantics.test.ts \
  tests/frontendCriticalPress.test.ts \
  tests/deliveryVisualContext.test.ts \
  tests/fluidMotion.test.ts \
  tests/fluidSheet.test.tsx \
  tests/lightWorkspaceFormContrast.test.ts \
  tests/lightWorkspaceSurfaceInk.test.ts \
  tests/shellThemeContrast.test.ts
mise exec -- npm run check:design
mise exec -- npm run build
```

Resultado: 49/49 pruebas focales, TypeScript, sistema de diseño y build
correctos. También se recorrió localmente una venta de demostración hasta la
selección de pago; los botones verdes mostraron tinta oscura legible. Esa
demostración no escribió datos reales y no acredita los módulos autenticados:
la validación de cada ruta permanece pendiente de tenant QA y del SHA que llegue
a staging.

## Reparación P0: puente Día para texto heredado

La segunda revisión encontró la causa común de varios textos invisibles: el
bridge Día ya convertía `surface` y `slate` a canvas claro, pero sólo traducía
encabezados e inputs; párrafos, botones, badges e iconos con `text-white` o
`text-slate-*` seguían sin una tinta contextual. No se corrigió pantalla por
pantalla. El bridge ahora hereda una tinta desde las mismas superficies que
convierte, usando variables de contexto y clases exactas.

Los rellenos semánticos claros publican su propia tinta AA para descendientes.
Los tickets, código, fondos oscuros y los gradientes oscuros marcados con
`nx-dark-island` restablecen tinta clara. Los gradientes mixtos de facturación
se ajustaron por estado: verde con tinta de marca, rojo `red-800` a `red-900`
con texto secundario medido al 80 %, y ámbar con tinta de advertencia. Así no existe una regla plana que
convierta a oscuro un recibo, un CTA oscuro o un gradiente de impuestos.

`tests/lightWorkspaceSurfaceInk.test.ts` verifica el alcance, las islas, el
orden frente al contrato de rellenos sólidos y los tres gradientes. El modo
Noche queda fuera de este bridge y conserva sus propios tokens.

## Límites que impiden declarar “todo Nortex aprobado”

- Las 33 rutas autenticadas no recibieron todavía un recorrido visual real con
  datos QA en ambos tamaños de pantalla ni ligado al SHA candidato.
- No se enviaron login, registro, reset ni invitaciones; falta cubrir sus errores
  de API con identidades sintéticas.
- POS, compra, fiado, devolución, cierre, delivery, LENDER, Superadmin y
  periféricos requieren sus recorridos UI→API→MySQL y roles aislados. Los flujos
  con dinero o stock no se acreditan por apariencia.
- No hubo prueba física de cámara, impresora, balanza, lector ni operación humana
  prolongada.

## Estado de release

**Producción bloqueada.** El control de promoción por SHA está preparado en un
candidato local separado, pero no está integrado en `main` ni reemplaza la
configuración externa de GitHub/Coolify. Antes de cualquier promoción se exige:

1. Integrar una compuerta donde CI no pueda desplegar producción y donde el SHA
   tenga confirmación manual explícita.
2. Proteger `main`, impedir autoaprobación/bypass en `production` y verificar el
   destino Coolify fijado al mismo SHA con Auto Deploy apagado.
3. Ejecutar CI y staging sobre el SHA exacto, luego completar la matriz funcional
   con tenants QA antes de pedir una autorización de producción separada.

## Próxima ronda

Usar un tenant QA descartable para recorrer Día/Noche y el texto escrito en
Inicio, Inventario, Compras, POS y Equipo; luego cubrir dos tenants y los roles
OWNER, CASHIER, BODEGUERO y ACCOUNTANT en los flujos financieros e inventario.
