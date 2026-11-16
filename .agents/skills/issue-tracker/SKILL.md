---
name: issue-tracker
description: Claim work from the bursa issue tracker in the Home Repo tracker before editing files, and hand finished work back through it. Required for every non-trivial change.
---

# The issue tracker

Work is tracked in the Home Repo tracker under project BUR. Read
[docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) for the
full conventions. The tracker is the `home-tasks` CLI; BB Tasks and the old
Obsidian vault are retired.

## The loop

1. Find work: `home-tasks list --project BUR --status todo`.
2. Claim before editing:
   `home-tasks update BUR-12 --status in_progress`, then re-read the task.
3. Work one task at a time, and only what the task describes.
4. Blocked or wrong? Add a `blocked` label and a comment with the reason, put it
   back in `todo`, and release it.
5. Finished? Comment the handover — what changed, how to check it, which checks
   ran — then `home-tasks update BUR-12 --status in_review`. A different
   agent reviews and sets `done`.

Never edit `~/Work/tracker/data/tracker.jsonl` directly. Task keys are
permanent; cite them in commits and reports.
