#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="root@mohshoo.tailf9eafe.ts.net"
REMOTE_DB="/var/lib/bursa/data/stocktrack.sqlite"
LOCAL_DB="./data/stocktrack.sqlite"

if [ ! -f "${LOCAL_DB}" ]; then
  echo "Local DB not found: ${LOCAL_DB}"
  exit 1
fi

echo "WARNING: pushing local DB to prod will overwrite prod data."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

ssh "${REMOTE_HOST}" "mkdir -p /var/lib/bursa/data && cp '${REMOTE_DB}' '${REMOTE_DB}.bak-'\$(date +%s) 2>/dev/null || true"
scp "${LOCAL_DB}" "${REMOTE_HOST}:${REMOTE_DB}"
echo "Pushed ${LOCAL_DB} -> ${REMOTE_HOST}:${REMOTE_DB}"
echo "You should restart the app after push: kamal deploy"
