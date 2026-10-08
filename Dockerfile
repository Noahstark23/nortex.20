# 1. Usar una imagen de Node.js moderna
FROM node:22.23.2-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS base

# 2. Instalar dependencias necesarias para Prisma y node-gyp
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Copiar archivos de dependencias y schema de Prisma
COPY package*.json ./
COPY backend/prisma ./backend/prisma/

# 4. Instalar exactamente el árbol bloqueado que CI audita
RUN npm ci

# 5. Generar Prisma explicitamente con variables de entorno limpias
RUN DATABASE_URL="mysql://dummy:dummy@localhost:3306/dummy" npx prisma generate --schema=backend/prisma/schema.prisma

# 6. Copiar el resto del código
COPY . .

# Identidad de código generada en la imagen, independiente del entorno de Coolify.
ARG NORTEX_BUILD_COMMIT
RUN node scripts/write-release-identity.mjs

# 7. Construir la aplicación (React + Backend) + prerender SEO por-ruta
RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build:seo

# La imagen de runtime no necesita compiladores ni herramientas de desarrollo
# (Vite, Capacitor CLI, Stryker, etc.). Quitarlas reduce superficie de ataque y
# hace que lo instalado en producción coincida con `npm audit --omit=dev`.
RUN npm prune --omit=dev

# Receipt nuevo de esta imagen, después de generar cliente y assets.
RUN node scripts/nortex-seal-image.mjs

# 8. Puerto en el que corre la app
EXPOSE 3000

# 8b. Healthcheck HTTP; verificar su uso efectivo en el proveedor.
#     El periodo inicial admite la espera del gate de sólo lectura, sin DDL.
#     node:22-slim no trae curl/wget → el chequeo usa el fetch nativo de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 9. Este candidato preserva el schema existente. El gate exige receipt nuevo,
#    identidad de imagen/destino y uno de los dos contratos exactos revisados.
#    El entrypoint DDL histórico sigue disponible para CI, fuera del CMD runtime.
CMD ["sh", "scripts/nortex-start.sh"]
