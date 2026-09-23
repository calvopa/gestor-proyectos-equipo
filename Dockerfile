# Stage 1: compilar módulos nativos (better-sqlite3)
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: imagen de producción (sin build tools)
FROM node:20-alpine
RUN apk add --no-cache openssh-client
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY migrations ./migrations
COPY package.json ./
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
CMD ["node", "src/index.js"]
