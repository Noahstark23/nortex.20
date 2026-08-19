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

# 8b. Healthcheck del contenedor: Coolify lo usa para no enrutar tráfico a una
#     instancia enferma y reiniciarla. start-period generoso: el entrypoint
#     espera MySQL + aplica `db push`, que en un deploy con schema nuevo tarda.
#     node:22-slim no trae curl/wget → el chequeo usa el fetch nativo de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 9. Arranque resiliente vía entrypoint (ver scripts/docker-entrypoint.sh):
#    espera a que MySQL acepte conexiones, aplica preflights DDL conocidos y luego
#    ejecuta `db push`. Reintenta solo fallos operativos; estados incompatibles o
#    warnings de data loss fallan inmediatamente. Sigue SIN --accept-data-loss:
#    un cambio no autorizado detiene el arranque en vez de borrar datos.
CMD ["sh", "scripts/docker-entrypoint.sh"]
