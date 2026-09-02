# Cobertura Apple Día/Noche por ruta — 2026-09-01

## Propósito

Esta matriz evita usar “todo Nortex” como una afirmación ambigua. Separa cuatro
niveles de evidencia:

- **Sólida**: captura fresca de la ruta real en Día y Noche, con viewport móvil y
  escritorio cuando la superficie los expone.
- **Parcial**: existe evidencia visual fresca, pero falta al menos un viewport,
  un tema o un estado importante.
- **Contractual**: la ruta hereda el shell tematizable y está protegida por
  pruebas estáticas, pero no tiene una captura fresca propia Día/Noche.
- **Separada**: la ruta no usa el tema global de `Layout`; requiere un contrato y
  una aceptación visual propios.

Una captura local no equivale a staging ni a producción. La columna de evidencia
describe el candidato local del 1 de septiembre de 2026.

## Resultado ejecutivo

- Las 33 rutas autenticadas declaradas en `ProtectedApp` permanecen dentro de
  `Layout`. De ellas, 32 comparten el shell tematizable y un único control
  Día/Noche por viewport: en Día usan material claro y tinta oscura; en Noche
  cambian shell y canvas juntos.
- `/app/pos` es la única excepción deliberada: conserva su superficie operativa
  oscura y oculta el header/bottom-nav que alojan el control Día/Noche. Por tanto,
  no se debe afirmar que el botón aparece en las 33 rutas.
- Tener el shell correcto no demuestra que cada módulo interno esté migrado. Hay
  rutas que todavía solo cuentan con el contrato de herencia y no con una captura
  propia.
- `/app/ayuda` ya no depende del puente que recolorea clases oscuras heredadas:
  usa primitivas semánticas y tiene evidencia fresca Día/Noche en escritorio y
  móvil.
- `/app/mi-espacio` también consume ahora superficies y tinta semánticas. La
  captura fresca comprobó que los valores del expediente y los formularios son
  visibles en Día y Noche, sin desborde horizontal en el vacío móvil de colillas.
- `/app/accounting` dejó de forzar una segunda superficie oscura dentro del
  workspace. Sus 11 pestañas, formularios y diálogos usan ahora semántica
  Día/Noche; la evidencia fresca incluye escritorio, móvil, contraste, targets y
  un recorrido de solo lectura por cada pestaña.
- `/driver` usa un tema separado por identidad. Login, estado autenticado,
  billetera, confirmación y vacío tienen evidencia local Día/Noche, pero la red de
  la sesión autenticada fue sintética e interceptada.
- Marketing, autenticación general, legal, blog, catálogo, tracking y admin no
  heredan `workspaceTheme`; requieren evidencia propia. El 2026-09-02 la
  familia pública principal quedó auditada otra vez con capturas frescas.

## Rutas autenticadas `/app/*`

