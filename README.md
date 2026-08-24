# Bursa

AI-powered stock analysis app built with TanStack Start, React, Tailwind, Nitro, and SQLite.

## Local development

This repo uses Vite+.

```bash
vp install
vp run hooks:install
vp dev
```

Useful commands:

```bash
vp build
vp check
vp test
vp run ci
```

The installed pre-push hook runs `vp run ci` before every push.

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
- `FMP_API_KEY` for Financial Modeling Prep market data
- `MARKET_DATA_PROVIDER` (`fmp` or `yahoo`)
- `BETTER_AUTH_URL` in production

Market data now supports an official-provider path. When `FMP_API_KEY` is set, the app prefers Financial Modeling Prep and falls back to Yahoo if an FMP request fails. Without `FMP_API_KEY`, Yahoo remains the default.

AI requests use `moonshotai/kimi-k2.6` via OpenRouter.

## Production deploy

Production deploys use Alchemy against Cloudflare (Workers + D1).
See `infra/README.md` for the stack layout.
Pushes are checked locally by the pre-push hook; deploy production explicitly
after the push succeeds using the logged-in local Alchemy session.

```bash
vp run cf:deploy:prod   # prod stage → https://bursa.mohshoo.com
vp run cf:deploy        # dev stage (workers.dev URL)
```

Deploys seed sensitive values from `.env` into Cloudflare Secrets Store under
`BURSA_*` names. The Worker reads them through live Secrets Store bindings;
local development continues to use `.env`. D1 migrations in `./drizzle` apply
on every deploy.

## Current production status

- public URL: `https://bursa.mohshoo.com`
- health endpoint: `https://bursa.mohshoo.com/api/health`
