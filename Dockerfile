# 1. Usar una imagen de Node.js moderna
FROM node:22-slim AS base

# 2. Instalar dependencias necesarias para Prisma y node-gyp
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Copiar archivos de dependencias y schema de Prisma
COPY package*.json ./
COPY backend/prisma ./backend/prisma/

# 4. Instalar dependencias
RUN npm install

# 5. Generar Prisma explicitamente con variables de entorno limpias
RUN DATABASE_URL="mysql://dummy:dummy@localhost:3306/dummy" npx prisma generate --schema=backend/prisma/schema.prisma

# 6. Copiar el resto del código
COPY . .

# 7. Construir la aplicación (React + Backend) + prerender SEO por-ruta
RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build:seo

# 8. Puerto en el que corre la app
EXPOSE 3000

# 9. Arranque resiliente vía entrypoint (ver scripts/docker-entrypoint.sh):
#    espera a que MySQL acepte conexiones ANTES del `db push` (el `depends_on` de
#    compose no espera readiness), reintenta la ventana de primer arranque, y solo
#    falla si el error es persistente — así un simple race de inicio no quema el
#    límite de restarts. Sigue SIN --accept-data-loss: un cambio destructivo del
#    schema hace fallar el arranque en vez de borrar datos (ver nortex-migration).
CMD ["sh", "scripts/docker-entrypoint.sh"]
