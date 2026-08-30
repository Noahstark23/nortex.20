# Plan de migración frontend — Spatial Counter

## Meta

Convertir Nortex en un workspace operativo claro y preciso, con navegación y
superficies de cobro oscuras, siguiendo la dirección visual 3 aprobada. La
migración es visual y de interacción: no cambia cálculos, permisos, aislamiento
por tenant, movimientos de inventario ni contratos del backend.

Referencia visual aprobada:

`/Users/stark/.codex/generated_images/01a02657-4a36-7a80-9e37-20c58c7b6f90/exec-86d94bc6-79a8-4c07-a7b7-c729d1d4ea2e.png`

## Contrato de diseño

- Chrome de navegación y ticket en grafito; canvas de trabajo gris muy claro.
- Verde Nortex reservado para acción primaria, selección y dinero que entra.
- Tipografía del sistema con ajuste óptico; cifras con numerales tabulares.
- Radios limitados a control, tarjeta y píldora; bordes hairline y sombras suaves.
- Foto, nombre, metadato, precio y existencia de producto con jerarquía separada.
- Objetivos táctiles mínimos de 44 px, foco visible y estados no dependientes solo
  del color.
- Respuesta desde `pointerdown`; gestos continuos con pointer capture, histéresis
  de 10 px y resortes interrumpibles desde el valor de presentación actual.
- Movimiento reducido, transparencia reducida y contraste aumentado respetados.
- Español nicaragüense y voseo en toda acción nueva.

## Fases

### Fase 1 — Fundaciones y shell

- Tokens semánticos de canvas, chrome, ticket, vidrio, elevación y movimiento.
- Contextos explícitos claro/oscuro y primitivas `nx-*` reutilizables.
- Sidebar compacto persistente en escritorio, topbar por módulo y navegación móvil.
- Motor de movimiento rAF sin dependencias y pruebas de física/reduced motion.

Salida: cualquier módulo puede adoptar el sistema sin duplicar colores ni física.

### Fase 2 — Primer valor

- Dashboard/Mi Plata con encabezado editorial, acciones rápidas y cards claras.
- Demo pública y POS real con catálogo claro y ticket oscuro anclado.
- Búsqueda, categorías, selección de producto, carrito y cobro funcionales.

Salida: el camino entrar → agregar producto → cobrar se siente como un solo sistema.

### Fase 3 — Operación comercial

- Clientes y Customer 360.
- Proveedores, compras, devoluciones y cuentas por pagar.
- Inventario, productos, importación y ajustes.

Salida: ventas, abastecimiento y relación comercial comparten jerarquía y controles.

### Fase 4 — Administración y análisis

- Facturación, reportes, contabilidad, RR. HH., configuración y planes.
- Tablas densas, filtros, formularios, estados vacíos y diálogos estandarizados.
- Unificación de skeletons, errores, confirmaciones y toasts.

Salida: todo el workspace autenticado usa las mismas primitivas y estados.

### Fase 5 — QA visual y adopción

- Comparación a viewport idéntico contra la referencia aprobada.
- Flujos desktop, tablet y móvil; teclado, lector de pantalla y preferencias del SO.
- TypeScript, Vitest focalizado, sistema de diseño y build de producción.
- Inventario de pantallas pendientes y eliminación de estilos legacy solo cuando
  no queden consumidores.

## Compuertas de aceptación

1. Ninguna regresión en contratos de caja, dinero, impuestos, inventario o tenant.
2. Ningún color o radio nuevo fuera de tokens.
3. Los controles críticos conservan nombre accesible, foco y target de 44 px.
4. La ruta principal funciona con mouse, touch y teclado.
5. La comparación visual no deja diferencias P0, P1 ni P2.
6. `npx tsc --noEmit`, pruebas focalizadas, `npm run check:design` y `npm run build`
   terminan correctamente con Node 22.23.2.

## Archivos base

- `nortex-tokens.css`: tokens y contextos.
- `index.css`: primitivas semánticas y preferencias de accesibilidad.
- `components/Layout.tsx`: shell y navegación.
- `components/Dashboard.tsx`: primer valor autenticado.
- `components/POS.tsx`: composición del POS, sin mover lógica de negocio.
- `components/pos/CajaNicaCatalog.tsx`: catálogo presentacional.
- `components/pos/CajaNicaCheckout.tsx`: cobro presentacional.
- `components/GuestPOS.tsx`: recorrido público verificable.
- `utils/fluidMotion.ts` y `hooks/useFluidPress.ts`: física compartida.
