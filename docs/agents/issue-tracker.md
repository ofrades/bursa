# Issue tracker: Home Repo tracker

Issues for this repository live in the Home Repo tracker under the **BUR**
project. The tracker is the `home-tasks` CLI (source: `~/Work/tracker`); BB
Tasks and the old Obsidian vault are retired.

- List the board: `home-tasks list --project BUR`
- Read a task: `home-tasks show BUR-1 --json`
- Task keys (`BUR-1`) are permanent handles; cite them in repository documents.

GitHub Issues is enabled on this repository but is **not** the tracker. Do not
open issues there; if one arrives from outside, create a `home-tasks` task and
close the GitHub issue with a pointer to this file.

## History

The Obsidian vault tracker was retired on 2026-11-10; its open issues moved to
BB Tasks, then the tracker data was imported into the Home Repo tracker on
2026-11-16. The markdown files remain in the notes git history.

## Commands

| Operation          | Command                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| List               | `home-tasks list --project BUR`                                                                                                        |
| Show               | `home-tasks show BUR-1 --json`                                                                                                         |
| Create             | `home-tasks create --project BUR --title "..." --description-file /tmp/task.md --priority <urgent\|high\|medium\|low\|none> --label <name>` |
| Claim              | `home-tasks update BUR-1 --status in_progress`                                                                                         |
| Comment            | `home-tasks comment BUR-1 --body "..."`                                                                                                |
| Hand off to review | comment the handover, then `home-tasks update BUR-1 --status in_review`                                                                |
| Close              | `home-tasks update BUR-1 --status done` (or `canceled`)                                                                                |
| Parent / subtask   | `home-tasks update BUR-2 --parent BUR-1`                                                                                          |
| Attach evidence    | `home-tasks attach BUR-1 --file <path>`                                                                                                |
| Board              | `home-tasks board --project BUR`                                                                                                       |

## Status vocabulary

| Status        | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| `backlog`     | Accepted or untriaged; not scheduled                 |
| `todo`        | Ready to start, by an agent or a human               |
| `in_progress` | Claimed and actively being worked                    |
| `in_review`   | Implementation complete, awaiting independent review |
| `done`        | Reviewed and accepted, or the outcome delivered      |
| `canceled`    | Wontfix or archived                                  |

The five triage roles are **labels**, not statuses: `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Category is a
label too: `bug`, `enhancement`. A `blocked` label plus the reason in the
description marks a gate outside the board. [triage-labels.md](triage-labels.md)
has the full mapping.

## Conventions

- **Claim before editing.** Set `in_progress`, then re-read the task before
  touching a file. Work one task at a time.
- **Keep WIP small:** at most two tasks `in_progress` and two `in_review` in the
  project.
- **Dependencies:** list blocking task keys in a `## Dependencies` section of the
  description (`- Depends on BUR-1`). Start only when those tasks are `done`
  or `canceled`. Use `--parent` for a real subtask relationship.
- **Evidence:** a repository path (`docs/...`), never a local notes path.
- **Handover:** a few lines plus commit hashes in a comment, then `in_review`.
  The worker does not accept its own work.
- **Closing:** the reviewer sets `done`; `wontfix` and `archived` become
  `canceled`.
