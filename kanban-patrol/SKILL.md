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
- **REVIEW**: Tasks in `review`.
- **IGNORE**: Tasks in `todo`, `done`, `on-hold`.

### 3. Action Rules (Quiet Hours)
Check current time (Asia/Taipei).
- **00:00 - 08:00 (Sleep Mode)**:
  - Only report **CRITICAL** issues (Stuck tasks).
  - Suppress "Waiting for Review" notifications.
- **08:00 - 23:59 (Active Mode)**:
  - Report all issues.

### 4. Notification Channels
- **To Main Agent (Wake Up)**: If actionable items found (Stuck), wake the main agent.
  - Tool: `sessions_send`
  - Target: `agent:main:main`
  - Message: `🚨 PM Patrol: Task #[Seq] is stuck...`
- **To User (Notification)**: If Review items found (and active hours), notify user.
  - Tool: `message`
  - Channel: `telegram`
  - Message: `🔔 Task #[Seq] is waiting for review.`

## 🤖 Usage (Cron Payload)
The Cron Job should simply instruct the agent to "Follow the `kanban-patrol` skill."