| Ruta | Superficie | Estado | Evidencia actual | Hueco pendiente |
| --- | --- | --- | --- | --- |
| `/app/inicio` | Mi Negocio | Parcial | Escritorio Día/Noche | Falta par móvil propio |
| `/app/dashboard` | Mi Plata / Lender | Parcial | Escritorio Día/Noche | Falta móvil y estados Lender por destino |
| `/app/pos` | Punto de venta | Sólida, excepción operativa | Escritorio y sheets móviles | No adopta canvas claro por diseño; mantener contraste propio |
| `/app/sales` | Ventas y devoluciones | Parcial | Escritorio Día/Noche | Falta móvil propio |
| `/app/clients` | Clientes | Contractual | Herencia de workspace y root semántico | Falta captura propia Día/Noche |
| `/app/suppliers` | Proveedores | Contractual | Herencia de workspace y root semántico | Falta captura propia Día/Noche |
| `/app/hr` | Mi Personal | Contractual | Herencia de workspace y root semántico | Falta par fresco Día/Noche |
| `/app/mi-espacio` | Mi Espacio | Sólida | Escritorio/móvil Día/Noche, contraste y targets medidos | Colilla no vacía e impresión verificadas por test sintético, no por dato real |
| `/app/quotations` | Proformas | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/receivables` | Fiado y cobros | Parcial | Escritorio Día/Noche y móvil Día | Falta móvil Noche |
| `/app/reports` | Reportes | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/marketplace` | B2B Marketplace | Contractual | Herencia de `Layout`; ruta oculta del menú | Falta captura y decisión de producto |
| `/app/blueprint` | Panel de blueprint | Contractual | Herencia y root semántico | Ruta técnica oculta; falta aceptación propia |
| `/app/delivery` | Entregas | Sólida | Escritorio/móvil Día/Noche, kanban y sheet | Mantener regresiones cubiertas |
| `/app/inventory` | Mis Productos | Sólida | Escritorio/móvil Día/Noche | Modales heredados todavía requieren recorrido temático |
| `/app/warehouses` | Bodegas | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/mi-carga` | Carga del vendedor | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/purchase-orders` | Órdenes de compra | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/serials` | Series | Contractual | Herencia; satélite de Inventario | Falta captura propia Día/Noche |
| `/app/scales` | Balanzas y etiquetas | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/inventory-count` | Conteo físico | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche y rol Bodeguero |
| `/app/cash-registers` | Caja y arqueos | Parcial | Escritorio Día/Noche | Falta móvil y sheets en Noche |
| `/app/smart-purchases` | Compras inteligentes | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/purchases` | Compras | Parcial | Escritorio Día/Noche y tickets/sheets | Falta recorrido móvil de la ruta completa |
| `/app/financial-health` | Salud financiera | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/audit` | Auditoría | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/accounting` | Contabilidad | Sólida | Escritorio/móvil Día/Noche, 11 pestañas, formularios y diálogos medidos | Datos autenticados locales; mutaciones financieras no se ejecutaron en navegador |
| `/app/billing` | Mi Plan de Nortex | Contractual | Herencia de `Layout` | Falta captura propia Día/Noche |
| `/app/team` | Mi Equipo | Sólida | Escritorio/móvil Día/Noche y menú abierto | Cierre visual del shell actual |
| `/app/cartera` | Lender: cartera | Parcial | Shell `COLLECTOR` Día/Noche | Falta `LenderDashboard` de owner/admin y destino completo |
| `/app/cobros` | Lender: reportes de cobro | Parcial | Shell `COLLECTOR` Día/Noche | Falta `LenderDashboard` de owner/admin y destino completo |
| `/app/cobradores` | Lender: cobradores | Parcial | Shell `COLLECTOR` Día/Noche | Falta `LenderDashboard` de owner/admin y destino completo |
| `/app/ayuda` | Centro de ayuda | Sólida | Escritorio/móvil Día/Noche, contraste y targets medidos | Mantener contratos de tema y navegación local |

## Rutas fuera del tema global

| Ruta o familia | Estado | Observación |
| --- | --- | --- |
| `/driver`, `/driver/:id` | Separada con evidencia sólida local | Tema propio por repartidor; sesión autenticada visual con API sintética |
| `/` y `/apple` | Separada con evidencia parcial + contractual | `/` conserva la entrega estática SEO con captura Día/Noche en escritorio; `/apple` es un alias de compatibilidad de la misma home SPA y queda cubierto por contrato. Falta completar el par móvil de la raíz y una captura propia de `/apple`. |
| `/register`, `/login`, `/forgot-password`, `/reset-password/:token` | Separada con evidencia parcial + contractual | Login tiene captura Día/Noche. Registro, recuperación y reset inválido comparten `AuthShell` y pruebas propias, pero en este ciclo solo tienen captura clara. |
| `/demo` | Separada | Demo pública; no satisface aceptación del producto autenticado |
| `/ferreterias`, `/farmacias`, `/nicaragua` | Separada con evidencia parcial + contractual | Landings SEO auditadas otra vez el 2026-09-02 con shell público Apple. La cobertura Día/Noche del shell está en tests; las capturas frescas de este ciclo son claras. |
| `/blog`, `/blog/categoria/:slug`, `/blog/:slug` | Separada con evidencia contractual | Contenido público sobre `BlogShell`, cubierto por pruebas de tema y navegación. Las capturas editoriales previas no forman parte de la carpeta trazable de este release. |
| `/privacy`, `/terms` | Separada con evidencia parcial + contractual | Legal sobre `BlogShell`; cada ruta tiene una captura clara en Día y contrato compartido de tema. Faltan sus pares visuales Noche y móvil. |
| `/pedidos/:slug`, `/catalog/:slug` | Separada | Catálogo público; patrones alias del mismo componente |
| `/track/:pedidoId` | Separada | Tracking público |
| `/repartidor/registro` | Separada | Registro de repartidor con estilo propio |
| `/admin` | Separada | Consola administrativa fuera de `ProtectedApp` |

## Evidencia pública del 2026-09-02

- Login Día/Noche:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/01-login-light.png`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/03-login-dark.png`
- Registro:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/04-register-light.png`
- Recuperación y reset inválido:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/05-forgot-light.png`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/06-reset-invalid.png`
- Landings SEO:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/07-ferreterias-light.png`,
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/08-farmacias-light.png`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/09-nicaragua-light.png`
- Legal:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/10-privacy-light.png`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/11-terms-light.png`
- Landing estática real:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/12-landing-static-light.png`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/13-landing-static-dark.png`
- Handoff final de la raíz sobre build limpio (`127.0.0.1:4192`):
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/final/05-home-final-4192-day.jpg`
  y
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/final/06-home-final-4192-night.jpg`
- Login claro con texto escrito en modo Día:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence/iab-2026-09-02-final/02-login-light-typed.png`
- Evidencia ejecutable y logs de este ciclo:
  `/private/tmp/nortex-public-apple.CdwEfO/evidence`

