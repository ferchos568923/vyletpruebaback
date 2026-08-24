FROM node:20-slim

WORKDIR /app

# OpenSSL es requerido por las herramientas de Prisma
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dependencias (capa cacheable)
COPY package.json package-lock.json ./
RUN npm ci

# Código fuente
COPY . .

# Generar cliente Prisma y compilar TypeScript
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
