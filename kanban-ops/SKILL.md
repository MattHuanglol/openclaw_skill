---
name: kanban-ops
description: Kanban board operations for Matt’s local project-kanban (port 3001): health checks, DB schemaVersion, task summary, and the exact /kanban reply format (first line is a clickable link). Use when the user types /kanban or asks for kanban status/health/version.
---

# Kanban Ops

This skill standardizes **what to do and how to reply** when Matt asks about the Kanban board.

## /kanban Reply Contract (must follow)

When the user sends `/kanban`, reply in this exact structure:

1) **Line 1 = clickable link** (plain URL, no markdown wrapper):
- `http://100.96.208.119:3001`
- `http://127.0.0.1:3001` (local)

2) **Health** (short bullets):
- Server up? (port 3001 + GET / returns HTML)
- API up? (GET /api/tasks and /api/mailboxes return 200)
- DB schemaVersion (from SQLite meta table)

3) **Task summary** (short bullets):
- Counts by status: todo / in-progress / review / on-hold / done
- List review tasks (id + title + task link)

If health checks fail, replace task summary with:
- what failed
- the single best next action (restart service / check logs)

## How to Collect Status (preferred)

Run the bundled script and use its JSON output:

```bash
cd /home/matt/clawd
python3 ./skills/kanban-ops/scripts/kanban_status.py --json
```

Then format the reply per the contract above.

## 狀態變更 SOP（嚴禁直接改資料庫或檔案）

只要涉及 **Kanban 任務狀態更新**，一律遵守以下 6 大準則：

1) **變更前先同步 (Fetch First)**：
- 在進行任何更新前，**必須**先執行 `GET /api/tasks`，確保本地認知與伺服器當前狀態一致，避免操作到錯誤的 UUID。

2) **溝通紀錄優先 (Discussion Log)**：
- 當任務因任何原因受阻、或需要主人做決策時，**必須**將訊息同步寫入任務的 **「討論 / 訊息歷史」**。
- 操作：使用 `PATCH /api/tasks/:id` 並帶上 `discussionAppend` 物件。

3) **子任務先行 (Check Subtasks)**：
- 在將任務移至 `review` 或 `done` 之前，**必須**確認該任務所有相關的 **子任務 (subtasks)** 都已正確標記為 `done`。

4) **開發完必進 Review (Flow Control)**：
- 任務開發完成後，**嚴禁直接設為 `done`**。
- 必須先更新為 **`review`** 狀態，等待主人親自驗收。主人確認後才可改為 `done`。

5) **API 唯一路徑 (API Only)**：
- **禁止**直接操作 SQLite 資料庫檔案或修改 `tasks.json`。
- 必須統一透過 `PATCH /api/tasks/:id` 進行變更。

6) **變更後雙重驗證 (Verify & Refresh)**：
- **API 驗證**：更新後**必須**立即再次執行 `GET /api/tasks`，檢查 `status`、`version` 或 `subtasks` 是否真的如預期發生變動。**禁止在未執行 API 驗證前就向主人回報成功。**
- **UI 驗證**：告知主人已更新，並提醒刷新頁面確認（若不同步，建議使用無痕模式或強制重整）。

## Operational Notes

### Service management (systemd user)
- Service name: `project-kanban.service`

Useful commands:
```bash
systemctl --user status project-kanban.service --no-pager -l
systemctl --user restart project-kanban.service
journalctl --user -u project-kanban.service -n 100 --no-pager
```

### Data sources
- Source of truth DB: `/home/matt/clawd/project-kanban/data/kanban.sqlite`
- schemaVersion location: `meta` table, key `schemaVersion`

## Guardrails
- Do **not** push to git unless the user explicitly asks.
- Keep /kanban replies concise; link first.
