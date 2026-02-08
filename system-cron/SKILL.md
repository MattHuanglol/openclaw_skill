---
name: system-cron
description: 系統層級 crontab 排程管理。將高頻 cron jobs 從 OpenClaw isolated session 搬到系統 crontab，避免 session lock 競爭導致 Telegram 訊息丟失。
---

# System Cron（系統排程）

## 背景

OpenClaw 的 cron isolated session 執行時會佔住 `sessions.json.lock`（通常 30~90 秒）。期間 Telegram webhook 進來的訊息**會被靜默丟棄**（不是排隊，是 skip）。

**解法**：高頻 / 長時間的 cron jobs 改用系統 crontab 執行 node 腳本，只在有結果時才用 `openclaw sessions send` 瞬間送回 main session（佔 lock < 1 秒）。

## 架構

```
之前：OpenClaw cron → isolated session（佔 lock 60s+）→ 跑腳本 → 送通知
現在：系統 crontab → 直接跑 node 腳本（0 lock）→ 有事才 openclaw sessions send（<1s lock）
```

## 目前的系統 crontab

```crontab
# Mail: important unread check (every 30 min)
*/30 * * * * /home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh important

# Mail: daily summary (09:00 + 17:00)
0 9 * * * /home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh summary
0 17 * * * /home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh summary

# Kanban dev monitor (every 10 min)
*/10 * * * * /home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/cron_wrapper.sh
```

Log 位置：
- `/tmp/mail-important.log`
- `/tmp/mail-summary.log`
- `/tmp/kanban-monitor.log`

## Wrapper 腳本規範

每個 wrapper (`cron_wrapper.sh`) 遵循同一模式：

1. 執行 node 腳本，捕獲 stdout
2. 如果輸出是 `NO_REPLY` 或空 → 靜默退出（不碰 OpenClaw lock）
3. 如果有實際結果 → `openclaw sessions send --agent main --message "..."` 送回 main session

Wrapper 位置：
- `/home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh`
- `/home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/cron_wrapper.sh`

## 仍在 OpenClaw cron 的 Jobs（低頻，需要 agent 能力）

| Job | 頻率 | 原因 |
|-----|------|------|
| Daily AI News (1998dd19) | 09:00 & 18:00 | 需要 web_search tool |
| Weekly AI Brief (2823154c) | 週日 20:00 | 需要 web_search tool |
| Weekly Stuck Analysis (f674a679) | 週日 22:00 | 需要 exec + message tools |

這些每天最多跑 2~3 次，lock 碰撞風險低，暫時保留。

## 已停用的 OpenClaw cron Jobs

| Job ID | 名稱 | 停用原因 |
|--------|------|---------|
| b118209c | 🚨 重要郵件檢查 (30min) | 改系統 crontab |
| b96e67bb | 📧 每日郵件摘要 09:00 | 改系統 crontab |
| 94a46e38 | 📧 每日郵件摘要 17:00 | 改系統 crontab |
| b4b8b75e | Kanban Dev Monitor | 改系統 crontab |
| 80ebd317 | Cron Health Watchdog | 監控對象都搬走了 |
| 70dcf44b | Voice flush | 改事件驅動 (2026-02-08) |
| 318d10f8 | Voice scan | 改事件驅動 (2026-02-08) |

## 管理指令

```bash
# 查看目前系統 crontab
crontab -l

# 編輯
crontab -e

# 查看 log
tail -f /tmp/mail-important.log
tail -f /tmp/kanban-monitor.log

# 手動測試 wrapper（不會碰 lock 除非有結果）
/home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh important
/home/matt/clawd/skills/custom/mail-assistant/scripts/cron_wrapper.sh summary
/home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/cron_wrapper.sh
```

## 問題排查

### Wrapper 沒執行
```bash
# 確認 crontab 有載入
crontab -l

# 確認 PATH 包含 node 和 openclaw
which node && which openclaw

# 檢查 cron daemon
systemctl status cron
```

### openclaw sessions send 失敗
```bash
# 確認 gateway 在跑
openclaw gateway status

# 手動測試
openclaw sessions send --agent main --message "test"
```

## 決策紀錄

- **2026-02-08**：因 Telegram 訊息反覆丟失，決定將高頻 cron 搬到系統 crontab。根因是 OpenClaw isolated session 佔 lock 時間過長（GitHub #10538, #11273, #11058）。即使更新到 d90cac9（lock contention fix），高頻 isolated session 仍有碰撞風險。系統 crontab 方案將 lock 佔用從 60s+ 降到 <1s。
