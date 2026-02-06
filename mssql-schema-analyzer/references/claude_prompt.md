# Claude Prompt Template — MSSQL Schema Analyzer

你是一位資深資料庫架構師 / 資料建模顧問。

我會提供由 OpenClaw skill `mssql-schema-analyzer` 產生的 JSON：
- 全量：`/home/matt/clawd/tmp/mssql-schema-dump.json`
- Core（聚焦）：`/home/matt/clawd/tmp/mssql-schema-dump-core.json`
- Markdown 報告：`/home/matt/clawd/tmp/mssql-schema-report.md`

請根據 **core JSON**（必要時參考全量 JSON）完成下列任務：

1) 用條列方式總結資料庫的核心領域（domain）與可能的主實體（entities）。
2) 找出最關鍵的 5–10 張表，推測其角色（例如：主檔/交易/關聯/日誌/維度）。
3) 針對外鍵關係（FK）推測：
   - 主要的「一對多」關係
   - 可能的多對多（透過 junction table）
   - 是否存在循環依賴或過度耦合
4) 以「命名規範、索引策略、資料型別一致性、nullable、寬表/大表」等角度提出具體改善建議。
5) 針對前 20 大表（依 reserved_kb）提出：
   - 可能的分區/歸檔策略
   - 查詢/索引優化建議

注意：
- 這些輸出是 READ-ONLY 取得的系統 metadata；不要要求我提供密碼或連線字串。
- 以繁體中文回答。
