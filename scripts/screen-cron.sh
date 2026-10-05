#!/usr/bin/env bash
# Weekly example (host timezone):
# 0 6 * * 1 SCREEN_ADMIN_TOKEN=... BASE_URL=https://bursa.mohshoo.com /path/screen-cron.sh
# Free-data screen only. Paid AI classification is an explicit separate action.
set -euo pipefail

: "${SCREEN_ADMIN_TOKEN:?SCREEN_ADMIN_TOKEN required}"
: "${BASE_URL:?BASE_URL required}"

body='{}'
for _ in $(seq 1 120); do
  response=$(curl --fail-with-body --silent --show-error --max-time 600 \
    -X POST "$BASE_URL/api/screen/run" \
    -H "x-screen-token: $SCREEN_ADMIN_TOKEN" \
    -H 'content-type: application/json' --data "$body")
  status=$(printf '%s' "$response" | node --input-type=module -e '
    let text=""; for await (const chunk of process.stdin) text+=chunk;
    const data=JSON.parse(text);
    if (!["running","done","failed"].includes(data.status)) throw new Error("Invalid screen response");
    console.log(data.status);')
  echo "[screen-cron] batch: $response"
  if [ "$status" = "done" ]; then
  outcomes=$(curl --fail-with-body --silent --show-error --max-time 600 \
    -X POST "$BASE_URL/api/screen/outcomes" \
    -H "x-screen-token: $SCREEN_ADMIN_TOKEN" \
    -H 'content-type: application/json' --data '{}')
  echo "[screen-cron] outcomes: $outcomes"
  exit 0
fi
  if [ "$status" = "failed" ]; then echo 'Screen failed' >&2; exit 1; fi
  body=$(printf '%s' "$response" | node --input-type=module -e '
    let text=""; for await (const chunk of process.stdin) text+=chunk;
    const data=JSON.parse(text); if (!data.runId) throw new Error("Missing run ID");
    console.log(JSON.stringify({runId:data.runId}));')
  sleep 5
done

echo 'Screen did not complete within 120 batches; rerun to resume.' >&2
exit 1
