---
name: voice-assistant
description: Handle Telegram voice/audio messages as commands (STT) and send voice notifications (TTS). Use when the user sends a voice message or asks to "語音指令/STT" or "語音通知/TTS". Implements A+1: always transcribe voice, reply with transcript first, and only propose a command draft when transcript starts with the keyword「指令」.
---

# Voice Assistant（Telegram 語音指令 + 語音通知）

## ⚠️ 架構：事件驅動（非 Cron）

**不使用 Cron 輪詢。** 收到語音訊息時，直接在 main session 當次 turn 處理。

理由：Cron isolated sessions 搶 session lock，會導致 Telegram 訊息丟失。事件驅動零延遲、零 lock 衝突。

### 觸發條件
當 Telegram 訊息包含 **voice/audio 附件**（.ogg、.oga、.mp3、.m4a 等），立即走以下流程。

---

## Scope（目前階段：A+1）

- **STT（語音→文字）**：收到 Telegram 的 voice/audio 附件時
  1) 先轉寫
  2) 先回覆「轉寫文字」讓主人確認
  3) 若轉寫文字以 **「指令」** 開頭，再產生「候選指令草稿」並要求確認後執行（A+1）

- **TTS（文字→語音通知）**：需要可靠通知主人時
  - 用 `tts` tool 產生音檔，再用 `message(action=send, asVoice=true)` 送 Telegram voice note。

---

## STT：事件驅動完整流程

### Step 0: 識別語音訊息

收到 Telegram 訊息時，檢查是否有語音/音訊附件：
- 訊息中有提到 voice/audio file path（`~/.openclaw/media/inbound/` 下的 .ogg/.oga/.mp3/.m4a）
- 若無音訊附件：不走本流程

### Step 1: Dedup 檢查

從訊息取得唯一識別碼（`file_unique_id` 或 `message_id`）：

```bash
node /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_dedup.js --check --id <ID>
```

- `duplicate: true`：回覆「這則語音我已經處理過囉～」，結束。
- `duplicate: false`：繼續。

### Step 2: 轉寫（直接在 main session exec）

```bash
node /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_handle_inbound.js \
  --path <audio_file_path> --message-id <msg_id> [--file-unique-id <fuid>]
```

#### STT 優先序 / Fallback 規則
自動選擇後端（失敗自動回退）：
1) **Remote Faster-Whisper**（若設定 `REMOTE_STT_URL`）
2) **Gemini STT**（若設定 `GEMINI_API_KEY`）
3) **本機 Whisper**（最後保底）

回覆最後一行附上：`(STT: remote|gemini|local)`

#### Remote Faster-Whisper STT（自架雲端，可選）
讀取順序：
1) `process.env.REMOTE_STT_URL`
2) `~/.openclaw/secrets.env`

```bash
REMOTE_STT_URL=http://100.114.182.68:8000/transcribe
REMOTE_STT_TOKEN=your_token_here
REMOTE_STT_AUTH_HEADER=X-API-Key  # Optional, default: X-API-Key
```

#### Gemini STT（雲端，可選）
讀取順序：
1) `process.env.GEMINI_API_KEY`
2) `~/.openclaw/secrets.env`

```bash
GEMINI_API_KEY=your_api_key_here
GEMINI_STT_MODEL=gemini-2.5-flash  # Optional
```

**隱私提醒**：Remote/Gemini STT 時語音內容會上傳到外部服務。

---

**優先使用 OpenClaw 的音訊理解能力（如果附件已被系統轉成可理解的內容）。**

> **現實約束**：目前 OpenClaw 對 Telegram voice 的「附件→可供模型轉寫」形式，依 channel/設定而異。
> 若本 turn 取不到可轉寫的內容，請回覆：
> - "我有收到語音，但目前拿不到可轉寫的音檔/內容。請先貼文字，或稍後我幫你調整讓語音附件可轉寫。"

### Step 3: 解析結果 + 回覆

`voice_handle_inbound.js` 輸出 JSON：
```json
{
  "requestId": "...",
  "transcript": "...",
  "isCommand": true/false,
  "draftCommand": "/remind ..." or null,
  "commandType": "exec"|"idea"|"task"|null,
  "suggestedReplyText": "你剛剛說：\n「...」"
}
```

**直接回覆** `suggestedReplyText` 給主人。

### Step 4: Command Mode（門檻：指令）

只有當 transcript **以「指令」開頭** 時，才產生候選草稿。

支援的語音前綴：
- `指令 ...` → commandType `exec`
- `點子：/想法：/Idea：...` → commandType `idea`
- `任務：/Task：/新增任務：...` → commandType `task`

**草稿格式：**
```
（草稿）/remind 10:00 機車保養

請確認：
✅ 執行  ✏️ 修改  ❌ 取消
```

**若平台支援 inline buttons，優先用按鈕。** 按鈕的 callback_data 對應確認動作。

### Step 5: 確認後執行（A+1）

等待主人回覆：
- `執行` / ✅按鈕：執行草稿指令
- `取消` / ❌按鈕：取消
- `修改：<new_command>` / ✏️按鈕：修改後執行

確認腳本：
```bash
node /home/matt/clawd/skills/custom/voice-assistant/scripts/voice_confirm.js \
  --request-id <id> --action execute|cancel|modify [--modify-text "..."]
```

---

## TTS：語音通知（Telegram voice note）

1. 呼叫 `tts(text)` 取得音檔路徑（MEDIA: ...）
2. 用 `message` tool 發送：
   - `channel: telegram`
   - `target: 894437982`
   - `path: <MEDIA 路徑>`
   - `asVoice: true`

---

## 去重（Deduplication）

狀態檔案：`~/.clawd-voice-dedup.json`

```bash
# 檢查
node scripts/voice_dedup.js --check --id <ID>
# 標記
node scripts/voice_dedup.js --mark --id <ID> --transcript "轉寫內容"
# 列出
node scripts/voice_dedup.js --list
# 清理（預設 24h）
node scripts/voice_dedup.js --clean --max-age 48
```

---

## 待確認草稿（Pending Drafts）

狀態檔案：`~/.clawd-voice-pending.json`

requestId 生成：`sha256(fileUniqueId || messageId)` 取前 16 hex。

---

## 升級到 A+2（未來）

- 低風險指令可自動執行；高風險仍需確認。
- 仍建議保留 fallback：轉寫品質差就退回 A+1。
