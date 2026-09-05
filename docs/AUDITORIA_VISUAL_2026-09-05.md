# Auditoría visual de Nortex — 2026-09-05

## Propósito y candidato

Esta ronda separa la calidad demostrada de la autorización de release. Las rutas
públicas y de acceso se revisaron desde un checkout local basado en
`d9cdd7cefb1724ab2fab65458f6aadaf531c339a`, sin enviar formularios, sin
credenciales reales y sin tocar dinero, inventario ni usuarios. La observación
autenticada provino de una sesión QA local ya abierta; es evidencia exploratoria,
no una prueba amarrada al SHA. Nada de esta ronda acredita producción.

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

La ronda focal pasó **54/54** pruebas en siete archivos:

```sh
mise exec -- npm test -- --run \
  tests/authAppleExperience.test.tsx \
  tests/publicAppleRoutes.test.tsx \
  tests/publicLandingApple.test.ts \
  tests/lightWorkspaceFormContrast.test.ts \
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
