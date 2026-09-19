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
  heredan `workspaceTheme`; siguen siendo un programa visual separado.

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
| `/` y `/apple` | Separada | Marketing; `/apple` es referencia, no prueba del ERP autenticado |
| `/register`, `/login`, `/forgot-password`, `/reset-password/:token` | Separada | Flujos de acceso con estilo propio; no heredan el botón del ERP |
| `/demo` | Separada | Demo pública; no satisface aceptación del producto autenticado |
| `/ferreterias`, `/farmacias`, `/nicaragua` | Separada | Landings SEO |
| `/blog`, `/blog/categoria/:slug`, `/blog/:slug` | Separada | Contenido público |
| `/privacy`, `/terms` | Separada | Legal |
| `/pedidos/:slug`, `/catalog/:slug` | Separada | Catálogo público; patrones alias del mismo componente |
| `/track/:pedidoId` | Separada | Tracking público |
| `/repartidor/registro` | Separada | Registro de repartidor con estilo propio |
| `/admin` | Separada | Consola administrativa fuera de `ProtectedApp` |

## Evidencia del cierre del menú

- Escritorio Día:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/01-team-desktop-day-current.png`
- Escritorio Noche:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/02-team-desktop-night-current.png`
- Móvil Noche, contenido:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/03-team-mobile-night-closed.png`
- Móvil Día, contenido:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/06-team-mobile-day-closed.png`
- Menú móvil Noche:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/04-team-mobile-menu-night-current.png`
- Menú móvil Día:
  `.codex/apple-route-matrix-audit-2026-09-01-cycle9/05-team-mobile-menu-day-current.png`

La sesión fue autenticada local y solo se alternó el tema y se abrió/cerró el menú.
No se pulsaron invitaciones, asistencia, cierre de sesión ni acciones de negocio.

## Evidencia del Centro de Ayuda

- Escritorio Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/08-desktop-day-after.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/07-desktop-night-after.png`
- Móvil Día/Noche:
  `.codex/apple-help-audit-2026-09-01-cycle10/05-mobile-day-after.png` y
  `.codex/apple-help-audit-2026-09-01-cycle10/06-mobile-night-after.png`

## Evidencia de Mi Espacio

- Antes, móvil Día con los valores ocultos:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/07-mobile-day-forms-before.png`
- Después, escritorio Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/12-desktop-day-after.png` y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/13-desktop-night-after.png`
- Después, móvil Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/09-mobile-day-after.png` y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/15-mobile-night-after.png`
- Formularios móviles Día/Noche:
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/11-mobile-day-forms-after.png`
  y
  `.codex/apple-miespacio-audit-2026-09-01-cycle11/16-mobile-night-forms-after.png`

La medición antes/después vive en `08-metrics-day-before.json`,
`10-metrics-mobile-day-after.json` y `14-metrics-night-after.json` del mismo
directorio. El mínimo crítico de Día pasó de **1:1** a **5.40:1** en el conjunto
muestreado y los siete controles propios del módulo pasaron de 35–39.5 px a
44 px. La sesión local no envió solicitudes ni abrió una impresión real.
- Medición de contraste de 84 muestras visibles por tema:
  `.codex/apple-help-audit-2026-09-01-cycle10/09-contrast-after.json`
- Medición móvil de los cinco controles del módulo:
  `.codex/apple-help-audit-2026-09-01-cycle10/10-mobile-metrics-after.json`
- Conteo del único control Día/Noche visible por viewport:
  `.codex/apple-help-audit-2026-09-01-cycle10/11-theme-toggle-after.json`

La sesión local solo alternó el botón visible Día/Noche, abrió y cerró el menú y
desplazó la superficie. Los cuatro tutoriales conservaron sus destinos y se
verificaron en jsdom; no se inició un tour ni se ejecutó una mutación de negocio.

## Evidencia de Contabilidad

- Antes, escritorio Día con contenido invisible sobre tarjetas claras:
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
- Menú móvil Día/Noche con un único control global:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/13-mobile-menu-day-after.png`
  y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/14-mobile-menu-night-after.png`
- Diálogo de decisión en escritorio Día/Noche:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/21-desktop-day-dialog-after.png`
  y
  `.codex/apple-accounting-audit-2026-09-01-cycle12/22-desktop-night-dialog-after.png`
- Foco visible de teclado en pestaña y selector mensual:
  `.codex/apple-accounting-audit-2026-09-01-cycle12/25-keyboard-focus-after.json`

Los textos críticos medidos pasaron de **1:1** en Día a **17.44:1**; en Noche
quedaron en **13.88:1**. Todos los controles propios visibles quedaron en 44 px
o más y no hubo desborde horizontal en 390 px ni en 1280 px. Los recorridos de
las 11 pestañas están en `23-all-tabs-night-after.json` y
`24-all-tabs-day-after.json`: cero targets menores de 44 px, cero controles fuera
del canvas y cero alertas visibles en ambos temas. La sesión no confirmó asientos,
declaraciones, retenciones, cierres, reaperturas, depreciaciones ni bajas de
activos; esas conductas permanecieron bajo pruebas sintéticas y contratos de
código, no bajo datos financieros reales.

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

## Regla para cerrar “todo Nortex”

Una ruta solo pasa de **Contractual** a **Sólida** cuando tiene captura fresca de
sus estados relevantes en Día/Noche, QA focal, ausencia de mutaciones inesperadas y
un límite escrito. El orden siguiente se decide por impacto y deuda visible, no por
la facilidad de producir una captura.
