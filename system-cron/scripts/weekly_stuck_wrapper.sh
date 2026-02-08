#!/usr/bin/env bash
# Weekly Stuck Analysis: run script, send result directly to Telegram
set -euo pipefail

PATH=/home/matt/.npm-global/bin:/home/matt/.nvm/versions/node/v24.13.0/bin:/usr/local/bin:/usr/bin:/bin
HOME=/home/matt

OUTPUT=$(node /home/matt/clawd/skills/custom/kanban-dev-monitor/scripts/analyze_stuck.js 2>&1) || true

if [[ -z "$OUTPUT" ]] || echo "$OUTPUT" | grep -q "No stuck events"; then
  exit 0
fi

openclaw message send --channel telegram --target 894437982 --message "📊 卡點週報結果：
$OUTPUT"
