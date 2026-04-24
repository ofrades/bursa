#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="root@mohshoo.tailf9eafe.ts.net"
REMOTE_DB="/var/lib/bursa/data/stocktrack.sqlite"
LOCAL_DB="./data/stocktrack.sqlite"
TMP_DIR="./.tmp"
PROD_COPY="${TMP_DIR}/prod-sync.sqlite"
MERGED_DB="${TMP_DIR}/prod-merged.sqlite"

mkdir -p "${TMP_DIR}"

MODE="diff"
PUSH=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --merge) MODE="merge" ;;
    --push)  PUSH=true ;;
  esac
done

echo "Fetching production DB..."
scp "${REMOTE_HOST}:${REMOTE_DB}" "${PROD_COPY}"
echo "  copied to ${PROD_COPY}"

if [ "$MODE" = "diff" ]; then
  echo ""
  echo "Running diff..."
  npx tsx scripts/db-sync.ts --diff --local "${LOCAL_DB}" --prod "${PROD_COPY}"
  echo ""
  echo "Run with --merge to apply local changes to prod DB."
  echo "Run with --merge --push to merge and push back to production."
  exit 0
fi

# Merge mode
echo ""
echo "Running merge (local → prod copy)..."
npx tsx scripts/db-sync.ts --merge --local "${LOCAL_DB}" --prod "${PROD_COPY}" --output "${MERGED_DB}"

if [ "$PUSH" = false ]; then
  echo ""
  echo "Merge complete. Review the merged DB at: ${MERGED_DB}"
  echo "Push to production with: $0 --merge --push"
  exit 0
fi

# Push mode
echo ""
echo "Pushing merged DB to production..."
ssh "${REMOTE_HOST}" "cp '${REMOTE_DB}' '${REMOTE_DB}.bak-$(date +%s)'"
scp "${MERGED_DB}" "${REMOTE_HOST}:${REMOTE_DB}"
echo "  pushed to ${REMOTE_HOST}:${REMOTE_DB}"
echo ""
echo "You should restart the app after push: kamal deploy"
