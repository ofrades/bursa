# AGENTS.md

## Stack

- TanStack Start + Vite 8, driven directly by `vite` / `vitest` (no meta-CLI).
- Bun is the package manager (`bun install`, `bun.lock`, `bun run <script>`).
  Node 24 remains the runtime for dev servers, tests, and builds.
- Lint with oxlint (anti-slop plugin under `tools/`), format with oxfmt,
  typecheck with plain `tsc --noEmit`. `bun run check` runs all three.

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

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

<!-- effect-solutions:end -->
