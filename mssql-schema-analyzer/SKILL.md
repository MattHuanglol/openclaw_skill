# MSSQL Schema Analyzer（READ-ONLY）

這個 skill 用來**安全、唯讀（READ-ONLY）**地擷取 SQL Server（MSSQL）資料庫的結構與容量概況，並產生：
- 全量 schema dump（JSON）
- Core（聚焦）schema dump（JSON：依表大小挑選 Top N + 外鍵鄰域）
- Markdown 報告（含 Mermaid ERD，聚焦 Core）

> 只會執行 `SELECT` 查詢讀取系統 metadata（`sys.*` / `dm_db_*`），不會建立/修改任何物件。

---

## 需求

- Node.js（建議 18+；本環境可用 Node 24）
- 可連線到 MSSQL（SQL Server 2025）

---

## 安裝

進入此 skill 目錄安裝依賴：

```bash
cd /home/matt/clawd/skills/custom/mssql-schema-analyzer
npm i
```

---

## Secrets / 環境變數

連線資訊讀取順序：
1) `process.env`
2) `~/.openclaw/secrets.env`

需要的 key：
- `MSSQL_HOST`
- `MSSQL_PORT`（可選，預設 1433）
- `MSSQL_DATABASE`
- `MSSQL_USER`
- `MSSQL_PASSWORD`
- `MSSQL_ENCRYPT`（可選，預設 true）
- `MSSQL_TRUST_CERT`（可選，預設 false）
- `MSSQL_TLS_MIN_VERSION`（可選，例如 `TLSv1.2`；僅在伺服器 TLS 很舊導致連線失敗時使用）

`~/.openclaw/secrets.env` 範例（請勿提交到 git）：

```env
MSSQL_HOST=127.0.0.1
MSSQL_PORT=1433
MSSQL_DATABASE=MyDb
MSSQL_USER=readonly_user
MSSQL_PASSWORD=***
MSSQL_ENCRYPT=true
MSSQL_TRUST_CERT=false
```

> 腳本**不會輸出密碼**，請避免自行在終端機 echo 這些值。

---

## 用法

### 1) 產生 schema dump（全量 + core）

```bash
node /home/matt/clawd/skills/custom/mssql-schema-analyzer/scripts/mssql_schema_dump.js \
  --out /home/matt/clawd/tmp/mssql-schema-dump.json \
  --core-top 20 \
  --core-depth 1
```

輸出：
- 全量：`/home/matt/clawd/tmp/mssql-schema-dump.json`
- Core：`/home/matt/clawd/tmp/mssql-schema-dump-core.json`

可用參數：
- `--out PATH`：全量 dump 位置
- `--core-out PATH`：core dump 位置
- `--core-top N`：依 reserved_kb 排名前 N 張表作為 core seed（預設 20）
- `--core-depth N`：外鍵鄰域擴張深度（預設 1）
- `--timeout-ms MS`：每個 request 超時（預設 60000）
- `--connection-timeout-ms MS`：連線超時（預設 15000）
- `--max-text-bytes BYTES`：輸出檔案大小保護（預設 2000000）

### 2) 產生 Markdown 報告 + Mermaid ERD

```bash
node /home/matt/clawd/skills/custom/mssql-schema-analyzer/scripts/mssql_schema_report.js \
  --in /home/matt/clawd/tmp/mssql-schema-dump.json \
  --out /home/matt/clawd/tmp/mssql-schema-report.md
```

預設會自動尋找同目錄下的 `*-core.json` 作為 ERD 聚焦（若不存在，則以全量 dump 生成）。

### 3) 一鍵跑完（dump -> report）

```bash
bash /home/matt/clawd/skills/custom/mssql-schema-analyzer/scripts/run_all.sh
```

可用環境變數：
- `DUMP_OUT`（預設 `/home/matt/clawd/tmp/mssql-schema-dump.json`）
- `REPORT_OUT`（預設 `/home/matt/clawd/tmp/mssql-schema-report.md`）
- `CORE_TOP`（預設 20）
- `CORE_DEPTH`（預設 1）

---

## 產出內容（摘要）

Dump 會包含：
- Schemas
- Tables（含 `row_count`/`reserved_kb`/`used_kb`/`data_kb` 的估計值）
- Columns
- PK / Unique constraints（欄位順序）
- Indexes（keys + includes）
- Foreign keys（欄位對應、on delete/update、disabled/trusted）

Report 會包含：
- 總覽統計
- 前 20 大表（依 reserved_kb）
- 連結度最高的 20 張表（依 FK in/out）
- Core 聚焦的 Mermaid ERD + MermaidId 對照表

---

## Smoke Test（快速冒煙測試）

1) 確認 secrets 有設定（建議先用 readonly 帳號）。
2) 安裝依賴：
   ```bash
   cd /home/matt/clawd/skills/custom/mssql-schema-analyzer
   npm i
   ```
3) 只跑 dump（會在 stdout 印出安全摘要，不含密碼）：
   ```bash
   node scripts/mssql_schema_dump.js --out /home/matt/clawd/tmp/mssql-schema-dump.json
   ```
4) 檢查檔案存在：
   - `/home/matt/clawd/tmp/mssql-schema-dump.json`
   - `/home/matt/clawd/tmp/mssql-schema-dump-core.json`
5) 產生報告：
   ```bash
   node scripts/mssql_schema_report.js --in /home/matt/clawd/tmp/mssql-schema-dump.json
   ```

若遇到 TLS/憑證問題，可在 secrets 設定 `MSSQL_TRUST_CERT=true`（請了解風險）。
