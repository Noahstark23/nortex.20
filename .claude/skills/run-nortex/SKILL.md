---
name: run-nortex
description: Levantar, correr y manejar la app Nortex real desde una máquina limpia — arrancar el server con MySQL, probar la API end-to-end, servir el frontend y tomar screenshots. Usar cuando se pida "correr Nortex", "levantar la app", "probar un cambio en vivo", "screenshot", o verificar que un PR funciona de verdad (no solo tsc).
---

# Correr Nortex (app real, no la suite de tests)

Nortex = Express+Prisma sobre **MySQL 8** + SPA Vite servido por el mismo server en
producción. Rutas relativas a la **raíz del repo**.

## Camino del agente (PRIMERO)

Un solo comando hace todo — instala MySQL si falta, aplica el schema (`db push`,
igual que el deploy), buildea, arranca el server, corre un **flujo real**
(registro → producto con mayoreo/empaque → login → lectura tenant-scoped →
landing/prerender/sitemap) y saca screenshot de la GUI:

```bash
bash .claude/skills/run-nortex/smoke.sh          # levanta, prueba, apaga → 14 PASS
bash .claude/skills/run-nortex/smoke.sh --keep   # ídem, pero deja el server vivo en :3000
```

Salidas en `/tmp/nortex-smoke/`: `server.log`, `build.log`, `login.png`.
Verificado en este contenedor: **14 PASS · 0 FAIL**.

Con `--keep`, interactuá directo:
```bash
curl -s -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"companyName":"Mi Negocio","email":"yo@test.com","password":"Pass1234","type":"FERRETERIA"}'
# → { token, ... }  · usar como  -H "Authorization: Bearer $TOKEN"  en todo /api/*
```
Screenshot de cualquier ruta (chromium del entorno, sin instalar nada):
```bash
CHROME=$(find /opt/pw-browsers -name chrome -type f | head -1)
"$CHROME" --headless --disable-gpu --no-sandbox --screenshot=/tmp/shot.png \
  --window-size=1280,800 http://localhost:3000/login
```

## Invocación directa (lógica interna sin server)
La lógica pura se prueba sin levantar nada — patrón del repo (ver nortex-qa):
replicar la función en un `.cjs` con `require('<repo>/node_modules/decimal.js')`
y correr casos. Para tocar la BD desde un script:
`DATABASE_URL="mysql://nortex:nortex123@localhost:3306/nortex" npx tsx <script>.ts`.

## Camino humano (dev)
`npm run dev` (Vite :5173, proxy al backend) + `npm run start` con las env de
abajo. Inútil headless — el camino del agente es el de arriba.

## Env mínimas del server
`DATABASE_URL` · `JWT_SECRET` (o `JWT_SECRETS`; **sin él el server lanza y muere**)
· `NODE_ENV=production` para servir `dist/` (landing + prerender + SPA) · `PORT` (def. 3000).
Opcionales: Stripe/Resend/WhatsApp solo logean warnings si faltan.

## Gotchas (todas pasaron acá)
- **`docker` CLI existe pero NO hay daemon** en este contenedor → MySQL va por
  `apt-get` (el driver lo hace). Antes de instalar: `apt-get update` (las listas
  vienen viejas → 404 en los .deb).
- **Matar el server**: el PID de `npx tsx` NO es el del node hijo — matarlo deja
  al viejo dueño del puerto y tus curls pegan contra código VIEJO (síntoma:
  editás y "no cambia nada"). Siempre `pkill -f "tsx backend/server.ts"`.
- **`npm install` tras cambiar de rama** o `npx prisma` baja v7 y rechaza el
  schema con errores engañosos (el repo pinnea 6.4.1).
- `service mysql start` imprime `su: warning: cannot change directory to
  /nonexistent` — **cosmético**, ignorarlo.
- El flujo de registro valida `type` contra el enum Zod de
  `backend/validation/schemas.ts` (`businessType`) — si agregás un tipo de
  negocio en la UI, agregalo AHÍ también (este driver encontró ese bug).
- `/` en producción es `public/landing.html`, no el SPA — no busques la app ahí;
  el SPA vive en `/login`, `/app/*`, etc.

## Troubleshooting
| Síntoma | Fix |
|---|---|
| `🚨 CRITICAL: JWT_SECRETS/JWT_SECRET no está definido` | exportar `JWT_SECRET=loquesea` |
| `db push` cuelga o `P1001` | `service mysql start; sleep 3` y reintentar |
| register devuelve `Datos de entrada inválidos` | body es `{companyName,email,password,type}` — `type` del enum de schemas.ts |
| server "Ready" pero responde código viejo | proceso huérfano: `pkill -f "tsx backend/server.ts"` y relanzar |
| screenshot en negro/blanco | la página anima el fade-in; agregar `--virtual-time-budget=5000` |
