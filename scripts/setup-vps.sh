#!/bin/bash
# VPS setup script — run once on the server
# Usage: bash scripts/setup-vps.sh

set -e

echo "→ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "→ Installing PM2..."
sudo npm install -g pm2

echo "→ Creating app directory..."
sudo mkdir -p /srv/stocktrack
sudo chown $USER:$USER /srv/stocktrack

echo "→ Creating .env file (fill in your values)..."
cat > /srv/stocktrack/.env << 'EOF'
BETTER_AUTH_SECRET=change-this-to-a-random-secret
BETTER_AUTH_URL=https://your-domain.com
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OPENROUTER_API_KEY=your-openrouter-api-key
EOF

echo "→ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /srv/stocktrack/.env with real credentials"
echo "  2. Add GitHub secrets: VPS_HOST, VPS_USER, VPS_SSH_KEY"
echo "  3. Push to main branch to trigger deployment"
echo "  4. (Optional) set up nginx reverse proxy on port 80/443"
