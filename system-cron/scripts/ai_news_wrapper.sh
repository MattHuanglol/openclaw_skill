#!/usr/bin/env bash
# AI News Brief: pure script using gemini CLI for search+summarize
# Result sent via openclaw message send directly to Telegram (no session lock needed)
set -euo pipefail

PATH=/home/matt/.local/share/pnpm:/home/matt/.npm-global/bin:/home/matt/.nvm/versions/node/v24.13.0/bin:/usr/local/bin:/usr/bin:/bin
HOME=/home/matt
export GEMINI_MODEL="gemini-2.5-flash"

PROMPT='Search the web for the latest AI news from the past 12 hours. Select 3-6 important items and format as a concise Traditional Chinese (繁體中文) news brief with this structure:

📰 每日 AI 新聞簡報

For each item:
- 標題 + 一句話重點
- 來源連結

End with: 🔍 今日觀察 (1-2 sentences)

Output ONLY the formatted brief, nothing else.'

OUTPUT=$(echo "$PROMPT" | gemini -m gemini-2.5-flash 2>/dev/null) || true

if [[ -z "$OUTPUT" ]] || [[ ${#OUTPUT} -lt 50 ]]; then
  exit 0
fi

# Send directly to Telegram via openclaw message (brief lock, <1s)
openclaw message send --channel telegram --target 894437982 --message "$OUTPUT"