La sesión pública se ejecutó en `127.0.0.1:4188` para evitar la redirección
automática provocada por una sesión previa del browser sobre `127.0.0.1:4174`.
No se ejecutaron credenciales reales ni mutaciones de negocio.

## Evidencia autenticada del 2026-09-01

Las referencias antiguas a `.codex/apple-*-audit-*` son artefactos locales no
versionados: permanecen en el workspace canónico del operador, pero no se copian
a este worktree aislado ni forman parte del commit. Por tanto, sustentan el
histórico de la auditoría, no una prueba reproducible desde Git ni una
verificación del despliegue actual.

Se conservan los estados de cobertura de `/app/*` porque siguen respaldados por:

- La declaración real de las `33` rutas autenticadas dentro de `ProtectedApp`
  en `App.tsx`.
- La compuerta estructural de `tests/appleWorkspaceContract.test.ts`, que exige
  que todos los destinos autenticados permanezcan dentro de `Layout` y mantiene
  `/app/pos` como única excepción operativa.
- La compuerta de `tests/layoutThemeToggle.test.tsx`, que exige un solo control
  conceptual por viewport y persistencia de tema por identidad.
- Los contratos semánticos específicos de `tests/teamVisualSemantics.test.ts`,
  `tests/helpCenterThemeContract.test.ts` y
  `tests/contabilidadThemeContract.test.ts`.
- Los recorridos sintéticos de `tests/helpCenter.test.tsx` y
  `tests/contabilidadUx.test.tsx`.

Por honestidad, los estados `Sólida` de `/app/*` describen el cierre local del
ciclo anterior y no deben presentarse como evidencia fresca de este release.
La promoción actual solo vuelve a verificar las superficies públicas incluidas
en `/private/tmp/nortex-public-apple.CdwEfO/evidence`; staging exige además salud
y contenido servidos desde el SHA exacto.

## Compuertas que sostienen el resultado

- `tests/appleWorkspaceContract.test.ts` clasifica cada destino autenticado,
  exige que permanezca dentro de `Layout` y mantiene `/app/pos` como excepción
  operativa sin prometer que el toggle sea visible dentro del POS.
- `tests/layoutThemeToggle.test.tsx` exige un solo control conceptual por viewport,
  sincronización del shell/`html`/`body` y persistencia por identidad.
- `tests/shellThemeContrast.test.ts` exige contraste mínimo 4.5:1 para tinta e
  iconos sobre materiales Día/Noche.
- `tests/teamVisualSemantics.test.ts` evita que `/app/team` vuelva a colores fijos
  incompatibles con el canvas.
- `tests/helpCenterThemeContract.test.ts` impide reintroducir colores oscuros
  fijos, `transition-all` o perder las primitivas de canvas.
- `tests/helpCenter.test.tsx` protege jerarquía, targets, press states y los cuatro
  destinos locales exactos de los tutoriales.
- `tests/contabilidadThemeContract.test.ts` impide reintroducir la raíz oscura,
  exige superficies/controles semánticos y conserva roles, carga lazy, endpoints
  y barreras de las mutaciones contables.
- `tests/contabilidadUx.test.tsx` mantiene diálogos accesibles, fechas civiles de
  Managua, autorización, idempotencia y confirmaciones previas a las mutaciones.

## Corridas conocidas de este ciclo

- `mise exec -- npm run check:design`: `83` archivos revisados, `0`
  violaciones.
- Suite pública/auth enfocada del 2026-09-02: `61/61` verdes.
- `mise exec -- npm test -- --run`: `3952` pruebas totales, `3884` verdes y
  `68` skip.
- `mise exec -- npm run build:seo`: `71` rutas prerenderizadas y `72` URLs en
  sitemap.
- Los logs y capturas de estas corridas viven fuera del repo en
  `/private/tmp/nortex-public-apple.CdwEfO/evidence`.

## Regla para cerrar “todo Nortex”

Una ruta solo pasa de **Contractual** a **Sólida** cuando tiene captura fresca de
sus estados relevantes en Día/Noche, QA focal, ausencia de mutaciones inesperadas y
un límite escrito. El orden siguiente se decide por impacto y deuda visible, no por
la facilidad de producir una captura.
