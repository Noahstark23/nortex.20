---
name: nortex-feature
description: Método para implementar, reparar e integrar cambios de Nortex en un candidato aislado, con contratos, propietarios y verificación proporcional. Publicar o desplegar exige el alcance autorizado.
---

# Método de desarrollo Nortex

Fuentes canónicas: `AGENTS.md` y `CLAUDE.md`. Leelas completas y ejecutá
`git status --short --branch` antes de editar. Esta skill organiza el trabajo;
`nortex-clean-code` detalla el diseño y `nortex-qa` las compuertas.

## 1. Preparar y caracterizar

- Preservá rama, índice y cambios existentes. Trabajá en el candidato aislado
  autorizado; puede ser una copia ordinaria, no necesariamente un worktree.
  No crear/cambiar ramas o worktrees, limpiar, restaurar ni hacer rebase sin el
  alcance correspondiente. Registrá origen y hashes antes de reintegrar.
- Node `22.23.2` vía `mise exec --`, npm y `package-lock.json`; dependencias con
  `mise exec -- npm ci` en el candidato. Prisma local `6.4.1` mediante
  `mise exec -- npx --no-install prisma`. No descargar otro binario con npx.
- Candidato y fixtures sin archivos de secretos ni datos de producción. No leer
  `.env*`, tokens o credenciales. Un entorno vacío no impide que una herramienta
  cargue archivos locales automáticamente; no copiarlos al candidato de QA.
- Buscá con `rg` el flujo real, sus consumidores, schemas, permisos y pruebas.
  Para un defecto, reproducí entrada y salida incorrecta. Para una extracción,
  ejecutá primero una prueba de la conducta que debe conservarse.

## 2. Contrato y ejecución

- Definí resultado, errores, permisos, efectos e identidad idempotente. Asigná un
  propietario por dominio y un integrador por archivo compartido antes de delegar.
- Módulos nuevos fuera de `backend/server.ts` y `components/POS.tsx`; estos componen.
  Reutilizá servicios del dominio, cliente Prisma compartido, Decimal,
  `applyStockDelta` y auditoría atómica. Políticas de roles se consultan en código.
- Modificá schema solo si hace falta, con cambios aditivos y migración MySQL.
  El despliegue vigente usa preflight y `db push`; SQL/DML versionado no demuestra
  que un backfill se ejecutó. Seguí `nortex-migration` y comprobá expansión,
  reconciliación y reejecución. Nunca `--accept-data-loss`.
- Conservá contratos compartidos de API/UI. Para cantidades, usá validadores
  existentes: no truncar medidas ni permitir fracciones en unidades contadas.
- Actualizá generación Prisma cuando cambie schema; probá funciones importadas del
  producto. No crear fórmulas paralelas ni trasladar todo el monolito a un hook.
- En extracciones, reportá delta de origen, destinos y suma; bajá los presupuestos
  ejecutables en el mismo cambio y conservá las garantías de pruebas existentes.

## 3. Verificar y resolver

Aplicá `nortex-qa`: pruebas focales y regresión, Prisma generate/validate,
TypeScript, Vitest, sistema de diseño y build. Dinero/inventario exige además
`mise exec -- npm run test:integration:required`: el wrapper crea MySQL 8 efímero,
no requiere suministrarle una conexión. Mutación cuando corresponda, sin reducir
umbrales ni alcance. UI requiere recorrido afectado, carrito, lector/atajos y
estados de error; una pantalla abierta no prueba una venta.

Un fallo material de integridad bloquea la entrega del flujo. Corregilo dentro del
alcance y repetí la verificación afectada. Un bloqueo externo se informa con
acción pendiente; no se convierte en PASS ni obliga por sí solo a pedir una nueva
autorización para trabajo ya autorizado.

## 4. Integrar y entregar

- Compará fuente y candidato antes de reintegrar solo archivos propios. Si cambió
  el origen, incorporá esa diferencia sin sobrescribir el trabajo ajeno.
- Conflictos: inspeccioná ambos lados y ancestro; resolvé semánticamente y repetí
  pruebas. No usar `--ours`/`--theirs` indiscriminadamente ni apilar duplicados.
- Entregá candidato identificable, diff, resultados ejecutados, omisiones, fallos
  y riesgos pendientes. Separá código, QA local, modelo real, piloto y despliegue.
- Commit/PR/push/merge solo si están autorizados; no son un requisito implícito
  para cerrar una reparación. Release sigue `docs/runbooks/release-promotion.md`:
  CI terminal, staging del mismo SHA y autorización de producción son evidencias
  separadas. Un reporte histórico no sustituye ninguna de ellas.
