# Nortex Agent Instructions

Nortex es un ERP/POS multi-tenant que maneja dinero e inventario reales. Antes de
modificar el producto, lee `CLAUDE.md` completo: es la fuente canónica de reglas de
dominio, seguridad, integridad, escalabilidad y QA para todos los agentes.

## Antes de tocar archivos

- Ejecuta `git status --short --branch` y preserva todo cambio existente del usuario.
- No cambies de rama, limpies, restaures, hagas rebase o alteres worktrees sin una
  solicitud explícita. Nunca uses `git clean`, `reset --hard` o equivalentes.
- No leas ni muestres `.env*`, llaves, tokens, credenciales o datos de producción.
- No hagas deploy, push, merge, cambios DNS, llamadas a webhooks ni mensajes externos
  salvo autorización explícita y separada.

## Toolchain canónico

- Node `22.23.2`, fijado en `.mise.toml`; usa `mise install` y `mise exec -- ...`.
- npm + `package-lock.json` son canónicos. No generes ni uses lockfiles de pnpm/yarn.
- Prisma está fijado a `6.4.1`; usa siempre el binario local con
  `npx --no-install prisma`.
- MySQL 8 es la base de datos. No asumas PostgreSQL.

## Desarrollo y verificación

- Frontend local seguro: `nortex frontend` (`127.0.0.1:4174`).
- Backend local: `nortex backend` (`127.0.0.1:3210`) después de `nortex db-up`.
- Integración Docker completa opcional: `nortex app-up` y `nortex app-down`.
- Compuerta rápida, sin deploy: `nortex check` o `sh scripts/ci-local-safe.sh`.
- La compuerta mínima es: Prisma generate, TypeScript, Vitest, sistema de diseño y
  build. Activa mutación con `NORTEX_CI_MUTATION=1` cuando cambie lógica de dinero.
- Los servicios locales viven en `~/Developer/Nortex`; no uses el Compose de
  producción para desarrollo general ni inicies su servicio de backup.

## Reglas de revisión

- Toda lectura/escritura de negocio debe quedar aislada por `tenantId` obtenido del
  JWT autenticado; nunca confiar en un tenant enviado por el cliente.
- Dinero nuevo usa Decimal/`decimal.js`; stock se mueve mediante `applyStockDelta`.
- Mutaciones de dinero o inventario requieren auditoría atómica en la misma transacción.
- Cambios de schema son aditivos y nunca usan `--accept-data-loss`.
- Trata cualquier valor de entorno como secreto y evita incorporarlo a bundles,
  fixtures, logs, capturas o respuestas del agente.

## Coordinación y modularidad

- Antes de trabajar en paralelo, acordar el contrato entre módulos, un responsable
  de edición por dominio y una lista explícita de archivos permitidos por agente.
  Los archivos compartidos tienen un único integrador; revisar no habilita a editarlos.
- Los flujos nuevos viven fuera de `backend/server.ts` y `components/POS.tsx`, en
  rutas, servicios, componentes o hooks con una responsabilidad concreta. Los
  monolitos solo componen esos módulos; no trasladar el monolito entero a un hook.
- Antes de extraer, caracterizar la conducta con una prueba ejecutable del flujo.
  Mantener contratos de URL, tenant, roles, errores y estado; una búsqueda de texto
  no reemplaza pruebas de conducta.
- Nunca subir el presupuesto de líneas/estado ni ampliar excepciones para hacer
  pasar un test. Una extracción reduce el presupuesto en el mismo cambio y reporta
  el delta del archivo original, de los módulos destino y del total afectado.
- Registrar implementación, QA y despliegue por separado. El avance local de
  activación/modularidad del 2026-09-04 y sus pendientes se documentan en
  [el informe de la entrega](docs/ACTIVACION_Y_MODULARIDAD_2026-09-04.md).
- La cola de ventas se reintenta con `usePosOfflineQueue` y `toOfflineSyncTransport`:
  no enviar filas de IndexedDB por spread ni crear un segundo motor en Avisos.
  Guardada localmente no significa confirmada; conservar identidad y evidencia.
- Un panel operativo debe bloquear atajos y lector por detrás, distinguir fallo
  de cero y comprobar cómo conserva el carrito antes de navegar. Contratos y QA
  actuales: [POS y avisos](docs/POS_Y_AVISOS_2026-09-04.md).
- Una entrega de rediseño requiere antes/después del mismo escenario y evidencia
  del recorrido que simplifica. Pasar pruebas no acredita mejora visual ni retención.
  Ver [rediseño visible del POS](docs/REDISENO_POS_2026-09-04.md). Comprobar el alcance
  de los selectores CSS contra los ancestros de Layout y ambos modos del POS.

## Criterio de cierre de entregas

- Separar demostrado, defecto reproducido, riesgo por validar y no probado;
  vincular cada estado con escenario, candidato y evidencia. Tests omitidos no
  cuentan como aprobados; un total verde no sustituye la prueba transaccional.
- Diferencias de dinero/stock, duplicación, pérdida de trabajo o acceso indebido
  bloquean la aprobación del flujo afectado. Verificar la reparación antes de
  ampliarlo; las mejoras independientes conservan una revisión proporcional.
- Seguir las prioridades E01–E08 del [plan de dirección](docs/PLAN_DIRECCION_UX_Y_VALIDACION_2026.md#0-ejecución-posterior-a-la-revisión-exigente).
  No declarar «definitivo», «sin errores» o «mejora la retención» por apariencia,
  acuerdo de agentes o conteos de tests. Requieren evidencia del resultado.

## Compuerta de calidad integral (2026-09-04)

- Las prioridades E01–E08 se registran en `docs/PLAN_DIRECCION_UX_Y_VALIDACION_2026.md`.
  La evidencia ejecutada y la cobertura por módulo viven en `docs/VERIFICACION_MODULOS_2026-09-04.md`.
- `npm run test:integration:required` es obligatorio para cambios de dinero/inventario.
  Usa MySQL 8 local descartable y falla si una suite falta, falla o contiene casos omitidos.
  No conectar bases de usuarios ni reutilizar credenciales reales para esta compuerta.
- Resolver y sembrar cuentas de un asiento usando la transacción recibida.
  Una consulta por el cliente global durante una transacción puede agotar el pool;
  la prueba de una conexión debe conservarse.
- Fechas de vencimiento son días civiles del catálogo; comparar contra el día
  vigente en Managua con `utils/batchExpiry.ts`, también en FEFO y vistas.
- Una consulta de evidencia offline es de solo lectura. No marcar sincronizada,
  borrar o recrear una venta pendiente por una coincidencia aproximada o un 404.
- Cambiar documentación de reglas operativas implica reconciliar recetas antiguas
  de la skill y `CLAUDE.md`; la documentación nunca sustituye pruebas ejecutables.

## Promoción de producción

Seguir `docs/releases/2026-09-04-production-gate.md`: staging y producción son
compuertas distintas. Un push/documento no constituye intención de promoción.
La autorización debe identificar el SHA completo; no inferirla de un verde local.
