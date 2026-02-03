---
name: kanban-dev-monitor
description: Event-driven Kanban development monitor. Use to periodically check Project Kanban in-progress tasks, detect changes or stuck (>=30m no progress), persist monitor state, and wake the PM (main agent). Designed to be run by Cron every 5 minutes and to execute a deterministic JS runner.
---

# Kanban Dev Monitor

## Purpose
A lightweight, **event-driven** monitor for Project Kanban development tasks.

- Runs every **5 minutes**
- Detects events only (no spam):
  - status/version/open-subtasks changed
  - **stuck**: no progress for **>= 30 minutes**
  - Kanban server down
- Persists snapshots to:
  - `/home/matt/clawd/memory/kanban-monitor-state.json`
- **Never** messages the user directly.
- On events, **wake PM (main agent)** via `sessions_send`.

## Execution (JS-only)
The actual logic must be executed by the deterministic runner:

- `scripts/kanban_dev_monitor.js`

Run locally:
```bash
node /home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/kanban_dev_monitor.js
```

## Cron Contract
Cron job should:
1) Execute the JS runner.
2) If runner exits non-zero or throws, wake PM with error summary.
3) Otherwise stay silent.

## Config
Environment variables supported by the runner:
- `KANBAN_URLS` (default: `http://localhost:3001,http://100.96.208.119:3001`)
- `STATE_PATH` (default: `/home/matt/clawd/memory/kanban-monitor-state.json`)
- `STUCK_MINUTES` (default: `30`)
- `ONLY_ASSIGNEE` (default: `妲己`)
