# 1. Usar una imagen de Node.js moderna
FROM node:22-slim AS base

# 2. Instalar dependencias necesarias para Prisma y node-gyp
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Copiar archivos de dependencias y schema de Prisma
COPY package*.json ./
COPY backend/prisma ./backend/prisma/

# 4. Establecer DATABASE_URL dummy para que prisma generate funcione durante npm install
#    (postinstall script ejecuta prisma generate automáticamente)
ENV DATABASE_URL="mysql://build:build@localhost:3306/build"

# 5. Instalar dependencias (prisma generate se ejecuta vía postinstall)
RUN npm install --force

# 6. Copiar el resto del código
COPY . .

# 7. Construir la aplicación (React + Backend)
RUN npm run build

# 8. Limpiar DATABASE_URL dummy para que runtime use el real
ENV DATABASE_URL=""

# 9. Puerto en el que corre la app
EXPOSE 3000

# 10. Comando para arrancar en producción (con migración automática)
CMD ["sh", "-c", "npx prisma db push --schema=backend/prisma/schema.prisma --accept-data-loss && npm run start"]
