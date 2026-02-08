#!/usr/bin/env bash
# Weekly AI Deep Brief: pure script using gemini CLI
set -euo pipefail

PATH=/home/matt/.local/share/pnpm:/home/matt/.npm-global/bin:/home/matt/.nvm/versions/node/v24.13.0/bin:/usr/local/bin:/usr/bin:/bin
HOME=/home/matt

PROMPT='Search the web for the most important AI news and developments from the past 7 days. Create a comprehensive weekly brief in Traditional Chinese (繁體中文) with this structure:

🦊 妲己本週 AI 深度簡報

📊 本週總覽 (2-3 sentences overview)

🚀 5-8 則重點 (numbered, each with title + impact + source)

🧐 趨勢判讀 (2-3 key trends)

🔍 下週觀察 (what to watch)

💡 行動建議 (practical advice)

Output ONLY the formatted brief.'

OUTPUT=$(echo "$PROMPT" | gemini -m gemini-2.5-flash 2>/dev/null) || true

if [[ -z "$OUTPUT" ]] || [[ ${#OUTPUT} -lt 100 ]]; then
  exit 0
fi

openclaw message send --channel telegram --target 894437982 --message "$OUTPUT"
