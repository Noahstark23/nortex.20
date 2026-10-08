---
name: nortex-qa
description: Verificar Nortex con pruebas de contrato, conducta, permisos y efectos reales sobre datos sintéticos; reparar defectos dentro del alcance y distinguir evidencia local, IA real y release.
---

# QA de Nortex

Leé `AGENTS.md` y `CLAUDE.md`. Usá el candidato aislado de `nortex-feature`,
con cambios del usuario preservados y sin secretos ni datos de producción.
Elegí escenarios por riesgo del cambio, no una cantidad fija de pasadas.

## Qué comprobar

- **Contrato y precisión:** importar la función real; resultados independientes,
  serialización Decimal, límites, impuestos históricos y corte civil Managua.
  Ausencia, cero y error son estados distintos. No replicar fórmulas en sondas.
- **Identidad y permisos:** revisar consultas con `rg`, luego probar dos tenants,
  roles, IDs ajenos y revocación. Una búsqueda textual no prueba aislamiento.
- **Integridad:** una operación ante concurrencia/reintentos/respuesta perdida;
  stock, caja, deuda, asiento y auditoría se reconcilian. Fallo intermedio revierte
  todos sus efectos. Probar locks reales, no inferirlos de un `upsert` o un 200.
- **UI y recuperación:** render o navegador sobre el flujo afectado. Conservar
  carrito/borrador, bloquear lector y atajos detrás de paneles, validar cantidades
  contadas/medidas, offline y recuperación sin duplicar operación.
- **Modularidad:** contratos antes/después, propietario único, presupuestos y
  alcance de mutación. Menos líneas no acredita menos CPU ni memoria.

## Comandos canónicos

Node `22.23.2`, npm y Prisma `6.4.1` locales. Prepará dependencias bloqueadas en el
candidato con `mise exec -- npm ci` cuando haga falta. Ejecutá primero los tests
focales del cambio con `mise exec -- npx --no-install vitest run <archivos>`.

Compuerta general, desde la raíz del candidato sin archivos de secretos:

```sh
mise exec -- sh scripts/ci-local-safe.sh
```

Incluye Prisma generate, TypeScript, Vitest, diseño y build. La validación del
schema se verifica además explícitamente, con URL ficticia que no conecta una BD:

```sh
env DATABASE_URL='mysql://qa:qa@127.0.0.1:3307/nortex_ci_types' mise exec -- npx --no-install prisma validate --schema backend/prisma/schema.prisma
```

Para dinero/inventario es adicional y obligatorio:

```sh
mise exec -- npm run test:integration:required
```

- Este comando llama `scripts/qa-integration-required.sh`, que prepara MySQL 8
  propio en tmpfs y delega a `scripts/run-quality-integration.mjs`. No configurar
  una `DATABASE_URL` ni ejecutar el runner interno contra una base existente.
- Requiere Docker local, dependencias y la imagen `mysql:8.0` ya disponible; no
  reutilizar Compose/volúmenes de desarrollo. Verificá el contexto local antes de
  iniciar: no asumir que publicar un puerto loopback hace local un daemon remoto.
- Registro único: `scripts/quality-gate-contract.mjs`; descubrimiento/validación:
  `scripts/verify-quality-suite-registration.mjs`. No copiar una lista o cantidad
  de suites a esta skill ni omitir casos para aprobar.
- El wrapper genera conexiones efímeras; el runner usa entorno acotado, backend
  por suite y retira la credencial del proveedor. Reports en
  `reports/quality-integration/`; revisá el resumen y los casos, no solo el exit 0.
  Una suite requerida ausente, vacía, fallida, omitida o `todo` bloquea.

Lógica monetaria cubierta por mutación: `mise exec -- npm run test:mutation`
(o `NORTEX_CI_MUTATION=1` en la compuerta general). Al mover funciones, verificá
rangos, pisos y correspondencia fuente/reporte con `scripts/check-mutation-scope.cjs`.
No bajar umbral ni excluir fallos. SEO afectado usa `NORTEX_CI_SEO=1` para build con
prerender; no presentar el build SPA como verificación de HTML público generado.

## IA real y cierre

La compuerta determinista no acredita lectura de facturas ni calidad de Haiku.
Evaluación real sigue `docs/runbooks/nortexgpt-evaluacion-haiku.md`: presupuesto
reservado, credencial privada, datos autorizados y expectativas revisadas por una
persona. No inventar revisión humana ni consumo por ejecución sin enlace explícito.

Reportá candidato/escenario/comando/resultado, defectos reproducidos y reparación,
omitidos y límites. Separá local, MySQL, CI, staging, producción y prueba con modelo
real. Errores preexistentes explican un bloqueo, no aprueban una compuerta.
Corregí y revalidá dentro del alcance; si falta una decisión externa, dejá el
resultado concreto preparado. Commit, push y release no se autorizan por esta skill.
