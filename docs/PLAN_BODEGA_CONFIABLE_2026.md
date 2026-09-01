# Plan vigente — Bodega confiable y fácil de usar

**Misión:** cualquier persona del negocio debe poder recibir, mover, contar y
corregir existencias sin conocer el mapa interno de Nortex y sin riesgo de
afectar la ubicación equivocada.

Este documento sustituye los planes de Bodeguero que asumían una sola
ubicación. Parte de la auditoría local del 22 de agosto de 2026 y se ejecuta por
puertas de calidad: una fase no se considera terminada solo porque compile.

**Base de evidencia:** auditoría operativa local del 22 de agosto de 2026; sus
capturas de navegador se conservan fuera del repositorio por ser artefactos de QA.
Hoy la jornada está repartida entre `/app/inventory`, `/app/warehouses`,
`/app/purchases`, `/app/purchase-orders` y `/app/inventory-count`; la fase 1
consolida esas tareas sin mezclar en la portada la caja, el IVA o las cuentas por
pagar.

## Corte 2026-08-30

- Quedó cerrada la fase de exactitud para conteo, recepción de OC, compra
  directa, ajuste manual y transferencia entre ubicaciones.
- El QA autenticado verificó una cuenta nueva con dos bodegas en escritorio y
  390 × 844. También corrigió dos problemas que la automatización no veía:
  tablas móviles recortadas y avisos nativos que bloqueaban el flujo.
- La separación de permisos operativos ya cuenta con el rol `BODEGUERO`, una
  allowlist server-side y redacción de datos financieros. El siguiente bloque P0
  es ampliar capacidades por caso de uso sin debilitar esa frontera.

## Principios no negociables

1. Toda operación que cambia stock conoce su `warehouseId`.
2. `Product.stock` continúa siendo el total agregado y debe coincidir con la
   suma del desglose por bodega después de cada operación.
3. Un cliente legado solo puede omitir la bodega cuando el negocio tiene una
   única ubicación activa; con varias ubicaciones, el API rechaza la ambigüedad.
4. El operador de bodega no obtiene acceso a caja, contabilidad o configuración
   por poder recibir, mover o contar productos.
5. Ninguna vista muestra datos de una bodega bajo el nombre de otra.
6. Móvil se diseña para escanear y confirmar, no como una tabla desktop reducida.
7. Cada mutación conserva Kardex, usuario, bodega, referencia y justificación.

## Fase 0 — Rescate de exactitud

**Objetivo:** impedir movimientos ambiguos o engañosos antes de rediseñar.

### 0A. Contrato multi-bodega

- Toma física: guardar bodega, tomar el snapshot de esa ubicación y ajustar esa
  misma ubicación al cerrar.
- Compra directa: exigir bodega destino y registrarla en el Kardex.
- Recepción de OC: exigir bodega destino en cada recepción, incluyendo parciales.
- Ajuste manual: exigir bodega y mostrar disponible en esa ubicación.
- Histórico sin bodega: mantenerlo legible como dato histórico, sin inventar una
  atribución silenciosa.

### 0B. Estados confiables

- Al cambiar de bodega, retirar inmediatamente el stock anterior.
- Distinguir carga, error, sin bodegas, sin existencias y sin coincidencias.
- Reintento visible sin perder selección ni búsqueda.
- Tratar stock negativo como anomalía accionable.

### 0C. Puerta de salida

- Pruebas con dos bodegas demuestran que recibir, contar y ajustar en B no mueve A.
- Una recepción parcial conserva la bodega elegida en ProductStock y Kardex.
- Una falla de red al cambiar de ubicación nunca deja datos viejos visibles.
- `prisma validate`, pruebas objetivo, build y chequeo del sistema de diseño pasan.
- QA local autenticado cubre desktop y 390 px sin realizar mutaciones destructivas
  fuera de datos de prueba identificados.

## Fase 1 — Centro operativo Bodega

**Objetivo:** dejar de obligar al usuario a saltar entre módulos.

Una única entrada `Bodega` debe organizar el trabajo, conservando el diseño
visual actual de Nortex:

- **Resumen:** tareas pendientes y anomalías, no una pared de KPIs.
- **Recibir:** compra directa u OC, ubicación destino, escáner, revisión y parcial.
- **Mover:** origen, destino, productos, cantidades, nota y estado.
- **Contar:** ubicación, alcance, escaneo, progreso y revisión de diferencias.
- **Ajustes:** ubicación, motivo, evidencia, confirmación e historial Kardex.

El catálogo de productos sigue siendo catálogo. La decisión de pago, cuentas
por pagar e IVA sigue siendo financiera. Bodega puede registrar lo recibido sin
conceder permisos de caja.

### Puerta de salida

- Usuario nuevo identifica Recibir, Mover y Contar sin abrir “Más opciones”.
- Cada pantalla muestra ubicación, estado y siguiente acción.
- Existen estados útiles para negocio vacío, una bodega y múltiples bodegas.
- El diseño elegido se valida visualmente antes de tocar estas superficies.

## Fase 2 — Transferencias y operación móvil serias

