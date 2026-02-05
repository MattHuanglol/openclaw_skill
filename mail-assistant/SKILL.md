---
name: mail-assistant
description: Manage email via himalaya CLI (hmattwork). Provides deterministic Node scripts to list/search/read/mark/archive. Includes notification runner scripts (important unread + daily summary) driven by a user-editable rules JSON.
---

# Mail Assistant（郵件助理）

本技能使用 **himalaya CLI**（已設定帳號：`hmattwork`）來讀取/搜尋郵件、讀取內文摘要、設定已讀/未讀、以及移動到資料夾（含歸檔）。

> 注意：本技能不會儲存任何密碼或 token；也不會提交任何本機私密設定。

---

## 目錄
- `scripts/mail_assistant.js`：統一入口（之後給語音助理呼叫用）
- `scripts/mail_list.js`：列出收件匣（或指定資料夾）
- `scripts/mail_search.js`：搜尋（from/to/subject/body）+ 分頁
- `scripts/mail_read.js`：依 id 讀信（安全摘要：標頭 + 內文前 N 行）
- `scripts/mail_mark.js`：標記已讀/未讀
- `scripts/mail_move.js`：移動/歸檔（自動找 Gmail All Mail/Archive）
- `scripts/notify_important_unread.js`：重要未讀檢查（規則驅動，無規則→輸出 `NO_REPLY`）
- `scripts/notify_daily_summary.js`：每日摘要（未讀數量 + 前 N 封未讀）

---

## 先決條件
- 系統已安裝 `himalaya`
- himalaya 設定檔內已存在帳號：`hmattwork`

---

## 使用方法（統一入口）

### 1) 列出最新 N 封（id/subject/from/date/flags）
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  list --folder INBOX --limit 10
```

### 2) 搜尋（支援 from/to/subject/body）+ 分頁
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  search --folder INBOX --to matt.huang@xummit.com.tw --limit 5 --page 1

# 只看未讀
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  search --folder INBOX --unread --subject "urgent" --limit 20
```

### 3) 依 id 讀信（安全摘要）
預設使用 `--preview`，避免讀信時自動標記已讀。
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  read 41909 --folder INBOX --lines 30
```

### 4) 標記已讀/未讀
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  mark seen 41909 --folder INBOX

node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  mark unseen 41909 --folder INBOX
```

### 5) 歸檔 / 移動到資料夾
```bash
# 歸檔（會嘗試自動找 Gmail "All Mail"/"Archive"）
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  archive 41909 --folder INBOX

# 直接移動到指定資料夾
node /home/matt/clawd/skills/custom/mail-assistant/scripts/mail_assistant.js \
  move --target "[Gmail]/All Mail" 41909 --folder INBOX
```

---

## 規則檔（通知 runner）

### 規則檔位置
預設：
- `~/.openclaw/mail-assistant.rules.json`

你可以用 `--rules <path>` 或環境變數覆蓋：
- `MAIL_ASSISTANT_RULES=/path/to/rules.json`

### 規則檔 Schema（v1，使用者可自行編輯）
參考範例：
- `/home/matt/clawd/skills/custom/mail-assistant/references/mail-assistant.rules.example.json`

重點欄位：
- `important_unread.enabled`：是否啟用重要未讀檢查
- `important_unread.match_any[]`：多條規則（符合任一條就算重要）
  - `from_contains[] / to_contains[] / subject_contains[]`：不分大小寫的「包含」比對
  - `flags_forbidden` 建議放 `"Seen"`，避免已讀再次提醒

> 若規則檔不存在/空的，`notify_important_unread.js` 會輸出 **完全一致** 的字串：`NO_REPLY`

---

## 通知 Runner（給 Cron / PM 用）

### 重要未讀檢查
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/notify_important_unread.js

# 需要 JSON
node /home/matt/clawd/skills/custom/mail-assistant/scripts/notify_important_unread.js --json
```

### 每日摘要
```bash
node /home/matt/clawd/skills/custom/mail-assistant/scripts/notify_daily_summary.js --top 10
```

---

## Cron 範本（只提供範本，不會在程式內自動建立）

> PM 會自行新增 Cron；此處僅提供指令範本。

### 每 10 分鐘檢查「重要未讀」
```bash
openclaw cron add \
  --name "Mail: Important Unread (10m)" \
  --every 10m \
  --agent main \
  --message "Run mail-assistant important-unread check and notify if needed" \
  --thinking off
```

### 每天 09:00 寄出每日摘要（Asia/Taipei）
```bash
openclaw cron add \
  --name "Mail: Daily Summary (09:00)" \
  --cron "0 9 * * *" \
  --tz "Asia/Taipei" \
  --agent main \
  --message "Run mail-assistant daily summary" \
  --thinking off
```
