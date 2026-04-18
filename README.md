# Bursa

AI-powered stock analysis app built with TanStack Start, React, Tailwind, Nitro, and SQLite.

## Local development

This repo uses Vite+.

```bash
vp install
vp dev
```

Useful commands:

```bash
vp build
vp check
vp test
```

Notes:
- `vp test` currently exits non-zero when there are no test files.
- `vp check` currently reports existing formatting issues across the repo.

## Environment

Copy `.env.example` to `.env` and fill in the values you need.

Important variables:
- `AUTH_SECRET`
- `DB_PATH`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OPENROUTER_API_KEY`
- `CRON_SECRET`
- `BETTER_AUTH_URL` in production

## Production deploy

Production deploys use Kamal with config in `config/deploy.yml`.
Images are published to GitHub Container Registry (`ghcr.io/ofrades/bursa`) and then pulled on the VPS.

Target:
- app URL: `https://bursa.mohshoo.com`
- server: `mohshoo.tailf9eafe.ts.net`
- persistent SQLite volume: `/var/lib/bursa/data`

### First-time host setup

```bash
ssh root@mohshoo.tailf9eafe.ts.net 'mkdir -p /var/lib/bursa/data'
```

Cloudflare Tunnel should send `bursa.mohshoo.com` traffic to `http://kamal-proxy:80` on the VPS.

### Local manual deploy

1. Create `.kamal/secrets` with the production secret values, plus GHCR credentials:

```bash
KAMAL_REGISTRY_USERNAME=your-github-username
KAMAL_REGISTRY_PASSWORD=your-github-token-with-read:packages,write:packages
AUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OPENROUTER_API_KEY=...
CRON_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_CREDITS_10=...
```

2. First deploy on a fresh host:

```bash
kamal setup
```

3. Deploy updates:

```bash
kamal deploy
```

## GitHub Actions deploy

`.github/workflows/deploy.yml` builds on every PR/push to `master` and deploys on pushes to `master`.

Required GitHub secrets:
- `TAILSCALE_AUTHKEY`
- `DEPLOY_SSH_KEY`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OPENROUTER_API_KEY`
- `CRON_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_CREDITS_10`

The workflow uses the built-in `GITHUB_TOKEN` for GHCR, so no extra registry secret is required in GitHub Actions.

## Current production status

- public URL: `https://bursa.mohshoo.com`
- health endpoint: `https://bursa.mohshoo.com/api/health`