**Objetivo:** soportar el trabajo físico y la responsabilidad entre ubicaciones.

- Transferencia: borrador → enviada/en tránsito → recepción parcial/completa.
- Referencia, nota, responsable, timestamps e historial visibles.
- Escaneo para agregar o confirmar productos.
- CTA fijo de la tarea actual y targets táctiles accesibles.
- El onboarding no puede cubrir selectores, alertas o acciones primarias.
- Recuperación clara ante cámara denegada, código desconocido y conexión perdida.

### Puerta de salida

- Una transferencia puede revisarse antes de afectar el destino.
- Dos operadores pueden entender quién envió, qué llegó y qué falta.
- El flujo principal funciona en 390 × 844 sin solapamientos ni scroll horizontal.
- Teclado, foco, Escape, labels y contraste cumplen la base WCAG 2.2 AA aplicable.

## Fase 3 — Delegación, activación y retorno

**Objetivo:** convertir Bodega en una razón para volver a Nortex.

- Definir capacidades de stock independientes de permisos financieros.
- Home por rol: recepción pendiente, transferencia por recibir, conteo abierto,
  stock negativo y productos por reponer con acción directa.
- Ayuda contextual solo cuando la tarea la necesita.
- Datos demo seguros para que una cuenta nueva complete un primer flujo.
- Instrumentación con contexto de giro, rol, dispositivo y ubicación, sin datos
  sensibles del negocio.

### Métricas

- tiempo hasta primera recepción correcta;
- recepción, traslado y conteo completados sin reintento;
- tiempo de conteo por 20 productos;
- transferencias corregidas/canceladas;
- retorno D1/D7 de quien completó una tarea real de Bodega;
- errores de ubicación ambiguos, que deben tender a cero.

## Orden de ejecución actual

| Trabajo | Estado |
|---|---|
| Conteo físico por bodega | Implementado y revisado |
| Recepción de OC por bodega | Implementado y revisado |
| Compra directa con destino | Implementado y revisado |
| Ajuste manual por bodega | Implementado y revisado |
| Estados seguros en Bodegas | Implementado y revisado |
| Navegación a Bodegas y Órdenes de compra | Implementada y verificada |
| Bodegas y Toma Física a 390 × 844 | Implementadas como tarjetas, sin scroll horizontal |
| Confirmaciones no bloqueantes de ajuste/conteo | Implementadas y verificadas |
| Matriz de permisos y rol `BODEGUERO` | Implementados; cualquier ampliación requiere revisión de política |
| Centro operativo Bodega | Especificación; requiere objetivo visual elegido |
| QA multi-bodega y móvil | Completado con cuenta y datos desechables locales |

### Corte verificado del 22 de agosto de 2026

- `warehouseId` explícito en compra directa, recepción de OC, ajuste y conteo.
- El ajuste bloquea la fila local y rechaza una merma aunque el agregado global
  tenga unidades en otra ubicación.
- La toma física fotografía y corrige solo la bodega elegida; conserva históricos
  ambiguos sin reinterpretarlos.
- El cambio de bodega nunca pinta stock anterior y bloquea acciones si la
  topología no pudo revalidarse.
- `prisma validate`, TypeScript, build y sistema de diseño pasan.
- Suite completa: 711 pruebas aprobadas y 12 integraciones omitidas en la corrida
  estándar. Esas 12 integraciones se ejecutaron después contra la instancia QA
  real y pasaron 12/12 con el mismo backend del checkout.
- QA autenticado de navegador: crear segunda bodega, ajuste localizado, toma
  física, OC recibida en Principal y transferencia móvil. La recepción dejó
  Principal=2 y Sucursal=5; la transferencia posterior movió exactamente una
  unidad entre ambas sin alterar el total.
- `Bodegas` aparece en el menú Stock simple y completo; `Órdenes de compra`
  aparece en el menú completo. Existencias, estado, diferencia y acciones son
  visibles a 390 px.

### Siguiente bloque P0 — evolución segura de permisos de Bodega

`BODEGUERO` ya existe. Toda capacidad nueva debe agregarse a su política de forma
explícita y probada, sin ampliar el poder financiero de `MANAGER` ni confiar en
ocultar controles del frontend:

- **Sí:** ver stock por ubicación, transferir, capturar/cerrar conteos, registrar
  ajustes con auditoría y recibir una OC aprobada.
- **No:** crear/aprobar/cancelar OC, registrar o pagar facturas de compra, cambiar
  la topología de bodegas, acceder a billetera o contabilidad.
- La autorización debe vivir en API; ocultar enlaces o botones solo complementa
  esa regla y nunca la sustituye. El plan de captura por cámara y códigos se
  mantiene en [PLAN_CAMARA_CODIGOS_BODEGA.md](./PLAN_CAMARA_CODIGOS_BODEGA.md).

## Regla de entrega

No se hace un rediseño masivo ni se declara “premium” por apariencia. Cada lote
de trabajo debe demostrar que reduce ambigüedad, tiempo o errores en una tarea
real y conservar una ruta de reversión segura.
