# 2026-09-01 - Nortex local auth preview fix

## Objetivo

Recuperar una demostración local autenticada de Nortex antes de hablar de
producción. El síntoma visible era engañoso: desde `http://127.0.0.1:4174`
la app mostraba shell, pero `Login`, `Dashboard` y `POS` fallaban como si fuera
“conexión” o “panel roto”.

## Causa raíz

El backend aceptaba solo una parte de los orígenes locales. El flujo real de
Nortex usa dos superficies válidas:

- `nortex frontend` en `http://127.0.0.1:4174`
- preview/app integrado en `http://127.0.0.1:3210`

El allowlist de CORS dependía de `FRONTEND_URL` y no incluía ambos loopbacks al
mismo tiempo. Resultado: el navegador enviaba `Origin: http://127.0.0.1:4174`
y `POST /api/auth/login` era rechazado por CORS antes de llegar al handler.

## Cambio aplicado

- Se extrajo `backend/lib/allowedOrigins.ts` para construir y deduplicar la lista
  de orígenes válidos.
- Se agregaron los loopbacks canónicos `127.0.0.1` y `localhost` para `3210` y
  `4174`.
- `backend/server.ts` ahora usa `isAllowedOrigin()` en vez de depender de un
  array armado inline.

## Verificación

### Código

- `mise exec node@22.23.2 -- npm run test -- tests/allowedOrigins.test.ts`
- `mise exec node@22.23.2 -- npx tsc --noEmit`

### Runtime

- Preflight real:
  - `OPTIONS /api/auth/login`
  - `Origin: http://127.0.0.1:4174`
  - resultado: `204 No Content`
  - encabezado: `Access-Control-Allow-Origin: http://127.0.0.1:4174`

- UI autenticada verificada sobre la base aislada `nortex_ui_audit`:
  - `/app/inicio`
  - `/app/inventory`
  - `/app/pos`
  - `/app/dashboard`

## Nota operativa importante

El perfil Docker `nortex app-up` sigue bloqueado por un preflight de schema
separado: Prisma detecta `UNIQUE` pendientes sobre `ProductReturn` y no arranca
sin una ruta DDL más específica. Eso no invalida el fix de CORS, pero sí impide
usar ese perfil como prueba final hasta resolver ese frente por separado.
