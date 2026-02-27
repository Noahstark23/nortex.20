# 1. Usar una imagen de Node.js moderna
FROM node:22-slim AS base

# 2. Instalar dependencias necesarias para Prisma y node-gyp
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Copiar archivos de dependencias
COPY package*.json ./
COPY backend/prisma ./backend/prisma/

# 4. Instalar dependencias
RUN npm install --force

# 5. Copiar el resto del código
COPY . .

# 6. Generar el cliente de Prisma
RUN npx prisma generate --schema=backend/prisma/schema.prisma

# 7. Construir la aplicación (React + Backend)
RUN npm run build

# 8. Puerto en el que corre la app
EXPOSE 3000

# 9. Comando para arrancar en producción (con migración automática)
CMD ["sh", "-c", "npx prisma db push --schema=backend/prisma/schema.prisma --accept-data-loss && npm run start"]
