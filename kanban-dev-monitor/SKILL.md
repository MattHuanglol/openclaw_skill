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
  - **finish**: task leaves `in-progress`
- Persists snapshots to:
  - `/home/matt/clawd/memory/kanban-monitor-state.json`

### Deterministic automations (no LLM)
- **Service down**: best-effort restart `project-kanban.service`, then retry once
- **Stuck**: append a one-time discussion template per stuck episode
- **Finish**: auto-move task to **Review** (never Done) and append an acceptance checklist

### Notification policy
- 平常不會直接通知使用者（避免刷屏）。
- **任務完成（finish）事件**：會主動 Telegram 通知 Matt（且同時喚醒 PM）。
- 其他事件：只喚醒 PM（main agent） via `sessions_send`。

## Execution (JS-only)
The actual logic must be executed by the deterministic runner:

- `scripts/kanban_dev_monitor.js`

Run locally:
```bash
node /home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/kanban_dev_monitor.js
```

## Cron Contract
Cron job should implement a **closed-loop** (and run as an **isolated agentTurn** so we can pin the model):

- **sessionTarget:** `isolated`
- **model:** `google-gemini-cli/gemini-3-flash-preview`

Steps:
1) Execute the JS runner.
2) If runner detects an **event** (change/stuck/finish/service-down), it must wake PM (main session) via `sessions_send`.
3) **If event is `finish`**: also proactively notify Matt on Telegram (one concise message, max 5 items).
4) After PM is awake, PM must **continue the next step automatically** (e.g., re-run the next phase using `claude_code_run.py`, restart services, or push task to `Review` after verification).
5) If runner exits non-zero or throws, wake PM with error summary.
6) Otherwise stay silent (`NO_REPLY`).

## Config
Environment variables supported by the runner:
- `KANBAN_URLS` (default: `http://localhost:3001,http://100.96.208.119:3001`)
- `STATE_PATH` (default: `/home/matt/clawd/memory/kanban-monitor-state.json`)
- `STUCK_MINUTES` (default: `30`)
- `ONLY_ASSIGNEE` (default: `妲己`)
