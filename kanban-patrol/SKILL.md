---
name: kanban-patrol
description: Automated monitoring logic for the Kanban project. Checks for stuck tasks, review items, and system health. Designed to be run by a lightweight Cron agent (Flash).
---

# Kanban Patrol Skill 👮‍♀️

This skill defines the logic for the automated patrol agent.

## 🕵️‍♂️ Patrol Workflow

The patrol agent should execute the following logic:

### 1. Check Status
Fetch current tasks from the local Kanban API.
```bash
curl -sS http://127.0.0.1:3001/api/tasks
```

### 2. Analyze
Parse the JSON and check for:
- **STUCK**: Tasks in `in-progress` not updated for > 1 hour.
- **IGNORE**: Tasks in `todo`, `done`, `on-hold`, `review`.

### 2.5 Check Background Agents (Safety Net)
- Run `openclaw sessions --json --active 30`.
- Look for sessions with `model` like `claude` that stopped recently.
- If found (and looks like a task): Notify Main Agent.

### 3. Action Rules (Logic)
- **Auto-Stop Logic**:
  - If `count(in-progress) == 0`:
    - **Disable Cron**: `openclaw cron disable --id c7438563-e00f-40f0-b7cb-6468e96efef7`
    - **Notify**: "💤 No active development tasks. Patrol entering deep sleep."
    - **Exit**.

- **Quiet Hours (00:00 - 08:00)**:
  - If tasks exist: Only report **CRITICAL** (Stuck).

- **Active Hours (08:00 - 23:59)**:
  - If tasks exist: Report Stuck status.
  - **Running Check**: If active sessions found, notify Main Agent AND User ("✅ Patrol: Task #[Seq] is running...").

### 4. Notification Channels
- **To User**: Use `message` tool (Telegram).
- **To Main Agent**: Use `sessions_send`.
- **To Main Agent (Wake Up)**: If actionable items found (Stuck), wake the main agent.
  - Tool: `sessions_send`
  - Target: `agent:main:main`
  - Message: `🚨 PM Patrol: Task #[Seq] is stuck...`

## 🤖 Usage (Cron Payload)
The Cron Job should simply instruct the agent to "Follow the `kanban-patrol` skill."
