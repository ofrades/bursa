# Bursa

AI-powered stock analysis app built with TanStack Start, React, Tailwind, Nitro, and SQLite.

## Local development

This repo uses bun as its package manager.

```bash
bun install
bun run hooks:install
bun run dev
```

Useful commands:

```bash
bun run build
bun run check
bun run test
bun run ci
```

The installed pre-push hook runs `bun run ci` before every push.

Notes:

- `bun run test` exits non-zero when there are no test files.
- Formatting is enforced by oxfmt; run `bun run fmt` to fix.

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
bun run cf:deploy:prod   # prod stage → https://bursa.mohshoo.com
bun run cf:deploy        # dev stage (workers.dev URL)
```

Deploys seed sensitive values from `.env` into Cloudflare Secrets Store under
`BURSA_*` names. The Worker reads them through live Secrets Store bindings;
local development continues to use `.env`. D1 migrations in `./drizzle` apply
on every deploy.

## Current production status

- public URL: `https://bursa.mohshoo.com`
- health endpoint: `https://bursa.mohshoo.com/api/health`

## EPS-revision screen

`/screen` runs the Mare Nostrum-style screen (90-day FY1/FY2 consensus revisions,
breadth, SUE, ROIC/leverage/Piotroski gates, composite ranking) over the curated
global large-cap universe in `src/lib/screen/universe.ts`. The list is data-driven:
every survivor, ranked, equal-weighted; the strict top-revision-quintile subset is
flagged. Admin: "Run screen" advances the batched run; "Classify revisions" runs the
OpenRouter revision-quality classifier (RECURRING/ONE_OFF/MIXED) over the strict set.

Headless runs (cron / CI): `POST /api/screen/run` then `POST /api/screen/jev` with
the `x-screen-token` header matching the `SCREEN_ADMIN_TOKEN` secret — or just use
`scripts/screen-cron.sh`.
