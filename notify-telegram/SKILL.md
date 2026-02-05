---
name: notify-telegram
description: Send a proactive notification/reminder to Matt via Telegram using the OpenClaw message tool. Use when a Cron/monitor/job must reliably notify the user directly (not via systemEvent/heartbeat), e.g. reminders, alerts, job completion notices.
---

# Notify Telegram (可靠直接通知)

## 核心原則
- **一定要用 `message` tool** 發 Telegram（不要只丟 systemEvent）。
- 目標是「使用者一定看得到」：直接送到 Matt 的 Telegram。
- 訊息要短、可行動，必要時包含時間點/背景。

## 送出通知（標準做法）
用工具：`message(action="send")`

必填欄位：
- `channel: "telegram"`
- `target: "894437982"`（Matt）
- `message: "..."`

範例（提醒）
```json
{
  "action": "send",
  "channel": "telegram",
  "target": "894437982",
  "message": "⏰ 提醒：機車保養（你設定今天 10:00）。"
}
```

範例（監控告警）
```json
{
  "action": "send",
  "channel": "telegram",
  "target": "894437982",
  "message": "🚨 Kanban 監控：API 打不通（localhost:3001）。建議：重啟 project-kanban server.js。"
}
```

## 給 Cron 的建議設定（最穩）
- 用 `cron.payload.kind = "agentTurn"`
- `sessionTarget = "isolated"`
- 在 `payload.message` 清楚寫：要通知的內容 + 目標一定要用 message tool。

注意：`sessionTarget="main" + systemEvent` 可能要等 heartbeat 才會被處理，不適合「一定要提醒到」的需求。
