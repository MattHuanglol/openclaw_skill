---
name: mail-assistant
description: Manage email via himalaya CLI (hmattwork). Provides deterministic Node scripts to list/search/read/mark/archive. Includes notification runner scripts (important unread + daily summary) driven by a user-editable rules JSON.
---

# Mail Assistant（郵件助理）

本技能使用 **himalaya CLI**（帳號：`hmattwork`）來讀取/搜尋郵件、讀取內文摘要、標記已讀/未讀、移動/歸檔。

> 本技能不儲存任何密碼或 token。

---

## 帳號資訊
- **帳號**：`hmattwork` (`matt.huang@xummit.com.tw`)
- **信箱來源**：公司信件同步至此信箱
- **可用資料夾**：INBOX, Notes, [Gmail]/全部郵件, [Gmail]/垃圾桶, [Gmail]/垃圾郵件, [Gmail]/寄件備份, [Gmail]/已加星號, [Gmail]/草稿, [Gmail]/重要郵件, 聖宜網站通知

---

## 檔案結構
- `mail-assistant.rules.json`：**規則檔**（通知 runner 用，隨 skill 版控）
- `scripts/mail_assistant.js`：統一入口
- `scripts/mail_list.js`：列出信件
- `scripts/mail_search.js`：搜尋（from/to/subject/body）+ 分頁
- `scripts/mail_read.js`：讀信（安全摘要：標頭 + 內文前 N 行）
- `scripts/mail_mark.js`：標記已讀/未讀
- `scripts/mail_move.js`：移動/歸檔
- `scripts/notify_important_unread.js`：重要未讀檢查（規則驅動）
- `scripts/notify_daily_summary.js`：每日摘要
- `scripts/rules_util.js`：規則載入/比對工具
- `scripts/himalaya_util.js`：himalaya CLI wrapper

---

## 使用方法

### 列出信件
```bash
node scripts/mail_assistant.js list --folder INBOX --limit 10
node scripts/mail_assistant.js list --folder "[Gmail]/全部郵件" --limit 20
```

### 搜尋
```bash
node scripts/mail_assistant.js search --folder "[Gmail]/全部郵件" --from github --limit 10
node scripts/mail_assistant.js search --folder INBOX --unread --subject "urgent" --limit 20
```

### 讀信（安全預覽，不自動標記已讀）
```bash
node scripts/mail_assistant.js read 42078 --folder INBOX --lines 30
```

### 標記已讀/未讀
```bash
node scripts/mail_assistant.js mark seen 42078 --folder INBOX
node scripts/mail_assistant.js mark unseen 42078 --folder INBOX
```

### 歸檔 / 移動
```bash
node scripts/mail_assistant.js archive 42078 --folder INBOX
node scripts/mail_assistant.js move --target "[Gmail]/All Mail" 42078 --folder INBOX
```

---

## 規則檔

### 位置
- **預設路徑**：`<skill-dir>/mail-assistant.rules.json`（與 skill 一起版控）
- 可用 `--rules <path>` 或 `MAIL_ASSISTANT_RULES` 環境變數覆蓋

### 目前規則（重要未讀）

| 規則名稱 | 比對條件 | 說明 |
|----------|---------|------|
| GitHub Issues/PR | `from_contains: ["github"]` | GitHub 通知信 |
| Google 安全性快訊 | `subject_contains: ["安全性快訊"]` | Google 帳號安全警報 |
| 診所系統異常 | `from: sainteir` + `subject: 問題` | 出勤/刷卡等系統異常 |
| Splashtop 漏洞警告 | `from: splashtop` + `subject: Critical/Vulnerability` | 遠端管理漏洞警告 |

### 規則格式
```json
{
  "important_unread": {
    "enabled": true,
    "folder": "[Gmail]/全部郵件",
    "max_scan": 100,
    "match_any": [
      {
        "name": "規則名稱",
        "from_contains": ["關鍵字"],
        "subject_contains": ["關鍵字"],
        "to_contains": ["關鍵字"],
        "flags_required": [],
        "flags_forbidden": ["Seen"]
      }
    ]
  },
  "daily_summary": {
    "enabled": true,
    "folder": "[Gmail]/全部郵件",
    "top_n": 15,
    "page_size": 50,
    "max_pages": 3
  }
}
```

- `match_any`：符合**任一條**規則即算重要
- `from_contains` / `subject_contains`：不分大小寫，包含比對
- 同一規則內多個條件為 **AND** 邏輯

---

## 通知 Runner

### 重要未讀檢查
```bash
node scripts/notify_important_unread.js
node scripts/notify_important_unread.js --json
```
- 有匹配 → 輸出 `IMPORTANT_UNREAD (N)` + 逐條列出
- 無匹配 → 輸出 `NO_REPLY`

### 每日摘要
```bash
node scripts/notify_daily_summary.js
node scripts/notify_daily_summary.js --top 15
```
- 輸出未讀數量 + 前 N 封未讀信件清單

---

## Cron 排程（已啟用）

| 名稱 | 頻率 | 說明 |
|------|------|------|
| 🚨 重要郵件檢查 | 每 30 分鐘 | 比對規則，有重要信即通知 |
| 📧 每日郵件摘要 09:00 | 每天 09:00 | 早上信箱總覽 |
| 📧 每日郵件摘要 17:00 | 每天 17:00 | 下班前信箱總覽 |

全部使用 `google-antigravity/gemini-3-flash` 模型，isolated session 執行。

---

## 信箱內容分類（2026-02-08 分析）

| 來源 | 類型 | 數量佔比 | 通知策略 |
|------|------|---------|---------|
| 診所營運管理系統 (sainteir.com) | 授權結帳通知 | ~80% | 靜音（每日摘要） |
| 診所營運管理系統 (sainteir.com) | 出勤/刷卡/特休 | ~5% | 異常信即時通知 |
| WordPress (xummit.com.tw) | WP 更新通知 | ~10% | 每日摘要 |
| GitHub (matthuang-hue/SaintEir) | Issue/PR 回覆 | 少量 | 🔴 即時通知 |
| Google | 安全性快訊、Cloud 更新 | 少量 | 🔴 安全即時 / 更新摘要 |
| Splashtop | 設備管理、漏洞報告 | 少量 | 漏洞即時 / 其餘摘要 |
| NotebookLM | 共用邀請 | 少量 | 每日摘要 |
| SIGN CHINA / Nutanix | 行銷信 | 少量 | 忽略或摘要 |
