# Hosting (Cloudflare via Alchemy)

TanStack Start SSR app deployed to Cloudflare Workers with a D1 database,
declared in `alchemy.run.ts`. Replaced the Docker/Kamal/VPS deployment.

## Stack shape

- `Cloudflare.Website.Vite("Website")` — builds with plain
  `tanstackStart()` + `viteReact()` plugins and deploys client assets +
  SSR worker. Sensitive values are live Secrets Store bindings; server code
  reads them asynchronously through `src/secrets.ts`.
- `Cloudflare.D1.Database("Database", { migrations: "./drizzle" })` —
  migrations apply on every deploy. Runtime uses drizzle's d1 driver
  (`src/lib/db.ts`); there is no runtime migration step anymore.
- Prod stage attaches zone route `bursa.mohshoo.com/*` over the existing
  proxied DNS record (zero-downtime cutover from the VPS container).

## Commands

```bash
npm run cf:dev            # TanStack dev server with live cloud bindings
npm run cf:deploy         # dev stage (workers.dev URL)
npm run cf:deploy:prod    # prod stage → bursa.mohshoo.com
npm run cf:destroy        # tear a stage down (prod resources retained)
```

Deploys seed `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `OPENROUTER_API_KEY`,
`FMP_API_KEY`, and `STRIPE_*` credentials from `.env` into the account-level
Secrets Store with a `BURSA_` prefix. Public IDs and non-sensitive settings
remain ordinary Worker bindings. Local development still reads `.env`.

## Database notes

- better-sqlite3 → D1: drizzle's d1 driver is async and has no interactive
  transactions; `applyWalletTopUp` leans on the UNIQUE index for dedupe.
- drizzle-kit was upgraded to v1 layout (`drizzle-kit up` converted the old
  `meta/_journal.json` format).
- The security-state migration intentionally invalidates legacy JWTs that lack
  a DB session version. This is a one-time global logout; subsequent sign-out
  increments the version and intentionally revokes all sessions for that user.
- Analysis requests reserve `ANALYSIS_MAX_CHARGE_CENTS` (25 cents by default).
  The final charge is capped at that hold, so provider overages are absorbed by
  the service and can never make a wallet negative. If provider usage is absent
  on a successful structured response, the full hold is charged and marked as
  unreported in `usage_log`.
- The production admin role was preserved during the security rollout without
  retaining a personal identifier in source. On a fresh database, provision an administrator only after their first login
  with `UPDATE user SET role = 'admin' WHERE id = '<verified-user-id>'`; runtime
  authorization never derives admin access from email or an environment flag.
- `scripts/d1-dump.mjs` dumps a SQLite file into size-capped data-only
  migration folders. Sensitive tables are excluded unless the operator passes
  `--include-sensitive`. The schema does not require a data seed: the stock
  catalog is populated by normal search/analyze flows.

## VPS decommission checklist

Done — Dockerfile, .kamal/, config/deploy.yml, setup-vps.sh,
nginx.conf and the db-pull/push/sync scripts were removed. Remaining:
stop/destroy the `bursa-web-*` container on the VPS itself.
