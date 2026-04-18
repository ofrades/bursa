#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="root@mohshoo.tailf9eafe.ts.net"
REMOTE_DB="/var/lib/bursa/data/stocktrack.sqlite"
LOCAL_DB="./data/stocktrack.sqlite"

mkdir -p ./data

echo "Pulling DB from ${REMOTE_HOST}:${REMOTE_DB}"
scp "${REMOTE_HOST}:${REMOTE_DB}" "${LOCAL_DB}"
echo "Done: ${LOCAL_DB}"
