---
name: nortex-clean-code
description: Diseñar y refactorizar módulos de Nortex con contratos pequeños, precisión financiera y pruebas de conducta. Complementa nortex-feature y nortex-qa; no autoriza cambios de rama ni releases.
---

# Código mantenible en Nortex

Leé `AGENTS.md` y `CLAUDE.md` completos antes de modificar producto. Usá
`nortex-feature` para ejecutar el cambio y `nortex-qa` para verificarlo. Estas
fuentes gobiernan integridad, entorno y autorización; esta skill concreta el diseño.

## Contratos y propietarios

- Ubicá el dueño existente con `rg` antes de crear helpers. Reutilizá políticas de
  acceso, validadores de cantidades, fechas Managua, servicios y cliente Prisma.
- Cada módulo tiene una responsabilidad y un contrato pequeño: entradas tipadas,
  salida, errores, autoridad y efectos. Los cálculos reciben valores; la capa de
  aplicación coordina permisos, persistencia y transacciones.
- Lógica pura nueva vive en módulos sin I/O de `utils/` o `backend/lib/`, o en un
  servicio acotado. No la agregués al inicio de `POS.tsx` ni de `server.ts`.
- Estado, eventos y recursos se quedan junto a su dueño. Extraer JSX sin trasladar
  el estado correspondiente puede ordenar el archivo sin reducir acoplamiento.
  Tampoco trasladés el monolito completo a un hook.
- Antes de trabajo paralelo, fijá archivos permitidos por agente y un único
  integrador de archivos compartidos; revisar un archivo no autoriza editarlo.

## Integridad del dominio

- Dinero nuevo usa Decimal desde entrada hasta persistencia. Elegí precisión y
  redondeo explícitos según el contrato: contabilización, impuesto, cantidad o
  presentación pueden tener límites distintos. No redondear solo al mostrar.
- Los Float legacy no justifican campos monetarios nuevos Float; migrarlos exige
  expansión, comparación, backfill y reconciliación por agregado, sin sweep global.
- El servidor calcula importes y permisos. `tenantId` proviene de la identidad
  autenticada; una selección por ID no sustituye la verificación de propiedad.
- Stock usa `applyStockDelta`. Stock, efectos financieros, idempotencia y auditoría
  comparten transacción. Pasá esa transacción a los colaboradores; no abrir otra
  conexión global dentro de ella ni llamar proveedores externos.
- Validá con los schemas Zod existentes y reglas de acceso del dominio. No inventés
  un listado universal de roles ni conviertas un dato ausente en cero.
- Usá los contratos de cantidades: cajas/unidades contadas y unidades medidas no
  son equivalentes. No truncar ni sustituir la validación por `parseInt`/`parseFloat`.
- Tipá límites nuevos sin propagar `any`. `tsconfig.json` no implica modo estricto
  global; tipar un módulo no acredita haber migrado todo el proyecto.
- Errores de negocio son explícitos y conservan el trabajo recuperable. Los logs
  no incluyen secretos, documentos completos ni datos privados innecesarios.

## Extracciones con evidencia

1. Caracterizá la conducta antes de mover: función real importada, render real o
   HTTP/MySQL según el flujo. Conservá URL, permisos, errores, estado e identidad.
2. Extraé por responsabilidad y revisá dependencias/ciclos. No introducir nuevos
   clientes Prisma, motores de cola ni lógica financiera duplicada.
3. Reejecutá los mismos escenarios y las compuertas correspondientes al cambio.
4. Medí líneas de origen, destinos y conjunto. Reducí en el mismo cambio los
   límites de `tests/presupuestoBackend.test.ts` y `tests/presupuestoPos.test.ts`;
   son la fuente vigente, no las cifras de un informe anterior. `useState` allí es
   un conteo textual, no una medición AST ni de rendimiento.
5. No elevar presupuestos ni ampliar excepciones textuales para pasar; tampoco
   bajar umbrales o pisos de cobertura. Migrá aserciones de ubicación a conducta
   cuando corresponda, conservando garantías.

## Pruebas que detectan errores

- Importá implementación real y compará resultados esperados independientes. Una
  copia de la fórmula, coincidencia de texto o porcentaje verde no prueba el flujo.
- Para dinero/inventario, añadí escenarios de concurrencia, rechazo y rollback en
  MySQL descartable; el comando canónico está en `nortex-qa`.
- Stryker puede mutar código con I/O; la separación pura facilita pruebas rápidas
  y deterministas. Reconciliá `stryker.config.json`, sus rangos y
  `scripts/check-mutation-scope.cjs` cuando cambie el alcance. No bajar umbral ni
  pisos; verificá que se instrumentó la función completa y que el reporte coincide
  con la fuente. Un sobreviviente se investiga; no se oculta con exclusiones.
- Reducción de líneas no demuestra menor latencia, memoria ni incidentes. Si esa
  es la mejora prometida, medila sobre el mismo escenario antes y después.
