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
- `mise run deploy` — deploy the current checkout locally through Alchemy core.
- `mise run status` / `mise run logs` / `mise run backup` / `mise run rollback`.
- `bun run cf:dev` — developer local bindings; remote prod operations require the
  deliberate cutover procedure in `docs/deployment.md`.

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

## Desktop deployment

Read [docs/deployment.md](docs/deployment.md) before hosting changes or deployment.
Production uses Alchemy/workerd locally with Cloudflare bindings, supervised by
mise/Pitchfork and exposed through the shared Bursa-owned Cloudflare Tunnel.
Use `mise run deploy` (local host stack, stage desktop); do not apply the remote
prod stack. Run one launcher against production storage. Secrets and binding
data live outside Git under `~/Servers/apps/bursa`. Push does not deploy;
deploy does not fetch. Preserve dirty hosting changes before updating checkout.
Retained remote resources are stale checkpoints; moving back requires current
data transfer and workflow reconciliation. See the runbook for backups/rollback.

## Work tracking

Open work lives in BB Tasks under the **BUR** project: `bb tasks list --project
BUR`. Claim a task before editing (`bb tasks update BUR-1 --status in_progress`
and `bb tasks attach BUR-1`), work one at a time, and hand implementation off
through `in_review`; owner review is not an agent completion claim. The
operating conventions are in
[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

The Obsidian vault tracker at `~/Work/ofrades/notes/bursa/issues/` was retired
on 2026-11-10; its open issues were imported into BB Tasks and the markdown files
are frozen history. Do not edit them.

GitHub Issues is enabled on this repository but is not the tracker; do not open
issues there. If someone files one, create a BB task and close the GitHub issue
with a pointer.

## Agent skills

### Issue tracker

Open work lives in BB Tasks under the BUR project. See
`docs/agents/issue-tracker.md`.

### Triage labels

Triage roles are BB Tasks labels (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.
