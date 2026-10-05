#!/usr/bin/env bash
# Scheduled screen driver for bursa — designed for a system cron line like:
#   0 6 1,15 * *  SCREEN_ADMIN_TOKEN=... BASE_URL=https://bursa... /path/screen-cron.sh
# Advances the screen in batches until done, then runs the revision-quality
# classifier over the strict quintile. Requires SCREEN_ADMIN_TOKEN and BASE_URL.
set -euo pipefail

: "${SCREEN_ADMIN_TOKEN:?SCREEN_ADMIN_TOKEN required}"
: "${BASE_URL:?BASE_URL required}"

status="running"
for _ in $(seq 1 40); do
  response=$(curl -sS -X POST "$BASE_URL/api/screen/run" \
    -H "x-screen-token: $SCREEN_ADMIN_TOKEN")
  status=$(echo "$response" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')
  echo "[screen-cron] batch: $response"
  [ "$status" != "running" ] && break
  sleep 5
done

if [ "$status" = "done" ]; then
  response=$(curl -sS -X POST "$BASE_URL/api/screen/jev" \
    -H "x-screen-token: $SCREEN_ADMIN_TOKEN" \
    -H "content-type: application/json" -d '{}')
  echo "[screen-cron] classify: $response"
fi
