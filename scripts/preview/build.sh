#!/bin/sh
# Builds the public read-only preview into $1 (default ./preview-site): runs the app in throwaway containers with
# fictional data, crawls it, and writes plain HTML. Needs Docker. Nothing touches your local database.
set -e
OUT="${1:-preview-site}"
cd "$(dirname "$0")/../.."
docker build -q -t arroven-preview . >/dev/null
docker network create arroven-preview >/dev/null
cleanup() { docker rm -f arroven-preview-app arroven-preview-db >/dev/null 2>&1; docker network rm arroven-preview >/dev/null 2>&1; }
trap cleanup EXIT
docker run -d --name arroven-preview-db --network arroven-preview -e POSTGRES_PASSWORD=preview -e POSTGRES_DB=arroven postgres:17 >/dev/null
sleep 6
DB=postgres://postgres:preview@arroven-preview-db:5432/arroven
docker run -d --name arroven-preview-app --network arroven-preview -p 3998:3000 -e DATABASE_URL=$DB \
  -e ALLOWED_EMAILS="engineer@example.com,reviewer@example.com" arroven-preview >/dev/null
sleep 12
TOKEN=$(docker exec -e PREVIEW_SEED=1 -e DATABASE_URL=$DB arroven-preview-app npx tsx scripts/preview/seed.ts | sed -n 's/^TOKEN=//p')
[ -n "$TOKEN" ] || { echo "Seeding failed." >&2; exit 1; }
node scripts/preview/crawl.mjs http://localhost:3998 "$TOKEN" "$OUT"
