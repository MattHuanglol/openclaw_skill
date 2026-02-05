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

#### Gemini STT（雲端，可選）
若設定了 `GEMINI_API_KEY`，此 skill 會**優先**使用 Google AI Studio（Gemini）進行轉寫；否則回退到本機 Whisper。

- 讀取順序：
  1) `process.env.GEMINI_API_KEY`
  2) `~/.openclaw/secrets.env`（`KEY=VALUE` 格式）

`~/.openclaw/secrets.env` 範例：
```bash
GEMINI_API_KEY=your_api_key_here
# Optional: override model
GEMINI_STT_MODEL=gemini-2.0-flash
```

**隱私提醒**：啟用 Gemini STT 時，語音內容會被上傳到 Google 的 API 進行處理。

---

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

## 待確認草稿（Pending Drafts）

### 狀態檔案
`~/.clawd-voice-pending.json`

當語音訊息被識別為指令（以「指令」開頭）且成功產生草稿時，系統會自動儲存待確認的草稿資料。

### JSON 格式

```json
{
  "pending": {
    "<requestId>": {
      "createdAt": "2026-02-05T10:30:00.000Z",
      "messageId": "12345",
      "fileUniqueId": "AgADxxxx",
      "audioPath": "/tmp/voice_xxx.ogg",
      "transcript": "指令 提醒我下午三點開會",
      "draftCommand": "/remind 15:00 開會"
    }
  }
}
```

### requestId 生成規則

`requestId` 使用穩定的 hash 演算法：`sha256(fileUniqueId || messageId)` 取前 16 個 hex 字元。
這確保同一則訊息的 requestId 永遠相同，可用於跨對話追蹤。

---

## 確認/取消/修改草稿（voice_confirm.js）

### 腳本使用

```bash
# 執行草稿指令
node scripts/voice_confirm.js --request-id <id> --action execute

# 取消草稿
node scripts/voice_confirm.js --request-id <id> --action cancel

# 修改後執行
node scripts/voice_confirm.js --request-id <id> --action modify --modify-text "/remind 16:00 開會"
```

### 輸出格式

```json
{
  "ok": true,
  "action": "execute",
  "requestId": "abc123...",
  "commandToExecute": "/remind 15:00 開會",
  "transcript": "指令 提醒我下午三點開會"
}
```

| 欄位 | 說明 |
|------|------|
| `ok` | 是否成功 |
| `action` | 執行的動作（execute/cancel/modify） |
| `requestId` | 請求 ID |
| `commandToExecute` | 要執行的指令（cancel 時為 null） |
| `transcript` | 原始轉寫文字 |
| `error` | 錯誤訊息（僅在失敗時） |

---

## 升級到 A+2（未來）

- 低風險指令可自動執行；高風險仍需確認。
- 仍建議保留 fallback：轉寫品質差就退回 A+1。

---

## Test Plan（測試計畫）

### 0. Smoke Test（本機檔案）
```bash
# Whisper（無 GEMINI_API_KEY 時）
/home/matt/.venvs/whisper/bin/python \
  /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_transcribe_whisper.py \
  /path/to/sample.ogg

# Gemini（需要 GEMINI_API_KEY）
GEMINI_API_KEY=... node \
  /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_transcribe_gemini.js \
  /path/to/sample.ogg
```

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

### 7. 待確認草稿測試
1. 發送語音說「指令 提醒我明天早上九點開會」
2. 確認 `~/.clawd-voice-pending.json` 有新紀錄
3. 記下回傳的 `requestId`

### 8. voice_confirm.js 測試

```bash
# 測試 execute
node scripts/voice_confirm.js --request-id <id> --action execute
# 預期：ok=true, commandToExecute 有值

# 測試 cancel（需先重新產生一個待確認草稿）
node scripts/voice_confirm.js --request-id <id> --action cancel
# 預期：ok=true, commandToExecute=null

# 測試 modify（需先重新產生一個待確認草稿）
node scripts/voice_confirm.js --request-id <id> --action modify --modify-text "/remind 10:00 改時間"
# 預期：ok=true, commandToExecute="/remind 10:00 改時間"

# 測試無效 requestId
node scripts/voice_confirm.js --request-id invalid123 --action execute
# 預期：ok=false, error 提示找不到 pending draft
```

### 9. requestId 穩定性測試
1. 對同一則語音訊息執行兩次 voice_handle_inbound.js（第二次會被 dedup 擋掉）
2. 確認兩次回傳的 requestId 完全相同
3. 這確保 requestId 可用於跨對話追蹤
