#!/usr/bin/env bash
# Weekly AI Deep Brief: send task to main session
set -euo pipefail
openclaw sessions send --agent main --message "📊 [系統排程] 請準備本週 AI 深度簡報（繁體中文）。結構：本週總覽、5-8 則重點、趨勢判讀、下週觀察、行動建議。用 web_search 搜尋過去 7 天的 AI 新聞，整理後用 message tool 發送給主人（target=894437982）。"
