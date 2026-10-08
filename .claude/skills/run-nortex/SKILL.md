---
name: run-nortex
description: Ejecutar un smoke local de Nortex con MySQL 8 efímero y datos sintéticos, separado de integración obligatoria, revisión visual y producción.
---

# Smoke local de Nortex

Leé `AGENTS.md` y `CLAUDE.md`. Usá un candidato aislado sin archivos de secretos;
no usar una base compartida, staging ni producción. Esta skill arranca y destruye
sus recursos propios: para una demostración persistente usá el flujo local de
`AGENTS.md` y registrá la revisión por separado.

## Preparación y ejecución

- Runtime canónico Node `22.23.2` con mise, npm y Prisma local `6.4.1`.
- Prepará dependencias con `mise exec -- npm ci` y generá el cliente Prisma del
  schema actual según `nortex-qa`; el smoke hace `db push --skip-generate` y no
  sustituye esa preparación.
- Docker debe estar disponible por **socket Unix local**, con `mysql:8.0` ya
  descargada explícitamente. El script no instala dependencias ni obtiene imágenes.

Desde la raíz del candidato:

```sh
mise exec -- bash .claude/skills/run-nortex/smoke.sh
```

El script rechaza parámetros de conexión y `--keep`. Crea MySQL en tmpfs con
credenciales efímeras y puertos loopback propios; aplica schema sin
`--accept-data-loss`, construye SPA/prerender y arranca un backend con entorno
mínimo. Comprueba registro/login, producto con mayoreo/empaque, lectura autenticada,
landing y sitemap con datos sintéticos. No prueba por eso todos los roles, otra
identidad de tenant, venta/cobro ni los flujos completos de NortexGPT.

## Aislamiento y límites

- No sustituye `npm run test:integration:required`, el QA visual autenticado ni
  las compuertas de release. El runner obligatorio y este smoke son distintos.
- El script retira configuración heredada de proveedores; una herramienta aún
  puede cargar archivos locales por su cuenta. Por eso el candidato no debe
  contener `.env*` ni archivos de secretos. No inspeccionarlos ni copiarlos.
- No ejecutar con `bash -x`, volcar entornos ni capturar argumentos de procesos:
  las credenciales de esta corrida también son privadas. No hay evaluación pagada.
- Su limpieza normal no deja servidor, base, token, capturas ni logs activos de
  la corrida. El build `dist/` permanece en el candidato. No prometer limpieza
  completada si Docker/host falló: verificar exclusivamente recursos propios.
- Un smoke correcto acredita solo sus aserciones. Un HTTP autenticado no equivale
  a una prueba de aislamiento entre dos tenants; una página abierta no prueba POS.

## Ante fallos

Si falta runtime, dependencias, imagen o Docker local, preparar ese prerrequisito
sin sustituir la base por una compartida. Un fallo de schema/build/HTTP termina
no cero y ejecuta limpieza; reproducir con una prueba focal en el candidato.
No matar procesos por nombre ni borrar contenedores ajenos. Conservar una síntesis
sin credenciales del escenario, candidato, salida y límites; los logs temporales
no son un archivo de evidencia permanente.
