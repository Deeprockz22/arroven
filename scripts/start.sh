#!/bin/sh
# Container entrypoint. Hosts mount the persistent disk at /data owned by root, so when started as root we hand it to the
# unprivileged node user first, then run migrations and the server as that user.
set -e
mkdir -p "${STORAGE_DIR:-/data/storage}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups sh -c 'npx tsx scripts/migrate.ts && exec npx next start -p "$PORT"'
fi
npx tsx scripts/migrate.ts
exec npx next start -p "$PORT"
