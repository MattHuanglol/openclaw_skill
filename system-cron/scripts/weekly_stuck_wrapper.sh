#!/usr/bin/env bash
# Weekly Stuck Analysis: run script, send result if any
set -euo pipefail

OUTPUT=$(node /home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/analyze_stuck.js 2>&1) || true

if [[ -z "$OUTPUT" ]] || echo "$OUTPUT" | grep -q "No stuck events"; then
  exit 0
fi

openclaw sessions send --agent main --message "📊 [系統排程] 卡點週報結果：
$OUTPUT

請整理通知主人，並確認點子庫是否已建立。"
