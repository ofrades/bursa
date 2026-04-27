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
- `BETTER_AUTH_URL` in production

AI requests use `moonshotai/kimi-k2.6` via OpenRouter.

## Production deploy

Production deploys use Kamal from your local machine.
There is no GitHub Actions deploy.

Target:

- app URL: `https://bursa.mohshoo.com`
- server: `mohshoo.tailf9eafe.ts.net`
- persistent SQLite volume: `/var/lib/bursa/data`

### First-time setup

1. Prepare the host:

```bash
bash scripts/setup-vps.sh
```

2. Create local deploy secrets from the example:

```bash
cp .kamal/secrets.example .kamal/secrets
chmod 600 .kamal/secrets
```

3. Fill in `.kamal/secrets` with your real production values.

4. If this host is new, run:

```bash
kamal setup
```

Route `bursa.mohshoo.com` traffic to `http://127.0.0.1:80` on the VPS, which is served by `kamal-proxy`.

### Deploy

Important: Kamal deploys from a git clone, so commit your changes first.

```bash
git status
kamal deploy
```

Useful commands:

```bash
kamal logs
kamal app details
kamal proxy details
```

### SSH note for Tailscale/MagicDNS

If `kamal deploy` complains about a host key mismatch for the Tailscale hostname/IP pair, add this to `~/.ssh/config` on your machine:

```sshconfig
Host mohshoo.tailf9eafe.ts.net
  CheckHostIP no
  StrictHostKeyChecking yes
```

Then refresh the host key entry in `~/.ssh/known_hosts` if needed.

## Current production status

- public URL: `https://bursa.mohshoo.com`
- health endpoint: `https://bursa.mohshoo.com/api/health`
