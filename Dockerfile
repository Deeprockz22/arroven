# Production image. Expects DATABASE_URL (Postgres 15+) and a persistent volume at STORAGE_DIR.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/data/storage PORT=3000
COPY --from=build /app ./
RUN mkdir -p /data/storage && chown -R node:node /data
EXPOSE 3000
# Starts as root only to take ownership of the mounted disk, then drops to the node user (see scripts/start.sh).
CMD ["sh", "scripts/start.sh"]
