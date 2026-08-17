# 🚀 NORTEX OS — Guía de Despliegue en Producción

> **Plataforma:** Coolify + Docker Compose  
> **Autor:** DevOps Team — NORTEX Inc.  
> **Última actualización:** Febrero 2026

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
curl -s https://nortex.com/api/health | jq .

# Respuesta esperada:
# { "status": "ok", "timestamp": "2026-02-11T...", "version": "1.0.0" }

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
