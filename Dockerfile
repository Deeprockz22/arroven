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
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p ${PORT}"]
