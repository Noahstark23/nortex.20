# 🚀 NORTEX OS — Guía de Despliegue en Producción

> **Plataforma:** Coolify + Docker Compose  
> **Autor:** DevOps Team — NORTEX Inc.  
> **Última actualización:** Agosto 2026

---

## 1. Requisitos Previos

| Requisito | Detalle |
|-----------|---------|
| **VPS** | Ubuntu 22.04+ con mínimo 2GB RAM, 2 vCPU, 40GB SSD |
| **Coolify** | Instalado y accesible en tu VPS ([coolify.io](https://coolify.io)) |
| **Dominio** | Dominio comprado y DNS apuntando al IP del VPS (ej: `nortex.com`) |
| **Stripe** | Cuenta activa con claves `sk_live_...` y `pk_live_...` |
| **Resend** | Cuenta activa con API key `re_...` para envío de emails transaccionales |
| **GitHub** | Repositorio con el código de Nortex accesible desde Coolify |

### Configuración DNS

```
Tipo: A
Nombre: @
Valor: <IP_DE_TU_VPS>
TTL: 300
```

```
Tipo: A
Nombre: www
Valor: <IP_DE_TU_VPS>
TTL: 300
```

---

## 2. Configuración en Coolify

### Paso 1: Crear el Proyecto

1. Accede a tu panel de Coolify (`http://TU_IP:8000`)
2. Click en **"+ New Project"**
3. Nombre: `NORTEX OS`
4. Click en **"Create"**

### Paso 2: Agregar Resource

1. Dentro del proyecto, click en **"+ New Resource"**
2. Seleccionar **"Public Repository"** o **"Private Repository (via GitHub App)"**
3. Pegar la URL del repositorio: `https://github.com/TU_USUARIO/nortex.git`
4. Branch: `main`

### Paso 3: Build Pack

1. Build Pack: seleccionar **Docker Compose**
2. Coolify detectará automáticamente el `docker-compose.yml`
3. Base Directory: `/` (raíz del proyecto)

### Paso 4: Dominio

1. En la sección **"Domains"**, configurar:
   ```
   https://nortex.com
   ```
2. Coolify generará automáticamente el certificado SSL vía Let's Encrypt
3. Habilitar **"Force HTTPS"** ✅

### Paso 5: Compuertas separadas (CI → staging; promoción manual a producción)

La ruta vinculante de release está en
[`docs/runbooks/release-promotion.md`](docs/runbooks/release-promotion.md). CI,
staging, la aprobación técnica de un environment y la autorización de producto son
estados distintos. Un push —incluido uno solo documental— puede actualizar staging,
pero nunca crea una ruta automática a producción.

`.github/workflows/ci.yml` ejecuta CI y, en pushes a `main`, puede actualizar
staging. `.github/workflows/release-production.yml` es el único workflow de
producción: se dispara manualmente con un SHA candidato completo y la confirmación
`PROMOTE <SHA>`, comprueba staging/main antes y después del environment, y verifica
que Coolify esté fijado al candidato. Para configurarlo:

1. **Apagar el auto-deploy de Coolify** en las apps de staging y prod
   (Configuration → desactivar *Auto Deploy on push*). Si queda encendido,
   Coolify despliega el push directo y evita la compuerta de GitHub.
2. **Crear la app de STAGING en Coolify** (misma receta que prod, mismo repo y
   branch `main`): base de datos MySQL **propia** (jamás la de prod), dominio
   `staging.somosnortex.com`, mismas variables de entorno pero con
   `DATABASE_URL`/`JWT_SECRETS` propios y SIN llaves reales de Stripe/WhatsApp.
   También con auto-deploy apagado.
3. **Activar `Include Source Commit in Build`** en ambas apps. Coolify inyecta
   ese SHA como `SOURCE_COMMIT`; Nortex lo devuelve en `/api/health`. Sin esta
   opción la compuerta falla con `COMMIT_MISSING` y no promueve la release.
4. **Preparar el destino de producción en Coolify:** habilitar su API si es una
   instalación self-hosted, mantener *Auto Deploy on push* apagado y comprobar que
   la app construye desde Git (`dockerfile` o `dockercompose`). Antes de cada
   promoción, fijar en la configuración de la app el `git_commit_sha` al SHA
   candidato autorizado; no dejar `HEAD`, `main` ni una rama mutable. Esta guía no
   da permiso al workflow para escribir ese pin: el workflow solo lo verifica.
5. **Copiar los webhooks de deploy**: en cada app de Coolify, sección
   *Webhooks* → copiar la *Deploy Webhook URL*.
6. **Crear las variables públicas en GitHub** (repo u organización → Settings →
   Secrets and variables → Actions → Variables):
   | Variable | Valor |
   |---|---|
   | `STAGING_URL` | `https://staging.somosnortex.com` |
   | `PROD_URL` | `https://somosnortex.com` |
   | `NORTEX_DEPLOY_ENABLED` | `false` durante la preparación; `true` solo habilita staging en push a `main` |
   | `NORTEX_PRODUCTION_DEPLOY_ENABLED` | `false` por defecto; `true` solo después de endurecer controles externos y para permitir el preflight manual |

   `NORTEX_PRODUCTION_DEPLOY_ENABLED` debe existir a nivel repo u organización:
   el preflight no entra al environment `production` y por diseño no puede leer
   variables de ese environment. No equivale a una autorización de producto.

7. **Crear los secrets dentro de cada environment de GitHub** (Settings →
   Environments). No guardarlos como secrets globales del repositorio:

   | Environment | Secret | Valor |
   |---|---|---|
   | `staging` | `COOLIFY_STAGING_WEBHOOK` | URL del webhook de la app staging |
   | `staging` | `COOLIFY_TOKEN` | Solo si el webhook de staging exige bearer token |
   | `production` | `COOLIFY_PROD_WEBHOOK` | URL del webhook de la app productiva |
   | `production` | `COOLIFY_PROD_READ_TOKEN` | Obligatorio: token API con permiso mínimo de lectura del destino de producción |
   | `production` | `COOLIFY_PROD_DEPLOY_TOKEN` | Opcional: token de despliegue solo si ese webhook exige bearer; no reutilizar el token de lectura |

   La aprobación del environment `production` protege sus secretos: ningún job
   de staging ni otro job anterior a esa aprobación puede leerlos.

   La promoción manual falla cerrada si Coolify no devuelve una aplicación única
   con `git_commit_sha` igual al candidato, un build desde Git (`dockerfile` o
   `dockercompose`) y `is_auto_deploy_enabled=false`. Nunca pongas este token en
   CI o staging, ni le des permisos `write`, `read:sensitive` o `root`. El token de
   despliegue, si se necesita, debe quedar separado y limitado a `deploy`.
8. **Endurecer GitHub antes de habilitar producción:** proteger `main` con PR y
   checks requeridos; limitar el environment `production` a `main`, usar reviewer
   independiente, activar `prevent-self-review` y desactivar bypass administrativo.
   Sin esos controles, el estado correcto es bloqueado.
9. **Promover solo con el runbook canónico:** tras CI y staging del mismo SHA,
   registrar autorización explícita de producto (alcance, SHA, ventana,
   responsable, rollback). Recién entonces un responsable inicia **Promote
   production** desde `main`; no uses `workflow_dispatch` de CI para staging ni
   producción.
10. **Monitoreo** (5 minutos de setup, gratis):
   - **Sentry**: crear proyecto Node en sentry.io y poner `SENTRY_DSN` en las
     variables de Coolify (el backend ya lo soporta — gate suave, sin DSN opera
     igual). Los errores 500 de prod llegan solos, con stack.
   - **UptimeRobot** (o similar): monitor HTTP a
     `https://somosnortex.com/api/health` cada 5 min con alerta al correo. El
     endpoint devuelve 503 si la BD no responde, así que también avisa de una
     BD caída, no solo del proceso muerto.
   - El contenedor ya trae `HEALTHCHECK` (Dockerfile): Coolify reinicia una
     instancia enferma y no le enruta tráfico durante el deploy.

---

## 3. Variables de Entorno (Secretos)

> ⚠️ **IMPORTANTE:** Pega estas variables en la sección **"Environment Variables"** de Coolify.  
> **NUNCA** pongas claves reales en el código ni en el repositorio.

### Variables a configurar:

```env
# ==========================================
# 🔧 SERVIDOR
# ==========================================
PORT=3000
NODE_ENV=production

# ==========================================
# 🗄️ BASE DE DATOS
# ==========================================
# El host "db" es el nombre del servicio MySQL dentro de Docker Compose.
# Coolify resuelve internamente los nombres de servicio entre contenedores.
# Cambia CONTRASEÑA_SEGURA por una contraseña fuerte (32+ caracteres).
DATABASE_URL=mysql://root:CONTRASEÑA_SEGURA@db:3306/nortex_db

# También configura la misma contraseña en el contenedor MySQL:
MYSQL_ROOT_PASSWORD=CONTRASEÑA_SEGURA
MYSQL_DATABASE=nortex_db

# ==========================================
# 🔐 AUTENTICACIÓN
# ==========================================
# Generar con: openssl rand -base64 64
JWT_SECRET=GENERA_UNA_CLAVE_LARGA_CON_OPENSSL_RAND_BASE64_64

# ==========================================
# 💳 STRIPE (PRODUCCIÓN)
# ==========================================
# Obtener desde: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=<tu-clave-secreta-de-stripe-live>
STRIPE_PUBLISHABLE_KEY=<tu-clave-publica-de-stripe-live>

# Obtener desde: https://dashboard.stripe.com/webhooks
# Crear webhook apuntando a: https://nortex.com/api/billing/webhook
STRIPE_WEBHOOK_SECRET=<tu-webhook-secret-de-stripe>

# ID del precio de suscripción mensual (creado en Stripe Dashboard > Products)
STRIPE_PRICE_ID=<tu-price-id-de-stripe>

# ==========================================
# 🏦 COBRO LOCAL (OBLIGATORIO EN NICARAGUA)
# ==========================================
# Stripe NO soporta Nicaragua como país de comercio, así que el rail real de
# cobro es depósito/transferencia con comprobante. Si BANK_ACCOUNTS_JSON no está
# definida, /api/billing/status devuelve una lista vacía y la pantalla de pago
# NO MUESTRA NINGUNA CUENTA a la cual transferir: el cliente que quiere pagar se
# queda sin cómo hacerlo y cae al canal de WhatsApp.
#
# Arreglo JSON en UNA sola línea (comillas dobles, sin saltos):
BANK_ACCOUNTS_JSON=[{"bank":"BAC","type":"Cuenta corriente USD","number":"000000000","name":"NORTEX"},{"bank":"LAFISE","type":"Cuenta de ahorro C$","number":"000000000","name":"NORTEX"}]

# A dónde llega el aviso "entró un pago por revisar". La activación de la
# suscripción es MANUAL: sin este correo, el pago espera a que alguien abra el
# panel de administración por casualidad.
BILLING_ALERT_EMAIL=<tu-correo>

# Teléfono de soporte que ve el cliente (default: +505 7664-4030)
SUPPORT_WHATSAPP=+505 7664-4030

# ==========================================
# 📧 EMAILS (RESEND)
# ==========================================
# Obtener desde: https://resend.com/api-keys
RESEND_API_KEY=<tu-api-key-de-resend>

# ==========================================
# 🌐 FRONTEND
# ==========================================
FRONTEND_URL=https://nortex.com

# ==========================================
# 💾 BACKUP DIARIO OFF-SITE (DGI-4 · OBLIGATORIO)
# ==========================================
# Sin estas variables el servicio `backup` del compose NO arranca y queda visible
# como caído en Coolify. La app sigue funcionando, pero NO hay respaldo: si muere
# el volumen de MySQL se pierde el inventario y la cartera de todos los clientes.
#
# El bucket debe estar en OTRO proveedor/región que el Droplet — un backup en el
# mismo servidor se pierde junto con el servidor.
BACKUP_S3_BUCKET=s3://nortex-backups/produccion
BACKUP_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com   # vacío si es AWS S3
AWS_ACCESS_KEY_ID=<clave-del-bucket>
AWS_SECRET_ACCESS_KEY=<secreto-del-bucket>
AWS_DEFAULT_REGION=us-east-1

# Opcionales
BACKUP_HOUR=03            # hora local del backup (default 03:15)
BACKUP_MINUTE=15
BACKUP_KEEP_DAYS=7        # retención LOCAL; la del bucket se maneja con su lifecycle
BACKUP_ALERT_WEBHOOK=     # Slack/Discord: avisa si un backup FALLA
```

### 🔑 Generación de claves seguras

```bash
# Generar JWT_SECRET:
openssl rand -base64 64

# Generar MYSQL_ROOT_PASSWORD:
openssl rand -base64 32

# Alternativa sin openssl:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

---

## 4. Docker Compose para Producción

Tu `docker-compose.yml` actual es para desarrollo. Para producción en Coolify, asegúrate de que:

- La contraseña de MySQL **NO** sea `root` — usa la variable `MYSQL_ROOT_PASSWORD`
- Los puertos de phpMyAdmin **NO** estén expuestos al público
- El volumen `mysql_data` persista los datos

### Checklist pre-deploy:

- [ ] Contraseña MySQL cambiada (no usar `root`)
- [ ] `DATABASE_URL` apunta a `db:3306` (nombre del servicio Docker)
- [ ] Webhook de Stripe configurado para `https://nortex.com/api/billing/webhook`
- [ ] DNS del dominio apuntando al VPS
- [ ] phpMyAdmin deshabilitado o protegido con autenticación adicional
- [ ] Credenciales del bucket de backup cargadas (`BACKUP_S3_BUCKET`, `AWS_*`)

---

## 5. Comandos de Verificación

### Ver logs en Coolify

1. Ir a tu recurso en el panel de Coolify
2. Click en la pestaña **"Logs"**
3. Seleccionar el contenedor deseado (`app`, `db`, etc.)

También puedes ver los logs por SSH:

```bash
# Conectarte al VPS
ssh root@TU_IP

# Ver logs del contenedor de la app
docker logs -f $(docker ps --filter "name=nortex" -q --last 1) --tail 100

# Ver logs de MySQL
docker logs -f $(docker ps --filter "name=db" -q --last 1) --tail 50

# Ver todos los contenedores del proyecto
docker compose -p nortex ps
```

### Probar endpoint /health

```bash
# Desde tu máquina local:
curl -s https://somosnortex.com/api/health | jq .

# Respuesta esperada (200 si la BD responde, 503 si no):
# { "ok": true, "db": "up", "uptimeSeconds": 12345, "commit": "<sha del build>" }

# Probar autenticación:
curl -s -X POST https://nortex.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.com","password":"tu_password"}' | jq .

# Probar que Stripe responde:
curl -s https://nortex.com/api/billing/status \
  -H "Authorization: Bearer TU_JWT_TOKEN" | jq .
```

### Ejecutar migraciones de base de datos

```bash
# Dentro del contenedor de la app:
docker exec -it $(docker ps --filter "name=nortex" -q --last 1) npx prisma db push

# Generar cliente Prisma:
docker exec -it $(docker ps --filter "name=nortex" -q --last 1) npx prisma generate

# Crear Super Admin:
docker exec -it $(docker ps --filter "name=nortex" -q --last 1) npx tsx backend/scripts/createSuperAdmin.ts
```

---

## 6. Post-Deploy Checklist

- [ ] ✅ La app carga en `https://nortex.com`
- [ ] ✅ El certificado SSL está activo (candado verde)
- [ ] ✅ Login funciona correctamente
- [ ] ✅ Se puede crear un tenant nuevo desde `/register`
- [ ] ✅ POS procesa ventas correctamente
- [ ] ✅ Stripe webhook recibe eventos (`/api/billing/webhook`)
- [ ] ✅ Emails se envían correctamente (verificar en Resend dashboard)
- [ ] ✅ Base de datos persistente entre reinicios
- [ ] ✅ Super Admin puede acceder a `/admin`
- [ ] ✅ El servicio `backup` está arriba (`docker compose -p nortex ps`) y su log dice
      `🗓 Planificador activo`
- [ ] ✅ **Primer respaldo verificado a mano** (no esperar a las 03:15):

```bash
# 1 · Corre un backup ahora mismo y mirá que termine en "✓ Backup off-site OK."
docker compose -p nortex exec backup bash /app/scripts/backup-db.sh

# 2 · Evidencia del último respaldo bueno (fecha, tamaño, sha256, destino)
docker compose -p nortex exec backup cat /var/backups/nortex/last-backup.json

# 3 · LA PRUEBA QUE IMPORTA: restaurar ese dump en una base desechable.
#     Un backup no probado no existe. No toca la base de producción: crea y
#     borra `nortex_restore_test`, y el script se niega a correr contra un
#     nombre de base que no parezca desechable.
docker compose -p nortex exec backup bash -lc '
  RESTORE_DATABASE_URL="${DATABASE_URL%/*}/nortex_restore_test" \
  SOURCE_DATABASE_URL="$DATABASE_URL" \
  bash /app/scripts/verify-backup-restore.sh "$(ls -t /var/backups/nortex/*.sql.gz | head -1)"'
```

---

## 7. Troubleshooting

| Problema | Solución |
|----------|----------|
| `ECONNREFUSED db:3306` | MySQL aún no ha iniciado. Espera 10-15s o agrega `depends_on` + healthcheck |
| `Invalid JWT` | Verifica que `JWT_SECRET` sea el mismo en todas las instancias |
| Stripe webhook falla | Verifica el `STRIPE_WEBHOOK_SECRET` y que la URL sea `https://` |
| `P1001: Can't reach database` | Verifica que `DATABASE_URL` use `db` como host (no `localhost`) |
| Emails no llegan | Verifica la API key de Resend y que el dominio esté verificado |
| CSS no carga | Ejecuta `npm run build` y verifica que Vite genera a `/dist` |
| Puerto 3000 ocupado | Cambiar `PORT` en las variables de entorno |

---

> **¿Necesitas ayuda?** Contacta al equipo de DevOps o abre un issue en el repositorio.
