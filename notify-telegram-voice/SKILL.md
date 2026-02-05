---
name: notify-telegram-voice
description: Send reliable Telegram voice-note notifications to Matt (TTS -> Telegram asVoice). Use when a cron/monitor/job must notify Matt with audio (TTS), or when the user asks for "語音通知/TTS".
---

# Notify Telegram Voice（TTS 語音通知）

## 做法（最穩）

1. 用 `tts` tool 把文字轉成音檔
2. 用 `message(action=send)` 以 **Telegram voice note** 送出（`asVoice: true`）

---

## 標準流程（Agent 執行）

### Step 1: 產生語音
```
tts(text="提醒：機車保養")
```
→ 取得 `MEDIA: /path/to/audio.mp3`

### Step 2: 發送 Telegram Voice Note
```
message(
  action: "send",
  channel: "telegram",
  target: "894437982",
  path: "/path/to/audio.mp3",
  asVoice: true
)
```

---

## Cron / 自動化（Deterministic Workflow）

### 方式一：直接用 agentTurn（推薦）

Cron 設定範例：
```json
{
  "kind": "agentTurn",
  "sessionTarget": "isolated",
  "message": "發送 Telegram 語音通知給 Matt：「提醒：機車保養」\n\n步驟：\n1. 呼叫 tts(text=\"提醒：機車保養\") 取得音檔\n2. 呼叫 message(action=\"send\", channel=\"telegram\", target=\"894437982\", path=<音檔>, asVoice=true)"
}
```

### 方式二：使用 Helper Script

腳本位置：`scripts/send_voice_notification.js`

```bash
# 產生 agentTurn payload
node /home/matt/clawd/skills/custom/notify-telegram-voice/scripts/send_voice_notification.js \
  --text "提醒：機車保養"

# 從檔案讀取
cat message.txt | node scripts/send_voice_notification.js --text-stdin

# 指定其他 target
node scripts/send_voice_notification.js --text "..." --target 123456789
```

輸出範例：
```json
{
  "kind": "agentTurn",
  "sessionTarget": "isolated",
  "message": "Send a Telegram voice notification to 894437982...",
  "metadata": {
    "source": "send_voice_notification.js",
    "timestamp": "2026-02-05T10:30:00.000Z",
    "target": "894437982",
    "textLength": 12
  }
}
```

---

## 範例訊息

### 提醒類
```
⏰ 提醒：機車保養（你設定今天 10:00）
```

### 監控告警
```
🚨 Kanban API 無回應，建議重啟 server
```

### 天氣通知
```
☔ 今天降雨機率 80%，記得帶傘
```

---

## 注意事項

- 這是「直接推播到 Telegram」：不依賴 heartbeat。
- 訊息請保持短、清楚可行動（避免太長的段落）。
- TTS 最佳長度：1-2 句話（約 10-30 字）。
- 若文字太長，語音會很長且難以快速理解。

---

## 與其他 Skill 的關係

| Skill | 用途 |
|-------|------|
| `notify-telegram` | 文字通知（快、省資源） |
| `notify-telegram-voice` | 語音通知（需要注意力時） |
| `voice-assistant` | 雙向語音：STT + TTS |

### 何時用語音通知？
- 重要提醒（容易被文字忽略的）
- 主人可能在忙，語音更能引起注意
- 有趣的互動（如每日問候）

### 何時用文字通知？
- 一般狀態更新
- 批次通知（多則訊息）
- 不需要立即注意的資訊

---

## Test Plan（測試計畫）

### 1. 基本 TTS 發送測試
1. 執行：`tts(text="測試語音通知")`
2. 取得音檔路徑
3. 執行：`message(action="send", channel="telegram", target="894437982", path=<音檔>, asVoice=true)`
4. 預期：Telegram 收到 voice note

### 2. Cron Payload 測試
1. 執行 helper script：
   ```bash
   node scripts/send_voice_notification.js --text "Cron 測試通知"
   ```
2. 確認輸出為有效的 agentTurn JSON

### 3. Isolated Session 測試
1. 設定一個測試用的 cron job
2. 等待觸發
3. 預期：Telegram 收到 voice note，且不影響主 session

### 4. 長文字警告測試
1. 嘗試發送超過 50 字的通知
2. 記錄語音長度
3. 評估是否需要截斷或分段
