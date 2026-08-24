# AGENTS.md

## Stack

- TanStack Start + Vite 8, driven directly by `vite` / `vitest` (no meta-CLI).
- Bun is the package manager (`bun install`, `bun.lock`, `bun run <script>`).
  Node 24 remains the runtime for dev servers, tests, and builds.
- Lint with oxlint (anti-slop plugin under `tools/`), format with oxfmt.
  `bun run check` runs both. `bun run typecheck` runs plain `tsc --noEmit`
  (note: 22 pre-existing errors remain from the Vite+ era, where the type
  gate was Vite+'s bundled checker — fixing them is a pending follow-up).

## Commands

- `bun install` — install dependencies
- `bun run dev` — dev server on :3000
- `bun run build` / `bun run preview` — production build / preview
- `bun run check` — lint + format check + typecheck
- `bun run test` — vitest (watch: `bun run test:watch`)
- `bun run ci` — check + test + build
- `bun run cf:deploy` — deploy via Alchemy (`cf:dev`, `cf:deploy:prod`,
  `cf:destroy` also available)

## Conventions

- Native modules (`better-sqlite3`) are built by bun's install lifecycle via
  `trustedDependencies`; there is no postinstall rebuild step.
- Run `bun run knip` when refactoring and before finishing a feature; remove
  dead files, exports, and dependencies it reports.
