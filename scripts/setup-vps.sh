#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-root@mohshoo.tailf9eafe.ts.net}"

echo "→ Creating persistent data directory on ${REMOTE_HOST}..."
ssh "${REMOTE_HOST}" 'mkdir -p /var/lib/bursa/data'

echo "→ Host prep complete"
echo "Next steps:"
echo "  1. Make sure .kamal/secrets exists locally"
echo "  2. Run: kamal setup"
echo "  3. Deploy with: kamal deploy"
