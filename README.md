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
- `OPENROUTER_API_KEY` for Jev decisions
- `FMP_API_KEY` for Financial Modeling Prep market data
- `MARKET_DATA_PROVIDER` (`fmp` or `yahoo`)
- `BETTER_AUTH_URL` in production

Market data now supports an official-provider path. When `FMP_API_KEY` is set, the app prefers Financial Modeling Prep and falls back to Yahoo if an FMP request fails. Without `FMP_API_KEY`, Yahoo remains the default.

AI requests use TanStack AI's non-streaming `decide()` API and the OpenRouter adapter, using `typesafe/jev-1.13` through `/api/alpha/decisions`. `POST /api/analyze` returns JSON only after persistence and billing. Jev classifies revision drivers and operating momentum from supplied headlines; it does not write essays, update AI memory, invent price targets, or generate trade recommendations. Metrics and thesis cards are assembled in code. The weekly action remains WAIT until an entry policy is evaluated; EMA direction is displayed as trend context, with no invented forecast confidence. Missing causal evidence has an explicit `INSUFFICIENT_EVIDENCE` outcome. Model confidence concerns the classification, not future returns.

Billing uses OpenRouter's reported `usage.cost`, not a token-price estimate. Missing cost is an error rather than an invented charge. The existing wallet markup and charge cap still apply. Keep the existing `OPENROUTER_API_KEY` locally and for deployment; no TypeSafe account or additional API key is needed.

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

`/screen` is a free-data research shortlist over the 371 manually curated global
large caps in `src/lib/screen/universe.ts`, not a reproduction of a fund's verified
methodology or coverage of every market. It always shows the latest **completed**
methodology-v2 snapshot; partial/failed refreshes do not replace it. Original v1
results remain stored but are not compared against corrected calculations.

- Yahoo-only consensus, adjusted prices and statements, independent of the app's
  FMP configuration. Raw numeric wrappers and both named/merged fundamentals are
  decoded at the boundary. Every evaluated row saves its inputs, source, fetch
  time, consensus fiscal targets and aligned statement dates.
- Universe: market cap ≥ €40bn, 63-session average daily turnover ≥ €100m,
  analyst coverage ≥ 20. Missing company inputs are reported, not inferred.
- FX uses one free daily EUR-based ExchangeRate-API snapshot, covering every
  currency in the universe (including TWD and SAR). Missing/non-positive rates,
  incorrect EUR bases, or provider timestamps over 72 hours old block screening
  rather than exclude entire markets. FX source/as-of metadata is saved in each
  new run's parameters; rates remain stored as units per EUR. No historical runs
  are rewritten by this fix.
- Revisions: positive 90-day FY1 **and** FY2 EPS changes with positive EPS baselines;
  positive 30-day analyst breadth `(up-down)/(up+down)`. Loss/zero-baseline names
  and missing breadth are explicitly excluded, not treated as negative signals.
- Quality: ROIC ≥10%, net debt/(EBIT+D&A) ≤3, Piotroski ≥7. Financial-sector
  exemptions remain explicit. Statement ratios use the same two fiscal dates.
- Composite: clipped (±3) cross-sectional z-scores: revisions 35%, analyst breadth
  35%, surprise score 20%, adjusted-price momentum 10%. SUE requires eight usable
  quarters; missing SUE/momentum use the survivor median (zero if none exist),
  with warnings. Strict selection uses the 80th percentile of revision+breadth
  z-scores; ties can produce more than 20% of survivors.
- GARP is optional and off by default. It does not change base ranking or strict
  membership. The page shows changes since the preceding comparable completed
  snapshot, entrants/exits, exclusions, errors and stale-run warnings.
- Prices older than seven days and statements older than 550 days reject the row.
  Fetch timestamps are **not** estimate-update timestamps; consensus freshness and
  historical FY-rollover continuity cannot be verified from this free source.
- Trade Republic buy/long consensus, coverage, dates and target-price upside are
  manual pre-buy checks, separate from estimate revisions. No broker rating or
  validated buy-share threshold is invented by this screen.

Admin: "Run screen" advances/resumes the run. Batches are atomically leased;
creation/queue insertion is atomic, and stale runs over 24 hours are abandoned.
Optional "Classify revisions (paid AI)" invokes Jev through the same TanStack decision API. Its probabilities require domain validation and remain advisory, never screen-gate inputs. The weekly driver never invokes paid AI.

Headless: `POST /api/screen/run` with `{ "runId": "..." }` after the first response,
using the `x-screen-token` header matching a deployed `SCREEN_ADMIN_TOKEN` binding.
Pinning the run prevents retries from accidentally starting another completed run.
`scripts/screen-cron.sh` does this, fails on HTTP/invalid response/incomplete-run
errors, and requires Node 24 plus curl. Example host cron (host timezone):

```cron
0 6 * * 1 SCREEN_ADMIN_TOKEN=... BASE_URL=https://bursa.mohshoo.com /path/screen-cron.sh
```

The script alone does not install a scheduler. Set `SCREEN_ADMIN_TOKEN` in the
secure deployment environment to provision its Secrets Store binding.
Deployment: `bun run cf:deploy:prod` applies the reliability migration and publishes
`https://bursa.mohshoo.com/screen`; then run the first corrected snapshot as admin.
Deploy requires the existing credentials listed in `.env.example`—do not replace
`AUTH_SECRET` merely to satisfy a deployment configuration error.
