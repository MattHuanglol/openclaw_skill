---
name: voice-assistant
description: Handle Telegram voice/audio messages as commands (STT) and send voice notifications (TTS). Use when the user sends a voice message or asks to "語音指令/STT" or "語音通知/TTS". Implements A+1: always transcribe voice, reply with transcript first, and only propose a command draft when transcript starts with the keyword「指令」.
---

# Voice Assistant（Telegram 語音指令 + 語音通知）

## Scope（目前階段：A+1）

- **STT（語音→文字）**：收到 Telegram 的 voice/audio 附件時
  1) 先轉寫
  2) 先回覆「轉寫文字」讓主人確認
  3) 若轉寫文字以 **「指令」** 開頭，再產生「候選指令草稿」並要求確認後執行（A+1）

- **TTS（文字→語音通知）**：需要可靠通知主人時
  - 用 `tts` tool 產生音檔，再用 `message(action=send, asVoice=true)` 送 Telegram voice note。

---

## STT：語音指令（A+1）完整流程

### Step 0: 取得訊息識別碼（Dedup）

從 Telegram 訊息取得唯一識別碼，優先順序：
1. `file_unique_id`（voice/audio 附件的唯一 ID）
2. `message_id`（訊息 ID）

**檢查是否已處理過：**
```bash
node /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_dedup.js --check --id <ID>
```

- 若 `duplicate: true`：回覆「這則語音我已經處理過囉～」，不重複轉寫。
- 若 `duplicate: false`：繼續處理。

### Step 1: 只處理 voice/audio

- 若訊息沒有 audio/voice 附件：不要走本流程。
- 若是影片/圖片：忽略。

### Step 2: 轉寫

**優先使用 OpenClaw 的音訊理解能力（如果附件已被系統轉成可理解的內容）。**

> **現實約束**：目前 OpenClaw 對 Telegram voice 的「附件→可供模型轉寫」形式，依 channel/設定而異。
> 若本 turn 取不到可轉寫的內容，請回覆：
> - "我有收到語音，但目前拿不到可轉寫的音檔/內容。請先貼文字，或稍後我幫你調整讓語音附件可轉寫。"

### Step 3: 標記已處理 + 回覆轉寫

**標記為已處理：**
```bash
node /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_dedup.js --mark --id <ID> --transcript "<轉寫文字>"
```

**回覆模板：**
```
你剛剛說：
「<transcript>」
```

### Step 4: Command Mode（門檻：指令）

只有當 `<transcript>` **以「指令」開頭**（可容許前後空白）時，才產生候選草稿。

**判斷邏輯：**
```javascript
const normalized = transcript.trim();
const isCommand = normalized.startsWith('指令');
```

**草稿格式（範例）：**
```
（草稿）/remind 10:00 機車保養

請確認：
✅ 執行  ✏️ 修改  ❌ 取消
```

### Step 5: 要求確認才執行（A+1）

- 直接請主人回覆：`執行` / `取消` / `修改：...`
- **若平台支援 inline buttons，優先用按鈕：**
  - ✅執行
  - ✏️修改
  - ❌取消

**等待確認後：**
- `執行`：執行草稿指令
- `取消`：取消，不執行
- `修改：<new_command>`：用修改後的指令執行

---

## TTS：語音通知（Telegram voice note）

### 標準做法

1. 呼叫 `tts(text)` 取得音檔路徑（MEDIA: ...）
2. 用 `message` tool 發送語音：
   - `channel: telegram`
   - `target: 894437982`
   - `path: <MEDIA 路徑>`
   - `asVoice: true`

### 文字內容建議

- 先短句（可行動）：例如「提醒：機車保養」
- 如有時間點：加上「你設定今天 10:00」

---

## 去重（Deduplication）

### 狀態檔案
`~/.clawd-voice-dedup.json`

### 腳本使用

```bash
# 檢查是否重複
node scripts/voice_dedup.js --check --id <message_id|file_unique_id>
# Exit code: 0 = 新訊息, 1 = 重複

# 標記已處理
node scripts/voice_dedup.js --mark --id <ID> --transcript "轉寫內容"

# 列出所有已處理
node scripts/voice_dedup.js --list

# 清理舊紀錄（預設 24 小時）
node scripts/voice_dedup.js --clean --max-age 48
```

### JSON 格式

```json
{
  "processed": {
    "AgADxxxx": {
      "processedAt": "2026-02-05T10:30:00.000Z",
      "transcript": "指令 提醒我下午三點開會"
    }
  }
}
```

---

## 升級到 A+2（未來）

- 低風險指令可自動執行；高風險仍需確認。
- 仍建議保留 fallback：轉寫品質差就退回 A+1。

---

## Test Plan（測試計畫）

### 1. 基本轉寫測試
1. 從 Telegram 發送一則語音訊息（說「測試語音」）
2. 預期：收到回覆「你剛剛說：『測試語音』」
3. 確認 `~/.clawd-voice-dedup.json` 有新紀錄

### 2. 重複訊息測試
1. 手動觸發同一則語音的處理（模擬重試）
2. 預期：收到「這則語音我已經處理過囉～」

### 3. 指令模式測試
1. 發送語音說「指令 提醒我明天早上九點開會」
2. 預期：
   - 收到轉寫文字
   - 收到草稿：`（草稿）/remind 09:00 開會`
   - 收到確認選項

### 4. 非指令語音測試
1. 發送語音說「今天天氣真好」
2. 預期：只收到轉寫，不出現草稿/確認選項

### 5. 確認執行測試
1. 在草稿後回覆「執行」
2. 預期：指令被執行

### 6. Fallback 測試
1. 發送語音但系統無法取得音檔
2. 預期：收到「我有收到語音，但目前拿不到可轉寫的音檔/內容...」
